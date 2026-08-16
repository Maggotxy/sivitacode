# SivitaCode

[English](README.md) | 中文

SivitaCode 是面向 Linux 与 macOS 的 Web 优先、无头优先编程 Agent。项目基于 MIT 许可的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 独立开发，保留上游 `dsh` 兼容命令，并增加产品自有的 `sivitacode` 命令和隔离的数据目录。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 状态

SivitaCode 目前处于开发者预览阶段。首次稳定版本发布前，上游核心和 SivitaCode 扩展都可能产生破坏兼容性的变化，因此部署时应固定具体版本。

## 运行

### 使用 npm 最快启动

轻量 `sivitacode` npm 包会验证并运行所有打包部署方式共用的固定 GitHub Release 安装器。没有参数时，它会无需 sudo 安装当前核心并启动 Web UI：

```sh
npx sivitacode
```

其他参数会转发给已安装产品，例如 `npx sivitacode --version` 或 `npx sivitacode run "inspect this repository"`。如需持久 launcher，请使用 `npm install --global sivitacode`。npm 只承担发现入口，不会再次构建内部 package 依赖图。

### 直接使用一行命令安装

唯一运行时前置条件是 Node.js 22.19 或更高版本。固定版本的引导脚本会检测平台与 CPU，认证下载的安装器和服务器归档，无需 sudo 即可安装到 `~/.local/share/sivitacode`，并在 `~/.local/bin` 下发布 `sivitacode`：

```sh
curl -fsSL https://raw.githubusercontent.com/Maggotxy/sivitacode/sivitacode-install-v0.1.0-preview.1/deploy/install.sh | sh
~/.local/bin/sivitacode web
```

重新运行该命令即可原子升级。安装器会打印本机回滚命令。当前预览 release 提供 Linux x64 产物；如果没有匹配的 release 产物，检测会在不改变当前安装的情况下失败。

### 一条命令运行 Docker Compose

安装 Docker Compose v2 的 Linux 用户可以在希望 SivitaCode 编辑的项目目录中运行以下私有回环部署。它从同一份经过认证的 release 归档构建，在具名 volume 中持久化 SivitaCode 状态，把当前目录挂载为 `/workspace`，并在 `http://127.0.0.1:3080` 提供服务：

```sh
curl -fsSLO https://github.com/Maggotxy/sivitacode/releases/download/dsh-v0.1.0-rc.5-sivitacode.1/compose.yml
docker compose -f compose.yml up -d --build
```

[部署参考](deploy/README.md)还提供使用 Caddy 的公网 HTTPS Compose 方案、直接 Docker 构建、systemd 安装、离线安装、升级与回滚说明。

### 安装已发布的服务器 release

受支持的公开分发方式是适用于 `linux-x64`、`linux-arm64`、`darwin-x64` 或 `darwin-arm64` 的已验证 GitHub Release 归档。目标设备需要 Node.js 22.19 或更高版本，但不需要源码 checkout、pnpm、编译器或 npm registry。请从同一个 [release](https://github.com/Maggotxy/sivitacode/releases) 下载归档、相邻的 `.sha256` 和 `install-sivitacode.mjs`，再执行安装：

```sh
sudo node install-sivitacode.mjs install \
  --root /opt/sivitacode \
  --archive ./sivitacode-server-0.1.0-rc.5-linux-x64.tar.gz \
  --checksum ./sivitacode-server-0.1.0-rc.5-linux-x64.tar.gz.sha256
node /opt/sivitacode/current/node_modules/@deepseek-ai/dsh/lib/sivitacode.js web
```

安装器会在原子切换 `current` 前验证外层摘要、所有归档路径、逐文件 manifest 和已安装 CLI 冒烟测试。[部署参考](deploy/README.md)介绍 systemd、HTTPS 反向代理、升级、回滚、SSH 目标与 rootless 容器目标。

### 从源码运行

安装 Node.js 22.19 或更高版本以及 pnpm 11.7，然后运行：

```sh
corepack pnpm install
corepack pnpm run build
corepack pnpm sivitacode web
```

该命令默认在 `http://127.0.0.1:3080` 启动 Web UI。仅监听回环地址是有意的安全默认值；私有远程访问可使用 SSH 隧道，公网访问则应部署下文的带认证反向代理配置。

如需在同一服务器上通过 HTTPS 反向代理访问，应让 SivitaCode 位于代理之后，并明确配置公网 authority：

```sh
SIVITACODE_WEB_PASSWORD='use a long unique password' \
SIVITACODE_WEB_ADMIN_USERNAME='admin' \
SIVITACODE_WEB_PUBLIC_ORIGIN='https://code.example.com' \
SIVITACODE_WEB_TRUSTED_PROXY_CIDRS='127.0.0.1/32' \
  corepack pnpm sivitacode web --host 0.0.0.0 --trusted-host code.example.com
```

由反向代理终止 TLS，并把 HTTP 和 WebSocket upgrade 转发到 3080 端口。代理必须重写 `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto` 与 `X-Forwarded-For`；只有直接对端属于 `SIVITACODE_WEB_TRUSTED_PROXY_CIDRS` 时，SivitaCode 才信任这些字段。这里应填写代理真实使用的来源 CIDR，而非客户端网段。公网部署不得直接暴露 3080 端口，也不得设置 `SIVITACODE_WEB_INSECURE_COOKIE`。

### 执行一次无头任务

```sh
corepack pnpm sivitacode run "inspect this repository and run its tests"
```

SivitaCode 将 profile、设置、凭据和会话保存在 `~/.sivitacode`。如需移动根目录，应在启动环境中设置 `SIVITACODE_HOME`。兼容命令 `dsh` 仍使用 `DSH_HOME` 或 `~/.dsh`，两个产品不会隐式共享数据。

## 架构

Web 和无头模式共用一个插件组合的 Agent 核心。文件系统、Shell、终端、后台任务、LSP、MCP stdio、会话、工具、LLM 和子 Agent 共用所选执行世界。Web Inventory 可以在本机、精确固定主机密钥的 SSH 服务器或 rootless Docker/Podman 容器上打开会话，且基于子进程的工具不会绕回控制机。部署计划会保留目标 revision、要求独立生产审批、限制输出，并通过同一受管子进程 provider 仅执行一次。安全 Git 工作树创建在所选目标 workspace 内。

GitHub Releases 是部署权威。公开的 `sivitacode` npm 包有意只作为这些产物的 checksum 验证启动器，而不会重新发布完整内部 `@deepseek-ai/dsh-*` 依赖图。这样既能提供方便的 `npx sivitacode`，也不会弱化来源信息或把上游 package 拓扑变成 SivitaCode 兼容性契约。

本仓库有意保留上游内部 `@deepseek-ai/dsh-*` 包名。这能清晰保留来源、避免把上游成果描述为 SivitaCode 原创，并使上游安全更新能够被选择性审查。SivitaCode 自研功能使用独立产品身份，并在文档中明确说明。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 署名与许可证

SivitaCode 基于 DeepSeek Harness，并依据 [MIT 许可证](LICENSE)发布。项目保留 DeepSeek 原始版权与许可声明。发行说明和源码历史必须标识 SivitaCode 修改，不得把上游核心宣传为 SivitaCode 原创成果。

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
