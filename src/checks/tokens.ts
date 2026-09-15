import type { Page } from "playwright";
import type { TokenFinding, TokenFindingKind } from "../types.js";

export type TokensOptions = {
  scope: string;
  props: string[];
  ignore: string[];
  includeThirdParty: boolean;
  strictTokens: boolean;
  tokenPrefix?: string;
};

export type TokensResult = {
  findings: TokenFinding[];
  skippedSheets: number;
  inspectedRules: number;
  truncated: TokenFindingKind[];
};

export async function checkTokens(page: Page, opts: TokensOptions): Promise<TokensResult> {
  return page.evaluate(collect, opts);
}

// Re-run per matrix cell: theme-scoped blocks can define a token only under one
// scheme, so a token that resolves in light may be undefined in dark.
export function mergeTokens(a: TokensResult, b: TokensResult): TokensResult {
  const seen = new Set(a.findings.map(key));
  const findings = a.findings.slice();
  for (const f of b.findings) {
    if (!seen.has(key(f))) {
      seen.add(key(f));
      findings.push(f);
    }
  }
  return {
    findings,
    skippedSheets: Math.max(a.skippedSheets, b.skippedSheets),
    inspectedRules: Math.max(a.inspectedRules, b.inspectedRules),
    truncated: [...new Set([...a.truncated, ...b.truncated])],
  };
}

const key = (f: TokenFinding) => `${f.kind}|${f.property}|${f.value}|${f.selector}`;

function collect(o: TokensOptions): TokensResult {
  const NAMED = new Set(
    ("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen").split(" "),
  );
  const KEYWORDS = new Set([
    "inherit", "initial", "unset", "revert", "revert-layer",
    "currentcolor", "transparent", "none", "auto",
  ]);
  const FUNCS = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\s*\(/i;
  const HEX = /#[0-9a-f]{3,8}\b/i;

  const scopeEl = (document.querySelector(o.scope) as HTMLElement | null) ?? document.body;

  const ignored: Element[] = [];
  for (const sel of o.ignore) {
    try {
      scopeEl.querySelectorAll(sel).forEach((e) => ignored.push(e));
    } catch {
      /* invalid ignore selector */
    }
  }
  const isIgnored = (el: Element) => ignored.some((i) => i === el || i.contains(el));

  function elementPath(el: Element): string {
    const parts: string[] = [];
    let cur: Element | null = el;
    for (let i = 0; i < 4 && cur && cur !== document.documentElement; i++) {
      let s = cur.tagName.toLowerCase();
      if (cur.id) s += `#${cur.id}`;
      else {
        const cls = Array.from(cur.classList).slice(0, 2);
        if (cls.length) s += `.${cls.join(".")}`;
      }
      const tid = cur.getAttribute("data-testid");
      if (tid) s += `[data-testid=${tid}]`;
      parts.unshift(s);
      cur = cur.parentElement;
    }
    const path = parts.join(" > ");
    return path.length > 120 ? `…${path.slice(-119)}` : path;
  }

  // querySelectorAll can't match ::before or :hover, so match on a stripped
  // selector to find the elements the rule applies to, and report the original.
  function matchable(sel: string): string {
    return sel
      .split(",")
      .map((s) =>
        s
          .replace(/::[a-z-]+(\([^)]*\))?/gi, "")
          .replace(/:(hover|active|focus|focus-visible|focus-within|visited|link|target|checked|disabled|enabled|indeterminate|placeholder-shown|autofill|user-invalid|user-valid)\b/gi, "")
          .trim(),
      )
      .filter(Boolean)
      .join(", ");
  }

  function match(sel: string): Element[] {
    const m = matchable(sel);
    if (!m) return [];
    try {
      return Array.from(scopeEl.querySelectorAll(m)).filter((e) => !isIgnored(e));
    } catch {
      return [];
    }
  }

  function varRefs(value: string): { name: string; fallback: boolean }[] {
    const out: { name: string; fallback: boolean }[] = [];
    const re = /var\(\s*(--[\w-]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(value))) {
      // fallback = a comma at depth 0 inside this var()
      let depth = 1;
      let fallback = false;
      for (let i = m.index + 4; i < value.length && depth > 0; i++) {
        const c = value[i];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (c === "," && depth === 1) {
          fallback = true;
          break;
        }
      }
      out.push({ name: m[1]!, fallback });
    }
    return out;
  }

  function isLiteral(value: string): boolean {
    const v = value.trim().toLowerCase();
    if (!v || KEYWORDS.has(v)) return false;
    if (HEX.test(v) || FUNCS.test(v)) return true;
    return v.split(/[\s,()/]+/).some((w) => NAMED.has(w));
  }

  const findings: TokenFinding[] = [];
  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  const truncated = new Set<TokenFindingKind>();

  function add(f: TokenFinding) {
    const k = `${f.kind}|${f.property}|${f.value}|${f.selector}`;
    if (seen.has(k)) return;
    counts[f.kind] = (counts[f.kind] ?? 0) + 1;
    if (counts[f.kind]! > 50) {
      truncated.add(f.kind);
      return;
    }
    seen.add(k);
    findings.push(f);
  }

  function reportVars(value: string, prop: string, selector: string, els: Element[]) {
    for (const ref of varRefs(value)) {
      if (o.tokenPrefix && !ref.name.startsWith(o.tokenPrefix)) {
        add({
          kind: "non-token-var", severity: "warning", property: prop, value,
          token: ref.name, selector, elements: els.length, sample: elementPath(els[0]!),
        });
        continue; // already flagged; an undefined-token line on top is just noise
      }
      const undef = els.filter(
        (el) => getComputedStyle(el).getPropertyValue(ref.name).trim() === "",
      );
      if (!undef.length) continue;
      add(
        ref.fallback
          ? {
              kind: "fallback-used", severity: "warning", property: prop, value,
              token: ref.name, selector, elements: undef.length, sample: elementPath(undef[0]!),
            }
          : {
              kind: "undefined-token", severity: "error", property: prop, value,
              token: ref.name, selector, elements: undef.length, sample: elementPath(undef[0]!),
            },
      );
    }
  }

  let skippedSheets = 0;
  let inspectedRules = 0;

  function thirdParty(sheet: CSSStyleSheet): boolean {
    const href = sheet.href ?? "";
    const owner = sheet.ownerNode as Element | null;
    const vite = owner?.getAttribute?.("data-vite-dev-id") ?? "";
    return href.includes("node_modules") || vite.includes("node_modules");
  }

  function walk(rules: CSSRuleList) {
    for (const rule of Array.from(rules)) {
      const nested = (rule as CSSGroupingRule).cssRules;
      if (nested) walk(nested);
      const style = (rule as CSSStyleRule).style;
      const selectorText = (rule as CSSStyleRule).selectorText;
      if (!style || typeof selectorText !== "string") continue;
      inspectedRules++;
      let els: Element[] | null = null;
      for (const prop of o.props) {
        const value = style.getPropertyValue(prop).trim();
        if (!value) continue;
        if (els === null) els = match(selectorText);
        if (!els.length) break;
        if (value.includes("var(")) reportVars(value, prop, selectorText, els);
        else if (isLiteral(value)) {
          add({
            kind: "hardcoded",
            severity: o.strictTokens ? "error" : "warning",
            property: prop, value, selector: selectorText,
            elements: els.length, sample: elementPath(els[0]!),
          });
        }
      }
    }
  }

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      if (!o.includeThirdParty && thirdParty(sheet)) continue;
      const rules = sheet.cssRules;
      if (!rules) continue;
      walk(rules);
    } catch {
      skippedSheets++; // cross-origin sheet, rules are not readable
    }
  }

  const inScope = [scopeEl, ...Array.from(scopeEl.querySelectorAll("[style]"))].filter(
    (e) => e.hasAttribute?.("style") && !isIgnored(e),
  );
  for (const el of inScope) {
    const style = (el as HTMLElement).style;
    for (const prop of o.props) {
      const value = style.getPropertyValue(prop).trim();
      if (!value) continue;
      const selector = `${elementPath(el)} [style]`;
      if (value.includes("var(")) reportVars(value, prop, selector, [el]);
      else if (isLiteral(value)) {
        add({
          kind: "hardcoded",
          severity: o.strictTokens ? "error" : "warning",
          property: prop, value, selector, elements: 1, sample: elementPath(el),
        });
      }
    }
  }

  return { findings, skippedSheets, inspectedRules, truncated: Array.from(truncated) };
}

