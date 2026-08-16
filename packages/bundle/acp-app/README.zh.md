# `@deepseek-ai/dsh-acp-app`

[English](README.md) | 中文

这是 SivitaCode 的无头 Agent Client Protocol profile 组合包。`sivitacode acp` 在 stdin/stdout 上提供逐行 ACP JSON-RPC，并创建普通基础运行时 Agent（智能体）。客户端关闭 stdin 后，ACP bridge 会取消并收稳自有 Agent，发出 `acp/closed`，再由本组合包请求有界的整个 profile 关闭。它不挂载 HTTP 服务器、浏览器界面、Electron 运行时或 stdout logger。

该组合包与 `sivitacode web` 打开同一份 `$SIVITACODE_HOME/sivitacode.db` SQLite WAL 数据库。运维人员通过已认证的 Web 控制面创建和更新本地、SSH 与 rootless 容器目标；ACP 直接读取这些持久化 Inventory 记录，不维护第二种目标格式。Web 与 ACP 可以作为独立进程同时运行。由于本预发布仓库不承诺存储迁移兼容，旧的 `$SIVITACODE_HOME/storages/*.json` Inventory 不会自动导入。

提示词执行期间，该 profile 通过 ACP `session/update` 转发实时 assistant 文本、推理、工具调用／结果和上下文用量。工具展示与提供方无关且经过隔离：generic／diff 视图成为 ACP 卡片，terminal 视图使用文本 fallback，故障 presenter 不会导致轮次失败。加载会话只回放已提交的 user／assistant 消息，不回放之前的实时尝试或工具 trace。

会话列表采用稳定的 50 条 keyset 分页。组合内置的第一方持久化后端会启用 `session/delete`；它只在连接拥有的实时 Agent 完全结算并释放资源后永久移除精确日志。`session/close` 仍是非破坏性的资源释放操作。

ACP stdio 不认证个人身份或 Web 会话。因此，只有 `SIVITACODE_ACP_EXECUTION_TARGETS` 包含由逗号分隔的精确目标 id allowlist 时，才启用执行目标选择；`*` 是显式的部署级完全信任选项。客户端通过 `_meta['sivitacode.dev'].executionTarget` 选择获准目标；目标在会话发布前完成挂载，并持久化到会话 header。该 allowlist 授权整个 ACP 进程，不是逐用户 RBAC——当不同自动化主体需要不同权限时，应运行采用不同 allowlist 的独立 ACP 进程。

已经由 Web 初始化的 home 不需要口令。对于空 home，首次启动须设置 `SIVITACODE_WEB_PASSWORD`（以及可选的 `SIVITACODE_WEB_ADMIN_USERNAME`），以引导共享 access-control domain；缺失时启动会失败，不会创建无保护的管理员。

```sh
SIVITACODE_HOME=/srv/sivitacode \
SIVITACODE_ACP_EXECUTION_TARGETS='target-id-a,target-id-b' \
sivitacode acp
```

## 模型体验

间接影响，来自其组合的基础运行时；该运行时的 prompt、工具、模型选择与回答格式保持不变。

#### KV Cache 影响

除组合的基础运行时外无影响；该 profile 不贡献 prompt 或 schema 文本。

## 已知限制与延期工作

- ACP 的进程 allowlist 不是逐用户 RBAC，因为标准 stdio ACP 不携带经过认证的 SivitaCode actor。
- HTTP MCP 服务器仍是显式网络端点；只有 stdio／进程型能力随执行目标迁移。
- 旧 JSON Inventory 在使用共享 SQLite 控制面数据库前，需要人工完成一次导出或重建。
