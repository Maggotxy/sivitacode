# SivitaCode npm 启动器

[English](README.md) | 中文

这是 [SivitaCode](https://github.com/Maggotxy/sivitacode) 的轻量官方入口；SivitaCode 是一个 Web 优先、可自行托管的编程 Agent。启动器会下载固定版本的 GitHub Release 引导脚本，验证其 SHA-256 摘要，通过其他部署方式共用的原子安装器安装匹配且经过 checksum 验证的服务器产物，然后运行已安装命令。

```sh
npx sivitacode
```

没有参数时，启动器会运行 `sivitacode web`。其他参数会原样转发：

```sh
npx sivitacode --version
npx sivitacode run "inspect this repository and run its tests"
```

如需持久命令，请使用 `npm install --global sivitacode`。核心程序仍安装在 `~/.local/share/sivitacode`，稳定命令为 `~/.local/bin/sivitacode`。当该命令已经报告当前固定核心版本时，再次运行启动器会跳过下载。

当前预览版提供 Linux x64 服务器产物，并要求 Node.js 22.19 或更新版本、`sh`、`curl` 与 `tar`。持久公网服务器应使用仓库提供的 Docker Compose 定义。npm 只承担轻量启动入口；不可变 GitHub Release 产物仍是产品字节来源和回滚边界。
