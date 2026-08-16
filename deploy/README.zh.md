# SivitaCode 服务器部署

[English](README.md) | 中文

SivitaCode 服务器产物是从通过 packed-install 发布检查的同一批 npm tarball 构建的自包含生产依赖树。服务器只需安装受支持的 Node runtime，不需要源码 checkout、Corepack、pnpm、编译器或 registry 访问。每个归档均包含 MIT 许可证、第三方声明、目标平台与架构、固定的上游 commit，以及逐文件 SHA-256 manifest。

每个 `dsh-v*` 标签都会在 [GitHub Releases](https://github.com/Maggotxy/sivitacode/releases) 发布全部四种经过验证的归档、对应摘要文件和本仓库安装器。release 产物而非内部 npm 包依赖图，是受支持的公开安装输入。

必须在与目标服务器相同的平台和 CPU 架构上构建并验证 npm 输入，再生成平台专用归档。构建 Linux launcher 需要原生 musl 工具链（Ubuntu 上为 `musl-tools`）；macOS 可复现归档需要 GNU tar（`brew install gnu-tar`）。生产服务器不需要这些工具。`--from` 同时接收 dsh、vendored framework 和 Landlock 的打包目录；所有提供的 tarball 都会以本地字节安装到隔离 staging 树中。下面的命令序列适用于 Linux；macOS 会打包可移植 Landlock entry 而不是 launcher，并在运行时使用 Seatbelt。

```sh
pnpm run build
pnpm run release:pack --family dsh --out dist/npm/dsh
pnpm run release:pack --family vendor --out dist/npm/vendor
pnpm --dir native/landlock-run run build:native
node native/landlock-run/scripts/pack-release.mjs "$PWD/dist/npm-landlock" --current-platform-only
NALR_REQUIRE_LANDLOCK=1 node native/landlock-run/scripts/verify-packed-install.mjs "$PWD/dist/npm-landlock" --current-platform-only
pnpm run release:verify-packed-install --family dsh --from dist/npm/dsh --from dist/npm/vendor --from dist/npm-landlock
pnpm run release:server-bundle --from dist/npm/dsh --from dist/npm/vendor --from dist/npm-landlock --out dist/server
```

把 `.tar.gz`、配套 `.sha256` 和 `deploy/install-sivitacode.mjs` 复制到平台和 CPU 架构匹配的 Linux 或 macOS 服务器。安装器会在解压前验证外层摘要和归档条目，再验证 manifest 中的每个文件，并运行已安装的 `--version` 与命令帮助 smoke，最后原子切换 `current`。验证或 smoke 失败时，当前 release 不会改变；旧 release 会保留。

dsh 发布 workflow 会构建并验证四种原生产物：

| 产物 | 原生 runner | 必须通过的 confinement 证明 |
|---|---|---|
| `linux-x64` | `ubuntu-24.04` | 已安装 Landlock |
| `linux-arm64` | `ubuntu-24.04-arm` | 已安装 Landlock |
| `darwin-arm64` | `macos-latest` | 已安装 Seatbelt |
| `darwin-x64` | `macos-15-intel` | 已安装 Seatbelt |

每个 leg 都会执行全新的离线安装，启动带认证 Web composition，通过受信代理边界接受安全登录，提供打包后的 SPA；随后通过确定性的真实 prompt 驱动已安装 ACP session，并验证实时 reasoning／text 更新及完整持久生命周期。发布会等待全部四个原生 leg。

```sh
sudo node install-sivitacode.mjs install \
  --root /opt/sivitacode \
  --archive ./sivitacode-server-0.1.0-rc.5-linux-x64.tar.gz \
  --checksum ./sivitacode-server-0.1.0-rc.5-linux-x64.tar.gz.sha256
readlink -f /opt/sivitacode/current
```

升级时用新产物执行相同命令。无需重新构建或下载，即可回滚到最近一次激活前记录的 release：

```sh
sudo node install-sivitacode.mjs rollback --root /opt/sivitacode
```

将可变状态放在 release 目录之外，并使用无特权专用账户运行 Web profile。把 `sivitacode.env.example` 复制到 `/etc/sivitacode/sivitacode.env`，限制为服务账户可读，替换所有示例值，再把 `sivitacode.service` 安装到 `/etc/systemd/system/sivitacode.service`。该 unit 直接运行已安装的 Node 入口。

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now sivitacode
sudo systemctl status sivitacode
```

该 unit 仅监听回环地址。只选择一个 TLS 反向代理示例，替换 `code.example.com`，并阻止公网访问 3080 端口。代理会替换转发请求头并支持 WebSocket upgrade；应用只信任配置的回环代理 CIDR。

容器执行目标与 SivitaCode 自身打包相互独立。注册容器目标前，需要为服务账户安装 rootless Docker 或 Podman；SivitaCode 会拒绝无法证明 rootless 的 runtime，且绝不回退到宿主机执行。

应把本地执行目标视为受专用服务账户信任的项目：它们共享该账户的宿主机权限。公网多用户部署必须把相互不信任的项目放入 rootless 容器目标，或使用相互隔离的远端 SSH 账户。文件系统根目录和逐 Agent 服务 realm 能保证能力路由一致，但不能替代操作系统隔离边界。
