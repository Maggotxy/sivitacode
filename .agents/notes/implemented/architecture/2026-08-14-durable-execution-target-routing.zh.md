# Agent Note: 持久执行目标路由

Status: implemented

[English](2026-08-14-durable-execution-target-routing.md) | 中文

## 问题

选择远程或容器目标的会话必须在恢复、fork 与创建子 Agent 后，仍让全部文件系统和基于子进程的能力留在该目标中。只路由 Shell 命令会使 MCP、LSP、后台任务或文件操作逃回控制机。

## 决策

会话 header 可以指定一个部署 Inventory 目标。Agent 构造会在发布 Agent 前解析该目标，隔离文件系统、子进程和传输服务 realm，并在完整 Agent 生命周期内挂载同一个 owner。fork 与进程内子 Agent 继承该目标。目标缺失、禁用或不可用时会明确失败。

路由 provider 从 AgentLoop 的完整运行时 Context 派生能力 realm，而 API、ACP 或子 Agent 调用方 Context 只持有 Agent 生命周期。这样可以防止传输适配器的窄注入作用域变成能力基础，从而丢失会话、工具或 provider 服务。

ACP 使用标准扩展 metadata namespace `_meta['sivitacode.dev']`。部署配置 allowlist 后才公布 `executionTarget` 支持，并允许 `session/new` 持久化一个所选目标；未配置 allowlist 时不公布能力，任何选择都会拒绝。由于 ACP stdio 没有经过认证的 actor，精确列表或显式 `['*']` 属于进程级信任，而不是用户 RBAC。

随附的 `sivitacode acp` profile 将基础运行时、ACP bridge 与部署 Inventory 组合在 Web 同样使用的 `$SIVITACODE_HOME/sivitacode.db` SQLite WAL 介质上。Web 仍是经过认证的管理控制面；每个 ACP 进程只得到自己的部署 allowlist。之所以用 SQLite 取代单进程整文件 JSON 介质，是因为 Web 与 ACP 被支持作为并发进程运行。依据预发布兼容策略，现有 JSON 存储不会迁移。

共享文件、搜索与 Bash 工具以及工作区指令发现会为每次携带持久目标的调用从路由后的 Agent context 选择服务；目标侧 Bash 只在文件系统与 subprocess 适配器就绪后挂载。setup 期间挂载的 Agent 作用域终端、LSP 与 MCP stdio 插件会直接捕获这些路由服务。provider 暴露同一个不透明执行世界标识；coherence invariant 会拒绝文件系统与子进程 owner 不一致的组合。

文件系统 skill 发现同样跟随 Agent 文件系统。宿主文件 watcher 只观察本地执行世界的根；目标侧根保持完整但明确不可缓存，并在每次查找时重新扫描，因此 SSH 或 OCI 上由 Git、Shell 或其他进程产生的变化不会留下虚假的宿主已监视目录。

Inventory 目标 revision 属于管理期望状态。恢复会话会用持久目标 id 解析当前启用的目标记录，因此管理员可以轮换主机密钥或镜像而不重写会话日志。部署计划则固定目标 revision，因为审批针对一个确切的执行目的地。

## 考虑过的替代方案

**分别路由每个 consumer。** 新增的子进程 consumer 可能静默绕过目标，独立 provider 也可能描述不同机器，因此被拒绝。

**在每个会话中持久化完整目标快照。** 这会让主机密钥或镜像轮换必须重写不可变会话 metadata，因此被拒绝。需要审批不可变目的地的部署计划会保留确切 revision。

**允许任意 ACP 客户端选择任意 Inventory 目标。** 此方案被拒绝，因为无认证的 stdio 客户端只需知道 id 就能使用目标持有的 SSH 凭据。部署必须列出精确目标，或显式选择通配符。

## 影响

本机、精确固定主机密钥的 SSH 与 rootless OCI 目标共用同一套 Agent 组合。传输相关功能不能通过直接在控制进程中 spawn 绕过路由。MCP stdio 通过 `ctx.subprocess` 跟随该组合。Streamable HTTP 会记录 `networkOwner: control-plane`；其 URL 绝不会被静默解释成目标本地的 `localhost`，并且在具备认证、可取消、可审计 tunnel 生命周期前会拒绝 `execution-target` owner。

## 验证

组合测试断言文件系统与子进程共享标识、逐调用文件／搜索／Bash provider 选择，并验证真实目标侧文件、进程、Shell、PTY、搜索、skill 发现、stdio MCP、Git worktree、健康检查、部署与清理行为。会话创建、持久化、fork、子 Agent 继承、Host RPC、Client projection、ACP 能力协商、allowlist 拒绝、发布前挂载失败与响应 metadata 共同覆盖持久目标字段。
