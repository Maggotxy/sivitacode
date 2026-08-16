# `@deepseek-ai/dsh-ssh`

[English](README.md) | 中文

一个固定远程主机的共享 OpenSSH ControlMaster 所有者。文件系统和子进程提供方注入该服务，并复用其已认证连接与不透明执行环境身份。

## 配置

必须提供 `host`、`username` 和精确的 `pinnedHostKey`。主机密钥是 `ssh-ed25519 AAAA…` 这样的 OpenSSH 公钥记录；SivitaCode 会将其写入连接私有的 `known_hosts` 文件，并始终使用 `StrictHostKeyChecking=yes`。`identityFile` 选择可读私钥；省略时使用启动操作员的 SSH agent。密码与键盘交互认证保持禁用。

`port` 默认为 22，`connectTimeoutMs` 默认为 15000，`keepAliveSeconds` 默认为 15。提供方需要主机安装 `ssh` 可执行文件，并面向 POSIX OpenSSH 服务器。

## 生命周期

激活会在权限为 0700 的临时目录中启动一个前台 ControlMaster，并仅在 `ssh -O check` 成功后完成。每个 channel 都复用其 socket。dispose 会发送 `ssh -O exit`、终止仍存活的 master，并删除 socket 与固定主机文件。

## 模型体验

无，因为该主机传输不注册工具或提示词文本。

#### KV Cache 影响

无；该包不贡献模型请求内容。

## 已知限制与延期工作

- 该传输接受 SSH agent 或 identity file 认证。部署 Inventory 会为健康检查与部署操作把凭据引用私钥解析到仅所有者可读的临时身份文件；直接 profile 组合仍接收路径。
- ProxyJump、SSH 证书、堡垒机、Windows 客户端及每主机算法策略尚未配置。
- 该所有者自身不迁移工作负载；成对的文件系统与子进程提供方共同建立执行环境。
