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

`build:portable` 更新程序、依赖与 Skill 到项目根的 `wisepen-cli/`，供本地用户和 agent 试用；它会保留该目录已有的 `wisepen.json` 和 `data/`，所以不会清除已有登录状态。程序不注册全局命令，不在启动时安装 Node。

## 版本控制与发布包

Git 仓库追踪源码、测试、文档、Skill、锁文件、CI 配置和根目录启动器 `wisepen` / `wisepen.cmd`。`dist/`、`node_modules/`、运行数据、`wisepen-cli/` 本地试用包以及 `releases/` 发布候选目录均为生成物，不提交到源码仓库；其中运行数据可能包含明文会话令牌。

源码检出后，先安装依赖并完成检查：

```sh
npm ci --ignore-scripts
npm run check
npm run docs:contracts
```

有两种构建方式：

1. **本地自测、自用**：运行 `npm run build:portable`。它更新项目根的 `wisepen-cli/`，保留该目录已有的 `wisepen.json` 与 `data/`，因此适合用户登录后反复试用，也适合 agent 直接调用。
2. **干净发布**：运行 `npm run build:release`。它先清空并重新生成 `releases/wisepen-cli/`，只放入编译程序、生产依赖、启动器、文档和 Skill；数据目录只有 `.gitkeep`、`.gitignore`，不会复制 `wisepen-cli/` 的配置或登录令牌。

两种方式都应先执行 `npm run check`；发布方式还应确认 `releases/wisepen-cli/data/` 没有 `auth.json`，再压缩并上传。`wisepen-cli/` 不直接作为公开发布源。

Windows PowerShell 示例：

```powershell
git clone <REPOSITORY-URL> WisePenCli-release
cd WisePenCli-release
npm.cmd ci --ignore-scripts
npm.cmd run check
npm.cmd run docs:contracts
npm.cmd run build:release
New-Item -ItemType Directory -Force .\releases | Out-Null
Compress-Archive -Path .\releases\wisepen-cli -DestinationPath .\releases\wisepen-cli-v0.2.0.zip -Force
```

Linux/macOS 示例：

```sh
git clone <REPOSITORY-URL> WisePenCli-release
cd WisePenCli-release
npm ci --ignore-scripts
npm run check
npm run docs:contracts
npm run build:release
mkdir -p releases
tar -czf releases/wisepen-cli-v0.2.0.tar.gz -C releases wisepen-cli
```

`wisepen-cli/` 是本地试用工作区，`releases/` 是本机生成的、准备上传的发布候选目录；两者都不提交到源码仓库。最终发布时，把 `releases/` 中经过验证的 zip/tar.gz 作为 GitHub Release 附件上传。版本发布时先创建版本标签，例如 `v0.2.0`，再将对应附件加入该 Release。GitHub 自动生成的源码 zip/tarball 是源码快照，不包含可直接使用的 `node_modules` 便携包。

后端接口依据见 [contract-map.md](docs/contract-map.md)。测试使用本地 HTTP/WS 服务，不等同于生产部署联调。平台与共享账户测试说明见 [测试说明](docs/testing.md)。
