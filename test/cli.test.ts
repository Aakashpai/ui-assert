import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "./server.js";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const OUT = "ui-assert-out-cli";

let origin: string;
let close: () => Promise<void>;

// The CLI is the built artefact, so exercise it the way a user does.
beforeAll(async () => {
  await run("npm", ["run", "build"], { cwd: fileURLToPath(new URL("..", import.meta.url)) });
  ({ origin, close } = await startServer());
});

afterAll(async () => {
  rmSync(OUT, { recursive: true, force: true });
  await close();
});

async function cli(args: string[]) {
  try {
    const { stdout } = await run("node", [CLI, ...args, "--out", OUT]);
    return { code: 0, stdout };
  } catch (err) {
    const e = err as { code?: number; stdout?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "" };
  }
}

describe("cli", () => {
  it("exits 1 and prints JSON for the bad fixture", async () => {
    const { code, stdout } = await cli([`${origin}/bad.html`, "--json", "--viewports", "375x812"]);
    expect(code).toBe(1);
    const report = JSON.parse(stdout);
    expect(report.summary.passed).toBe(false);
    expect(report.url).toContain("bad.html");
  });

  it("exits 0 for the good fixture", async () => {
    const { code, stdout } = await cli([`${origin}/good.html`, "--viewports", "375x812"]);
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
  });

  it("exits 0 on the bad fixture with --fail-on none", async () => {
    const { code } = await cli([
      `${origin}/bad.html`,
      "--fail-on",
      "none",
      "--viewports",
      "375x812",
    ]);
    expect(code).toBe(0);
  });

  it("reads options from a config file, with flags taking precedence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ui-assert-"));
    const config = join(dir, "ui-assert.config.json");
    writeFileSync(
      config,
      JSON.stringify({ url: `${origin}/good.html`, viewports: ["400x600"], schemes: ["light", "dark"], a11y: false }),
    );
    const { code, stdout } = await cli(["--config", config, "--json", "--schemes", "light"]);
    rmSync(dir, { recursive: true, force: true });
    expect(code).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.url).toContain("good.html");
    expect(report.matrix).toEqual({ viewports: ["400x600"], schemes: ["light"] });
    expect(report.a11y).toBeUndefined();
  });

  it("fails clearly when an explicit config file is missing", async () => {
    const { code } = await cli([`${origin}/good.html`, "--config", "/nonexistent/ui-assert.json"]);
    expect(code).toBe(2);
  });

  it("prints usage for --help", async () => {
    const { code, stdout } = await cli(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toContain("ui-assert <url> [options]");
  });
});
