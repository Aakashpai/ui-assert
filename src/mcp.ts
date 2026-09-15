#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import { z } from "zod";
import { formatText } from "./report.js";
import { run } from "./run.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const DESCRIPTION = `Render a URL in a real browser and get a compact verdict on design tokens, layout and accessibility.

Use it after changing UI and before claiming the work is done: it catches colours that bypass your tokens, tokens referenced but never defined, overflow and clipping at each viewport, tap targets under 24x24, and axe violations. A FAIL lists what is wrong and where, so it can be fixed without a screenshot.

The page must already be served (a dev server, a preview build, a Storybook iframe URL). Narrow the check with scope, and pass ignore selectors for dev-only overlays that ship their own colours and tiny buttons. Screenshots of failing cells are written to out.`;

const INPUT = {
  url: z.string().describe("URL of a page that is already being served"),
  scope: z
    .string()
    .optional()
    .describe("restrict tokens + layout checks to a subtree (default: body)"),
  viewports: z
    .array(z.string())
    .optional()
    .describe('viewports as WxH, e.g. ["375x812","1280x800"] (default 375x812,768x1024,1280x800)'),
  schemes: z.array(z.string()).optional().describe("colour schemes (default light,dark)"),
  themeAttr: z
    .string()
    .optional()
    .describe("also set this attribute on <html> to the scheme name"),
  browser: z
    .enum(["chromium", "firefox", "webkit"])
    .optional()
    .describe("chromium (default) | firefox | webkit"),
  wait: z
    .string()
    .optional()
    .describe("after load, wait for a selector or extra ms (default 250)"),
  tokenPrefix: z
    .string()
    .optional()
    .describe("only custom properties with this prefix count as tokens, e.g. --ds-"),
  props: z.array(z.string()).optional().describe("CSS properties the tokens check inspects"),
  ignore: z.array(z.string()).optional().describe("selectors skipped in all checks"),
  includeThirdParty: z
    .boolean()
    .optional()
    .describe("also inspect node_modules stylesheets"),
  strictTokens: z
    .boolean()
    .optional()
    .describe("hardcoded colours are errors instead of warnings"),
  tokens: z.boolean().optional().describe("run the tokens check (default true)"),
  layout: z.boolean().optional().describe("run the layout check (default true)"),
  a11y: z.boolean().optional().describe("run the axe check (default true)"),
  failOn: z
    .enum(["error", "warning", "none"])
    .optional()
    .describe("what counts as a failure (default error)"),
  out: z
    .string()
    .optional()
    .describe("directory for failing-cell screenshots (default ./ui-assert-out)"),
  format: z
    .enum(["text", "json"])
    .optional()
    .describe("text verdict (default) or the full JSON report"),
};

const server = new McpServer({ name: "ui-assert", version });

server.registerTool(
  "ui_assert",
  { title: "Check a page in a browser", description: DESCRIPTION, inputSchema: INPUT },
  async ({ format, ...options }) => {
    try {
      const report = await run(options);
      const text = format === "json" ? JSON.stringify(report, null, 2) : formatText(report);
      // A FAIL verdict is a successful call: the tool answered the question.
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text" as const, text: explain(err) }] };
    }
  },
);

function explain(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return /executable doesn't exist|browserType\.launch/i.test(message)
    ? `${message}\n\nThe browser is missing. Install it with: npx playwright install chromium`
    : message;
}

await server.connect(new StdioServerTransport());
