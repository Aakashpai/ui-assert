import { execFile } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "./server.js";

const exec = promisify(execFile);
const SERVER = fileURLToPath(new URL("../dist/mcp.js", import.meta.url));
const OUT = "ui-assert-out-mcp";

let origin: string;
let close: () => Promise<void>;
let client: Client;

// The server is the built artefact, spawned over stdio the way a host does it.
beforeAll(async () => {
  await exec("npm", ["run", "build"], { cwd: fileURLToPath(new URL("..", import.meta.url)) });
  ({ origin, close } = await startServer());
  client = new Client({ name: "ui-assert-test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: "node", args: [SERVER] }));
});

afterAll(async () => {
  await client.close();
  rmSync(OUT, { recursive: true, force: true });
  await close();
});

async function callText(url: string) {
  const result = await client.callTool({
    name: "ui_assert",
    arguments: { url, out: OUT, viewports: ["375x812"] },
  });
  const content = result.content as { type: string; text: string }[];
  return { isError: result.isError, text: content.map((c) => c.text).join("\n") };
}

describe("mcp server", () => {
  it("lists ui_assert with url required", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "ui_assert");
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
    expect(tool!.inputSchema.required).toContain("url");
    expect(Object.keys(tool!.inputSchema.properties ?? {})).toContain("viewports");
  });

  it("returns PASS for the good fixture", async () => {
    const { isError, text } = await callText(`${origin}/good.html`);
    expect(isError).toBeFalsy();
    expect(text).toContain("PASS");
  });

  // A FAIL verdict is a successful call, not a tool error.
  it("returns FAIL with the findings for the bad fixture", async () => {
    const { isError, text } = await callText(`${origin}/bad.html`);
    expect(isError).toBeFalsy();
    expect(text).toContain("FAIL");
    expect(text).toContain("undefined token");
  });

  it("returns the JSON report when asked", async () => {
    const result = await client.callTool({
      name: "ui_assert",
      arguments: { url: `${origin}/good.html`, out: OUT, viewports: ["375x812"], format: "json" },
    });
    const [first] = result.content as { text: string }[];
    expect(JSON.parse(first!.text).summary.passed).toBe(true);
  });
});
