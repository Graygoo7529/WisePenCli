# 在 agent 中安装 WisePen

使用 Node.js 22.13+。先将 WisePenCli 便携包解压到一个固定目录。开发者可在源码目录运行 `npm ci --ignore-scripts` 和 `npm run build:portable` 生成便携包。进入便携包目录，运行：

```sh
./wisepen login
node scripts/build-plugins.mjs
```

Windows PowerShell 将第一条命令替换为 `.\wisepen.cmd login`。如果此目录已经登录，跳过第一条。MCP server 沿用这个便携包的服务、数据目录与登录。也可以在源码检出中先运行 `npm run build`，再执行 `npm run build:plugins`。为另一份已构建的 CLI 生成插件时，给生成脚本传 `--cli-dir <绝对路径>`。

生成脚本在 CLI 下写入 `agent-plugins/`，并打印绝对路径。下文的 `<插件目录>` 指这个路径。配置引用生成时的 Node 可执行文件和 CLI 目录。移动其中任一个后，重新生成并安装插件。分发时分享干净的便携包，排除 `agent-plugins/` 和登录数据，让接收者在自己的电脑上生成配置。

## 通用 MCP 客户端

将 `<插件目录>/mcp.json` 中的 `wisepen` stdio 配置添加到客户端。若客户端需要分开填写启动参数，使用 JSON 中的 `command` 和 `args`。连接后先调用 `auth_status`，再用 `drive_ls` 或 `search` 查询。直接启动的入口是 `node <CLI目录>/dist/mcp.js`，可用 `--data-dir <绝对路径>` 指向 CLI 登录时使用的数据目录。启动后 stdout 是 MCP 协议流。

## Codex

```sh
codex plugin marketplace add "<插件目录>"
codex plugin add wisepen@wisepen-local
```

如果使用 Codex 桌面，在插件目录中选择本机的 `wisepen-local` marketplace，安装 WisePen。开新会话后调用 WisePen 的 `auth_status` 或 `drive_ls`。更新配置时先移除旧安装，再从同一 marketplace 安装。卸载使用 `codex plugin remove wisepen@wisepen-local`。如不再使用这个来源，可运行 `codex plugin marketplace remove wisepen-local`。

## Claude Code

```sh
claude plugin marketplace add "<插件目录>"
claude plugin install wisepen@wisepen-local
```

在新会话运行 `/mcp` 查看 WisePen server，然后调用 `auth_status` 或 `drive_ls`。开发测试可以直接用 `claude --plugin-dir "<插件目录>/wisepen"` 加载。更新配置时重新安装。卸载使用 `claude plugin uninstall wisepen@wisepen-local`。

## DeepSeek Harness

使用带有 `dsh plugin` 的 DeepSeek Harness。安装前确保 `pnpm` 在 PATH 中。选择实际使用的 profile，例如 `web`：

```sh
dsh plugin --profile web add "<插件目录>/dsh"
dsh --profile web
```

安装后重启该 profile。调用 `mcp__wisepen__auth_status` 或 `mcp__wisepen__drive_ls`。卸载使用 `dsh plugin --profile web remove @wisepen/dsh-plugin` 后重启。重新生成配置后，如果 profile 还在使用旧副本，移除并重新安装 bundle。

## 操作范围与重新登录

- MCP 默认只开放查询。工具包括资源搜索、个人或小组目录、文档任务、笔记元数据和版本、会话历史、供应商及模型、网页链接。
- 要让客户端执行目录和资源整理、笔记创建与复制、会话改名，运行 `node scripts/build-plugins.mjs --enable-writes` 后重新安装插件。工具默认预览。和用户确认后，才传 `dryRun: false`。直接运行 MCP 时也可使用 `--enable-writes`。
- 登录、密钥输入、永久删除、分享范围变更、文件上传下载与导出、实验性笔记正文读取继续使用 CLI。
- `LOGIN_REQUIRED` 表示需要人工登录。执行 `error.nextActions` 中的登录指令，随后重试 MCP 工具，无需重启 server。遇到 `partial`、`pending` 或 `unknown` 时先核实状态，再决定是否重试。
- 单次 MCP 结果最多 1 MiB。遇到 `OUTPUT_LIMIT` 时缩小分页大小，或用 CLI 导出。
- 所选 CLI 的指令说明描述个人与小组空间、文档任务与资源 ID 的区别。便携包中可查阅 `USAGE.md`。
