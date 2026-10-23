import { readFile, readdir, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import assert from "node:assert/strict";
const skill = "skills/apple-notes";
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await check(path);
    else if (path.endsWith(".mjs")) {
      const r = spawnSync(process.execPath, ["--check", path], {
        encoding: "utf8",
      });
      assert.equal(r.status, 0, r.stderr);
    } else if (path.endsWith(".sh")) {
      const r = spawnSync("/bin/bash", ["-n", path], { encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
    }
  }
}
await check("skills");
await check("scripts");
const runtime = JSON.parse(
  await readFile(join(skill, "runtime/package.json"), "utf8"),
);
const lock = JSON.parse(
  await readFile(join(skill, "runtime/package-lock.json"), "utf8"),
);
for (const [name, version] of Object.entries(runtime.dependencies)) {
  assert.equal(lock.packages[""].dependencies[name], version);
  assert.equal(lock.packages["node_modules/" + name].version, version);
}
const text = await readFile(join(skill, "SKILL.md"), "utf8");
assert.match(text, /^---\nname: apple-notes\n/);
for (const [, ref] of text.matchAll(/\]\((references\/[^)]+)\)/g))
  await access(join(skill, ref));
for (const file of [
  "scripts/bootstrap.sh",
  "scripts/setup.mjs",
  "scripts/notes.mjs",
  "agents/openai.yaml",
  "LICENSE",
  "NOTICE",
])
  await access(join(skill, file));
console.log(
  "Package check passed: scripts parse, references exist, runtime versions match lockfile.",
);
