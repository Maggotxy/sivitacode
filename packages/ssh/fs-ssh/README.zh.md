# `@deepseek-ai/dsh-fs-ssh`

[English](README.md) | 中文

共享 `ctx.ssh` 执行环境的文件系统 Service Provider。每个操作都通过固定 ControlMaster 调用一个固定的 Python 3 控制程序；路径和文件字节始终留在远端。

## 语义

`resolve` 使用远端 `realpath` 规范化；target key 是不透明 SSH 路径。可选 `cwd` 和 `localAnchor` 会把逻辑控制平面 workspace 映射到一个远端项目根。元数据、有界字节、严格 UTF-8 文本、二进制拒绝、稳定目录列表和 POSIX file URL 与文件系统 Service Definition 一致。写入和字面编辑会获取远端逐路径 `flock`，在锁内重新检查版本意图，写入同目录临时文件、执行 `fsync`、原子替换，并同步父目录。

远端服务器必须提供 Python 3 与 POSIX `flock` 支持。取消会终止 SSH channel；变更仅在原子发布前观察取消，因此客户端断开不能表示 rename 之后已经回滚。

## 模型体验

间接影响，体现在无需修改即可消费该提供方的现有文件系统工具中。

#### KV Cache 影响

除这些工具外无影响；选择提供方不会改变其 schema 或提示词文本。

## 已知限制与延期工作

- 流式读取目前执行一次有界 channel 读取并产生一个解码分片；尚未提供增量远端背压。
- 仅支持 POSIX 服务器。ACL、扩展属性、稀疏文件、硬链接身份策略和跨主机复制不在该约定内。
- 该提供方自身不限制路径。项目／容器隔离必须挂载隔离的 SSH 账户，或在其上方挂载执行策略的提供方。
