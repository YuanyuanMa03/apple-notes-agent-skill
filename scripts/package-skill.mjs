import { mkdir, rm, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
const dir = resolve("artifacts");
await mkdir(dir, { recursive: true });
const output = join(dir, "apple-notes-0.1.0.skill");
await rm(output, { force: true });
const r = spawnSync(
  "/usr/bin/zip",
  ["-q", "-r", output, "apple-notes", "-x", "*/node_modules/*"],
  { cwd: resolve("skills"), stdio: "inherit" },
);
if (r.status !== 0) process.exit(r.status ?? 1);
const sum = createHash("sha256")
  .update(await readFile(output))
  .digest("hex");
await writeFile(
  output + ".sha256",
  sum + "  " + output.split("/").at(-1) + "\n",
);
console.log(
  JSON.stringify({
    path: output,
    sha256: sum,
    format: "ZIP with self-contained apple-notes/SKILL.md",
  }),
);
