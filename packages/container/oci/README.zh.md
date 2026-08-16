# `@deepseek-ai/dsh-oci`

[English](README.md) | 中文

拥有一个持久 rootless Docker 或 Podman 容器。创建前验证 runtime 的 rootless 状态，删除全部 Linux capability，启用 no-new-privileges，限制 pid，默认禁用网络，只 bind-mount 配置的项目，并在静止清理时删除容器。缺少 runtime 或无法证明 rootless 时明确失败；绝不回退到宿主机执行。

owner 实现现有 Python 文件系统和托管 subprocess adapter 使用的远程命令协议，因此 FS、命令、PTY、LSP、jobs 与 MCP stdio 共享其精确 execution-world 身份。

## 模型体验

不直接增加，因为 provider adapter 与 consumer 拥有全部模型可见效果。

#### KV Cache 影响

无。

## 已知限制与延期工作

- 镜像必须包含 Python 3 与项目工具链。
- bind mount 会按设计读写暴露所选宿主项目；VM 级隔离需要 Firecracker 或 gVisor provider。
