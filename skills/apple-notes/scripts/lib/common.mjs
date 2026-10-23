import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  lstat,
  rm,
} from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

export const VERSION = "0.1.0";
export const BACKEND_VERSION = "2.15.10";
export const SDK_VERSION = "1.32.1";
export const SKILL_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const HOME = process.env.APPLE_NOTES_AGENT_USER_HOME || homedir();
export const DATA_HOME = resolve(
  process.env.APPLE_NOTES_AGENT_HOME ||
    join(
      process.env.XDG_DATA_HOME || join(HOME, ".local/share"),
      "apple-notes-agent",
    ),
);
export const RUNTIME = join(
  DATA_HOME,
  "runtimes",
  `notes-${BACKEND_VERSION}-sdk-${SDK_VERSION}`,
);
export const MANIFEST = join(DATA_HOME, "installation.json");
export const BIN_DIR = resolve(
  process.env.APPLE_NOTES_AGENT_BIN_DIR || join(HOME, ".local/bin"),
);

export class Failure extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
export function formatError(e) {
  return {
    ok: false,
    code: e.code || "error",
    message: e.message || String(e),
    ...e.details,
  };
}
export function requireMac() {
  if (process.platform !== "darwin")
    throw new Failure(
      "macos_required",
      "Apple Notes runs on the Mac holding your Notes library. Run this installer in your local Mac agent, not a Linux/cloud container.",
    );
}
export function shellQuote(s) {
  return "'" + String(s).replaceAll("'", "'\\''") + "'";
}
export async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
export async function atomicWrite(path, text, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, text, { mode });
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true });
  }
}
export async function writeJson(path, value) {
  return atomicWrite(path, JSON.stringify(value, null, 2) + "\n");
}
export function hash(value) {
  return createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
}
export async function treeHash(root) {
  const rows = [];
  async function walk(dir, prefix = "") {
    for (const name of (await readdir(dir)).sort()) {
      if (["node_modules", ".DS_Store"].includes(name)) continue;
      const path = join(dir, name),
        rel = prefix + name,
        s = await lstat(path);
      if (s.isDirectory()) await walk(path, rel + "/");
      else if (s.isFile()) rows.push([rel, hash(await readFile(path))]);
      else
        throw new Failure(
          "invalid_skill_file",
          `Unexpected symlink or special file: ${path}`,
        );
    }
  }
  await walk(root);
  return hash(rows);
}
export function parseArgs(argv, { booleans = [] } = {}) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i];
    if (word === "--") {
      args._.push(...argv.slice(i + 1));
      break;
    }
    if (!word.startsWith("--")) {
      args._.push(word);
      continue;
    }
    const [name, inline] = word.slice(2).split(/=(.*)/s, 2);
    if (!name) throw new Failure("invalid_argument", "Empty flag.");
    if (Object.hasOwn(args, name))
      throw new Failure("invalid_argument", `Repeated flag --${name}.`);
    if (booleans.includes(name)) {
      if (inline !== undefined)
        throw new Failure("invalid_argument", `--${name} takes no value.`);
      args[name] = true;
    } else {
      const value = inline ?? argv[++i];
      if (value === undefined || value.startsWith("--"))
        throw new Failure("invalid_argument", `--${name} requires a value.`);
      args[name] = value;
    }
  }
  return args;
}
export function checkFlags(args, allowed) {
  for (const key of Object.keys(args))
    if (key !== "_" && !allowed.includes(key))
      throw new Failure("invalid_argument", `Unknown flag --${key}.`);
}
export async function run(
  command,
  args,
  { timeout = 120_000, env = process.env, input, inherit = false } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: inherit ? "inherit" : ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      ended = false;
    const timer = setTimeout(() => {
      ended = true;
      child.kill("SIGTERM");
      reject(
        new Failure("process_timeout", `${command} timed out.`, {
          command,
          indeterminate: true,
        }),
      );
    }, timeout);
    if (!inherit) {
      child.stdout.on("data", (d) => {
        stdout += d;
      });
      child.stderr.on("data", (d) => {
        stderr = (stderr + d).slice(-24000);
      });
      child.stdin.end(input);
    }
    child.on("error", (e) => {
      clearTimeout(timer);
      if (!ended) reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (ended) return;
      if (code !== 0)
        reject(
          new Failure(
            "process_failed",
            `${command} exited ${code}: ${stderr.trim()}`,
            { exitCode: code },
          ),
        );
      else resolve(stdout.trim());
    });
  });
}
export function backendEnv() {
  return {
    ...process.env,
    APPLE_NOTES_MCP_BROKER: "off",
    APPLE_NOTES_MCP_ENABLE_PRIVATE: "0",
    APPLE_NOTES_MCP_CONFIG_FILE: join(DATA_HOME, "backend-config.json"),
  };
}
