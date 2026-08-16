# SivitaCode 服务器部署

[English](README.md) | 中文

SivitaCode 服务器产物是从通过 packed-install 发布检查的同一批 npm tarball 构建的自包含生产依赖树。服务器只需安装受支持的 Node runtime，不需要源码 checkout、Corepack、pnpm、编译器或 registry 访问。每个归档均包含 MIT 许可证、第三方声明、目标平台与架构、固定的上游 commit，以及逐文件 SHA-256 manifest。

## 安装方式

| 需求 | 方式 |
|---|---|
| 最快首次运行 | `npx sivitacode`；经过验证的 npm 发现启动器 |
| 快速安装到本机用户 | 固定版本的 `install.sh`；需要 Node.js，无需 sudo |
| 私有 Linux 容器 | `compose.yml`；仅回环的 host 网络 |
| 带自动 HTTPS 的公网服务器 | `compose.public.yml`；需要 Caddy、DNS 和引导密码 |
| 离线或受管服务器 | Release 归档与 `install-sivitacode.mjs` |
| 贡献者 checkout | 根目录 [README](../README.md#run-from-source) |

所有打包安装方式都使用同一份不可变服务器归档和 checksum，不会分别解析内部 npm 依赖图。

## npm 发现启动器

零依赖的 `sivitacode` npm 包会下载并认证固定的 Release 引导脚本；匹配的核心已经激活时会跳过安装，并把所有参数转发给稳定的已安装命令。没有参数时，它会启动 Web UI。

```sh
npx sivitacode
npx sivitacode --version
```

如需持久 launcher，请使用 `npm install --global sivitacode`。npm 提供最短发现路径；不可变 Release 归档仍是产品字节来源和回滚边界。

## 无 root 用户安装

固定版本的引导脚本会验证下载的 Node 安装器自身，检测 Linux 或 macOS 以及 x64 或 arm64，下载匹配的归档和 checksum，再把验证与原子激活委托给 `install-sivitacode.mjs`。默认 release 目录是 `~/.local/share/sivitacode`，命令目录是 `~/.local/bin`。如需覆盖，请在管道前设置 `SIVITACODE_INSTALL_ROOT` 或 `SIVITACODE_BIN_DIR`。

```sh
curl -fsSL https://raw.githubusercontent.com/Maggotxy/sivitacode/sivitacode-install-v0.1.0-preview.1/deploy/install.sh | sh
~/.local/bin/sivitacode web
```

重新运行该命令会通过同一原子激活路径升级。当前预览 release 发布 Linux x64 产物；没有匹配产物的主机会在激活前失败。

## 私有 Linux Docker Compose

把 Compose 定义下载到允许 agent 编辑的项目目录。该定义使用 host 网络，使 SivitaCode 保持仅回环的安全默认值；当前目录会挂载到 `/workspace`，产品状态持久化在 `sivitacode-data` volume 中。

```sh
curl -fsSLO https://github.com/Maggotxy/sivitacode/releases/download/dsh-v0.1.0-rc.5-sivitacode.1/compose.yml
docker compose -f compose.yml up -d --build
```

打开 `http://127.0.0.1:3080`；Docker 位于远程服务器时也可通过 SSH 本地转发访问。该方式要求 Linux host 网络；macOS 用户应使用无 root 安装器或公网 HTTPS composition。

## 公网 HTTPS Docker Compose

把一个 DNS 名称指向服务器，允许入站 TCP 80 和 443，再从允许 agent 编辑的项目目录运行公网 composition。Caddy 会获取并续期证书。SivitaCode 只能从专用容器网络访问，要求持久管理员登录，并且只信任来自该网络固定 CIDR 的转发请求信息。

```sh
curl -fsSLO https://github.com/Maggotxy/sivitacode/releases/download/dsh-v0.1.0-rc.5-sivitacode.1/compose.public.yml
SIVITACODE_DOMAIN=code.example.com \
SIVITACODE_WEB_PASSWORD='replace-with-at-least-12-characters' \
docker compose -f compose.public.yml up -d --build
```

保留 Compose 文件和具名 volume 以便升级；改变固定构建输入后，重新运行 `docker compose ... up -d --build`。不要把 secret 写入 Compose 文件或仓库。

## 直接构建 Docker

Dockerfile 会在镜像构建期间安装并验证 release，而不是复制源码 checkout。以下直接 Linux 运行使用 host 网络以保留私有回环绑定。

```sh
docker build -t sivitacode -f deploy/Dockerfile https://github.com/Maggotxy/sivitacode.git#sivitacode-install-v0.1.0-preview.1
docker run --rm --network host --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges -v "$PWD:/workspace" -v sivitacode-data:/var/lib/sivitacode sivitacode
```

## 已验证的 release 产物

发布 workflow 的目标是在 [GitHub Releases](https://github.com/Maggotxy/sivitacode/releases) 发布四种经过验证的归档、对应摘要文件和本仓库安装器。当前 `dsh-v0.1.0-rc.5-sivitacode.1` 预览版仅包含 Linux x64；在仓库获准更新发布 workflow 前，其余原生 leg 仍处于受限状态。release 产物而非内部 npm 包依赖图，是受支持的公开安装输入。

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
