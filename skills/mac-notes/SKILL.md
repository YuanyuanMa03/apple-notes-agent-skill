---
name: mac-notes
description: 操控 macOS 备忘录 (Apple Notes)：列出/搜索(标题+全文)/读取/创建/追加/改写/富排版/改名/移动/删除笔记，管理文件夹树，导出为 Obsidian Markdown，在 App 中打开笔记。零依赖 JXA CLI，输出 JSON，任何 agent 通用。Use this skill whenever the user mentions 备忘录、Apple Notes、Notes app、笔记, wants to 搜索/记录/整理/归档/移动/导出 notes, 记日记, or wants to use Mac Notes as an Obsidian-style knowledge base.
---

# Mac Notes (备忘录) 操控

通过本目录 `scripts/notes` CLI 完整操控 macOS 备忘录：**整理**（文件夹 / 移动 / 删除）、**搜索**（标题 + 全文）、**撰写**（新建 / 追加 / 改写）。零依赖（macOS 自带 osascript），ZCode / Claude Code 等任何 agent 可直接调用，成功一律输出 JSON。

## 首次使用（授权）

第一次运行会触发 macOS 弹窗「…想要控制"备忘录"」→ 点**允许**。
若曾被拒绝：系统设置 → 隐私与安全性 → 自动化 → 勾选你的终端 App 下的「备忘录」，然后重试。

## 调用方式

```bash
NOTES="$HOME/.agents/skills/mac-notes/scripts/notes"
"$NOTES" list                       # 或等价: osascript -l JavaScript "$NOTES" list
"$NOTES" help                       # 查看全部命令
```

成功 = stdout 输出 JSON（exit 0）；失败 = stderr 输出 `[mac-notes] …`（exit 1），错误信息里带下一步建议，照做即可。

## 命令速查

| 命令 | 作用 |
|---|---|
| `folders [--all]` | 文件夹列表（path、noteCount；默认不含「最近删除」） |
| `list [--folder F] [--limit N]` | 笔记列表，按修改时间倒序 |
| `search <词> [--folder F] [--deleted]` | 全文搜索（标题+正文，不区分大小写），带摘要 |
| `show <id\|标题> [--html]` | 读一条笔记（纯文本；`--html` 附原始 HTML） |
| `open <id\|标题>` | 在备忘录 App 中打开并定位 |
| `create --title "T" [--text "内容"] [--folder F]` | 新建笔记 |
| `append <id\|标题> --text "内容"` | 末尾追加段落 |
| `set-text <id\|标题> --text "内容"` | 整体替换正文（保留标题） |
| `apply-markdown <id\|标题> (--file F\|--text M) [--append]` | **Markdown → 备忘录富文本**（真表格/原生列表/标题样式/加粗，保留原标题） |
| `rename <id\|标题> --title "新标题"` | 改名 |
| `mkdir <路径>` | 建文件夹（支持 `父/子` 嵌套） |
| `move <id\|标题> --folder F` | 移动笔记 |
| `delete <id\|标题>` | 删除笔记 → 最近删除（30 天） |
| `delete-folder <路径\|id> [--force]` | 删文件夹；非空需 `--force` |
| `export <id\|标题> [--out 目录]` | 单篇导出为 Obsidian 格式 .md（frontmatter + 富文本→Markdown） |
| `export --folder F [--out 目录]` | 批量导出整个文件夹（含子文件夹） |

`<id|标题>`：优先用 id（`list`/`search`/`show` 都会返回）；标题唯一时可直接用标题，重名会报错并列出候选。多账户可加 `--account <名称>`（默认自动选 iCloud）。

## 示例

```bash
# 搜索并读取
"$NOTES" search 水稻土
"$NOTES" show "x-coredata://…/ICNote/p123"

# 新建 + 追加（注意: --text 里不要写标题，备忘录会自动把标题作为第一行）
"$NOTES" create --title "组会纪要 2026-10-24" --text $'参会: 全组\n要点: …' --folder "科研"
"$NOTES" append "组会纪要 2026-10-24" --text "补充: 下周交初稿"

# 整理: 找出某主题笔记批量归档
"$NOTES" search 会议 --folder "科研"          # 拿到 id 列表
"$NOTES" mkdir "科研/会议归档"
"$NOTES" move <id> --folder "科研/会议归档"

# 导出: 单篇 / 整个文件夹 → Obsidian .md
"$NOTES" export "推拉循环" --out ~/Documents
"$NOTES" export --folder "科研" --out ~/Documents/科研导出
```

## 核心规则（容易踩的坑）

1. **标题 = 正文第一行**。`create` 不要把标题重复写进 `--text`；改名必须走 `rename`（内部改写正文首个 div，name 会同步）。
2. **要富排版（表格/列表/标题样式）用 `apply-markdown`**，不要用 `set-text`。限制：原生可打勾清单无法通过脚本产生（`- [ ]` 会转为普通列表项，`- [x]` 加 ✓ 前缀）；标题样式是「粗体+字号」模拟而非语义 Heading；`plaintext` 里表格内容显示为 `￼`（读取表格内容要 `show --html`）。
2. **锁定（密码保护）笔记读不到**：列表里 `locked: true`，正文为空——端到端加密，脚本无法解锁，属正常现象。
3. **置顶（pin）在 macOS 26 上不可用**：AppleScript 接口读写 `pinned` 均报「不能转换类型」。
4. **删除是进「最近删除」**（30 天自动清空，可在 App 里恢复）；已在最近删除里的内容无法用脚本彻底删除。
5. **智能文件夹不是真文件夹**，不能作为 `move` 目标；`#标签` 只是正文文本，无原生标签 API。
6. **笔记 id 形如 `x-coredata://…/ICNote/p123`**，稳定可靠，跨命令通用。
7. 附件在纯文本里显示为 `￼`（对象占位符）；带图笔记的 HTML 可能非常大，非必要不用 `--html`。

更多原理与实测细节（为何不用 whose 子句、文件夹删除的异步怪癖等）：读 `references/quirks.md`。
