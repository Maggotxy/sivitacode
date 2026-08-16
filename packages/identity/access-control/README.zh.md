# @deepseek-ai/dsh-access-control

[English](README.md) | 中文

基于 `ctx.storageDomain` 的持久认证账户与服务端会话。密码凭据使用 Argon2id；Cookie 密钥是随机 256 位值，持久层只保存其 SHA-256 摘要。`ctx.accessControl` 验证凭据、将可信 `AccessActor` 绑定到传输请求、通过 `AsyncLocalStorage` 传播 actor、把内置角色展开为操作权限，并追加安全审计记录。

用户表为空时，首次启动需要 `bootstrapUsername` 与 `bootstrapPassword`。引导口令持久化前会被哈希；账户存在后不再读取它。禁用用户会增加会话版本，使该用户的全部现有会话失效而无需扫描会话表。

角色保持精简：`viewer` 可读，`developer` 可读并操作智能体，`operator` 还可更改部署配置，`admin` 还可管理身份。消费者在操作入口执行 `read`、`operate`、`configure` 或 `administer` 检查；浏览器载荷从不携带可信角色。生成的 `accessControl` Remote 允许管理员列出和创建用户、替换角色、停用账户以及读取有界审计窗口。角色或停用状态变化会递增目标用户的会话版本，服务拒绝停用或降级最后一个已启用管理员。这些决策和成功的身份变更都会追加持久审计记录。

## 模型体验

无，因为访问策略不改变模型请求、提示词、工具 schema 或工具结果。

#### KV Cache 影响

无；授权不会增加模型可见 token。

## 已知限制与延期工作

- 内置角色提供全局权限上限。部署 Inventory 通过显式逐目标授权收窄非管理员用户；外部 OIDC 身份联合仍属于未来的独立提供方，不会预先塞入本地账户格式。
