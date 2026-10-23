#!/bin/bash
set -euo pipefail
NOTES_AGENT_REPO=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec /bin/bash "$NOTES_AGENT_REPO/skills/apple-notes/scripts/bootstrap.sh" "$@"
