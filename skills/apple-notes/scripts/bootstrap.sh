#!/bin/bash
set -euo pipefail
# No sudo, global npm install, Homebrew change or system permission mutation.
if [ "$(uname -s)" != Darwin ]; then
  printf '%s\n' 'Apple Notes Agent Skill needs the Mac holding your Notes library.' >&2
  exit 1
fi
NOTES_AGENT_SKILL=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
NOTES_AGENT_NODE=$(command -v node || true)
if [ -z "$NOTES_AGENT_NODE" ] || ! "$NOTES_AGENT_NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' >/dev/null 2>&1; then
  for NOTES_AGENT_ARG in "$@"; do
    if [ "$NOTES_AGENT_ARG" = --dry-run ]; then
      printf '%s\n' 'Node 20+ is missing. A real install would download official Node 24 into the user directory; dry-run changed nothing.' >&2
      exit 1
    fi
  done
  NOTES_AGENT_ARCH=$(uname -m)
  case "$NOTES_AGENT_ARCH" in arm64) ;; x86_64) NOTES_AGENT_ARCH=x64 ;; *) printf '%s\n' 'Unsupported Mac architecture.' >&2; exit 1 ;; esac
  NOTES_AGENT_DATA=${APPLE_NOTES_AGENT_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/apple-notes-agent}
  mkdir -p "$NOTES_AGENT_DATA/node"
  NOTES_AGENT_TMP=$(mktemp -d "$NOTES_AGENT_DATA/node/download.XXXXXX")
  trap 'rm -rf "$NOTES_AGENT_TMP"' EXIT
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$NOTES_AGENT_TMP/SHASUMS256.txt"
  NOTES_AGENT_ARCHIVE=$(awk -v arch="$NOTES_AGENT_ARCH" '$2 ~ "-darwin-" arch "\\.tar\\.gz$" { print $2; exit }' "$NOTES_AGENT_TMP/SHASUMS256.txt")
  if [ -z "$NOTES_AGENT_ARCHIVE" ]; then printf '%s\n' 'No official Node 24 archive found.' >&2; exit 1; fi
  NOTES_AGENT_DIR=${NOTES_AGENT_ARCHIVE%.tar.gz}
  if [ ! -x "$NOTES_AGENT_DATA/node/$NOTES_AGENT_DIR/bin/node" ]; then
    printf '%s\n' 'Installing an official Node 24 runtime in your user directory…' >&2
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/latest-v24.x/$NOTES_AGENT_ARCHIVE" -o "$NOTES_AGENT_TMP/$NOTES_AGENT_ARCHIVE"
    awk -v file="$NOTES_AGENT_ARCHIVE" '$2 == file { print }' "$NOTES_AGENT_TMP/SHASUMS256.txt" > "$NOTES_AGENT_TMP/checksum.txt"
    (cd "$NOTES_AGENT_TMP" && shasum -a 256 -c checksum.txt)
    tar -xzf "$NOTES_AGENT_TMP/$NOTES_AGENT_ARCHIVE" -C "$NOTES_AGENT_TMP"
    mv "$NOTES_AGENT_TMP/$NOTES_AGENT_DIR" "$NOTES_AGENT_DATA/node/$NOTES_AGENT_DIR"
  fi
  NOTES_AGENT_NODE="$NOTES_AGENT_DATA/node/$NOTES_AGENT_DIR/bin/node"
fi
if [ -n "${NOTES_AGENT_TMP:-}" ]; then rm -rf "$NOTES_AGENT_TMP"; trap - EXIT; fi
exec "$NOTES_AGENT_NODE" "$NOTES_AGENT_SKILL/scripts/setup.mjs" "$@"
