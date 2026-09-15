#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { formatText } from "./report.js";
import { run } from "./run.js";
import {
  DEFAULT_SCHEMES, DEFAULT_VIEWPORTS,
  type BrowserName, type FailOn, type RunOptions,
} from "./types.js";

const USAGE = `ui-assert <url> [options]

  --scope <selector>        restrict tokens + layout checks to a subtree (default: body)
  --viewports <list>        default ${DEFAULT_VIEWPORTS.join(",")}
  --schemes <list>          default ${DEFAULT_SCHEMES.join(",")}
  --theme-attr <name>       also set this attribute on <html> to the scheme name
  --browser <name>          chromium (default) | firefox | webkit
  --wait <selector|ms>      after load, wait for a selector or extra ms (default 250)
  --token-prefix=<str>      only custom properties with this prefix count as tokens
                            (use the = form, the value starts with dashes)
  --props <list>            CSS properties the tokens check inspects
  --ignore <selectors>      comma-separated selectors skipped in all checks
  --include-third-party     also inspect node_modules stylesheets
  --strict-tokens           hardcoded colours are errors instead of warnings
  --no-tokens --no-layout --no-a11y
  --json                    JSON report to stdout
  --out <dir>               failing-cell screenshots (default ./ui-assert-out)
  --fail-on error|warning|none   (default error)
  --config <path>           JSON file with the same options in camelCase
                            (ui-assert.config.json in the cwd is picked up automatically)
  --help`;

const DEFAULT_CONFIG = "ui-assert.config.json";

const OPTIONS = {
  scope: { type: "string" },
  viewports: { type: "string" },
  schemes: { type: "string" },
  "theme-attr": { type: "string" },
  browser: { type: "string" },
  wait: { type: "string" },
  "token-prefix": { type: "string" },
  props: { type: "string" },
  ignore: { type: "string" },
  "include-third-party": { type: "boolean" },
  "strict-tokens": { type: "boolean" },
  // parseArgs has no --no-x negation, so the off switches are their own flags.
  "no-tokens": { type: "boolean" },
  "no-layout": { type: "boolean" },
  "no-a11y": { type: "boolean" },
  json: { type: "boolean" },
  out: { type: "string" },
  "fail-on": { type: "string" },
  config: { type: "string" },
  help: { type: "boolean" },
} as const;

const list = (v: string | undefined) => v?.split(",").map((s) => s.trim()).filter(Boolean);

// Flags win over the config file, but an unset flag must not erase a config value.
const defined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

async function loadConfig(path: string | undefined): Promise<Partial<RunOptions>> {
  try {
    return JSON.parse(await readFile(path ?? DEFAULT_CONFIG, "utf8"));
  } catch (err) {
    // Only the implicit default may be missing; an explicit --config must exist.
    if (!path && (err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`could not read config ${path ?? DEFAULT_CONFIG}: ${(err as Error).message}`);
  }
}

export async function main(argv: string[]): Promise<number> {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS }));
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }

  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  let config: Partial<RunOptions>;
  try {
    config = await loadConfig(values.config);
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }

  const url = positionals[0] ?? config.url;
  if (!url) {
    console.log(USAGE);
    return 1;
  }

  const flags = defined({
    scope: values.scope,
    viewports: list(values.viewports),
    schemes: list(values.schemes),
    themeAttr: values["theme-attr"],
    browser: values.browser as BrowserName | undefined,
    wait: values.wait,
    tokenPrefix: values["token-prefix"],
    props: list(values.props),
    ignore: list(values.ignore),
    includeThirdParty: values["include-third-party"],
    strictTokens: values["strict-tokens"],
    tokens: values["no-tokens"] ? false : undefined,
    layout: values["no-layout"] ? false : undefined,
    a11y: values["no-a11y"] ? false : undefined,
    out: values.out,
    failOn: values["fail-on"] as FailOn | undefined,
  });

  const report = await run({ ...config, ...flags, url });

  console.log(values.json ? JSON.stringify(report, null, 2) : formatText(report));
  return report.summary.passed ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
