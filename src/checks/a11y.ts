import { AxeBuilder } from "@axe-core/playwright";
import type { Result } from "axe-core";
import type { Page } from "playwright";
import type { A11yViolation } from "../types.js";

export type A11yOptions = { scope: string; ignore: string[] };

export async function checkA11y(page: Page, opts: A11yOptions): Promise<A11yViolation[]> {
  let builder = new AxeBuilder({ page });
  if (opts.scope && opts.scope !== "body") builder = builder.include(opts.scope);
  for (const sel of opts.ignore) builder = builder.exclude(sel);

  const { violations } = await builder.analyze();
  return violations.map((v: Result) => ({
    id: v.id,
    impact: v.impact ?? "minor",
    severity: v.impact === "critical" || v.impact === "serious" ? "error" : "warning",
    count: v.nodes.length,
    sample: String(v.nodes[0]?.target?.[0] ?? ""),
    help: v.help,
    helpUrl: v.helpUrl,
  }));
}
