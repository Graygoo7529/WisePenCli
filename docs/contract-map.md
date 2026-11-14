# 接口依据与验证边界

本版只经由配置中的外部网关访问；`authorization` 请求头携带原始会话令牌，不添加 Bearer。Java/Python 都要求响应 `code === 200`；空结果接受 `null`/`""`。Java 分页 total 是十进制字符串，Python 是数字、字段为 total_page；JavaLong ID 始终保留字符串。未知枚举或错误响应不转换为空成功。

机器可读映射见 [contract-map.json](contract-map.json)，由 `npm run docs:contracts` 从真实使用的 schema 生成，记录 method/path、query/body、只读性与请求/响应校验。

| 功能 | 本工作区核对源文件 |
| --- | --- |
| 登录/身份 | WisePenCloud AuthController、UserController；WisePenView UserInformationApi.schema.ts |
| 目录与路径 | WisePenView domains/Drive/service/DriveServices.impl.ts、Tag/apis/TagApi.schema.ts；Java ResourceTagController |
| 资源与挂载 | WisePenView ResourceCoreApi.schema.ts、ResourcePlacementApi.schema.ts；Java ResourcePlacementController |
| 文档 | WisePenView DocumentApi.schema.ts；Java DocumentController、DocumentServiceImpl |
| 历史 | WisePenView ChatSessionApi.schema.ts；Python chat/session 路由与历史组装 |
| 模型与供应商 | WisePenView ChatModelApi.schema.ts；Python chat/model 路由和 model service |
| 笔记元信息 | WisePenView NoteApi.schema.ts；Java NoteController |
| 笔记正文 | WisePenView domains/Note/session/WisepenProvider.ts、CustomBlockNote Yjs fragment 定义；未发现协同服务实现 |
| 网页链接 | WisePenView appRoute 中 resource/chat/profile 路由 |

单独的传输协议：

- `/document/download`：GET，平台鉴权；ORIGINAL 可能跳转对象存储，WATERMARK 可直接返回文件。跨 origin 后永久去掉本次重定向链中的平台认证；拒绝 HTTPS 降级到非本地 HTTP、无效跳转和 JSON 伪文件。文件写完才提交到目标名。
- `uploadDoc` 返回的 PUT URL：仅按返回的对象存储地址发送文件与 `x-oss-callback`，不发送平台凭据、不跟随重定向、不自动重发。保存最小任务记录，不保存签名地址。
- `/note-collab/ws?resourceId=...`：使用相同会话请求头，禁止重定向，仅发送外层 type=0 / SyncStep1，接收 SyncStep2/update；忽略服务器 SyncStep1，不发送本地 update、awareness 或意图帧。收到完整同步后关闭连接。固定 16 MiB 最大 WS 帧。

## 已验证与未验证

本机 HTTP/WS fixtures 验证客户端契约、明文会话跨进程复用、过期恢复和业务行为；PowerShell/CMD/Git Bash 测试实际经过启动器。POSIX 权限与不同 UID 验证须在对应环境运行，不能用同一用户子进程替代。fixtures 不能替代网关、Redis 会话、对象存储回调或协同服务权限的部署联调。

后续真实部署验收使用外部网关、前端地址和隔离测试账号：login 后直接在测试目录完成上传/下载/移动/挂载/回收恢复、模型配置、历史导出。笔记需另验证 WS 鉴权、拒绝越权、持久化确认和并发写入协议，满足门槛前正文写入继续交给网页。

CLI 与服务端均有权限责任：CLI 负责目标消歧、作用域、来源位置和明确意图，服务端最终裁决实时权限；本地 dry-run 不预留事务或锁定资源。
