# Agent Note: SivitaCode Web 认证

Status: implemented

[English](2026-08-13-sivitacode-web-authentication.md) | 中文

## Problem

编程 Agent 能以进程账户执行命令并读取项目文件。Host 与 Origin 检查可阻止 DNS 重绑定和跨站浏览器请求，但不能识别操作者，因此仅信任公网主机名绝不能开启网络访问。

## Decision

只有配置了至少 12 个字符的启动期管理员口令时，SivitaCode 才允许 `0.0.0.0`。口令通过固定长度 SHA-256 摘要和定时安全比较验证，绝不返回浏览器，也不存入浏览器存储。

登录成功会创建 256 位随机内存会话。浏览器只收到 HttpOnly、SameSite=Strict Cookie。HTTPS 部署使用 Secure `__Host-` 形式；显式的本地非安全测试模式使用无前缀 Cookie。会话具有空闲与绝对过期时间，重启即消失，注销会撤销服务端记录。登录失败按对端地址限速。

Webserver 路由前 guard 保护静态内容、API route、事件传输、下载和 upgrade。未认证页面请求跳转登录页，API 请求返回 401，upgrade 在 route 分发前收到 HTTP 401。

## Alternatives considered

**HTTP Basic 认证。** 不采用，因为浏览器会不透明地保留凭据，注销不可靠，而且会话过期与未来身份元数据难以组合。

**在 localStorage 保存 Bearer token。** 不采用，因为脚本可读的持久凭据会扩大客户端注入的影响，还需要自定义 WebSocket 传递。

**只信任反向代理或主机名。** 不采用，因为配置错误会在没有应用身份校验时暴露远程代码执行能力。

## Consequences

单个操作者可以通过 HTTPS 反向代理安全认证，登录后不再暴露口令。会话有意在重启时丢失，尚不提供用户、角色、持久撤销或审计身份；这些属于身份/RBAC 控制面。应用仍需要严格的 Host/Origin 配置与 TLS。
