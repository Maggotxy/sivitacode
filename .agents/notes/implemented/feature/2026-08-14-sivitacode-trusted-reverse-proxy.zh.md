# Agent Note: SivitaCode 可信反向代理

Status: implemented

[English](2026-08-14-sivitacode-trusted-reverse-proxy.md) | 中文

## 问题

TLS 通常由 Nginx、Caddy、Traefik 或托管 ingress 终止，而 SivitaCode 接收明文 HTTP。信任任意对端提供的转发字段，会让直接调用方伪造 HTTPS、公网 authority 或来源地址。完全忽略这些字段，又会导致代理后的 Secure Cookie 与客户端限流行为不正确。

## 决策

SivitaCode Web 公网服务使用唯一、规范的 HTTPS Origin 与一组显式可信反向代理 CIDR。只有直接 TCP 对端属于该集合时，服务器才接受转发的 scheme、authority 与客户端地址。请求必须携带规范公网 Host、转发 Host、HTTPS scheme 与唯一 IP 字面量客户端地址；浏览器 Origin 必须匹配，改变状态的请求必须提供该 Origin。

同一策略在 HTTP 路由选择与 WebSocket upgrade 分发之前执行。公网响应会携带 HSTS、CSP、防嵌框、MIME 嗅探、referrer 与权限响应头。登录限流使用通过校验的客户端地址，而非不可信的转发字段。

规范 Origin 与代理来源 CIDR 让这个转换保持显式，并把后端端口排除在公网信任域之外。

## 考虑过的替代方案

**无条件信任转发头。** 拒绝，因为能够访问后端端口的调用方可以伪造每个与安全有关的外部请求事实。

**忽略转发头。** 拒绝，因为应用无法验证公网 HTTPS authority，也无法在代理后按真实客户端限流。

**接受多个公网 Origin。** 单管理员部署拒绝该方案，因为唯一规范 Origin 能为 Cookie、Origin 与 WebSocket 策略提供无歧义 authority。

## 后果

运维方必须让代理覆盖而非追加四个必需响应头，并在代理网络改变时更新 CIDR 列表。最初的管理员身份仍只存在于单进程内；持久用户、RBAC、共享撤销与高可用属于独立工作。

应用生成的启动 manifest、启动主题与渲染 UI 目前需要内联脚本和样式，因此 CSP 在拒绝其他来源、对象、嵌框与 base 修改的同时允许内联脚本和样式。去掉这些允许项需要把 nonce 贯穿所有 index transform 与客户端 renderer。

测试覆盖可信回环代理、缺失转发事实、跨 Origin 登录拒绝、安全响应头与 Secure `__Host-` Cookie。启动覆盖证明监听所有接口必须同时提供口令、公网 Origin 与代理 CIDR。
