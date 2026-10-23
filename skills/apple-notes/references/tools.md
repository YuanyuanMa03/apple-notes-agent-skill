# Tools and recovery

Backend: `sweetrb/apple-notes-mcp` **2.15.10**, MIT. Use `notes-agent tools NAME` for exact schemas, then `notes-agent call NAME --input request.json`. Replace the launcher with `node /the/loaded/skill/scripts/notes.mjs` if PATH is not refreshed. JSON output retains structured errors, hashes, `committed` and `indeterminate` flags. Exit 1 means the call failed or setup is incomplete.

| Goal | Tool | Essential behavior |
|---|---|---|
| Discover | `get-capabilities`, `doctor`, `list-accounts`, `list-folder-tree` | Connection and feature readiness are separate. |
| Search | `search-notes` | `query`; optional `folder`, `account`, `searchContent`, `limit`. |
| Read for editing | `get-note-content` | Exact `id`; retain `contentHash`, warnings and `writable`. |
| Read Markdown | `get-note-markdown` | Exact `id`; a projection, not always a safe writeback body. |
| Create | `create-note` | `title` plus `content` or `contentPath`; optional `folder`, `account`, `format`. Plaintext needs no Markdown Shortcut. |
| Append | `append-to-note` | `id`, `expectedContentHash`, `content`; protected notes also need distinctive existing `scopeText` and a native bridge. |
| Replace body | `update-note` | `id`, `expectedContentHash`, `newContent`; entire-body replacement, subject to preservation checks. |
| Organize | `create-folder`, `rename-folder`, `move-note` | Nested folder paths; use `ifFolderId` on scoped moves. |
| Delete | `delete-note` | Inspect its schema and preserve revision/scope checks. Not needed for setup verification. |
| Native write | `create-table`, `create-checklist-items`, `add-native-tags`, `set-note-pinned` | Check availability; exact ID/hash and existing `scopeText`. |
| Native read | `get-note-tables`, `get-checklist-state`, `get-note-blocks` | Full Disk Access; preserve unknown ranges as opaque. |
| Attachments | `list-attachments`, `add-attachment`, `save-attachment` | Real absolute paths and returned attachment IDs. |
| Export | `export-notes-markdown`, `export-notes-html` | Exact `id` or scoped `folder`; `outputPath` and optional asset directory. |

`notes-agent export ID --format json` writes one note's raw tool response, not attachment bytes or a lossless native backup. For portable assets use backend Markdown/HTML exports and inspect warnings. Do not export the whole library to obtain one note.

Never fabricate a content hash or compute it from Markdown. Even plain notes can require native safety metadata before a write. Native `scopeText` is a unique 12–500 character phrase already below the title, preferably plain words; it does not replace the revision check. Newly created notes may not yet be visible to Notes search.

| Code/state | Action |
|---|---|
| `permission_denied` | Allow the actual responsible process to automate Notes; verify from that host. |
| `full_disk_access_missing` | Follow the exact runtime path in `doctor`; installed files cannot enable it. |
| `shortcut_not_installed` | Run setup for the requested native feature, guide through import and consent. |
| `revision_conflict` | Read again and reconcile, not a stale resend. |
| `ambiguous` | Resolve an exact ID. |
| `timeout_indeterminate`, uncertain/absent write outcome | Read back before retrying; avoid duplicate create/append. |
| `verification_failed`, `committed: true` | Inspect the write that may already be present. |
| `unsupported` | Explain the specific limit; do not replace rich notes to simulate support. |

Source and full reference: https://github.com/sweetrb/apple-notes-mcp/tree/v2.15.10
