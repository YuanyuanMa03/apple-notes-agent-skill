# Usage and compatibility

## Targets

| Target | Skill discovery | Optional local MCP config |
|---|---|---|
| codex | ~/.agents/skills/apple-notes | Printed entry for the host's MCP mechanism |
| claude-code | ~/.claude/skills/apple-notes | --mcp merges ~/.claude.json |
| cursor | ~/.cursor/skills/apple-notes | --mcp merges ~/.cursor/mcp.json |
| claude-desktop | No filesystem skill discovery assumed | Always merges ~/Library/Application Support/Claude/claude_desktop_config.json |
| generic | ~/.agents/skills/apple-notes, or --skill-dir | Printed standard entry |

Agent Skills is a portable format; discovery paths are host-specific. The host needs local shell execution or stdio MCP. This package does not install a remote connector or claim every AI chat can reach the Mac.

## Managed paths

Skill copies and pinned runtimes live in ~/.local/share/apple-notes-agent; the launcher is ~/.local/bin/notes-agent. Discovery directories contain symlinks to managed skill copies. XDG_DATA_HOME, APPLE_NOTES_AGENT_HOME and APPLE_NOTES_AGENT_BIN_DIR customize locations. APPLE_NOTES_AGENT_USER_HOME is an explicit user-home override used in isolated installer tests.

A receipt tracks ownership. Upgrades preserve edited managed files; JSON configs are merged at one named MCP entry, with private backups. Uninstall preserves unrelated config and modified files. --purge removes the managed backend cache, never Notes data.

## Calling tools

`notes-agent help` lists conveniences. `tools NAME` retrieves the exact backend schema; `call NAME --input request.json` exposes every operation without a hand-maintained duplicate API. `serve` runs the same backend for a native MCP host. Use UTF-8 files/stdin for quotes, Unicode and multiline content.

## Readiness

Installer verification covers versions, copied files, MCP handshake and tool discovery. `doctor` separately checks Notes and reports permission/capability requirements. Full Disk Access may be needed for even plain-note editing because preservation metadata is checked first. Creation success does not prove updates, native tables or portable exports.

The upstream broker App and private-framework write helpers are disabled. macOS consent and optional Shortcut first-run approvals remain user actions.

## Verified on 2026-10-23

On an Apple silicon Mac running macOS 15.7.1:

- 24 automated checks passed: isolated installation/reinstallation/uninstallation, preservation of user configuration and edits, path quoting, standalone skill-manager installation, input handling, and a real stdio MCP connection launched from the generated desktop configuration.
- A cold setup with no Node in PATH downloaded official Node 24.22.1, verified its SHA-256, installed the locked backend, and discovered 89 tools. No compiler or sudo was used.
- Real Notes checks passed for creating a synthetic note, exact-ID reading, scoped search, nested folder creation, and moving with readback.
- Guarded editing and portable Markdown export returned `full_disk_access_missing` in that host. They remain pending live acceptance after the system grant takes effect; their tool registration is not a passing edit/export test.
- Package script/reference validation and the skill-creator validator passed. Runtime dependency audit reported zero known vulnerabilities in the locked dependency snapshot.

The synthetic note is retained for inspection. Raw diagnostic outputs and private note IDs are excluded from the repository.

## Development

```sh
npm test
npm run check
npm run pack:skill
npm run test:live -- --allow-synthetic-write
```

The live test uses a dedicated synthetic folder and reports per-capability results. Permission failures are failed/pending checks, never passing mocks. It leaves the note for inspection.

## Sources

- https://github.com/sweetrb/apple-notes-mcp/tree/v2.15.10
- https://agentskills.io/client-implementation/adding-skills-support
- https://code.claude.com/docs/en/skills
- https://learn.chatgpt.com/docs/build-skills
