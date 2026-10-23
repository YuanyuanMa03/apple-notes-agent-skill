import { mkdir, cp, rename, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  BACKEND_VERSION,
  SDK_VERSION,
  RUNTIME,
  SKILL_ROOT,
  exists,
  readJson,
  run,
  Failure,
  requireMac,
} from "./common.mjs";

export const backendEntry = (runtime = RUNTIME) =>
  join(runtime, "node_modules/apple-notes-mcp/build/index.js");
export async function runtimeValid(runtime = RUNTIME) {
  try {
    const p = await readJson(
      join(runtime, "node_modules/apple-notes-mcp/package.json"),
    );
    const sdk = await readJson(
      join(runtime, "node_modules/@modelcontextprotocol/sdk/package.json"),
    );
    return (
      p?.version === BACKEND_VERSION &&
      sdk?.version === SDK_VERSION &&
      (await exists(backendEntry(runtime)))
    );
  } catch {
    return false;
  }
}
export async function installRuntime({
  runtime = RUNTIME,
  log = () => {},
} = {}) {
  requireMac();
  if (await runtimeValid(runtime)) return { path: runtime, reused: true };
  if (await exists(runtime))
    throw new Failure(
      "runtime_conflict",
      `Runtime exists but is incomplete or a different version: ${runtime}. Move it aside and rerun setup; it was not overwritten.`,
    );
  const stage = `${runtime}.${randomUUID()}.tmp`;
  await mkdir(stage, { recursive: true, mode: 0o700 });
  try {
    for (const file of ["package.json", "package-lock.json"])
      await cp(join(SKILL_ROOT, "runtime", file), join(stage, file));
    const npm = join(process.execPath, "..", "npm");
    if (!(await exists(npm)))
      throw new Failure(
        "npm_missing",
        "The selected Node installation has no adjacent npm. Run install.sh to provision a complete user-local Node runtime.",
      );
    log(
      `Installing pinned apple-notes-mcp ${BACKEND_VERSION} (no lifecycle hooks)…`,
    );
    await run(
      npm,
      [
        "ci",
        "--prefix",
        stage,
        "--ignore-scripts",
        "--omit=dev",
        "--no-fund",
        "--no-audit",
      ],
      {
        timeout: 240_000,
        env: {
          ...process.env,
          PATH: join(process.execPath, "..") + ":" + (process.env.PATH || ""),
        },
      },
    );
    if (!(await runtimeValid(stage)))
      throw new Failure(
        "runtime_verification_failed",
        "The installed runtime does not match the pinned package versions.",
      );
    try {
      await rename(stage, runtime);
    } catch (e) {
      if (await runtimeValid(runtime)) return { path: runtime, reused: true };
      throw e;
    }
    return { path: runtime, reused: false };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
export async function requireRuntime() {
  if (!(await runtimeValid()))
    throw new Failure(
      "runtime_not_installed",
      "Run the setup script beside this skill: node scripts/setup.mjs --target auto",
    );
}
