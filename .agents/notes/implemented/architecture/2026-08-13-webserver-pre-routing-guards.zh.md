# Agent Note: Webserver 路由前守卫

Status: implemented

[English](2026-08-13-webserver-pre-routing-guards.md) | 中文

## Problem

生产认证和请求策略必须一致覆盖浏览器外壳、RPC、下载、事件流和协议升级。只包装单个 route 会让未匹配 route 和以后新增的 route 脱离策略；把产品认证嵌入通用 Web server 则会让载体与一种部署模型耦合。

## Decision

`webServer` 服务分别提供 HTTP 与 upgrade guard 注册表。guard 按注册顺序在任何 route 查找前执行。guard 返回 true 表示继续；仅在完成拒绝响应或关闭 socket 后返回 false。其 disposer 会移除注册。guard 抛错或拒绝时进入服务器现有的请求错误隔离，并且绝不会继续分发。

HTTP guard 位于精确、前缀和 fallback 处理之前。upgrade guard 位于 upgrade route 查找与 handler 接管之前。guard 允许请求后，route 匹配和 fallback 语义保持不变。

## Alternatives considered

**只包装 `/api`。** 不采用，因为这会让浏览器外壳和未来的非 API endpoint 保持可访问，而且 WebSocket 还需要另一套策略。

**把认证配置放入 `WebServer`。** 不采用，因为载体不应拥有用户、会话、凭据、反向代理信任或产品登录行为。

**HTTP 与 upgrade 共用一个 guard。** 不采用，因为 `ServerResponse` 与原始升级 socket 的拒绝所有权和异步生命周期要求不同。

## Consequences

认证和部署策略插件无需修改 route 所有者，即可保护当前及未来的所有 Web 路径。行为错误的 guard 仍可能通过通用错误隔离产生 400 或关闭 socket，因此安全插件必须先给出精确状态码，再返回 false。真实 Loader 测试固定了先拒绝后分发、顺序、卸载和 upgrade 覆盖。
