# ssh/ — OpenSSH 远程执行系列

[English](README.md) | 中文

SSH 系列把与提供方无关的文件系统和进程消费方放到同一个固定的 POSIX OpenSSH 服务器上。`@deepseek-ai/dsh-ssh` 持有认证、主机密钥校验、连接复用和共享执行环境身份；文件系统与子进程适配器消费该所有者。

| 包 | 上下文键 | 角色 |
|---|---|---|
| [`ssh`](ssh/README.md) | `ctx.ssh` | 共享的固定主机 OpenSSH ControlMaster 生命周期和命令 channel |
| [`fs-ssh`](fs-ssh/README.md) | `ctx.fs` | 远端规范路径、有界读取和带版本守卫的原子变更 |
| [`subprocess-ssh`](subprocess-ssh/README.md) | `ctx.subprocess` | 远端进程树所有权、有界输出和真实 PTY 会话 |

所有者和两个提供方必须一同挂载。执行环境一致性守卫会拒绝 SSH 文件系统搭配本地子进程提供方以及相反组合。

## 已知限制与延期工作

远端容器隔离和多节点选择仍属于这些单主机提供方之上的部署层。
