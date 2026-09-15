import { existsSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatText } from "../src/report.js";
import { run } from "../src/run.js";
import type { Report } from "../src/types.js";
import { startServer } from "./server.js";

const OUT = "ui-assert-out-test";
let origin: string;
let close: () => Promise<void>;
let bad: Report;

beforeAll(async () => {
  ({ origin, close } = await startServer());
  rmSync(OUT, { recursive: true, force: true });
  bad = await run({ url: `${origin}/bad.html`, out: OUT, viewports: ["375x812"] });
});

afterAll(async () => {
  rmSync(OUT, { recursive: true, force: true });
  await close();
});

const tokenKinds = (r: Report, kind: string) =>
  (r.tokens?.findings ?? []).filter((f) => f.kind === kind);
const layoutMessages = (r: Report) =>
  (r.layout?.cells ?? []).flatMap((c) => c.findings.map((f) => f.message));
const a11yIds = (r: Report) =>
  (r.a11y?.cells ?? []).flatMap((c) => c.violations.map((v) => v.id));

describe("bad fixture", () => {
  it("reports the undefined token with no fallback as an error", () => {
    const f = tokenKinds(bad, "undefined-token").find((x) => x.token === "--surface-missing");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("error");
    expect(f!.property).toBe("background-color");
  });

  it("reports the undefined token with a fallback as a warning", () => {
    const f = tokenKinds(bad, "fallback-used").find((x) => x.token === "--gap-missing");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("warning");
  });

  it("reports hardcoded colours from stylesheets and inline styles", () => {
    const values = tokenKinds(bad, "hardcoded").map((f) => f.value);
    expect(values).toContain("rgb(255, 0, 0)");
    expect(values).toContain("rgb(1, 2, 3)");
  });

  it("reports layout overflow, offscreen elements and small targets", () => {
    const messages = layoutMessages(bad);
    expect(messages.some((m) => m.startsWith("text overflows box"))).toBe(true);
    expect(messages.some((m) => m.startsWith("extends past viewport"))).toBe(true);
    expect(messages.some((m) => m.includes("smaller than 24x24"))).toBe(true);
    expect(messages.some((m) => m.startsWith("horizontal page overflow"))).toBe(true);
  });

  it("reports axe violations", () => {
    expect(a11yIds(bad)).toContain("image-alt");
    expect(a11yIds(bad)).toContain("color-contrast");
  });

  it("screenshots the failing cells", () => {
    const shot = bad.layout!.cells.find((c) => c.screenshot)?.screenshot;
    expect(shot).toBeDefined();
    expect(existsSync(shot!)).toBe(true);
  });

  it("fails", () => {
    expect(bad.summary.passed).toBe(false);
    expect(bad.summary.errors).toBeGreaterThan(0);
  });
});

describe("good fixture", () => {
  it("passes with no findings", async () => {
    const r = await run({ url: `${origin}/good.html`, out: OUT, viewports: ["375x812"] });
    expect(r.tokens!.findings).toEqual([]);
    expect(r.layout!.cells.flatMap((c) => c.findings)).toEqual([]);
    expect(r.a11y!.cells.flatMap((c) => c.violations)).toEqual([]);
    expect(r.summary).toMatchObject({ errors: 0, warnings: 0, passed: true });
  });
});

describe("scope", () => {
  it("restricts findings to the subtree", async () => {
    const r = await run({
      url: `${origin}/bad.html`,
      scope: "h1.title",
      out: OUT,
      viewports: ["375x812"],
      schemes: ["light"],
      a11y: false,
    });
    expect(r.tokens!.findings).toEqual([]);
  });
});

describe("formatText", () => {
  it("prints one line per finding with no ANSI codes", () => {
    const text = formatText(bad);
    expect(text).not.toMatch(new RegExp(String.fromCharCode(27) + "\\["));
    expect(text).toContain("FAIL");
    expect(text).toContain("undefined token --surface-missing");

    const findingLines = text
      .split("\n")
      .filter((l) => l.startsWith("  error") || l.startsWith("  warning"));
    expect(findingLines.length).toBe(bad.tokens!.findings.length);
  });

  it("prints ok for a clean section and PASS overall", () => {
    const clean: Report = {
      ...bad,
      tokens: { findings: [], skippedSheets: 0, inspectedRules: 3, truncated: [] },
      layout: { cells: [] },
      a11y: { cells: [] },
      summary: { errors: 0, warnings: 0, passed: true, failOn: "error" },
    };
    const text = formatText(clean);
    expect(text).toContain("layout    ok");
    expect(text.trim().endsWith("PASS")).toBe(true);
  });
});
