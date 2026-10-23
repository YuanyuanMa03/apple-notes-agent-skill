import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile),
  entry = fileURLToPath(
    new URL("../skills/apple-notes/scripts/notes.mjs", import.meta.url),
  );
test("invalid JSON, unknown flags and invalid convenience input fail before backend access", async () => {
  for (const args of [
    ["call", "create-note", "--json", "{broken"],
    ["call", "create-note", "--json", "[]"],
    ["call", "create-note", "--json", "{}", "--input", "-"],
    ["edit", "id", "--input", "-"],
    ["read", "id", "--format", "bad"],
    ["create", "--title", "x", "--typo", "x"],
  ])
    await assert.rejects(exec(process.execPath, [entry, ...args]), (e) => {
      const result = JSON.parse(e.stdout);
      return (
        result.ok === false &&
        ["invalid_argument", "invalid_json"].includes(result.code)
      );
    });
});
test("JSON export does not overwrite an existing destination", async () => {
  const dir = await mkdtemp(join(tmpdir(), "notes-export-check-"));
  const path = join(dir, "existing.json");
  await writeFile(path, "original user data");
  try {
    await assert.rejects(
      exec(process.execPath, [
        entry,
        "export",
        "synthetic-id",
        "--format",
        "json",
        "--output",
        path,
      ]),
      (e) => JSON.parse(e.stdout).code === "output_exists",
    );
    assert.equal(await readFile(path, "utf8"), "original user data");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("JSON export refuses a Notes library path without contacting the backend", async () => {
  const dir = await mkdtemp(join(tmpdir(), "notes-library-check-"));
  const library = join(dir, "Library/Group Containers/group.com.apple.notes");
  await mkdir(library, { recursive: true });
  try {
    await assert.rejects(
      exec(process.execPath, [
        entry,
        "export",
        "synthetic-id",
        "--format",
        "json",
        "--output",
        join(library, "new.json"),
      ]),
      (e) => JSON.parse(e.stdout).code === "invalid_output",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
