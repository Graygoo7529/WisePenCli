---
name: wisepen-cli
description: 使用 WisePenCli 便携包浏览、整理和上传 WisePen 资源，查询文档任务、会话历史及模型供应商配置；需要正文编辑、Office/PDF 排版或图形操作时转交浏览器。
---

# 使用 WisePenCli

WisePenCli 是 WisePen 网页端的命令行入口，适合人类操作，也适合 agent 通过结构化结果完成重复流程。Windows 使用 .\wisepen.cmd，Linux/macOS/Git Bash 使用 ./wisepen。命令默认读取便携包旁的 data/，需要共享状态时使用同一 --data-dir。

## 登录

首次使用让用户在终端执行：

    W login

用户输入账号和密码后，agent 直接复用该目录中的会话令牌。令牌失效或未登录时，CLI 返回 LOGIN_REQUIRED 和可复制的登录命令；把该命令交给用户执行，再重试原命令。不要要求用户把密码发给 agent，也不要把令牌写入提示词。

检查位置和登录状态：

    W config show
    W auth status --json

其中 W 代表当前平台的启动器。--json 适合 agent 解析；人类查看时可省略。

## 先理解三个对象

- 远端目录使用 / 分隔；--file、--output 和 --data-dir 才是本地路径。
- documentId 是文档上传任务号，resourceId 是处理完成后的平台资源号，不能互换。
- 不指定小组就是个人空间；用 --group <名称> 或 --group-id <ID> 访问小组空间。小组根 / 可浏览，挂载和上传应选择其子目录。

## 常见流程

### 浏览和定位

    W drive ls --path / --json
    W drive ls --group "研究组" --path /资料 --json
    W search --query 论文 --json
    W resource show --path /研究/论文.pdf --json

名称不唯一时使用结果中的 ID；不要猜测 ID，也不要把本地路径传给 --path 或 --to。

### 上传文档

支持 PDF、DOC/DOCX、PPT/PPTX、XLS/XLSX，单文件最大 100 MiB。个人目录：

    W doc upload --file ./论文.pdf --to /研究 --json

小组目录：

    W doc upload --file ./论文.pdf --group "研究组" --to /资料 --json

也可使用 --group-id。保存返回的 documentId，再执行：

    W doc wait --document-id <documentId> --max-wait 300 --json

上传结果的 processing 为 pending 时，不能当作资源已就绪。当前服务的状态接口可能只返回状态而不返回 resourceId；此时不要按文件名盲猜资源，先报告任务号或用 search 在结果唯一且名称完全匹配时继续。

### 整理和共享

    W drive mkdir --group "研究组" --path /资料
    W resource move --path /研究/论文.pdf --to /归档 --json
    W resource mount --path /研究/论文.pdf --target-group "研究组" --to /资料 --yes --json

遇到 GROUP_ROOT_NOT_MOUNTABLE，根据 candidates 选择子目录，或先用 drive mkdir 创建目录。写操作先用 --dry-run；需要确认时加 --yes。

### 会话和配置

    W session list --json
    W session history --id <sessionId> --json
    W provider list --json
    W model list --scope USER --json

CLI 读取会话历史和模型/供应商配置，但当前不发送新的 AI 消息。创建或更新供应商时按 schema 提供输入，并让用户通过隐藏提示或 stdin 输入密钥。

## 结果和衔接

自动化始终使用 --json，同时检查进程退出码、ok 和 meta.outcome。pending、partial、unknown 表示仍需查询或人工判断；已有 documentId、resourceId、operationId 时先复用它们，不要直接重做写操作。

常见错误的处理方向：

| 错误 | 处理 |
| --- | --- |
| LOGIN_REQUIRED | 让用户执行返回的 login 命令，再重试原命令 |
| INVALID_INPUT / INVALID_ARGUMENT | 修正参数、远端路径或输入文件，不要重试原请求 |
| CLIENT_ERROR / DATA_DIR_ACCESS_DENIED | 检查本地文件和数据目录权限 |
| GROUP_ROOT_NOT_MOUNTABLE | 使用 candidates 中的子目录，或先创建目录 |

笔记正文读取需要 --experimental，结果是协同快照，不能替代网页端正文编辑。Office 排版、PDF 标注、图形编辑和完整聊天交给浏览器；W web url --id <resourceId> 只生成地址，不携带认证信息。

详细命令、输入 schema 和恢复步骤见 [references/commands.md](references/commands.md)。
