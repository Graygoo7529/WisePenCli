# 验证方式

`npm run check` 运行类型检查、lint 和本地 HTTP/WS 测试。测试创建隔离的临时便携目录和虚构会话，不读取包中现有 data，也不连接默认部署服务。

Windows 实际调用 PowerShell、CMD、Git Bash；Git Bash 位于标准 Git for Windows 安装目录。Linux/macOS 实际调用 POSIX 启动器和 Bash。测试覆盖包目录包含空格、中文文件、远端路径、JSON 输入、认证过期与原子文件保存。缺少目标 shell 时测试失败，不冒充已经验证。

## 真实跨账户验证

Linux 的 `scripts/verify-shared-directory.mjs` 需要由 root 启动，例如 CI 中执行：

```sh
sudo "$(command -v node)" scripts/verify-shared-directory.mjs
```

脚本以原调用用户和 nobody 两个不同 UID 启动 CLI，让两者使用共同的有效组，只在临时目录中设置组权限。它验证 A 登录、B 读取和写任务、A 再登录、B 读取新令牌，以及撤回目录访问权限后的错误。它不创建系统账户、不修改正式 data、不连接部署服务器。

共享目录采用组权限/默认 ACL 管理；临时文件和原子替换遵循目录继承规则，POSIX 还保留原文件 mode。不要依赖单独文件上的特殊 ACL 作为共享策略，Windows 原子替换后的 ACL 应在实际部署目录验证。

随项目提供的 `.github/workflows/check.yml` 面向独立 WisePenCli 仓库，使用 Windows/Linux/macOS runner，Linux 额外运行两个 UID 的测试。若项目放在其他仓库的子目录，需要在该仓库工作流中设定工作目录并调用相同命令。配置文件本身不代表远端 CI 已运行。

## 便携产物验证

MCP 测试通过真实 stdio 客户端启动便携包，覆盖工具发现、续登、分页、脱敏、输出预算和写入预览。使用同一个测试 HTTP 服务，既不连接正式部署，也不需要安装 agent 宿主。

构建后可在开发测试进程设置 `WISEPEN_TEST_PACKAGE=wisepen-cli` 再运行现有测试，以便从产物复制 dist、启动器及生产依赖进入隔离测试目录。这个变量仅供测试脚本使用，不是产品配置或认证环境变量。

当前本机 Windows 结果：47 项自动化测试中 46 项通过、1 项 POSIX 权限测试跳过；便携产物 5 项关键流程通过。真实 Windows PTY 已验证隐藏密码登录，以及账号/密码提示处 Ctrl+C 返回 130，取消后可再次登录。Linux/macOS、真实两个 OS 账户仍待对应环境执行；未执行项不算通过。详细结果记录在执行计划的实施核对表。
