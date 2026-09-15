import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import * as playwright from "playwright";
import type { Page } from "playwright";
import { checkA11y } from "./checks/a11y.js";
import { checkLayout } from "./checks/layout.js";
import { checkTokens, mergeTokens, type TokensResult } from "./checks/tokens.js";
import {
  DEFAULT_PROPS, DEFAULT_SCHEMES, DEFAULT_VIEWPORTS,
  type Report, type RunOptions,
} from "./types.js";

export async function run(options: RunOptions): Promise<Report> {
  const o = {
    scope: "body",
    viewports: DEFAULT_VIEWPORTS,
    schemes: DEFAULT_SCHEMES,
    browser: "chromium" as const,
    wait: "250",
    props: DEFAULT_PROPS,
    ignore: [] as string[],
    includeThirdParty: false,
    strictTokens: false,
    tokens: true,
    layout: true,
    a11y: true,
    out: "ui-assert-out",
    failOn: "error" as const,
    // The CLI passes every flag, so drop the unset ones or they beat the defaults.
    ...(Object.fromEntries(
      Object.entries(options).filter(([, v]) => v !== undefined),
    ) as RunOptions),
  };

  const startedAt = new Date();
  const t0 = Date.now();
  const browser = await playwright[o.browser].launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const report: Report = {
    url: o.url,
    browser: o.browser,
    startedAt: startedAt.toISOString(),
    durationMs: 0,
    matrix: { viewports: o.viewports, schemes: o.schemes },
    summary: { errors: 0, warnings: 0, passed: true, failOn: o.failOn },
  };

  try {
    // HMR websockets and polling keep a dev server's network busy forever, so
    // networkidle may never fire; `load` is good enough to carry on with.
    try {
      await page.goto(o.url, { waitUntil: "networkidle", timeout: 10_000 });
    } catch {
      await page.goto(o.url, { waitUntil: "load" });
    }
    await settle(page, o.wait);

    let tokens: TokensResult | undefined;
    const layoutCells: NonNullable<Report["layout"]>["cells"] = [];
    const a11yCells: NonNullable<Report["a11y"]>["cells"] = [];
    let outMade = false;

    for (const viewport of o.viewports) {
      const [w, h] = viewport.split("x").map(Number);
      for (const scheme of o.schemes) {
        await page.setViewportSize({ width: w ?? 1280, height: h ?? 800 });
        await page.emulateMedia({ colorScheme: scheme as "light" | "dark" });
        if (o.themeAttr) {
          await page.evaluate(
            ([name, value]) => document.documentElement.setAttribute(name!, value!),
            [o.themeAttr, scheme],
          );
        }
        await page.waitForTimeout(100);
        await settle(page, o.wait);

        if (o.tokens) {
          const cellTokens = await checkTokens(page, o);
          tokens = tokens ? mergeTokens(tokens, cellTokens) : cellTokens;
        }

        if (o.layout) {
          const findings = await checkLayout(page, o);
          const cell: (typeof layoutCells)[number] = { viewport, scheme, findings };
          if (findings.some((f) => f.severity === "error")) {
            if (!outMade) {
              await mkdir(o.out, { recursive: true });
              outMade = true;
            }
            cell.screenshot = join(o.out, `${viewport}-${scheme}.png`);
            await page.screenshot({ fullPage: false, path: cell.screenshot });
          }
          layoutCells.push(cell);
        }

        if (o.a11y) {
          a11yCells.push({ viewport, scheme, violations: await checkA11y(page, o) });
        }
      }
    }

    if (tokens) report.tokens = tokens;
    if (o.layout) report.layout = { cells: layoutCells };
    if (o.a11y) report.a11y = { cells: a11yCells };
  } finally {
    await browser.close();
  }

  report.durationMs = Date.now() - t0;
  report.summary = summarise(report, o.failOn);
  return report;
}

async function settle(page: Page, wait: string) {
  const ms = Number(wait);
  if (Number.isFinite(ms)) await page.waitForTimeout(ms);
  else await page.waitForSelector(wait, { timeout: 10_000 });
}

function summarise(report: Report, failOn: Report["summary"]["failOn"]) {
  let errors = 0;
  let warnings = 0;
  const bump = (s: "error" | "warning") => (s === "error" ? errors++ : warnings++);

  for (const f of report.tokens?.findings ?? []) bump(f.severity);

  // Count distinct problems, not problem x cell: the same overflow in six
  // cells is one thing to fix.
  const layoutSeen = new Set<string>();
  for (const c of report.layout?.cells ?? []) {
    for (const f of c.findings) {
      const k = `${f.kind}|${f.sample}|${f.message}`;
      if (!layoutSeen.has(k)) {
        layoutSeen.add(k);
        bump(f.severity);
      }
    }
  }
  const a11ySeen = new Set<string>();
  for (const c of report.a11y?.cells ?? []) {
    for (const v of c.violations) {
      if (!a11ySeen.has(v.id)) {
        a11ySeen.add(v.id);
        bump(v.severity);
      }
    }
  }

  const passed =
    failOn === "none" ? true : failOn === "warning" ? errors + warnings === 0 : errors === 0;
  return { errors, warnings, passed, failOn };
}
