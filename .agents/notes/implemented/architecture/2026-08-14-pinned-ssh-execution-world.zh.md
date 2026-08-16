# Agent Note: 固定 SSH 执行环境

Status: implemented

[English](2026-08-14-pinned-ssh-execution-world.md) | 中文

## 问题

SivitaCode 需要在另一台服务器上操作项目，同时不要求每个目标都安装完整 Web 控制平面。若远端文件通过 SSH 操作而命令仍在本地启动，同一个 agent 回合就会跨越不同机器。把命令包装为 `ssh host "..."` 还会丢失 argv 完整性、进程树所有权、终端前台信号，以及释放真正达到静默的证明。

## 决策

一个 `@deepseek-ai/dsh-ssh` 服务持有前台 OpenSSH ControlMaster、精确固定的主机密钥、私有 `known_hosts` 和不透明执行环境身份。`fs-ssh` 与 `subprocess-ssh` 注入同一所有者，并通过与提供方无关的文件系统和子进程服务公开其身份。现有一致性守卫拒绝混合执行环境。

部署 Inventory 只保存经过验证的凭据引用。目标健康操作按操作解析私钥、写入 mode-0600 临时身份文件、使用新的固定连接检查远端 workspace、脱敏失败详情，并在返回前删除身份文件和连接文件。

所有者使用平台 OpenSSH，而不嵌入另一套 SSH 密码学栈。认证必须非交互，密码和键盘交互方式禁用，强制 `StrictHostKeyChecking=yes`，每个业务 argv 都按参数序列进行 POSIX quote。实时 channel 复用已认证 master，并在释放期间等待收敛。

文件变更运行固定远端 Python 控制程序。它获取逐路径锁，并在目标主机的同一事务中完成版本比较、临时写入、文件 fsync、原子替换和父目录 fsync，使观察与变更保持在一个远端事务内。

普通进程由固定 Python 所有者运行；它创建新的 POSIX session，并让完整进程树继承不可猜测身份。独立控制 channel 通过目标的 POSIX `ps` 进程／环境视图查找该身份，向所有关联进程组发信号，并仅在身份集合为空后报告进程树静默。该协议会分别使用 Linux procps 与 macOS BSD `ps` 运行验证。退出完成仍单独要求持久结果，因此传输丢失不会变成成功进程结果。leader PID 可能退出并被复用，因此从不单独作为充分证据。

终端使用 OpenSSH PTY 分配。固定 bootstrap 在 exec 前发布就绪状态。独立控制 channel 从可移植 `ps` 事实读取 TTY 前台组、向该组发信号，并在清理期间终止全部带该身份的进程组。

没有保留输出 spill 的状态目录会在静默后删除。完整 spill 刻意在 handle 完成后保持可读。每次 provider 启动都会运行有界 collector：只接受 `/tmp` 下严格符合 SivitaCode UUID 的名称，要求目录所有者与 SSH 账户匹配，跳过 token 属于任何存活进程的目录，并仅删除超过 24 小时的残留。

## 考虑过的替代方案

**在每台服务器安装完整 SivitaCode。** 对需要管理隔离的场景这仍是有效部署方式，但它不能替代从中心操作多个目标，并会复制控制平面状态。

**在现有本地命令前加 `ssh`。** 这会让 shell 插值成为传输格式；杀死本地 ssh 进程不能证明远端后代停止；本地文件路径也不再描述命令所在的执行环境，因此被拒绝。

**使用 JavaScript SSH 库。** 初始提供方不采用此方案，因为系统 OpenSSH 已提供主机密钥策略、agent 和硬件集成、复用以及成熟的算法维护。只有必需传输能力无法通过 OpenSSH 安全表达时，才重新考虑库实现。

**只通过 PID、进程组或 session id 识别进程树。** 数字标识会复用，守护化后代也可能离开原进程组或 session，因此被拒绝。继承的随机身份独立于数字复用建立所有权。

**以 Mux 桌面架构作为产品运行时基础。** 对服务器优先产品而言，Electron 不是 headless Linux 的更强执行底座，因此被拒绝。Mux 仍是 UX 和能力先例；其 AGPL 源码不会复制到 MIT 主线。

## 后果

一个 Web/CLI 控制平面可以操作一台固定 Linux 或 macOS 目标，同时让全部文件系统、子进程、shell、job、LSP、经子进程运行的 MCP 和终端消费方共享同一机器。由于 SSH 传输基于 OpenSSH，macOS 或 Linux 电脑都能承载控制平面。

远端进程所有权要求 Python 3，以及能够显示 SSH 账户自身进程环境的 POSIX `ps`。Linux procps 与 macOS BSD `ps` 已受支持；其他方言暂不声称支持。完整 spill 文件会保留供下游读取，但同时受调用方字节上限以及所有者／token 校验的 24 小时 collector 约束。容器限制和多节点 Inventory 是独立层；仅有 SSH 传输不声称提供其中任何一项。

测试针对真实本地 POSIX 进程和真实 PTY 执行固定文件、进程和终端程序，覆盖版本竞争、二进制覆盖元数据、有界输出、批量 stdin、TERM 到 KILL 升级、后代清理、终端输入、前台信号和 session 终止。真实临时 `sshd` 夹具会生成独立主机密钥与用户密钥、验证并发 ControlMaster channel，并证明不同的固定主机密钥会被拒绝。

Inventory 组合测试会通过临时 `sshd` 驱动目标创建、固定密钥健康检查、路由文件读取、受管子进程执行和部署 plan 结算。它还会强制终止一次活动部署传输，证明已预留 plan 以失败状态结算且不能再次执行，随后通过新的固定连接部署新 plan。临时健康连接只释放其隔离 SSH 插件 fiber，因此不会拆除访问控制或其他父控制平面服务。
