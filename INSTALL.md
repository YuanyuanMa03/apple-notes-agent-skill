# Install Apple Notes Agent Skill

For the agent the user asked to install **Apple Notes (苹果备忘录)** integration. Use the user's local Mac. This package is MIT licensed and uses the MIT sweetrb/apple-notes-mcp 2.15.10 backend.

## Requested outcome

Install a discoverable skill for the current agent, prepare its pinned runtime, and check the actual connection. Prefer Skill + CLI for local shell agents: it works immediately without MCP re-registration. For a client without a shell, use local stdio MCP.

## Installation

1. Confirm this execution is on the Mac holding the Notes library. A Linux/cloud container cannot access it. If this is cloud-only, give the user this same prompt for a local Mac agent; do not install into the container and announce success.
2. Obtain https://github.com/YuanyuanMa03/apple-notes-agent-skill locally, or use the checkout from which you read this file. Inspect install.sh and the skill's scripts/bootstrap.sh and scripts/setup.mjs. Use a dedicated directory; do not clone over user work. If selecting a release tag, verify that it exists.

   Git and developer tools are optional. If Git is unavailable, download the GitHub source ZIP with the Mac's built-in `curl` and extract with `ditto -x -k` into a temporary directory, then use that checkout. Do not install Xcode Command Line Tools just to obtain this skill.
3. Select the current host: `codex`, `claude-code`, `cursor`, or `generic`. `auto` uses environment hints and otherwise selects generic. For an agent with a custom skill directory, pass `--skill-dir /absolute/path`. Do not install into every other detected agent unless asked.
4. Run from the checkout:

   ```sh
   bash install.sh --target auto
   ```

   Substitute the identified host when known. The bootstrap reuses Node 20+ or installs official Node 24 in the user directory with SHA-256 verification. No sudo, Homebrew change, global npm install, Swift compiler or model API key. Dependencies are pinned and installed without lifecycle hooks.
5. Read the JSON installation result; it gives absolute CLI and skill paths. Run that CLI's `doctor`. Installer handshake/tool discovery does **not** prove Notes permission, write access or complete feature readiness.
6. Follow the actual diagnosis for Automation and Full Disk Access. Identify the exact responsible Node/host process from tool output, not the visible app name. macOS grants require the user's click; never reset permissions or install a broker App to bypass that. If a host restart is needed, retain the completed installation and explain the next action once.
7. Read the installed SKILL.md and use its CLI in this conversation. Skill discovery is available on the next agent turn; a native MCP connection may require a server/client restart. Report actual working capabilities and specific remaining requirements.

Do not create, edit, delete or export user notes just to announce installation. Use a read-only health check. A live write check needs an explicitly requested synthetic test folder. Do not enumerate the entire library for a connection check.

## Clients without local shell access

For Claude Desktop: `bash install.sh --target claude-desktop`. This backs up and merges its JSON MCP config. It does not install an independent App. After restarting that client, run doctor through its own MCP connection; terminal grants do not prove the desktop host has access.

For Claude Code/Cursor, `--mcp` also merges their local JSON MCP configuration. For Codex/generic, requesting `--mcp` prints a standard local server entry; use that host's supported registration mechanism. Shell agents do not need native MCP registration. Avoid duplicating an existing Notes server unnecessarily.

## Optional native features

Only for a requested native feature, run `notes-agent setup shortcuts`, guide through Add Shortcut and first-run consent, then check `setup check` and `capabilities`. Imported does not mean consented. Missing features are reported; do not silently substitute lossy whole-body writes. Private-framework writes and the optional upstream broker App remain disabled.

## Recovery and removal

- Preserve same-name external skills/config entries. Ask only if a conflict requires choosing between installations.
- Retry a transient download failure. A setup lock reports its path/PID; verify the process is gone before removing that exact stale lock.
- Upgrade by getting a new source version and rerunning setup. Do not change the backend to latest or disable preservation guards.
- Uninstall with the installed absolute CLI's `uninstall`; `--purge` also removes the managed backend cache. Notes data and system permissions are untouched.

## Already installed by another skill manager

The directory `skills/apple-notes` is self-contained. A manager can copy just that directory. Its first-use bootstrap is `bash scripts/bootstrap.sh --runtime-only` from the copied skill directory, followed by `node scripts/notes.mjs doctor`. This prepares the same pinned backend without creating duplicate skills, global launchers or MCP config entries.
