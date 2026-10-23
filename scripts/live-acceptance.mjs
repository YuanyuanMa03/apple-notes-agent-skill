import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { session, callTool } from "../skills/apple-notes/scripts/lib/mcp.mjs";
import { Failure } from "../skills/apple-notes/scripts/lib/common.mjs";

const allowed = process.argv.includes("--allow-synthetic-write");
if (!allowed) {
  console.error(
    "This test creates a synthetic folder/note. Re-run with --allow-synthetic-write; setup itself never writes notes.",
  );
  process.exit(2);
}
const directory = resolve("artifacts/live-acceptance");
await mkdir(directory, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-");
const folder = `Apple Notes Agent synthetic ${stamp}`;
const title = `SYNTHETIC skill acceptance ${stamp}`;
const report = {
  timestamp: new Date().toISOString(),
  backend: "2.15.10",
  fixtureKind: "synthetic, not observational data",
  folder,
  title,
  checks: [],
  allPassed: false,
};
let id;
function check(name, result, verified) {
  report.checks.push({ name, ok: result.ok && verified, result });
  return result;
}
const texts = (r) =>
  (r.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
function findId(value) {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, v] of Object.entries(value)) {
    if (
      ["id", "noteId"].includes(key) &&
      typeof v === "string" &&
      v.includes("/ICNote/")
    )
      return v;
    if (typeof v === "object") {
      const found = findId(v);
      if (found) return found;
    }
  }
  return undefined;
}
function contentHash(value) {
  if (!value || typeof value !== "object") return undefined;
  for (const [k, v] of Object.entries(value)) {
    if (k === "contentHash" && typeof v === "string") return v;
    if (typeof v === "object") {
      const found = contentHash(v);
      if (found) return found;
    }
  }
  return undefined;
}
try {
  await session(async (client) => {
    const tools = await client.listTools();
    check(
      "MCP tool discovery",
      { ok: true, count: tools.tools.length },
      tools.tools.length > 10,
    );
    const f = await callTool(client, "create-folder", { name: folder });
    check("organize: create synthetic folder", f, f.ok);
    if (!f.ok) return;
    const body =
      "synthetic validation input not observational data\n中文测试记录 alpha\n保留这一段不变";
    const created = await callTool(client, "create-note", {
      title,
      content: body,
      folder,
      format: "plaintext",
    });
    id =
      findId(created.data) ??
      texts(created).match(/x-coredata:\/\/[^\s"<>]+\/ICNote\/p\d+/)?.[0];
    check("create synthetic note", created, !!id);
    report.noteId = id;
    if (!id) return;
    const read = await callTool(client, "get-note-content", { id });
    check(
      "read exact ID",
      read,
      read.ok && JSON.stringify(read).includes("中文测试记录 alpha"),
    );
    const search = await callTool(client, "search-notes", {
      query: title,
      folder,
    });
    check("search scoped title", search, JSON.stringify(search).includes(id));
    const subfolder = folder + "/Archive";
    const sf = await callTool(client, "create-folder", { name: subfolder });
    check("organize: create nested destination", sf, sf.ok);
    if (sf.ok) {
      const moved = await callTool(client, "move-note", {
        id,
        folder: subfolder,
      });
      const after = await callTool(client, "get-note-content", { id });
      const scoped = await callTool(client, "search-notes", {
        query: title,
        folder: subfolder,
      });
      check(
        "organize: move and read back",
        moved,
        after.ok && JSON.stringify(scoped).includes(id),
      );
    }
    const current = await callTool(client, "get-note-content", { id });
    const revision = contentHash(current.data);
    if (revision) {
      const update = await callTool(client, "update-note", {
        id,
        expectedContentHash: revision,
        newContent: title + "\n" + body.replace("alpha", "beta"),
        format: "plaintext",
      });
      const after = await callTool(client, "get-note-content", { id });
      check(
        "edit with revision and readback",
        update,
        JSON.stringify(after).includes("中文测试记录 beta") &&
          JSON.stringify(after).includes("保留这一段不变"),
      );
      if (update.ok) {
        const stale = await callTool(client, "update-note", {
          id,
          expectedContentHash: revision,
          newContent: "This stale write must never be applied",
        });
        const state = await callTool(client, "get-note-content", { id });
        check(
          "stale revision refused without modifying note",
          { ...stale, ok: !stale.ok },
          JSON.stringify(stale).includes("revision_conflict") &&
            !JSON.stringify(state).includes(
              "This stale write must never be applied",
            ),
        );
      }
    } else
      report.checks.push({
        name: "edit with revision and readback",
        ok: false,
        blocked: true,
        reason:
          "Backend did not return a usable contentHash; inspect read warnings and Full Disk Access. No unguarded write was attempted.",
      });
    const output = join(directory, `${stamp}.md`);
    const exported = await callTool(client, "export-notes-markdown", {
      id,
      outputPath: output,
    });
    let contains = false;
    if (exported.ok) {
      try {
        contains = (await readFile(output, "utf8")).includes("中文测试记录");
      } catch {}
    }
    check("portable Markdown export and file contents", exported, contains);
  });
} catch (error) {
  report.checks.push({
    name: "unexpected runtime error",
    ok: false,
    message: error.message,
  });
}
report.allPassed = report.checks.every((c) => c.ok);
report.fixtureRetained = true;
const path = join(directory, `${stamp}.json`);
await writeFile(path, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(
  JSON.stringify(
    {
      report: path,
      noteId: id,
      allPassed: report.allPassed,
      checks: report.checks.map(
        ({ name, ok, blocked, reason, result, message }) => ({
          name,
          ok,
          blocked,
          reason,
          code: result?.data?.code,
          message,
        }),
      ),
    },
    null,
    2,
  ),
);
if (!report.allPassed) process.exitCode = 1;
