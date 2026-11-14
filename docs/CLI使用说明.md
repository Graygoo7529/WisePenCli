# WisePenCli 指令说明

Windows 使用 `W = .\wisepen.cmd`，Linux/macOS/Git Bash 使用 `W = ./wisepen`。下面的 `W` 是阅读占位符，执行时替换为对应启动器，不需要设置别名或环境变量。需要 Node.js 22.13+。

## 登录与数据

```text
W login
W drive ls --json
W auth status --json
```

首次由用户输入账号和隐藏密码，agent 之后直接使用。默认连接已部署的 WisePen，明文会话令牌位于包内 `data/auth.json`，不保存密码。不同操作系统账户可共用同一目录，但必须有目录的读写权限。

```text
W config show
W config set --key dataDir --value <共享目录>
W config set --key apiUrl --value https://api.example.com
W config set --key webUrl --value https://wisepen.example.com
W --data-dir <临时目录> login
```

持久配置是包根目录的 `wisepen.json`。配置的相对目录以包目录为基准；临时 `--data-dir` 相对当前工作目录。切换目录不自动搬移旧数据。切换 API 地址后要重新登录。

令牌过期时按错误中的登录指令请用户重新登录，agent 随后继续任务。`logout` 只清除当前目录的 auth；`auth revoke --yes` 撤销服务端共享会话，可能同时退出浏览器。复制到另一设备的 data 不会随原目录自动同步。

受控自动化可用 `login --account <账号> --password-stdin`；也接受 `--password <密码>`，但会留在命令历史中。日常使用直接 `login` 即可。

## 浏览与整理

```text
W drive ls --path / --json
W group list --json
W drive ls --group "研究组" --path / --json
W search --query 论文 --size 20 --json
W drive mkdir --path /研究
W resource show --path /研究/论文.pdf --json
W resource move --path /研究/论文.pdf --to /归档 --dry-run --json
W resource move --path /研究/论文.pdf --to /归档 --json
```

`--path/--to` 是平台上的远端路径，统一使用 `/`，名称带空格时加引号。`--file/--output/--input/--data-dir` 才是本机路径。Git Bash 必须用 `./wisepen` 避免自动转换远端路径。

名称重复时 CLI 返回候选项，再用明确的 `--id` 或 `--group-id` 选择，不能默认选第一项。目录和资源是不同对象；分别使用 `drive rename/move` 和 `resource rename/move`。

```text
W drive mkdir --group "研究组" --path /资料
W resource mount --path /论文.pdf --target-group "研究组" --to /资料 --yes --json
W resource unmount --group "研究组" --path /资料/论文.pdf --yes --json
W resource trash --path /旧稿.pdf --yes --json
W resource restore --path /.Trash/旧稿.pdf --to /归档 --json
W resource delete --path /.Trash/旧稿.pdf --yes --json
```

挂载改变小组访问关系，不复制正文。小组 `/` 只展示目录，资源必须挂载到子目录。回收可能移除分享与小组挂载，恢复不会恢复这些授权；永久删除不能通过回收站恢复。

## 文档、历史和笔记

```text
W doc upload --file <本地文件.pdf> --to /研究 --json
W doc wait --document-id <documentId> --max-wait 300 --json
W doc status --document-id <documentId> --json
W doc tasks --json
W doc pending --json
W doc download --id <resourceId> --output <本地文件.pdf> --json
W session list --json
W session history --id <sessionId> --json
W session export --id <sessionId> --format markdown --output history.md --json
W note create --title 实验记录 --to /研究 --json
W note read --id <resourceId> --experimental --json
W web url --id <resourceId> --json
```

documentId 是上传任务 ID，resourceId 是资源 ID。`pending` 只表示任务已提交；`doc wait/refresh` 会刷新并可能推进处理，`doc status` 是只读查询。等待停止不代表服务端任务停止；不要因为任务不在 pending 列表中就推断已经完成。`doc retry/cancel` 按服务端状态决定能否操作。

笔记正文读取是实验性协同快照，文本/Markdown 可能丢失结构；正文编辑、Office 排版、PDF 标注和图形编辑用网页。`web url` 不携带认证凭据，浏览器需要自己的登录状态。CLI 不发送新聊天消息。

## 模型与供应商

```text
W provider list --json
W model list --scope USER --json
W model available --json
W schema --command "provider create" --json
W provider create --name 自用供应商 --type OPENAI_COMPATIBLE --input provider.json
W model bind --name 自用模型 --provider 自用供应商 --provider-model remote-model --json
```

`provider.json` 放非密钥配置，例如 `{"base_url":"https://provider.example/v1"}`。交互创建会提示输入 key；agent 使用 `--api-key-stdin` 从授权来源读取 key。复杂模型参数使用 `--input`，以对应 `schema` 为准。SYSTEM 模型配置通常只读，用户绑定仍可单独管理。

## agent 调用与升级

使用 `--json`，同时检查退出码、`ok` 和 `meta.outcome`。结果是 `pending/partial/unknown` 时保留已有 ID，先查询，不直接重复写操作。`--dry-run` 预览，`--yes` 确认需要确认的业务操作；它们不提升服务器权限。无 TTY 或使用 JSON 时不会进入交互提示。

六个全局选项是 `--json`、`--data-dir`、`--yes`、`--dry-run`、`--input`、`--timeout`。JSON 输出超过预算会明确失败，可用分页/导出，或 `config set --key maxOutputBytes --value 2097152` 调整。`--input -` 与密码/key 的 stdin 输入不能同时使用。

0.2 使用 JSON `schemaVersion: "2"`；meta 以 apiUrl/dataDir 代替 profile。从 0.1 升级首次重新登录，旧文件原样保留；不要把旧凭据复制改名为 auth.json。

| 旧入口 | 现在使用 |
| --- | --- |
| profile、`--profile` | 默认服务或 `config show/set` |
| `--config-dir` | `--data-dir` |
| whoami、doctor | 直接业务命令；需验证身份时 `auth status` |
| capabilities | `schema`，详细输入用 `schema --command "..."` |
| drive tree | 逐层 `drive ls` |
| group members、web open | 网页；链接由 `web url` 提供 |
| note append/patch/import | 网页编辑正文 |
| 认证环境变量、DPAPI 参数 | `login` 后读取指定目录中的 auth.json |

命令完整列表用 `W schema --json`，具体选项用 `W <命令> --help`。
