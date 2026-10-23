import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readlink,
  rm,
  symlink,
  lstat,
  readdir,
  access,
  cp,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
const exec = promisify(execFile),
  root = fileURLToPath(new URL("../", import.meta.url));
const runtimeName = "notes-2.15.10-sdk-1.32.1";
const testRuntime =
  process.env.NOTES_AGENT_TEST_RUNTIME ||
  join(
    root,
    "artifacts/installer-home/.local/share/apple-notes-agent/runtimes",
    runtimeName,
  );
const available = process.platform === "darwin";

test(
  "desktop MCP config starts a valid stdio server without extra stdout",
  { skip: !available },
  async () =>
    fixture(async ({ home, env, setup }) => {
      await setup(["--target", "claude-desktop"]);
      const config = JSON.parse(
        await readFile(
          join(
            home,
            "Library/Application Support/Claude/claude_desktop_config.json",
          ),
          "utf8",
        ),
      );
      const { Client } = await import(
        pathToFileURL(
          join(
            testRuntime,
            "node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js",
          ),
        ).href
      );
      const { StdioClientTransport } = await import(
        pathToFileURL(
          join(
            testRuntime,
            "node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js",
          ),
        ).href
      );
      const entry = config.mcpServers["apple-notes-agent"];
      const client = new Client({
        name: "installed-desktop-config-test",
        version: "0.1.0",
      });
      const transport = new StdioClientTransport({
        ...entry,
        env,
        stderr: "pipe",
      });
      transport.stderr?.on("data", () => {});
      try {
        await client.connect(transport);
        const names = (await client.listTools()).tools.map((t) => t.name);
        for (const name of [
          "get-note-content",
          "search-notes",
          "create-note",
          "update-note",
          "move-note",
          "export-notes-markdown",
        ])
          assert.ok(names.includes(name));
      } finally {
        await client.close();
      }
    }),
);

test(
  "a standalone skill copy bootstraps without duplicating its discovery entry",
  { skip: !available },
  async () =>
    fixture(async ({ home, data, bin, env }) => {
      const copied = join(home, "external-agent/skills/apple-notes");
      await cp(join(root, "skills/apple-notes"), copied, { recursive: true });
      const before = await readFile(join(copied, "SKILL.md"), "utf8");
      const { stdout } = await exec(
        process.execPath,
        [join(copied, "scripts/setup.mjs"), "--runtime-only"],
        { env, timeout: 30000 },
      );
      const result = JSON.parse(stdout);
      assert.equal(result.mode, "runtime_ready");
      assert.ok(result.toolCount > 10);
      assert.equal(await readFile(join(copied, "SKILL.md"), "utf8"), before);
      await assert.rejects(access(join(home, ".agents")));
      await assert.rejects(access(join(data, "installation.json")));
      await assert.rejects(access(join(bin, "notes-agent")));
    }),
);

test(
  "bootstrap dry-run without Node does not download or create directories",
  { skip: !available },
  async () =>
    fixture(
      async ({ data, env }) => {
        await assert.rejects(
          exec("/bin/bash", [join(root, "install.sh"), "--dry-run"], {
            env: { ...env, PATH: "/usr/bin:/bin" },
          }),
          (e) => e.stderr.includes("dry-run changed nothing"),
        );
        await assert.rejects(access(data));
      },
      { runtime: false },
    ),
);

async function fixture(fn, { runtime = true } = {}) {
  const home = await mkdtemp(join(tmpdir(), "apple notes ' installer-"));
  const data = join(home, "data"),
    bin = join(home, "bin");
  const env = {
    ...process.env,
    APPLE_NOTES_AGENT_USER_HOME: home,
    APPLE_NOTES_AGENT_HOME: data,
    APPLE_NOTES_AGENT_BIN_DIR: bin,
  };
  if (runtime) {
    await mkdir(join(data, "runtimes"), { recursive: true });
    await symlink(testRuntime, join(data, "runtimes", runtimeName));
  }
  const setup = async (args) =>
    JSON.parse(
      (
        await exec(
          process.execPath,
          [join(root, "scripts/install.mjs"), ...args],
          { env, timeout: 60000 },
        )
      ).stdout,
    );
  try {
    await fn({ home, data, bin, env, setup });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
test(
  "dry run creates no managed files, links, configs or lock",
  { skip: !available },
  async () =>
    fixture(
      async ({ home, data, setup }) => {
        const result = await setup([
          "--target",
          "codex,claude-code",
          "--dry-run",
        ]);
        assert.equal(result.mode, "plan");
        await assert.rejects(access(data));
        await assert.rejects(access(join(home, ".agents")));
      },
      { runtime: false },
    ),
);
test(
  "install, reinstall and uninstall preserve unrelated config",
  { skip: !available },
  async () =>
    fixture(async ({ home, data, bin, setup }) => {
      const config = join(home, ".claude.json");
      const before = {
        theme: "dark",
        mcpServers: { other: { command: "keep" } },
      };
      await writeFile(config, JSON.stringify(before));
      const first = await setup(["--target", "codex,claude-code", "--mcp"]);
      assert.equal(first.verified, true);
      assert.ok(first.toolCount > 10);
      assert.equal(
        await readlink(join(home, ".agents/skills/apple-notes")),
        first.skillPath,
      );
      assert.equal(
        await readlink(join(home, ".claude/skills/apple-notes")),
        first.skillPath,
      );
      const second = await setup(["--target", "codex,claude-code", "--mcp"]);
      assert.equal(second.skillPath, first.skillPath);
      const receipt = JSON.parse(
        await readFile(join(data, "installation.json"), "utf8"),
      );
      assert.equal(receipt.packages.length, 1);
      assert.equal(receipt.links.length, 2);
      const after = JSON.parse(await readFile(config, "utf8"));
      assert.deepEqual(after.mcpServers.other, before.mcpServers.other);
      after.newUserPreference = 42;
      await writeFile(config, JSON.stringify(after));
      const out = await setup(["--uninstall"]);
      assert.deepEqual(out.preserved, []);
      await assert.rejects(access(join(bin, "notes-agent")));
      assert.deepEqual(JSON.parse(await readFile(config, "utf8")), {
        ...before,
        newUserPreference: 42,
      });
      assert.ok(
        (await lstat(join(data, "runtimes", runtimeName))).isSymbolicLink(),
      );
    }),
);
test(
  "same-name user skill stops installation before unrelated writes",
  { skip: !available },
  async () =>
    fixture(async ({ home, bin, setup }) => {
      const dir = join(home, ".claude/skills/apple-notes");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), "user content");
      await assert.rejects(
        setup(["--target", "claude-code"]),
        (e) => JSON.parse(e.stdout).code === "skill_conflict",
      );
      assert.equal(
        await readFile(join(dir, "SKILL.md"), "utf8"),
        "user content",
      );
      await assert.rejects(access(join(bin, "notes-agent")));
    }),
);
test(
  "edited managed skill is preserved on upgrade and uninstall",
  { skip: !available },
  async () =>
    fixture(async ({ setup }) => {
      const out = await setup(["--target", "generic", "--no-verify"]);
      const path = join(out.skillPath, "SKILL.md");
      await writeFile(path, "user-edited skill");
      await assert.rejects(
        setup(["--target", "generic"]),
        (e) => JSON.parse(e.stdout).code === "modified_installation",
      );
      const removed = await setup(["--uninstall"]);
      assert.ok(removed.preserved.includes(out.skillPath));
      assert.equal(await readFile(path, "utf8"), "user-edited skill");
    }),
);
test(
  "uninstall retains a user-replaced MCP entry",
  { skip: !available },
  async () =>
    fixture(async ({ home, setup }) => {
      await setup(["--target", "claude-desktop", "--no-verify"]);
      const path = join(
        home,
        "Library/Application Support/Claude/claude_desktop_config.json",
      );
      const content = JSON.parse(await readFile(path, "utf8"));
      content.mcpServers["apple-notes-agent"] = { command: "user replacement" };
      await writeFile(path, JSON.stringify(content));
      const out = await setup(["--uninstall"]);
      assert.ok(out.preserved.includes(path + ":apple-notes-agent"));
      assert.deepEqual(
        JSON.parse(await readFile(path, "utf8")).mcpServers[
          "apple-notes-agent"
        ],
        { command: "user replacement" },
      );
    }),
);
test(
  "malformed JSON config is left byte-for-byte unchanged",
  { skip: !available },
  async () =>
    fixture(async ({ home, bin, setup }) => {
      const path = join(home, ".claude.json");
      await writeFile(path, "{invalid");
      await assert.rejects(
        setup(["--target", "claude-code", "--mcp"]),
        (e) => JSON.parse(e.stdout).code === "config_invalid",
      );
      assert.equal(await readFile(path, "utf8"), "{invalid");
      await assert.rejects(access(join(bin, "notes-agent")));
    }),
);
test(
  "an active setup lock prevents a second installer",
  { skip: !available },
  async () =>
    fixture(async ({ data, setup }) => {
      await mkdir(join(data, "setup.lock"));
      await writeFile(
        join(data, "setup.lock/owner.json"),
        JSON.stringify({ pid: process.pid }),
      );
      await assert.rejects(
        setup(["--target", "generic"]),
        (e) => JSON.parse(e.stdout).code === "setup_busy",
      );
      assert.equal(
        JSON.parse(await readFile(join(data, "setup.lock/owner.json"), "utf8"))
          .pid,
        process.pid,
      );
    }),
);
test(
  "generated launcher works with spaces and quotes in installed path",
  { skip: !available },
  async () =>
    fixture(async ({ bin, env, setup }) => {
      await setup(["--target", "generic"]);
      const { stdout } = await exec(
        join(bin, "notes-agent"),
        ["tools", "search-notes"],
        { env, timeout: 30000 },
      );
      assert.equal(JSON.parse(stdout).tool.name, "search-notes");
    }),
);
test(
  "custom install launcher remembers its runtime outside the setup environment",
  { skip: !available },
  async () =>
    fixture(async ({ bin, env, setup }) => {
      await setup(["--target", "generic"]);
      const clean = { ...env };
      delete clean.APPLE_NOTES_AGENT_HOME;
      delete clean.APPLE_NOTES_AGENT_BIN_DIR;
      const { stdout } = await exec(
        join(bin, "notes-agent"),
        ["tools", "search-notes"],
        { env: clean, timeout: 30000 },
      );
      assert.equal(JSON.parse(stdout).tool.name, "search-notes");
    }),
);
test(
  "unknown flags fail without contacting Notes or installing",
  { skip: !available },
  async () =>
    fixture(
      async ({ data, setup }) => {
        await assert.rejects(
          setup(["--targte", "codex"]),
          (e) => JSON.parse(e.stdout).code === "invalid_argument",
        );
        await assert.rejects(access(data));
      },
      { runtime: false },
    ),
);
