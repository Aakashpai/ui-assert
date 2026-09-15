#!/usr/bin/env node
import { parseArgs } from "node:util";
import { formatText } from "./report.js";
import { run } from "./run.js";
import {
  DEFAULT_PROPS, DEFAULT_SCHEMES, DEFAULT_VIEWPORTS,
  type BrowserName, type FailOn,
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
  --help`;

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
  help: { type: "boolean" },
} as const;

const list = (v: string | undefined) => v?.split(",").map((s) => s.trim()).filter(Boolean);

export async function main(argv: string[]): Promise<number> {
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS }));
  } catch (err) {
    console.error(`${(err as Error).message}\n\n${USAGE}`);
    return 2;
  }

  if (values.help || !positionals[0]) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }

  const report = await run({
    url: positionals[0],
    scope: values.scope,
    viewports: list(values.viewports),
    schemes: list(values.schemes),
    themeAttr: values["theme-attr"],
    browser: values.browser as BrowserName | undefined,
    wait: values.wait,
    tokenPrefix: values["token-prefix"],
    props: list(values.props) ?? DEFAULT_PROPS,
    ignore: list(values.ignore) ?? [],
    includeThirdParty: values["include-third-party"],
    strictTokens: values["strict-tokens"],
    tokens: !values["no-tokens"],
    layout: !values["no-layout"],
    a11y: !values["no-a11y"],
    out: values.out,
    failOn: values["fail-on"] as FailOn | undefined,
  });

  console.log(values.json ? JSON.stringify(report, null, 2) : formatText(report));
  return report.summary.passed ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
