# WisePenCli

WisePen 用户和 agent 共用的命令行客户端，版本 **0.2.0**。支持 Windows、Linux、macOS，运行环境需要 Node.js **22.13+**。

便携包位于 `wisepen-cli/`。Windows 使用 `wisepen.cmd`；Linux、macOS、Git Bash 使用 `./wisepen`。无需全局安装或认证环境变量。

```powershell
cd wisepen-cli
.\wisepen.cmd login
.\wisepen.cmd drive ls --json
```

人类登录时输入账号和隐藏密码，之后 agent 直接使用同一包。默认服务是 `https://api.wisepen.oriole.cn`，网页是 `https://wisepen.oriole.cn`。包内 `data/auth.json` 保存明文会话令牌，不保存密码；需要不同操作系统账户共用时，为双方配置数据目录读写权限。

使用说明见 [CLI 指令说明](docs/CLI使用说明.md)；agent 按任务读取 [Skill](skills/wisepen-cli/SKILL.md)。Skill 仅放在项目和便携包内，没有全局注册。

## 开发与构建

```sh
npm ci --ignore-scripts
npm run check
npm run docs:contracts
npm run build:portable
```

Windows PowerShell 如受脚本执行策略限制，将 `npm` 换为 `npm.cmd`。源码构建后可用 `node dist/cli.js` 或源码目录中的启动器；它们也默认使用各自包根目录的 `data/`，不读取用户主目录的旧配置。

`build:portable` 更新程序、依赖与 Skill，保留便携包既有 `wisepen.json` 和 `data/`。分享已登录状态时有意携带 data；制作通用分发包时不附带运行数据。程序不注册全局命令，不在启动时安装 Node。

## 版本控制与发布包

Git 仓库追踪源码、测试、文档、Skill、锁文件、CI 配置和根目录启动器 `wisepen` / `wisepen.cmd`。`dist/`、`node_modules/`、运行数据、`wisepen-cli/` 便携包目录以及 zip/tar.gz 发布档案均为生成物，不提交到源码仓库；其中运行数据可能包含明文会话令牌。

源码检出后，先安装依赖并完成检查：

```sh
npm ci --ignore-scripts
npm run check
npm run docs:contracts
```

`npm run build:portable` 会把当前源码构建到 `wisepen-cli/`，并保留该目录已有的 `wisepen.json` 与 `data/`。因此制作公开的通用发布包时，应从干净检出目录构建，确认 `wisepen-cli/data/` 只有 `.gitkeep`、`.gitignore`，没有 `auth.json`，再打包；不要把日常登录后的便携包直接压缩并上传。

Windows PowerShell 示例：

```powershell
git clone <REPOSITORY-URL> WisePenCli-release
cd WisePenCli-release
npm.cmd ci --ignore-scripts
npm.cmd run check
npm.cmd run docs:contracts
npm.cmd run build:portable
Compress-Archive -Path .\wisepen-cli -DestinationPath ..\wisepen-cli-v0.2.0.zip -Force
```

Linux/macOS 示例：

```sh
git clone <REPOSITORY-URL> WisePenCli-release
cd WisePenCli-release
npm ci --ignore-scripts
npm run check
npm run docs:contracts
npm run build:portable
tar -czf ../wisepen-cli-v0.2.0.tar.gz wisepen-cli
```

发布包作为 GitHub Release 的附件上传；源码仓库只保留可重复构建它的脚本和说明。版本发布时先创建版本标签，例如 `v0.2.0`，再将对应的 zip/tar.gz 附加到该 Release。GitHub 自动生成的源码 zip/tarball 是源码快照，不包含可直接使用的 `node_modules` 便携包。

后端接口依据见 [contract-map.md](docs/contract-map.md)。测试使用本地 HTTP/WS 服务，不等同于生产部署联调。平台与共享账户测试说明见 [测试说明](docs/testing.md)。
