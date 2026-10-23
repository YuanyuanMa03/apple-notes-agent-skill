#!/usr/bin/env node
import { readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  parseArgs,
  checkFlags,
  formatError,
  Failure,
  DATA_HOME,
  HOME,
  BACKEND_VERSION,
  SDK_VERSION,
  RUNTIME,
  MANIFEST,
  readJson,
  backendEnv,
  run,
  requireMac,
  exists,
} from "./lib/common.mjs";
import { requireRuntime, backendEntry, runtimeValid } from "./lib/runtime.mjs";
import { session, callTool, invoke } from "./lib/mcp.mjs";

const help = `Apple Notes Agent Skill
  notes-agent doctor                         Check the actual host and permissions
  notes-agent capabilities                   Discover available native operations
  notes-agent tools [NAME]                    Discover exact tool names / JSON schemas
  notes-agent call NAME --input FILE|-        Run any upstream tool with JSON input
  notes-agent call NAME --json '{...}'         Short JSON input (prefer files for content)
  notes-agent search QUERY [--folder PATH] [--body] [--limit N]
  notes-agent read ID [--format markdown|html|text]
  notes-agent create --title TITLE --input FILE|- [--folder PATH] [--format plaintext|html|markdown]
  notes-agent edit ID --expected-hash HASH --input FILE|- [--mode replace|append]
  notes-agent move ID --folder PATH [--from-folder-id ID]
  notes-agent folders
  notes-agent export ID --output PATH [--format markdown|html|json]
  notes-agent setup permissions|shortcuts|check
  notes-agent install [setup options]         Add another agent target or upgrade from source
  notes-agent uninstall [--purge]             Remove only managed links/configuration
  notes-agent serve                          Start the pinned stdio MCP server

No API key, independent app, sudo, or global npm install required.
Editing needs a fresh contentHash from read and the backend's preservation checks.
Native tables/checklists need optional Shortcuts; unavailable features are reported.
`;
async function inputText(args) {
  if (args.input === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
  }
  if (args.input) return readFile(resolve(args.input), "utf8");
  throw new Failure(
    "input_required",
    "Use --input FILE or --input - for note content.",
  );
}
function required(value, name) {
  if (!value) throw new Failure("invalid_argument", `${name} is required.`);
  return value;
}
function integer(value, name) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1)
    throw new Failure(
      "invalid_argument",
      `${name} must be a positive integer.`,
    );
  return n;
}
function defined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  );
}
async function doctor() {
  const receipt = await readJson(MANIFEST, null);
  if (!(await runtimeValid()))
    return {
      ok: false,
      status: "runtime_not_installed",
      next: "Run install.sh or scripts/setup.mjs.",
    };
  return session(async (c) => {
    const tools = (await c.listTools()).tools;
    const capabilities = await callTool(c, "get-capabilities", {});
    const health = await callTool(c, "health-check", {});
    const diagnosis = await callTool(c, "doctor", {});
    const healthy = health.ok && health.data?.healthy === true;
    const fullDiskAccess = health.data?.fullDiskAccess === true;
    return {
      ok: healthy,
      status: healthy
        ? fullDiskAccess
          ? "requirements_met"
          : "basic_only"
        : "permission_or_connection_required",
      runtimeReady: true,
      backendVersion: BACKEND_VERSION,
      sdkVersion: SDK_VERSION,
      toolCount: tools.length,
      node: process.execPath,
      installed: !!receipt,
      readiness: {
        basicReadAndCreate: healthy ? "requirements_met" : "unavailable",
        guardedEdit:
          healthy && fullDiskAccess
            ? "requirements_met"
            : "full_disk_access_missing",
        portableExport:
          healthy && fullDiskAccess
            ? "requirements_met"
            : "full_disk_access_missing",
        nativeWrites: capabilities.data?.features?.backgroundOperationsBridge
          ?.available
          ? "requirements_met"
          : "check_capabilities",
        liveOperationsVerified: false,
      },
      capabilities,
      health: { ok: health.ok, data: health.data },
      diagnosis,
      scope:
        "This is a local process probe. Requirements met is not live task acceptance. A different desktop MCP host must run its own doctor.",
      permissions:
        "The installer never grants macOS privacy permissions. Follow the diagnosis for the process actually launching this runtime.",
    };
  });
}
try {
  const [command = "help", ...argv] = process.argv.slice(2);
  if (command === "help" || command === "--help") {
    console.log(help);
  } else if (command === "install" || command === "uninstall") {
    process.argv = [
      process.argv[0],
      new URL("./setup.mjs", import.meta.url).pathname,
      ...(command === "uninstall" ? ["--uninstall"] : []),
      ...argv,
    ];
    await import("./setup.mjs");
  } else if (command === "serve") {
    if (argv.length)
      throw new Failure("invalid_argument", "serve takes no arguments.");
    requireMac();
    await requireRuntime();
    const child = spawn(process.execPath, [backendEntry()], {
      env: backendEnv(),
      stdio: "inherit",
    });
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
      process.on(signal, () => child.kill(signal));
    child.on("error", (e) => {
      console.error(JSON.stringify(formatError(e)));
      process.exitCode = 1;
    });
    child.on("exit", (code, signal) => {
      process.exitCode = code ?? (signal ? 1 : 0);
    });
  } else if (command === "setup") {
    const [mode, ...extra] = argv;
    if (extra.length)
      throw new Failure(
        "invalid_argument",
        "setup accepts only permissions, shortcuts, or check.",
      );
    requireMac();
    await requireRuntime();
    const options = {
      permissions: ["setup", "--permissions", "--once", "--probe-automation"],
      shortcuts: ["setup"],
      check: ["setup", "--check"],
    }[mode];
    if (!options)
      throw new Failure(
        "invalid_argument",
        "Use setup permissions, setup shortcuts, or setup check.",
      );
    await run(process.execPath, [backendEntry(), ...options], {
      env: backendEnv(),
      inherit: true,
      timeout: 120_000,
    });
  } else {
    const args = parseArgs(argv, { booleans: ["body"] });
    let result;
    switch (command) {
      case "doctor":
        checkFlags(args, []);
        if (args._.length)
          throw new Failure("invalid_argument", "doctor takes no arguments.");
        result = await doctor();
        break;
      case "capabilities":
        checkFlags(args, []);
        if (args._.length)
          throw new Failure(
            "invalid_argument",
            "capabilities takes no arguments.",
          );
        result = await invoke("get-capabilities", {});
        break;
      case "tools":
        checkFlags(args, []);
        if (args._.length > 1)
          throw new Failure("invalid_argument", "tools accepts one name.");
        result = await session(async (c) => {
          const tools = (await c.listTools()).tools;
          if (args._[0]) {
            const tool = tools.find((t) => t.name === args._[0]);
            if (!tool)
              throw new Failure("tool_not_found", `No tool named ${args._[0]}`);
            return { ok: true, tool };
          }
          return {
            ok: true,
            backendVersion: BACKEND_VERSION,
            tools: tools.map(({ name, description, annotations }) => ({
              name,
              description,
              annotations,
            })),
          };
        });
        break;
      case "call": {
        checkFlags(args, ["json", "input"]);
        if (args._.length !== 1)
          throw new Failure(
            "invalid_argument",
            "call requires exactly one tool name.",
          );
        if (args.json !== undefined && args.input !== undefined)
          throw new Failure(
            "invalid_argument",
            "Use exactly one of --json or --input.",
          );
        const raw = args.json ?? (args.input ? await inputText(args) : "{}");
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          throw new Failure("invalid_json", "Tool input is not valid JSON.");
        }
        if (!data || Array.isArray(data) || typeof data !== "object")
          throw new Failure(
            "invalid_json",
            "Tool input must be a JSON object.",
          );
        result = await invoke(args._[0], data);
        break;
      }
      case "search":
        checkFlags(args, ["folder", "account", "body", "limit"]);
        result = await invoke(
          "search-notes",
          defined({
            query: required(args._.join(" "), "QUERY"),
            folder: args.folder,
            account: args.account,
            searchContent: !!args.body,
            limit: integer(args.limit, "--limit"),
          }),
        );
        break;
      case "read": {
        checkFlags(args, ["format"]);
        if (args._.length !== 1)
          throw new Failure(
            "invalid_argument",
            "read requires one exact note ID.",
          );
        const name = {
          markdown: "get-note-markdown",
          html: "get-note-content",
          text: "get-note-plaintext",
        }[args.format ?? "html"];
        if (!name)
          throw new Failure("invalid_argument", "Use markdown, html or text.");
        result = await invoke(name, { id: args._[0] });
        break;
      }
      case "create": {
        checkFlags(args, [
          "title",
          "input",
          "folder",
          "account",
          "format",
          "markdown-route",
        ]);
        if (args._.length)
          throw new Failure("invalid_argument", "create accepts flags only.");
        result = await invoke(
          "create-note",
          defined({
            title: required(args.title, "--title"),
            content: await inputText(args),
            folder: args.folder,
            account: args.account,
            format: args.format ?? "plaintext",
            markdownRoute: args["markdown-route"],
          }),
        );
        break;
      }
      case "edit": {
        checkFlags(args, [
          "expected-hash",
          "input",
          "mode",
          "format",
          "scope-text",
          "from-folder-id",
        ]);
        if (args._.length !== 1)
          throw new Failure(
            "invalid_argument",
            "edit requires one exact note ID.",
          );
        const common = defined({
          id: args._[0],
          expectedContentHash: required(
            args["expected-hash"],
            "--expected-hash",
          ),
          format: args.format ?? "plaintext",
          ifFolderId: args["from-folder-id"],
        });
        const mode = args.mode ?? "replace";
        if (!["replace", "append"].includes(mode))
          throw new Failure(
            "invalid_argument",
            "--mode must be replace or append.",
          );
        result = await invoke(
          mode === "append" ? "append-to-note" : "update-note",
          {
            ...common,
            ...(mode === "append"
              ? {
                  content: await inputText(args),
                  ...defined({ scopeText: args["scope-text"] }),
                }
              : { newContent: await inputText(args) }),
          },
        );
        break;
      }
      case "move":
        checkFlags(args, ["folder", "account", "from-folder-id"]);
        if (args._.length !== 1)
          throw new Failure(
            "invalid_argument",
            "move requires one exact note ID.",
          );
        result = await invoke(
          "move-note",
          defined({
            id: args._[0],
            folder: required(args.folder, "--folder"),
            account: args.account,
            ifFolderId: args["from-folder-id"],
          }),
        );
        break;
      case "folders":
        checkFlags(args, []);
        if (args._.length)
          throw new Failure("invalid_argument", "folders takes no arguments.");
        result = await invoke("list-folders", {});
        break;
      case "export": {
        checkFlags(args, ["output", "format"]);
        if (args._.length !== 1)
          throw new Failure(
            "invalid_argument",
            "export requires one exact note ID.",
          );
        const format = args.format ?? "markdown";
        if (!["markdown", "html", "json"].includes(format))
          throw new Failure("invalid_argument", "Use markdown, html or json.");
        const output = resolve(required(args.output, "--output"));
        if (await exists(output))
          throw new Failure(
            "output_exists",
            "Choose a new export filename; the existing file was not overwritten.",
          );
        const parent = await realpath(resolve(output, ".."));
        if (
          parent.includes("/Library/Group Containers/group.com.apple.notes") ||
          parent.includes("/Library/Containers/com.apple.Notes")
        )
          throw new Failure(
            "invalid_output",
            "Never write exports into the Notes library.",
          );
        if (format === "json") {
          // An exact-note JSON export is a raw read, never the whole-library tool.
          result = await invoke("get-note-content", { id: args._[0] });
          if (result.ok) {
            const { open } = await import("node:fs/promises");
            const file = await open(output, "wx", 0o600);
            try {
              await file.writeFile(JSON.stringify(result, null, 2) + "\n");
            } finally {
              await file.close();
            }
            result = {
              ok: true,
              path: output,
              format: "json",
              noteId: args._[0],
              fidelity: "raw API projection; does not embed attachment bytes",
            };
          }
        } else
          result = await invoke(`export-notes-${format}`, {
            id: args._[0],
            outputPath: output,
          });
        break;
      }
      default:
        throw new Failure(
          "invalid_argument",
          `Unknown command ${command}. Run notes-agent help.`,
        );
    }
    console.log(JSON.stringify(result, null, 2));
    if (result.ok === false) process.exitCode = 1;
  }
} catch (e) {
  console.log(JSON.stringify(formatError(e), null, 2));
  process.exitCode = 1;
}
