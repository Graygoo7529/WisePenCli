# 场景命令参考

下文 `W` 代表 Windows 的 `.\wisepen.cmd`，或 Linux/macOS/Git Bash 的 `./wisepen`。执行时替换入口。需要精确输入契约时用 `W schema --command "命令" --json`。

## 上传文档

支持 PDF、DOC/DOCX、PPT/PPTX、XLS/XLSX，单文件最大 100 MiB。上传到个人目录或小组子目录：

```text
W doc upload --file <本地文件.pdf> --to /研究 --json
W doc upload --file <本地文件.pdf> --group "研究组" --to /资料 --json
W doc upload --file <本地文件.pdf> --group-id <groupId> --to /资料 --json
```

命令返回 documentId 和目标信息；documentId 只代表上传处理任务。小组根 `/` 可以浏览，但不能作为挂载目标，先用 `drive mkdir` 创建子目录。格式错误会在发出网络请求前返回支持的扩展名列表。

## 文档任务恢复

```text
W doc tasks --json
W doc pending --json
W doc status --document-id <documentId> --json
W doc refresh --document-id <documentId> --json
W doc wait --document-id <documentId> --max-wait 300 --json
W doc retry --document-id <documentId> --json
W doc cancel --document-id <documentId> --yes --json
```

tasks 是数据目录中的记录，pending 是服务器的未完成任务。status 只读；refresh/wait 可能推进处理。pending 中没有任务不能推断 READY；以明确状态为准。当前服务的状态响应可能不带 resourceId，不能按文件名盲猜资源；需要时用 search，并仅在名称完全匹配且结果唯一时继续。retry/cancel 有状态限制，不能用它们重做传输结果不确定的上传。停止 wait 不取消服务端任务。

会话过期时先请用户按 nextActions 重新登录，再查询原 documentId。下载已有文件需要 `--overwrite`；下载中断不能当作完整文件。

## 会话历史

```text
W session list --json
W session history --title "研究讨论" --json
W session export --id <sessionId> --format markdown --output history.md --json
W session rename --id <sessionId> --name "整理后的标题" --json
W session delete --id <sessionId> --yes --json
```

历史分页单位是回合，第一页通常是最新内容。导出会检查分页一致性；失败时不要宣称已经得到完整历史。会话 ID 与资源 ID 不同。

## 供应商和模型

```text
W provider list --json
W model list --scope USER --json
W model list --scope SYSTEM --json
W model available --json
W provider create --name 自用供应商 --type OPENAI_COMPATIBLE --input provider.json
W model create --input model.json --json
W model bind --name 自用模型 --provider 自用供应商 --provider-model remote-model --json
W model unbind --name 自用模型 --provider 自用供应商 --yes --json
```

provider.json 示例：`{"base_url":"https://provider.example/v1"}`。交互创建会隐藏提示 API key；agent 在用户授权后通过 `--api-key-stdin` 输入，不需要环境变量，不把 key 放入 Skill 或长期脚本。`--input -` 与 key stdin 不能同时使用。

更新供应商非密钥字段用 `provider update --name ... --input update.json`，文件内容示例：`{"patch":{"is_active":false}}`。更新 key 用 `provider update --name ... --api-key-stdin`。模型 create/update/bind 的复杂字段以各自 schema 为准，不猜测 API 字段。

USER 配置可编辑；SYSTEM 模型配置本身通常只读，但当前用户可以为其绑定自己的供应商。绑定时明确 `--scope SYSTEM`。供应商被引用时删除可能被服务端拒绝。

## 笔记与网页

```text
W note create --title 实验记录 --to /研究 --json
W note versions --id <resourceId> --json
W note fork --id <resourceId> --name "实验记录副本" --json
W note read --id <resourceId> --experimental --json
W note export --id <resourceId> --experimental --format xml --output note.xml --json
W web url --id <resourceId> --json
W web url --target session --id <sessionId> --json
W web url --target ai-settings --json
```

create 创建空笔记；fork 创建独立资源。read/export 得到活跃协同状态，不保证是数据库持久化版本；文本与 Markdown 只是有损阅读结果，不能无损导回。正文修改使用网页，不绕过 CLI 向内部协同接口发送写入。

## 选择目录和挂载

`resource move` 同空间移动；`resource mount` 将资源挂到目标小组；`resource unmount` 只卸载指定小组目录的位置。日常优先用源路径，CLI 可以同时确定资源和来源目录。只用 ID 操作小组挂载时，还需要 `--source-tag-id`，不能凭资源 ID 猜测挂载来源。

遇到 `GROUP_ROOT_NOT_MOUNTABLE`，从 candidates 选择目录，或按当前任务创建一个子目录。nextActions 中的 `/资料` 是示例，不是要求自动创建的固定目录。永久删除、回收、撤销会话等操作应符合用户的当前任务意图。
