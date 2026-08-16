# Agent Note: 持久会话删除与 ACP keyset 分页

Status: implemented

[English](2026-08-14-session-deletion-and-acp-pagination.md) | 中文

## Problem

关闭 ACP 会话会释放实时 Agent，但永久保留持久日志；`session/list` 还会返回完整语料库。随着服务器会话累积，运维人员既无法通过产品协议移除指定历史，也无法限制列表响应规模。

## Decision

`SessionPersistence` 现在公布 `supportsDeletion` 并提供 `delete(id, signal?)`。第一方 JSONL 与 SQLite 后端通过 `PersistenceCoordinator` 委托；协调器把删除与该 id 的所有操作串行化，等待 retirement，拒绝实时或未发布且已预留的身份，使冷缓存 preparation 失效，并只在最后一次取消检查后启动破坏性后端工作。一旦删除开始，存储结果就是权威结论，不会被迟到的 abort 掩盖。

JSONL 在所有项目 scope 中解析唯一 id，验证已存 header 与精确路径，只移除会话拥有的目录，并在 POSIX 上 fsync 父目录。SQLite 原子删除一条会话行，并依赖外键级联删除该会话的事件行。未知身份返回 `false`；不支持删除的第三方后端保留明确拒绝的默认实现。

`SessionQueryEngine.deleteSession` 是可信的实时优先边界：实时 id、缺失 id 与后端失败分别使用现有的不同错误码。ACP 只有在挂载支持删除的后端时才公布 `sessionCapabilities.delete`。对于当前连接拥有的实时会话，它会先取消工作、结算提示词、等待 idle、flush 持久化、drain 可继续后代并 dispose handle，然后删除日志。由其他所有者保持实时的会话会拒绝。

ACP 列表响应采用固定 50 条 keyset 分页，按 `createdAt` 降序、id 升序排列。不透明 cursor 保存最后一个 key 与精确 cwd 筛选。延续通过 key 而非 offset 比较，因此插入更新记录或删除锚点都不会导致跨页重复。

## Alternatives considered

**由 ACP bridge 直接删除文件或行。** 不采用，因为这会绕过 write-behind、实时所有权、prepared-session reservation、后端身份校验和未来持久化提供方。

**Offset 分页。** 不采用，因为在 offset 前插入或删除记录会导致遍历时重复或跳过会话。

**自动关闭由其他前端拥有的会话。** 不采用，因为 stdio ACP 无权销毁 Web 操作者的实时工作；只有当前连接拥有的 handle 会自动结算。

## Consequences

运维人员现在可以区分非破坏性 close 与精确永久删除，并以有界稳定响应遍历大型语料库。删除有意不可逆，且没有自动保留调度器、归档层、法律保留或跨进程 lease。协调器保护进程内所有权与顺序；允许多个独立 writer 的部署仍需要外部单 writer 或 lease 策略。
