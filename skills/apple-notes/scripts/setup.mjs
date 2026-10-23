#!/usr/bin/env node
import { install, uninstall } from "./lib/install.mjs";
import { parseArgs, checkFlags, formatError } from "./lib/common.mjs";
import { installRuntime } from "./lib/runtime.mjs";
import { session } from "./lib/mcp.mjs";
try {
  const args = parseArgs(process.argv.slice(2), {
    booleans: [
      "mcp",
      "dry-run",
      "no-verify",
      "runtime-only",
      "uninstall",
      "purge",
      "help",
    ],
  });
  checkFlags(args, [
    "target",
    "mcp",
    "skill-dir",
    "dry-run",
    "no-verify",
    "runtime-only",
    "uninstall",
    "purge",
    "help",
  ]);
  if (args.help) {
    console.log(
      "Apple Notes Agent Skill setup\n  node setup.mjs [--target auto|generic|codex|claude-code|claude-desktop|cursor] [--mcp] [--skill-dir PATH] [--dry-run]\n  node setup.mjs --runtime-only [--no-verify]\n  node setup.mjs --uninstall [--purge]\nDefault: a skill + a local CLI; no MCP config edits except for claude-desktop.",
    );
  } else {
    if (args._.length) throw Error("Unexpected positional arguments.");
    if (args.purge && !args.uninstall)
      throw Error("--purge requires --uninstall.");
    if (args["runtime-only"]) {
      checkFlags(args, ["runtime-only", "no-verify"]);
      const runtime = await installRuntime({
        log: (s) => process.stderr.write(s + "\n"),
      });
      const toolCount = args["no-verify"]
        ? undefined
        : await session(async (c) => (await c.listTools()).tools.length);
      console.log(
        JSON.stringify(
          {
            ok: true,
            mode: "runtime_ready",
            runtime: runtime.path,
            verified: !args["no-verify"],
            toolCount,
            skill:
              "Existing skill directory retained; no discovery links or MCP config were changed.",
          },
          null,
          2,
        ),
      );
    } else {
      const result = args.uninstall
        ? await uninstall({ purge: !!args.purge })
        : await install({
            target: args.target,
            mcp: !!args.mcp,
            skillDir: args["skill-dir"],
            dryRun: !!args["dry-run"],
            verify: !args["no-verify"],
            log: (s) => process.stderr.write(s + "\n"),
          });
      console.log(JSON.stringify(result, null, 2));
    }
  }
} catch (e) {
  console.log(JSON.stringify(formatError(e), null, 2));
  process.exitCode = 1;
}
