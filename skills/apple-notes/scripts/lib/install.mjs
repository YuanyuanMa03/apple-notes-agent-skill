import {
  mkdir,
  cp,
  symlink,
  readlink,
  lstat,
  readFile,
  rm,
  rename,
} from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  VERSION,
  BACKEND_VERSION,
  HOME,
  DATA_HOME,
  BIN_DIR,
  MANIFEST,
  SKILL_ROOT,
  RUNTIME,
  Failure,
  exists,
  treeHash,
  hash,
  readJson,
  writeJson,
  atomicWrite,
  shellQuote,
  requireMac,
} from "./common.mjs";
import { installRuntime } from "./runtime.mjs";
import { session } from "./mcp.mjs";

export const TARGETS = [
  "generic",
  "codex",
  "claude-code",
  "claude-desktop",
  "cursor",
];
export function selectTargets(value = "auto", env = process.env) {
  const targets =
    value === "auto"
      ? [
          env.CLAUDECODE
            ? "claude-code"
            : env.CODEX_THREAD_ID || env.CODEX_HOME
              ? "codex"
              : "generic",
        ]
      : value.split(",");
  for (const t of targets)
    if (!TARGETS.includes(t))
      throw new Failure(
        "invalid_target",
        `Unknown target ${t}; use auto or ${TARGETS.join(", ")}.`,
      );
  return [...new Set(targets)];
}
export function skillDestination(target, custom) {
  if (custom) return resolve(custom);
  if (target === "claude-desktop") return null;
  if (target === "claude-code") return join(HOME, ".claude/skills/apple-notes");
  if (target === "cursor") return join(HOME, ".cursor/skills/apple-notes");
  return join(HOME, ".agents/skills/apple-notes");
}
export function configDestination(target) {
  if (target === "claude-code") return join(HOME, ".claude.json");
  if (target === "claude-desktop")
    return join(
      HOME,
      "Library/Application Support/Claude/claude_desktop_config.json",
    );
  if (target === "cursor") return join(HOME, ".cursor/mcp.json");
  return null;
}
export function mergeMcpConfig(document, entry, previous) {
  if (!document || Array.isArray(document) || typeof document !== "object")
    throw new Failure("config_invalid", "MCP config must be a JSON object.");
  if (
    document.mcpServers !== undefined &&
    (!document.mcpServers ||
      Array.isArray(document.mcpServers) ||
      typeof document.mcpServers !== "object")
  )
    throw new Failure("config_invalid", "mcpServers must be an object.");
  const old = document.mcpServers?.["apple-notes-agent"];
  if (
    old &&
    hash(old) !== hash(entry) &&
    (!previous || hash(old) !== hash(previous))
  )
    throw new Failure(
      "mcp_conflict",
      "An unowned apple-notes-agent MCP entry exists. It was not overwritten.",
    );
  return {
    ...document,
    mcpServers: { ...document.mcpServers, "apple-notes-agent": entry },
  };
}
async function linkTarget(path) {
  try {
    const stat = await lstat(path);
    return stat.isSymbolicLink() ? await readlink(path) : null;
  } catch (e) {
    if (e.code === "ENOENT") return undefined;
    throw e;
  }
}
async function replaceLink(path, target) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await symlink(target, tmp);
  await rename(tmp, path);
}
async function installLock(work) {
  await mkdir(DATA_HOME, { recursive: true, mode: 0o700 });
  const path = join(DATA_HOME, "setup.lock");
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (e) {
    if (e.code === "EEXIST")
      throw new Failure(
        "setup_busy",
        `Another setup may be active. Inspect ${path}/owner.json before removing a stale lock.`,
      );
    throw e;
  }
  try {
    await writeJson(join(path, "owner.json"), {
      pid: process.pid,
      started: new Date().toISOString(),
    });
    return await work();
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}
export async function install({
  target = "auto",
  mcp = false,
  skillDir,
  dryRun = false,
  verify = true,
  log = () => {},
} = {}) {
  requireMac();
  const targets = selectTargets(target);
  if (skillDir && targets.length > 1)
    throw new Failure(
      "invalid_argument",
      "--skill-dir applies to one target at a time.",
    );
  const sourceHash = await treeHash(SKILL_ROOT);
  const packagePath = join(
    DATA_HOME,
    "packages",
    `${VERSION}-${sourceHash.slice(0, 12)}`,
  );
  const cli = join(BIN_DIR, "notes-agent");
  const links = [
    ...new Set(
      targets.map((t) => skillDestination(t, skillDir)).filter(Boolean),
    ),
  ].map((path) => ({ path, target: packagePath }));
  const entry = { command: cli, args: ["serve"] };
  const mcpTargets = targets.filter((t) => mcp || t === "claude-desktop");
  const configs = mcpTargets.map((t) => configDestination(t)).filter(Boolean);
  const plan = {
    ok: true,
    mode: "plan",
    version: VERSION,
    backendVersion: BACKEND_VERSION,
    targets,
    links,
    cli,
    runtime: RUNTIME,
    mcpConfigs: configs,
    manualMcp: mcpTargets
      .filter((t) => !configDestination(t))
      .map((target) => ({ target, entry })),
    systemPermissions: "requested by macOS only; never changed by installer",
  };
  if (dryRun) return plan;
  return installLock(async () => {
    const previous = await readJson(MANIFEST, {
      links: [],
      configs: [],
      packages: [],
    });
    for (const link of links) {
      const current = await linkTarget(link.path);
      const owned = previous.links.find((l) => l.path === link.path);
      if (
        current !== undefined &&
        current !== link.target &&
        current !== owned?.target
      )
        throw new Failure(
          "skill_conflict",
          `Existing skill at ${link.path} is not owned by this installer. It was preserved.`,
        );
    }
    if (await exists(cli)) {
      const text = await readFile(cli, "utf8");
      if (!previous.cli || hash(text) !== previous.cli.hash)
        throw new Failure(
          "cli_conflict",
          `Existing ${cli} is not owned by this installer.`,
        );
    }
    for (const pkg of previous.packages ?? []) {
      if ((await exists(pkg.path)) && (await treeHash(pkg.path)) !== pkg.hash)
        throw new Failure(
          "modified_installation",
          `Installed skill was edited at ${pkg.path}; preserve or move those changes before upgrading.`,
        );
    }
    const configPlans = [];
    for (const path of configs) {
      const before = (await exists(path)) ? await readFile(path, "utf8") : null;
      let parsed;
      try {
        parsed = before === null ? {} : JSON.parse(before);
      } catch {
        throw new Failure(
          "config_invalid",
          `Cannot parse ${path}; it was not modified.`,
        );
      }
      const owned = previous.configs.find((c) => c.path === path);
      configPlans.push({
        path,
        before,
        after: mergeMcpConfig(parsed, entry, owned?.entry),
      });
    }
    await installRuntime({ log });
    let toolCount;
    if (verify) {
      log("Verifying local MCP handshake and tool discovery…");
      toolCount = await session(
        async (c) => (await c.listTools()).tools.length,
      );
    }
    const undo = [];
    try {
      if (!(await exists(packagePath))) {
        await mkdir(dirname(packagePath), { recursive: true, mode: 0o700 });
        const stage = `${packagePath}.${randomUUID()}.tmp`;
        try {
          await cp(SKILL_ROOT, stage, {
            recursive: true,
            filter: (path) => !path.split("/").includes("node_modules"),
          });
          if ((await treeHash(stage)) !== sourceHash)
            throw new Failure(
              "copy_verification_failed",
              "Copied skill did not match the source.",
            );
          await rename(stage, packagePath);
        } finally {
          await rm(stage, { recursive: true, force: true });
        }
        undo.push(() => rm(packagePath, { recursive: true, force: true }));
      }
      const wrapper = `#!/bin/sh\n# Managed by Apple Notes Agent Skill ${VERSION}\nif [ -z "\${APPLE_NOTES_AGENT_HOME:-}" ]; then export APPLE_NOTES_AGENT_HOME=${shellQuote(DATA_HOME)}; fi\nif [ -z "\${APPLE_NOTES_AGENT_BIN_DIR:-}" ]; then export APPLE_NOTES_AGENT_BIN_DIR=${shellQuote(BIN_DIR)}; fi\nNOTES_AGENT_NODE=${shellQuote(process.execPath)}\nif [ ! -x "$NOTES_AGENT_NODE" ]; then NOTES_AGENT_NODE=$(command -v node) || exit 127; fi\nexec "$NOTES_AGENT_NODE" ${shellQuote(join(packagePath, "scripts/notes.mjs"))} "$@"\n`;
      const oldCli = (await exists(cli)) ? await readFile(cli, "utf8") : null;
      await atomicWrite(cli, wrapper, 0o755);
      undo.push(() =>
        oldCli === null
          ? rm(cli, { force: true })
          : atomicWrite(cli, oldCli, 0o755),
      );
      for (const link of links) {
        const before = await linkTarget(link.path);
        await replaceLink(link.path, link.target);
        undo.push(() =>
          before === undefined
            ? rm(link.path, { force: true })
            : replaceLink(link.path, before),
        );
      }
      const receipts = [];
      for (const c of configPlans) {
        const backup =
          c.before === null
            ? null
            : join(DATA_HOME, "backups", `${Date.now()}-${randomUUID()}.json`);
        if (backup) await atomicWrite(backup, c.before);
        await writeJson(c.path, c.after);
        undo.push(() =>
          c.before === null
            ? rm(c.path, { force: true })
            : atomicWrite(c.path, c.before),
        );
        receipts.push({ path: c.path, entry, backup });
      }
      const allLinks = [
        ...previous.links.filter((l) => !links.some((n) => n.path === l.path)),
        ...links,
      ];
      const allConfigs = [
        ...previous.configs.filter(
          (c) => !receipts.some((n) => n.path === c.path),
        ),
        ...receipts,
      ];
      const packages = [
        ...previous.packages.filter((p) => p.path !== packagePath),
        { path: packagePath, hash: sourceHash },
      ];
      const receipt = {
        version: VERSION,
        backendVersion: BACKEND_VERSION,
        installedAt: new Date().toISOString(),
        targets: [...new Set([...(previous.targets ?? []), ...targets])],
        links: allLinks,
        configs: allConfigs,
        packages,
        cli: { path: cli, hash: hash(wrapper) },
        runtime: RUNTIME,
        node: process.execPath,
      };
      await writeJson(MANIFEST, receipt);
      return {
        ...plan,
        mode: "installed",
        verified: verify,
        toolCount,
        skillPath: packagePath,
        discovery:
          "Available on the next agent turn; the installed CLI can be used immediately.",
        nextCommand: `${shellQuote(cli)} doctor`,
      };
    } catch (e) {
      const rollbackErrors = [];
      for (const revert of undo.reverse()) {
        try {
          await revert();
        } catch (error) {
          rollbackErrors.push(error.message);
        }
      }
      if (rollbackErrors.length) e.details = { ...e.details, rollbackErrors };
      throw e;
    }
  });
}
export async function uninstall({ purge = false } = {}) {
  requireMac();
  return installLock(async () => {
    const receipt = await readJson(MANIFEST, null);
    if (!receipt) return { ok: true, status: "not_installed" };
    const removed = [],
      preserved = [];
    for (const link of receipt.links) {
      if ((await linkTarget(link.path)) === link.target) {
        await rm(link.path);
        removed.push(link.path);
      } else if (await exists(link.path)) preserved.push(link.path);
    }
    if (await exists(receipt.cli.path)) {
      if (hash(await readFile(receipt.cli.path, "utf8")) === receipt.cli.hash) {
        await rm(receipt.cli.path);
        removed.push(receipt.cli.path);
      } else preserved.push(receipt.cli.path);
    }
    for (const c of receipt.configs) {
      const doc = await readJson(c.path, null);
      if (
        doc?.mcpServers?.["apple-notes-agent"] &&
        hash(doc.mcpServers["apple-notes-agent"]) === hash(c.entry)
      ) {
        delete doc.mcpServers["apple-notes-agent"];
        await writeJson(c.path, doc);
        removed.push(`${c.path}:apple-notes-agent`);
      } else if (doc?.mcpServers?.["apple-notes-agent"])
        preserved.push(`${c.path}:apple-notes-agent`);
    }
    for (const p of receipt.packages) {
      if (
        resolve(p.path).startsWith(join(DATA_HOME, "packages") + "/") &&
        (await exists(p.path))
      ) {
        if ((await treeHash(p.path)) === p.hash && !preserved.length) {
          await rm(p.path, { recursive: true });
          removed.push(p.path);
        } else preserved.push(p.path);
      }
    }
    if (purge && receipt.runtime === RUNTIME) {
      await rm(RUNTIME, { recursive: true, force: true });
      removed.push(RUNTIME);
    }
    if (!preserved.length) await rm(MANIFEST, { force: true });
    else
      await writeJson(MANIFEST, { ...receipt, uninstallPreserved: preserved });
    return {
      ok: true,
      removed,
      preserved,
      runtimeRetained: !purge,
      notes: "No Notes data or system privacy settings were changed.",
    };
  });
}
