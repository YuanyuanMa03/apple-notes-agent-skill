#!/bin/bash
# mac-notes 一键安装: 复制 skill 到本地 agent 的 skills 目录 (零依赖, 仅复制文件)
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)/skills/mac-notes"
TARGET="${1:-auto}"

case "$TARGET" in
  auto|generic) DEST="$HOME/.agents/skills" ;;   # 跨工具通用目录 (ZCode/Codex/等自动发现)
  zcode)        DEST="$HOME/.zcode/skills" ;;
  claude)       DEST="$HOME/.claude/skills" ;;
  *)            DEST="$TARGET" ;;                # 显式路径
esac

mkdir -p "$DEST"
rm -rf "$DEST/mac-notes"
cp -R "$SRC" "$DEST/mac-notes"
chmod +x "$DEST/mac-notes/scripts/notes"

echo "已安装: $DEST/mac-notes"
echo "验证:   $DEST/mac-notes/scripts/notes folders"
echo "提示:   首次运行 macOS 会弹授权「想要控制备忘录」→ 点允许"
