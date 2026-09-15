import type { Page } from "playwright";
import type { LayoutFinding } from "../types.js";

export type LayoutOptions = { scope: string; ignore: string[] };

const TARGETS =
  'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=menuitem], [role=tab], [role=checkbox], [role=radio], [role=switch], [tabindex]:not([tabindex="-1"])';

export async function checkLayout(page: Page, opts: LayoutOptions): Promise<LayoutFinding[]> {
  return page.evaluate(collect, { ...opts, targets: TARGETS });
}

function collect(o: LayoutOptions & { targets: string }): LayoutFinding[] {
  const findings: LayoutFinding[] = [];
  const counts: Record<string, number> = {};
  const seen = new Set<string>();

  function add(f: LayoutFinding) {
    const k = `${f.kind}|${f.sample}`;
    if (seen.has(k)) return;
    counts[f.kind] = (counts[f.kind] ?? 0) + 1;
    if (counts[f.kind]! > 25) return;
    seen.add(k);
    findings.push(f);
  }

  // Same as in tokens.ts. Functions passed to page.evaluate are serialised, so
  // they can't share module scope.
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

  const scopeEl = (document.querySelector(o.scope) as HTMLElement | null) ?? document.body;
  const vw = window.innerWidth;

  const overflow = (document.scrollingElement?.scrollWidth ?? 0) - vw;
  if (overflow > 1) {
    add({
      kind: "page-overflow", severity: "error",
      message: `horizontal page overflow +${Math.round(overflow)}px`,
      sample: "document",
    });
  }

  const ignored: Element[] = [];
  for (const sel of o.ignore) {
    try {
      scopeEl.querySelectorAll(sel).forEach((e) => ignored.push(e));
    } catch {
      /* invalid ignore selector */
    }
  }
  const isIgnored = (el: Element) => ignored.some((i) => i === el || i.contains(el));

  const hasText = (el: Element) =>
    Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && (n.nodeValue ?? "").trim() !== "",
    );

  // An ancestor that clips or scrolls its content bounds what the user can
  // see, so a child poking past the viewport inside it isn't a real overflow.
  // The ancestor itself is still checked on its own turn.
  const clippedByAncestor = (el: Element) => {
    let cur = el.parentElement;
    while (cur && cur !== document.documentElement && cur !== document.body) {
      if (getComputedStyle(cur).overflowX !== "visible") return true;
      cur = cur.parentElement;
    }
    return false;
  };

  // checkVisibility accounts for opacity: 0 and visibility: hidden set on
  // ancestors, which getComputedStyle on the element alone does not.
  const visible = (el: Element, cs: CSSStyleDeclaration) => {
    if (typeof el.checkVisibility === "function") {
      return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    }
    return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  };

  const all = Array.from(scopeEl.querySelectorAll("*")).slice(0, 5000);
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "html" || tag === "body") continue;
    if (isIgnored(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const cs = getComputedStyle(el);
    if (!visible(el, cs)) continue;

    const path = elementPath(el);
    const text = hasText(el);

    if (text && el.scrollWidth > el.clientWidth + 1) {
      const ox = cs.overflowX;
      if (ox === "visible") {
        add({
          kind: "text-overflow", severity: "error",
          message: `text overflows box  ${el.scrollWidth} > ${el.clientWidth}px`,
          sample: path,
        });
      } else if ((ox === "hidden" || ox === "clip") && cs.textOverflow !== "ellipsis") {
        add({
          kind: "text-overflow", severity: "warning",
          message: `text clipped  ${el.scrollWidth} > ${el.clientWidth}px`,
          sample: path,
        });
      }
    }

    if (text && el.scrollHeight > el.clientHeight + 1) {
      const oy = cs.overflowY;
      if (oy === "hidden" || oy === "clip") {
        add({
          kind: "clipped", severity: "warning",
          message: `content clipped vertically  ${el.scrollHeight} > ${el.clientHeight}px`,
          sample: path,
        });
      }
    }

    if ((rect.right > vw + 1 || rect.left < -1) && !clippedByAncestor(el)) {
      const over = Math.round(Math.max(rect.right - vw, -rect.left));
      add({
        kind: "offscreen", severity: "error",
        message: `extends past viewport by ${over}px`,
        sample: path,
      });
    }

    if (el.matches(o.targets) && (rect.width < 24 || rect.height < 24)) {
      // WCAG 2.5.8 inline exception: a link inside a sentence is sized by its text.
      const inlineLink =
        tag === "a" && cs.display.startsWith("inline") &&
        (el.parentElement?.textContent ?? "").trim() !== (el.textContent ?? "").trim();
      if (!inlineLink) {
        add({
          kind: "target-size", severity: "warning",
          message: `target ${Math.round(rect.width)}x${Math.round(rect.height)} smaller than 24x24`,
          sample: path,
        });
      }
    }
  }

  return findings;
}
