import type { A11yViolation, LayoutFinding, Report, Severity, TokenFinding } from "./types.js";

export function formatText(report: Report): string {
  const lines: string[] = [];
  const secs = (report.durationMs / 1000).toFixed(1);
  const { viewports, schemes } = report.matrix;
  lines.push(
    `ui-assert ${report.url}  ${report.browser}  ${viewports.length} viewport${viewports.length === 1 ? "" : "s"} x ${schemes.join(",")}  (${secs}s)`,
    "",
  );

  if (report.tokens) lines.push(...tokensSection(report.tokens));
  if (report.layout) lines.push(...layoutSection(report.layout));
  if (report.a11y) lines.push(...a11ySection(report.a11y));

  const { errors, warnings, passed } = report.summary;
  lines.push(passed ? "PASS" : `FAIL  ${count(errors, "error")}, ${count(warnings, "warning")}`);
  return lines.join("\n");
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function tally(severities: Severity[]): string {
  const e = severities.filter((s) => s === "error").length;
  const w = severities.length - e;
  if (!severities.length) return "ok";
  return [e && count(e, "error"), w && count(w, "warning")].filter(Boolean).join(", ");
}

function tokensSection(tokens: NonNullable<Report["tokens"]>): string[] {
  const stats = `(${tokens.inspectedRules} rules inspected, ${count(tokens.skippedSheets, "sheet")} skipped)`;
  const head = `tokens    ${tally(tokens.findings.map((f) => f.severity))}   ${stats}`;
  if (!tokens.findings.length) return [head, ""];

  const lines = [head];
  for (const f of tokens.findings) {
    lines.push(
      `  ${pad(f.severity, 8)} ${pad(describe(f), 36)} ${pad(f.property, 18)} ${pad(f.selector, 24)} ${count(f.elements, "element")}`.trimEnd(),
    );
  }
  for (const kind of tokens.truncated) lines.push(`  … more ${kind} findings truncated at 50`);
  lines.push("");
  return lines;
}

function describe(f: TokenFinding): string {
  switch (f.kind) {
    case "undefined-token":
      return `undefined token ${f.token}`;
    case "fallback-used":
      return `token undefined, fallback in use ${f.token}`;
    case "non-token-var":
      return `non-token custom property ${f.token}`;
    case "hardcoded":
      return `hardcoded ${f.value}`;
  }
}

function layoutSection(layout: NonNullable<Report["layout"]>): string[] {
  // The same finding usually shows up in every cell; one line per distinct
  // problem, listing where it happened.
  const merged = new Map<string, { cells: string[]; f: LayoutFinding; screenshot?: string }>();
  for (const cell of layout.cells) {
    for (const f of cell.findings) {
      const k = `${f.kind}|${f.sample}|${f.message}`;
      const entry = merged.get(k) ?? { cells: [], f };
      entry.cells.push(`${cell.viewport} ${cell.scheme}`);
      if (!entry.screenshot && f.severity === "error" && cell.screenshot) entry.screenshot = cell.screenshot;
      merged.set(k, entry);
    }
  }
  const head = `layout    ${tally([...merged.values()].map((m) => m.f.severity))}`;
  if (!merged.size) return [head, ""];

  const lines = [head];
  for (const { cells, f, screenshot } of merged.values()) {
    const where = cells.length === layout.cells.length ? "all cells" : cells.join(", ");
    const shot = screenshot ? `  ${screenshot}` : "";
    lines.push(
      `  ${pad(`[${where}]`, 30)} ${pad(f.severity, 8)} ${pad(f.message, 44)} ${f.sample}${shot}`.trimEnd(),
    );
  }
  lines.push("");
  return lines;
}

function a11ySection(a11y: NonNullable<Report["a11y"]>): string[] {
  // The same violation repeats in most cells; collapse it to one line listing them.
  const merged = new Map<string, { cells: string[]; v: A11yViolation }>();
  for (const cell of a11y.cells) {
    for (const v of cell.violations) {
      const entry = merged.get(v.id) ?? { cells: [], v };
      entry.cells.push(`${cell.viewport} ${cell.scheme}`);
      merged.set(v.id, entry);
    }
  }
  const head = `a11y      ${tally([...merged.values()].map((m) => m.v.severity))}`;
  if (!merged.size) return [head, ""];

  const lines = [head];
  for (const { cells, v } of merged.values()) {
    const where = cells.length === a11y.cells.length ? "all cells" : cells.join(", ");
    lines.push(
      `  ${pad(`[${where}]`, 30)} ${pad(v.impact, 9)} ${pad(v.id, 20)} ${count(v.count, "node")}  ${pad(v.sample, 20)} ${v.helpUrl}`.trimEnd(),
    );
  }
  lines.push("");
  return lines;
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
