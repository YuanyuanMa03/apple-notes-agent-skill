import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseArgs,
  checkFlags,
  shellQuote,
  treeHash,
} from "../skills/apple-notes/scripts/lib/common.mjs";
import {
  mergeMcpConfig,
  selectTargets,
} from "../skills/apple-notes/scripts/lib/install.mjs";
import { resultData } from "../skills/apple-notes/scripts/lib/mcp.mjs";

test("JSON MCP merge preserves every unrelated server and user field", () => {
  const before = {
    theme: "dark",
    mcpServers: {
      github: { command: "original", env: { TOKEN: "synthetic-test-value" } },
    },
  };
  const entry = { command: "/a path/notes-agent", args: ["serve"] };
  const after = mergeMcpConfig(before, entry);
  assert.deepEqual(after.mcpServers.github, before.mcpServers.github);
  assert.equal(after.theme, "dark");
  assert.equal(before.mcpServers["apple-notes-agent"], undefined);
  assert.deepEqual(after.mcpServers["apple-notes-agent"], entry);
  assert.deepEqual(mergeMcpConfig(after, entry), after);
});
test("MCP merge refuses unowned entries and malformed documents", () => {
  assert.throws(
    () =>
      mergeMcpConfig(
        { mcpServers: { "apple-notes-agent": { command: "other" } } },
        { command: "ours" },
      ),
    (e) => e.code === "mcp_conflict",
  );
  assert.throws(
    () => mergeMcpConfig({ mcpServers: [] }, {}),
    (e) => e.code === "config_invalid",
  );
  assert.throws(
    () => mergeMcpConfig(null, {}),
    (e) => e.code === "config_invalid",
  );
});
test("an owned entry can be upgraded without replacing the other entries", () => {
  const previous = { command: "old" },
    entry = { command: "new" };
  const after = mergeMcpConfig(
    {
      mcpServers: {
        "apple-notes-agent": previous,
        other: { command: "other" },
      },
    },
    entry,
    previous,
  );
  assert.deepEqual(after.mcpServers.other, { command: "other" });
  assert.deepEqual(after.mcpServers["apple-notes-agent"], entry);
});
test("target selection is explicit, deduplicated and rejects typos", () => {
  assert.deepEqual(selectTargets("auto", { CLAUDECODE: "1" }), ["claude-code"]);
  assert.deepEqual(selectTargets("auto", { CODEX_THREAD_ID: "synthetic" }), [
    "codex",
  ]);
  assert.deepEqual(selectTargets("auto", {}), ["generic"]);
  assert.deepEqual(selectTargets("codex,codex,claude-code"), [
    "codex",
    "claude-code",
  ]);
  assert.throws(
    () => selectTargets("claud"),
    (e) => e.code === "invalid_target",
  );
});
test("argument parsing preserves note content without evaluating shell syntax", () => {
  const payload = '{"text":"中文 \\n $(touch do-not-execute) `false`"}';
  assert.equal(parseArgs(["--json", payload]).json, payload);
  assert.equal(parseArgs(["--title=A = B"]).title, "A = B");
  assert.deepEqual(parseArgs(["--", "--literal"])._, ["--literal"]);
  assert.throws(
    () => parseArgs(["--json"]),
    (e) => e.code === "invalid_argument",
  );
  assert.throws(
    () => parseArgs(["--x", "1", "--x", "2"]),
    (e) => e.code === "invalid_argument",
  );
  assert.throws(
    () => checkFlags(parseArgs(["--typo", "1"]), []),
    (e) => e.code === "invalid_argument",
  );
});
test("shell quoting retains spaces, quotes, dollars and backticks literally", () => {
  assert.equal(
    shellQuote("/a path/it's/$HOME/`x`"),
    "'/a path/it'\\''s/$HOME/`x`'",
  );
});
test("MCP structured output and uncertainty flags are not discarded", () => {
  const data = {
    code: "timeout_indeterminate",
    indeterminate: true,
    committed: true,
  };
  assert.deepEqual(resultData({ structuredContent: data, content: [] }), data);
  assert.deepEqual(
    resultData({
      content: [
        {
          type: "text",
          text: "Human text\nstructuredContent: " + JSON.stringify(data),
        },
      ],
    }),
    data,
  );
  assert.deepEqual(
    resultData({ content: [{ type: "text", text: JSON.stringify(data) }] }),
    data,
  );
  assert.equal(
    resultData({ content: [{ type: "text", text: "not json" }] }),
    undefined,
  );
});
test("skill hashes change with content and reject symlink escapes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "notes-skill-hash-"));
  try {
    await writeFile(join(dir, "SKILL.md"), "one");
    const a = await treeHash(dir);
    await writeFile(join(dir, "SKILL.md"), "two");
    assert.notEqual(await treeHash(dir), a);
    await symlink("/etc/passwd", join(dir, "link"));
    await assert.rejects(treeHash(dir), (e) => e.code === "invalid_skill_file");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
