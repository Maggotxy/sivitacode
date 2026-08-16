# `@deepseek-ai/dsh-ssh-remote`

[English](README.md) | 中文

显式 profile overlay，用固定 SSH 提供方替换 base 文件系统和子进程提供方。把它放在 `@deepseek-ai/dsh-base` 之后、`@deepseek-ai/dsh-web-app` 或 `@deepseek-ai/dsh-headless` 等表层组合包之前。

## 配置

启动环境必须设置 `SIVITACODE_SSH_HOST`、`SIVITACODE_SSH_USERNAME`、`SIVITACODE_SSH_HOST_KEY` 和远端项目绝对路径 `SIVITACODE_SSH_WORKSPACE`。`SIVITACODE_SSH_PORT` 默认 22。`SIVITACODE_SSH_IDENTITY_FILE` 可选；省略时使用 SSH agent。发现的 `.env` 文件不能提供这些 bootstrap 值。

控制平面的当前目录仍是记录到 session 和提示词中的逻辑 workspace。两个 SSH 提供方都会把它映射到 `SIVITACODE_SSH_WORKSPACE`，因此由逻辑 workspace 派生的绝对路径会让文件和进程操作到达同一远端项目。

宿主本地 sandbox runner 无法限制远端内核。因此该 overlay 选择直接 bash 提供方和 `danger-full-access`，绝不宣传 `workspace-write`。只有目标端提供容器隔离后才选择更窄策略。

## 模型体验

间接影响，体现在远端项目中操作并报告逻辑控制平面 workspace 的现有编码工具中。

#### KV Cache 影响

除这些工具外无影响；该 overlay 不贡献提示词或 schema 文本。

## 已知限制与延期工作

- 每个 profile 对应一个部署目标。由 Inventory 驱动的逐 session 节点选择属于后续编排层。
- 该 overlay 不对目标实施容器限制。
- overlay 不安装密钥，也不发现主机密钥；操作员必须固定通过独立方式验证的精确密钥。
