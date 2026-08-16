# `@deepseek-ai/dsh-subprocess-ssh`

[English](README.md) | 中文

通过 `ctx.ssh` 到达一台 Linux 或 macOS 主机的子进程提供方。它与 `fs-ssh` 共享 SSH 所有者的执行环境身份，不通过调用方可控的 shell 语法启动 argv，并持有普通进程树和 OpenSSH 分配的终端直至静默。

## 进程所有权

每次普通启动都会创建权限为 0700 的远端状态目录和由后代继承的随机进程身份。固定 Python runner 使用 `setsid()` 启动目标，记录其身份和结果，传输 stdio，并可保留完整远端 spill。独立控制 channel 通过主机的 POSIX `ps` 进程／环境视图查找该身份，再在 Linux 与 macOS 上向对应进程组发信号；因此 leader PID 被复用时不会把终止操作重定向到无关进程。`terminate()` 先发送 TERM，等待 `graceMs`，必要时发送 KILL。`waitForExit()` 在没有带该身份的进程后报告进程树静默；若传输丢失导致无法取得持久结果，独立的 `done` promise 仍会拒绝，因此调用方不会把缺失的退出事实误认为成功完成。

收集输出在宿主侧保留有界尾部。启用 spill 且未超过字节上限时，`spillPath` 指向同一远端执行环境中的完整文件；消费方通过 `ctx.fs` 读取。不保留 spill 的状态会在证明静默后立即删除。启动维护只会删除超过 24 小时、所有者匹配、名称严格符合 SivitaCode UUID 且 token 不属于任何存活进程的目录，从而约束 spill 与崩溃残留，又不会宽泛清理临时路径。

## 终端

`spawnTerminal()` 请求真正的 OpenSSH PTY。其固定 bootstrap 应用尺寸、清理环境中凭据形态的名称、发布就绪状态并 exec 配置的 argv。控制 channel 检查内核 TTY 前台进程组、向该组发送支持的信号，并在释放完成前终止所有带该身份的进程组。

## 配置

`pollMs` 是远端存活轮询间隔，默认 50 毫秒。可选 `cwd` 和 `localAnchor` 会应用与 `fs-ssh` 相同的逻辑 workspace 映射。所有 SSH 命令都要求远端提供 `python3`，以及能够显示目标账户自身进程环境的 POSIX `ps`。

## 模型体验

间接影响，体现在执行位置被该提供方改变的现有 shell、job、LSP、MCP 和终端消费方中。

#### KV Cache 影响

除这些消费方外无影响；该提供方不增加工具 schema 或提示词文本。

## 已知限制与延期工作

- 进程／环境 inspector 支持 Linux procps 与 macOS BSD `ps`；其他 POSIX 方言只有在对应 CI 中运行精确调用后才会获得支持声明。
- 完整远端 spill 会刻意在 handle 完成后保留，供下游工具读取；严格前缀、所有者／token 校验的 24 小时维护是其生命周期上界。
- `inherit` 输出会投影到本地 SivitaCode 宿主流，而不是继承远端描述符。
- 子进程服务定义不包含 PTY resize，因此该提供方也不提供 resize。
- 真实固定主机密钥 `sshd` 集成在提供 OpenSSH 服务端二进制的 Linux 宿主上运行；其他平台依赖固定 runner 协议测试和 CI 矩阵。
