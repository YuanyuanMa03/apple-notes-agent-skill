# Apple Notes 脚本接口 (AppleScript/JXA) 的坑与原理

本 CLI 全部设计决策的依据。2026-10 在 macOS 26.7.1 (Build 25G241) + iCloud 单账户环境实测，并结合开源社区结论。

## 1. 搜索：批量拉取，不用 whose 子句

`whose`（如 `notes whose plaintext contains "x"`）有两大致命问题：

- **对新建笔记直接报错**「不能获取对象」：实测创建笔记数分钟后（含跨进程）whose 仍找不到它们；只有老笔记可查。原因推测是 Notes 的对象索引异步提交。
- **更慢**：cupertino 项目在 921 条笔记上实测，`whose plaintext contains` 比一次批量拉取全量再在 JS 里过滤慢约 6.9×（671ms vs 97ms），因为 whose 的匹配求值要在 Apple Events 桥上逐条往返。

因此本 CLI 的策略：**每个文件夹用一次 Apple Event 批量拉属性**（`folder.notes.id()` / `.name()` / `.plaintext()` / `.creationDate()`…），再在 JS 里过滤。锁定笔记可能让整批属性拉取失败，此时自动降级为逐条拉取（每条独立 try/catch）。

注意：`folders` 元素上的 whose 从未成功过（无论查询词），文件夹匹配一律批量拉名字后 JS 过滤。

## 2. 标题 = 正文第一行

- `note.name` 与 `note.body` 的首个 `<div>` 是同一份数据的两个视图。**只设 `name` 不会更新 body**（造成脱钩：AppleScript 的 name 变了，UI 标题还是旧正文）。
- **改写 body 首个 `<div>` 时 name 会自动同步**。所以 `rename` 的实现是 body 首块手术，并保留原有的 `<h1>` 包裹（如果有的话）。
- `create` 时 Notes 会自动把 `name` 注入为 body 第一行，所以 `--text` 里不要重复写标题。
- 社区已知限制（sweetrb/apple-notes-mcp issue #172）：AppleScript 写入的标题不产生真正的 Heading 样式；富格式写入需走 macOS 26+ 的 Shortcuts「Interpret as Markdown」桥。

## 3. pinned（置顶）在 macOS 26 上不可用

读写 `note.pinned` 均报「不能转换类型」(-1700)。接口字段还在 sdef 里，但值无法转换。故本 CLI 不提供 pin 命令。

## 4. 文件夹删除的怪癖

- `App.delete(folder)` **不会连坐子文件夹**：实测删父文件夹后子文件夹浮到账户根（或残留为孤儿——其 `container()` 报「不能获取对象」，父引用指向墓碑对象）。
- 删除可能出现**异步复活**：删除后列表短暂干净，之后父文件夹又出现（iCloud 同步延迟）。所以 `delete-folder` 删除后会复核并给出 warning。
- 本 CLI 的 `delete-folder --force` 自底向上删：先笔记、再子文件夹（深→浅）、最后本体。

## 5. 最近删除 (Recently Deleted)

- `App.delete(note)` 把笔记移入 Notes 自己的「最近删除」（不进系统废纸篓），30 天自动清除。
- **对已在最近删除里的笔记再次 delete 会失败**——脚本无法彻底清空最近删除，需在 App 里手动操作。
- 「最近删除」出现在文件夹枚举里，`folders`/`list`/`search` 默认排除它（`--all`/`--deleted` 可包含）。
- `App.notes`（应用级扁平集合）**包含**最近删除里的笔记，直接按 id 操作可以读到回收站内容（`show <id>` 即可，可用于"恢复预览"）。

## 6. 锁定笔记（密码保护）

`body`/`plaintext` 返回空串，无脚本方式解锁。底层是端到端加密（NoteStore.sqlite 中为 AES 密文 `ZCRYPTOTAG`），SQLite 侧同样拿不到。用 `passwordProtected` 属性识别并跳过。

## 7. body 是 Apple 私有 HTML 方言

- 读取：`plaintext` 是干净的纯文本（标题重复出现在第一行；**表格内容不出现在 plaintext 里**，显示为 `￼`，读表格要 `body`）；`body` 是 HTML（`<div>`/`<h1>`/`<br>` 混合，写入后会被 Notes 规范化——如单个 `<div>a<br>b</div>` 会被拆成两个 div）。
- 附件显示为 `￼`（U+FFFC）；大图片笔记 body 可达数十 MB，非必要不拉 `--html`。
- 写入：本 CLI 把纯文本按行转 `<div>`（转义 `& < >`），够用且安全。

## 7b. 富文本写入方言 (2026-10 实测, apply-markdown 的依据)

从本机已有富文本笔记（含表格/h2/h3/原生列表）提取方言 + 写入规范化测试：

- **表格（可写入，存活）**：`<div><object><table cellspacing="0" cellpadding="0" style="border-collapse: collapse; direction: ltr"><tbody><tr><td valign="top" style="border-style: solid; border-width: 1.0px 1.0px 1.0px 1.0px; border-color: #ccc; padding: 3.0px 5.0px 3.0px 5.0px; min-width: 70px"><div>单元格</div></td>…</tr></tbody></table></object></div>`。表格必须包在 `<object>` 里且带内联边框样式，否则不成表格。
- **原生列表（可写入，存活）**：`<ul class="Apple-dash-list"><li>…</li></ul>` = 备忘录原生「虚线列表」；紧邻的普通 `<ul>` 会被并入前一个 dash-list，独立的普通 `<ul>` 保持圆点列表。
- **标题样式（半可用）**：写入 `<h1>/<h2>/<h3>` 会被规范化成 `<b><span style="font-size: 18px">`（h2）等「粗体+字号」形式——视觉接近 Heading 但**不是语义标题样式**（验证了 sweetrb issue #172）。apply-markdown 用 `#`→22px / `##`→18px / `###`+→纯粗体 模拟。
- **原生可打勾清单（不可写入）**：`list-item-container`/`list-marker` 结构、`Apple-checked-list` 类、div/span 的 class 全部被写入路径剥离拍平成普通文本。备忘录 div 的 class 属性一律被清洗（`<ul>` 的 class 幸存）。真原生清单只能走 Shortcuts 桥或 UI 自动化。
- **UTF-8 文件读取**：StandardAdditions 的 `read` 按系统默认编码解码，中文 md 必乱码；用 ObjC 桥 `$.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null)` 显式 UTF-8。
- **export 反向映射**（HTML→Markdown）：22px 粗体→`#`、18px 粗体→`##`、纯粗体行→保留行内 `**`、object 表格→Markdown 表格（表头去粗体）、`Apple-dash-list`→`-` 列表、`<tt>`→反引号、首个 div（标题）跳过（进 frontmatter）、`⸻` 分隔线保留。反向映射按 §7b 方言设计，未识别的复杂结构（嵌套列表、多级表格）会降级为纯文本。

## 8. 其他

- **多账户**：`move` 要求笔记与目标文件夹同账户；本 CLI 所有操作都在单账户内解析（默认自动选 iCloud）。
- **智能文件夹**是保存的搜索，不出现在脚本接口的 folders 枚举里，不能作为 move 目标，也无法用脚本创建。
- **#标签**只是正文文本：脚本写入 `#tag` 只以纯文本存在（Notes UI 可能渲染为标签），读取 plaintext 时可能被剥离；无原生标签 API。
- **授权 (TCC)**：Automation 权限按「宿主终端 App × 备忘录」授权，首次运行弹窗；终端测试通过不代表其他 App（如桌面客户端）有权限。
- **性能**：全量搜索 = 每文件夹一次批量拉取。44 条笔记 <1s；社区数据约 900 条 ≈ 100ms、5k 条级会遇到 Apple Events 超时——超大库建议 `--folder` 限定范围。

## 参考来源

- cupertino `docs/notes.md` — JXA/SQLite 双路线实测（batch pull vs whose 性能、NoteStore 结构）：https://github.com/mgcrea/cupertino/blob/main/docs/notes.md
- sweetrb/apple-notes-mcp — 最完整的 Notes MCP（AppleScript + Shortcuts 桥 + 只读 SQLite），其文档确认锁定笔记、最近删除、富格式限制：https://github.com/sweetrb/apple-notes-mcp
- RhetTbull/macnotesapp — Python 库 + CLI，确认锁定笔记不可读、#标签剥离：https://github.com/RhetTbull/macnotesapp
- bru6.de JXA Notes 参考：https://bru6.de/jxa/automating-applications/notes
- macOS Automation 官方教程（make/move/delete 动词）：https://www.macosxautomation.com/applescript/notes/03.html
- Apple 官方：Notes 安全特性（锁定笔记 E2E 加密）：https://support.apple.com/guide/security/secure-features-in-the-notes-app-sec1782bcab1/web
