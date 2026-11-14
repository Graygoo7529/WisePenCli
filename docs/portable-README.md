# WisePenCli 便携包

需要 Node.js **22.13+**，把本目录整体解压即可使用，无需全局安装。

Windows PowerShell / CMD：

```powershell
.\wisepen.cmd login
.\wisepen.cmd drive ls --json
```

Linux / macOS / Git Bash：

```sh
./wisepen login
./wisepen drive ls --json
```

Linux/macOS 若解压工具丢失执行权限，先运行 `chmod +x wisepen`，或使用 `node ./dist/cli.js`。Git Bash 请用 `./wisepen`，它会保持远端路径原样传入。

首次由用户输入账号和密码，密码隐藏输入。之后 agent 直接调用业务命令；无需再次输入密码或预先检查一串状态命令。默认连接 `https://api.wisepen.oriole.cn`，网页地址为 `https://wisepen.oriole.cn`。

默认会话和任务保存在本目录 `data/`。其中 `auth.json` 是明文令牌，不保存密码。不要求用户和 agent 使用相同操作系统账户，但双方须能访问数据目录。共享这个目录即共享当前 WisePen 身份。

一次指定其他数据目录，此后仍可直接运行启动器：

```powershell
.\wisepen.cmd config set --key dataDir --value 'D:\Shared\WisePenData'
.\wisepen.cmd login
```

Linux/macOS 示例：`./wisepen config set --key dataDir --value /srv/shared/wisepen-data`。目录由拥有权限的用户准备；CLI 不自动扩大访问权限。配置相对路径以包目录为基准。临时改用另一目录可传 `--data-dir <路径>`，其相对路径以当前工作目录为基准。

会话过期或未登录时，CLI 返回 `LOGIN_REQUIRED` 和包含实际数据目录的登录指令。用户执行后，agent 下一次调用即可读取新令牌；已创建的文档任务继续按原 documentId 查询，不重复上传。

从 0.1 升级后首次需重新 `login`。旧凭据和任务不会被删除；若检测到旧自定义服务，先按提示明确配置 `apiUrl`。`logout` 只清除本目录会话；`auth revoke --yes` 才撤销服务端共享会话，可能同时影响浏览器与其他副本。

常用指令见 [USAGE.md](USAGE.md)，agent 使用方式见 [Skill](skills/wisepen-cli/SKILL.md)。不熟悉的命令使用 `--help` 或 `schema --command "resource show" --json`。

[MCP 与插件安装](AGENT-INTEGRATIONS.md) 说明如何在本机生成 Codex、Claude Code、DeepSeek Harness 插件和通用 MCP 配置。
