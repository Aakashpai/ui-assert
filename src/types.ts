export type Severity = "error" | "warning";
export type FailOn = "error" | "warning" | "none";
export type BrowserName = "chromium" | "firefox" | "webkit";

export type TokenFindingKind =
  | "undefined-token"
  | "hardcoded"
  | "fallback-used"
  | "non-token-var";

export type TokenFinding = {
  kind: TokenFindingKind;
  severity: Severity;
  property: string;
  value: string;
  token?: string;
  selector: string;
  elements: number;
  sample: string;
};

export type LayoutFindingKind =
  | "page-overflow"
  | "text-overflow"
  | "clipped"
  | "offscreen"
  | "target-size";

export type LayoutFinding = {
  kind: LayoutFindingKind;
  severity: Severity;
  message: string;
  sample: string;
};

export type A11yViolation = {
  id: string;
  impact: string;
  severity: Severity;
  count: number;
  sample: string;
  help: string;
  helpUrl: string;
};

export type Cell = { viewport: string; scheme: string };

export type Report = {
  url: string;
  browser: string;
  startedAt: string;
  durationMs: number;
  matrix: { viewports: string[]; schemes: string[] };
  tokens?: {
    findings: TokenFinding[];
    skippedSheets: number;
    inspectedRules: number;
    truncated: TokenFindingKind[];
  };
  layout?: {
    cells: (Cell & { findings: LayoutFinding[]; screenshot?: string })[];
  };
  a11y?: { cells: (Cell & { violations: A11yViolation[] })[] };
  summary: { errors: number; warnings: number; passed: boolean; failOn: FailOn };
};

export type RunOptions = {
  url: string;
  scope?: string;
  viewports?: string[];
  schemes?: string[];
  themeAttr?: string;
  browser?: BrowserName;
  wait?: string;
  tokenPrefix?: string;
  props?: string[];
  ignore?: string[];
  includeThirdParty?: boolean;
  strictTokens?: boolean;
  tokens?: boolean;
  layout?: boolean;
  a11y?: boolean;
  out?: string;
  failOn?: FailOn;
};

export const DEFAULT_PROPS = [
  "color",
  "background-color",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "fill",
  "stroke",
  "caret-color",
  "text-decoration-color",
  "accent-color",
];

export const DEFAULT_VIEWPORTS = ["375x812", "768x1024", "1280x800"];
export const DEFAULT_SCHEMES = ["light", "dark"];
