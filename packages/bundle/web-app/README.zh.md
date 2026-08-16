# `@deepseek-ai/dsh-web-app`

[English](README.md) | 中文

dsh 浏览器表层组合包。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-base`](../base/README.md) 之上：设置 coding persona，插入 Web 宿主行（webserver、API 网关、workspace、投影缓存、存储）、浏览器插件名录与始终挂载的客户端插件重载链（[`dsh-client-hmr`](../../client/hmr/README.md)，在重建 watcher 改写客户端 bundle 之前保持空闲），并挂载本包的 `web-runtime` 粘合插件（配置为 `{printUrl, surfaceContext, trustedHosts, publicOrigin}`）。该插件通过 `@deepseek-ai/dsh-web-frontend` 的 exports 解析已构建的前端 dist，只采样一次依赖 bind 的 LAN 信任信息并将其作为 `webRuntime` 提供给浏览器信任栅栏和客户端名录，挂载 [`frontend-static`](../../host/frontend-static/README.md) 回退席位所有者，在 `surfaceContext` 为 true 时注册 Harness 源码与 Web 表层提示词段落，以及 bash 可见的 `DSH_WEB_URL` 运行时变量，并在 `printUrl` 为 true 时等自身的 Loader 配置树结算后再打印所选产品的 URL 行，避免兄弟行失败时公告一个已失效的应用。配置公网 Origin 后，提示词、环境变量和就绪提示会用它替代私有监听 URL。本组合包还持有应用命令行：普通 `web-startup` 提供方（[`src/startup.ts`](src/startup.ts)）注入 `ctx.cmdlineArgs`（[`dsh-cmdline`](../../boot/cmdline/README.md)），解析 `--host`、`--port`、可重复的 `--trusted-host` 以及应用自己的 `--help`，再提供 `webStartup`。监听所有接口要求使用 SivitaCode 产品入口并配置 Web 认证。由 flag 配置的行会注入该服务，并在惰性配置中直接读取它，因此参数解析完成前不会有任何东西绑定端口，`dsh --profile web --help` 也不会启动服务器。[`dsh-headless`](../headless/README.md) 是同一 base 之上的同级表层，不挂载本组合包。

当 `SIVITACODE_WEB_PASSWORD` 存在且至少包含 12 个字符时，SivitaCode 启用持久访问控制与 `web-auth`。`SIVITACODE_WEB_ADMIN_USERNAME` 选择首个管理员用户名，默认是 `admin`；这些引导值仅在账户库为空时创建首个 Argon2id 凭据。登录会设置随机的 HttpOnly、SameSite=Strict、Secure `__Host-sivitacode_session` Cookie，其服务端记录可跨重启保留；会话空闲 60 分钟或创建 24 小时后过期。Host API 在分发点执行可信请求 actor 与服务端定义的 `viewer`、`developer`、`operator`、`admin` 权限，并把登录、退出、身份变更和拒绝写入持久审计表。Web 设置页提供仅限管理员使用的用户、角色、撤销和审计操作；服务确保至少保留一个已启用管理员。公网服务还要求规范的 `SIVITACODE_WEB_PUBLIC_ORIGIN` 与逗号分隔的 `SIVITACODE_WEB_TRUSTED_PROXY_CIDRS`。只有直接对端属于这些 CIDR 时，才能提供唯一的转发客户端地址、HTTPS scheme 与公网 authority；每个 HTTP 和 WebSocket 请求都必须匹配该 Origin。守卫还会发送 CSP、防嵌框、MIME 嗅探、referrer、权限与 HSTS 响应头。登录失败次数按通过校验的转发客户端地址限制。`SIVITACODE_WEB_INSECURE_COOKIE=1` 仅用于本地 HTTP 测试。

## 模型体验

### Harness 源码与 Web 表层上下文

#### 模型看到的内容

当 `surfaceContext` 为 true 时，`harness:source` 段落标明磁盘上的 Harness 实现，但不会声称它就是工作目录；全局段落 `app:web-surface`（顺序 −98）则向模型说明 GUI：配置的公网 Origin 或规范的本地 URL、「this page」指代什么、更新约定（重载接收端始终开启；无刷新重载还需要 `pnpm run dev:web` watcher），以及不要启动替代服务器的指令。`DSH_WEB_URL` 还会连同描述出现在受管 bash 环境中，并使用同一个浏览器访问 URL。当它为 false 时，这两个段落和该变量都不会注册。

#### Token 影响

每个会话一行源码说明和一段提示词，外加两行受管环境变量；每个进程内保持恒定。

#### KV Cache 影响

该提示词段落位于系统提示词靠前位置，且在进程整个生命周期内稳定（端口是启动期事实），因此不会使跨轮次缓存失效。

## 已知限制与延期工作

- **前端 dist 必须已构建**：对 dist 的 `require.resolve` 在激活时明确报错并给出构建提示；没有从源码直接服务的回退路径。
- **`lanAddresses` 是启动期快照**：启动后的网卡变化不会重新公告；打印的 LAN URL 始终与配置的信任栅栏一致。
- **目标授权绑定单个用户**：全局角色限制权限上限，Inventory 授权把每位非管理员用户收窄到选定目标；外部用户组映射需要未来的身份提供方。
