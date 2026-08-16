# Agent Note: 不可变服务器 release

Status: implemented

[English](2026-08-14-immutable-server-releases.md) | 中文

## Problem

服务器指南假设 `/opt/sivitacode/current` 下存在已构建的源码 checkout，并由 systemd 调用 pnpm。因此新服务器需要 monorepo、包管理器、编译产物和未成文的手动升级流程。原地安装失败可能改变正在使用的依赖树，也没有能够标识上游修订并支持回滚的认证产物。

## Decision

服务器产物在 packed-install 检查后，从完整的本地 npm tarball 集合构建。构建器把这些确切的 package 字节安装到隔离的生产依赖树，为目标平台编译并加载 node-pty，移除 npm 命令链接，拒绝其余符号链接，按大小和 SHA-256 记录所有普通文件，嵌入许可证与第三方声明，并生成可复现的特定平台和架构归档及外层 SHA-256 文件。manifest 标识 SivitaCode、Node engine 范围、入口文件和固定的 DeepSeek Harness commit。

服务器安装器会在解压前验证外层摘要和所有 tar 成员。它只接受采用相对、无穿越名称的普通文件和目录，随后要求解压文件集合与 manifest 完全一致，并验证所有大小和摘要。激活前还会检查平台、架构、Node runtime、入口认证、版本输出，以及 Web、run 和 ACP 命令界面。

dsh 发布 workflow 会从无需凭据的 npm pack 输出构建四种原生归档：Linux x64、Linux arm64、macOS arm64 与 macOS x64。每个构建都运行在架构匹配的 GitHub 托管 runner 上，因此 node-pty 会针对所声明目标编译。Linux leg 会编译匹配的静态 musl Landlock launcher，并强制通过两次真实 confinement 证明。macOS leg 使用可复现 GNU tar，并强制通过来自已安装 package 的真实 Seatbelt 证明：允许工作区写入，同时拒绝只读与相邻路径写入。上传前，每个 leg 都执行全新的离线安装，使用临时状态目录和生产式公网 origin 设置启动已安装入口，观察未认证登录跳转，经受信反向代理边界登录，检查 Secure `__Host-` session cookie，并获取打包后的 SivitaCode SPA。随后它会启动已安装 ACP 入口，协商文本能力以及包含删除在内的完整持久会话生命周期，并要求 stdin EOF 后干净退出。发布依赖全部四个 server leg，因此上传产物的前置条件是原生加载、sandbox 强制执行以及两种运行时 composition 都已就绪，而不只是成功生成归档。

Release 位于 `<root>/releases/<identity>`。`current` 和 `previous` 是通过同文件系统 rename 切换的相对符号链接。安装 staging 位于部署根目录，因此发布和链接替换在该文件系统上是原子的。任何检查失败都不会改变 `current`。回滚会重新验证并 smoke `previous`，再交换两个链接。安装器保留所有 release，且绝不编辑位于 `SIVITACODE_HOME` 的产品状态。

无 root 引导脚本同时固定 release 和所下载完整安装器的 SHA-256。它检测宿主机、获取匹配的归档与 checksum，再委托该安装器执行，而不是实现第二条激活路径。Docker 镜像也通过同一个安装器使用同一不可变归档。私有 Linux Compose 使用 host 网络，以保留 Web 仅监听回环的默认行为。公网 Compose 让应用只绑定到固定的私有容器子网，要求持久认证，只信任来自该子网的转发请求信息，并由 Caddy 提供自动 HTTPS。

## Alternatives considered

**直接从 workspace 运行 pnpm deploy。** 真实探针生成了看似可移植的依赖树，但启动时失败，因为通过 Cordis 配置加载的插件并非都能经由 JavaScript 依赖边抵达。只选择 CLI closure 无法表达运行时 composition。

**在每台服务器上从公共 registry 安装。** 这会让激活依赖凭据、registry 可用性、可变 dist-tag 和下载后的解析过程，也会使服务器字节脱离发布工作流已经检查的 tarball。

**把内部 package 依赖图发布成 npm 一键安装。** 这会在已验证的 release 构建之外重复解析依赖，并把实现 package 暴露为公开兼容性契约。未来可以提供只负责下载固定 Release 产物的轻量 npm launcher，但 npm 不作为产品字节来源。

**从 bridge 网络暴露未经认证的应用端口。** 这会削弱仅监听回环的安全默认值，并可能让部署意外暴露到公网。私有 composition 通过 host 网络保留回环行为；公网 composition 则要求认证和显式 TLS origin。

**复制或归档源码 workspace。** 这会保留 workspace 链接和构建工具，捕获 dirty 或 ignored 文件，并使服务器部署依赖构建机器的 checkout 布局。

**原地更新一个 live 目录。** 这种方式没有原子提交点：进程重启可能看到只替换了一部分的依赖树，恢复时必须重新构造旧字节。

## Consequences

由于构建 bundle 时会解析可选原生依赖，Linux 和 macOS 的每个平台与架构组合都需要独立产物。构建产物要求完整的本地打包 family，并要求外部 npm 依赖存在于构建器缓存或网络中；安装过程本身离线。Release 目录会比最小静态 import closure 更大，因为会有意包含由配置选择的插件。

原子激活本身不会重启 systemd 或提供连接 drain；运维人员需要把安装器与部署 inventory 的 drain、verify、rollback 和 restore 生命周期组合使用。所有 release 都会保留并占用磁盘，直到运维人员通过另行审查的流程删除非活动 release。

Shell 引导脚本要求 Node.js 22.19 或更高版本。当前预览版只发布 Linux x64，因此检测到但没有匹配产物的宿主机会在激活前失败。私有 Compose 依赖 Linux host 网络。公网 Compose 要求一个 DNS 名称、可从公网访问的 80 和 443 端口，以及运维人员提供的管理员密码。
