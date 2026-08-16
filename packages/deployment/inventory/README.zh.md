# `@deepseek-ai/dsh-deployment-inventory`

[English](README.md) | 中文

本地、固定密钥 SSH 和 rootless 容器部署目标的持久非秘密注册表。它存储目标身份、环境、传输配置、逻辑凭据引用、项目 workspace、标签、启用状态和乐观 revision；绝不存储私钥或密码。

## 授权与变更

所有方法都要求当前可信 `ctx.accessControl` actor。全局角色是权限上限；非管理员用户还必须具备所请求 `read`、`operate`、`configure` 或 `administer` 级别的显式目标授权。管理员保留对全部目标的恢复访问权。列表会过滤未授权目标和 plan，而每次读取、健康检查、工作树、路由、配置、审批、执行和删除操作都会在服务内部重新检查精确目标。授权替换与撤销使用乐观 revision，并把产品领域事件追加到共享安全审计。更新和删除同样必须携带观察到的 revision，因此两个管理员不能静默覆盖彼此。

SSH 目标要求 host、username、精确 OpenSSH 公钥和绝对 POSIX workspace。`identityCredential` 是经过验证的 `CredentialRef`，例如 `SIVITACODE_SSH_PROD_KEY`；凭据值是私钥，只会为单次操作解析，绝不会作为目标状态公开。本地目标拒绝 SSH 字段。

`checkHealth()` 要求 `operate` 权限。本地检查验证 workspace 可访问。SSH 检查会解析可选身份凭据、写入 mode-0600 临时文件、建立新的精确主机密钥固定 OpenSSH 连接，并通过远端 Python 检查 workspace 是否为目录。清理会删除临时密钥和连接状态。结果与审计只包含状态、耗时和脱敏诊断。

部署 plan 会在执行前持久保存目标 revision 和字面 argv。开发与预发布 plan 会立即就绪。生产 plan 必须由创建者之外的另一名 `admin` 审批。审批与执行预留在服务内串行化，因此同一个已观察 revision 只能结算一次；存在未结算 plan 的目标不能删除。执行会拒绝已变更或停用的目标、持久转换到 `running`、清理本地命令环境中的凭据特征条目、以不经过业务 shell 插值的 SSH argv 调用、只保留合并输出末尾有效 UTF-8 的 64 KiB，并且只会结算一次为 `succeeded` 或 `failed`。

滚动发布会持久保存包含 2–64 个目标的有序集合、每个已观察目标 revision、字面 argv、超时和不超过 16 的批次大小。可选字面 argv 阶段实现“摘流 → 部署 → 验证 → 失败时回滚 → 恢复流量”；配置摘流时必须配置恢复。只要包含任一生产目标，整个 rollout 就采用不同管理员审批规则。执行只会原子预留一次，重新检查全部目标 revision，然后逐批进行健康检查和有界执行。每个阶段分别保留有界结果，失败会停止后续批次。恢复流量失败，或控制平面在成功摘流后重启，会产生 `recovery-required`；获授权操作员只能重试持久化的恢复 argv，不会重新执行部署。

挂载 execution-world router 后，启用的目标可以拥有一个 session。session 持久保存目标 id；Agent 在发布前创建彼此独立的 `fs`、`subprocess` 与 `ssh` 服务 realm，并为 SSH 和 OCI 创建目标侧 `shell` realm，然后挂载本机 provider，或挂载同一个固定主机密钥 SSH／OCI owner 及其文件系统、进程和 Bash 适配器。共享文件、搜索和 Bash 工具会在执行时选择这些 Agent 作用域 provider；Agent 作用域的终端、LSP 与 MCP stdio 插件在路由后挂载时会继承它们。浏览器用户可在目标上点击“打开会话”进入该路径。

Web Inventory 页面可在所选目标中列出和创建 Git 工作树，并直接在工作树内打开会话。这些操作挂载与会话相同的本机、固定密钥 SSH 或 rootless 容器执行世界。链接 checkout 位于 `<workspace>/.sivitacode/worktrees` 下；删除仅允许该目录内的工作树，且绝不强制删除脏或锁定的工作树。

## 模型体验

无，因为 Inventory 是管理控制平面服务，不作为模型工具挂载。

#### KV Cache 影响

无；目标记录不会进入模型请求。

## 已知限制与延期工作

- 本地目标以 SivitaCode 服务账户执行，不在项目之间提供操作系统安全边界，仅适用于可信单用户控制机。多用户或相互不信任的项目必须使用 rootless 容器目标，或使用远端账户已隔离的 SSH 目标；SivitaCode 不会把路径检查或 Cordis 服务 realm 表述为操作系统安全边界的替代品。
- 定时触发 rollout 仍属于独立消费方；操作员显式启动持久 rollout。
- 主机密钥轮换当前是普通的 revision 守卫更新；专门的双密钥过渡流程延期实现。
- 授权当前绑定用户而非外部用户组；OIDC 或目录用户组映射需要独立身份提供方。
