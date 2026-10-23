# Apple Notes Agent Skill

让 Claude、Codex 和其他本地 agent 直接使用 Mac 上的**苹果备忘录**：读取、搜索、创建、编辑、整理和导出。

基于 [sweetrb/apple-notes-mcp](https://github.com/sweetrb/apple-notes-mcp)，封装成容易安装的通用 Agent Skill。**不需要独立 App、模型 API Key、sudo 或全局 npm 安装。**

## 把这段话发给你的 agent

```text
请阅读 https://github.com/YuanyuanMa03/apple-notes-agent-skill/blob/main/INSTALL.md，
在我的 Mac 上为当前 agent 安装 Apple Notes 技能，并完成安装和只读连接检查。
保留我现有的技能和配置。若 macOS 需要我手动授权，请告诉我具体要点哪个开关；
授权后继续验证，不要把“文件已安装”当作“全部功能可用”。
```

安装后直接说：

- “找一下我在备忘录里记过的项目决定。”
- “把这段内容保存到工作文件夹，标题叫今天的会议记录。”
- “给这篇备忘录追加下一步计划。”
- “把这几篇笔记移到归档文件夹。”
- “把这篇备忘录连同附件导出为 Markdown。”

首次系统授权需要用户点击，无法用 prompt 绕过。普通脚本操作需要 Automation → Notes；原生结构读取、许多已有笔记的安全编辑和便携导出还需要完整磁盘访问。高级原生操作按需导入快捷指令。

## 也可以自己安装

```sh
git clone https://github.com/YuanyuanMa03/apple-notes-agent-skill.git
cd apple-notes-agent-skill
bash install.sh --target auto
```

`auto` 根据当前 agent 环境选择目标，无法识别时安装到通用 `~/.agents/skills/apple-notes`。可指定 `codex`、`claude-code`、`cursor`、`claude-desktop` 或 `generic`，多个目标用逗号分隔。Claude Desktop 自动配置本地 MCP；其他目标默认使用 Skill + CLI。

优先复用 Node 20+；缺少时从 Node 官方下载并校验 Node 24，装到用户目录。后端固定为 **apple-notes-mcp 2.15.10**，MCP SDK 固定为 **1.32.1**，依赖使用 lockfile 安装并禁用生命周期脚本。

## 能力与边界

| 能力 | 说明 |
|---|---|
| 读取与搜索 | 账号、文件夹、标题/正文搜索，Markdown/HTML/纯文本读取 |
| 创建与编辑 | 创建、追加和受保护的正文更新；保留内容版本检查 |
| 整理 | 创建文件夹、移动、标签、置顶等；原生功能按能力检查结果提供 |
| 附件与导出 | 附件读取/保存，按笔记或文件夹导出 Markdown、HTML、JSON |
| 原生内容 | 结构读取、表格/清单创建等；需要相应权限与快捷指令 |
| 明确限制 | 不提供已有原生表格单元格的后台编辑、已有清单勾选切换、解锁或协作权限管理；不绕过保真保护 |

Skill + CLI 可在当前会话立即使用，不必等待 MCP 工具重新发现。只支持本机 Mac 上能够执行本地命令或启动本地 stdio MCP 的 agent；上传到云端容器不会获得本机备忘录访问能力。

## 安装管理

CLI 默认位于 `~/.local/bin/notes-agent`。PATH 未包含该目录时，使用安装结果给出的绝对路径。

```sh
notes-agent doctor
notes-agent capabilities
notes-agent tools search-notes
notes-agent setup shortcuts        # 仅在需要原生高级功能时
notes-agent install --target claude-code
notes-agent uninstall              # 保留运行时缓存、用户修改和全部笔记
notes-agent uninstall --purge      # 另删本包管理的后端运行时
```

升级：获取新版本源码后重新运行 `bash install.sh --target auto`。同名外部技能、手动修改过的安装文件和配置冲突会保留并报告。JSON 配置修改前有备份，卸载只移除本包的 MCP 项。

[Agent 安装指引](INSTALL.md) · [使用与兼容说明](docs/usage.md) · [技能正文](skills/apple-notes/SKILL.md) · [MIT License](LICENSE) · [上游声明](NOTICE)

English: A portable Apple Notes skill for local agents. Give your agent the INSTALL.md link; it installs a pinned backend, a discoverable skill and a shell-to-MCP CLI. macOS privacy grants still require your click.
