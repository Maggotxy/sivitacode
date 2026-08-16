# Agent Note: Rootless OCI 执行世界

Status: implemented

[English](2026-08-14-rootless-oci-execution-world.md) | 中文

## 问题

容器会话需要由同一个执行 owner 管理文件、进程、终端与子进程协议，同时不能静默把工作运行在宿主机。仅有 runtime 名称不能证明无特权运行或充分限制。

## 决策

OCI provider 拥有一个持久 Docker 或 Podman 容器，并实现与 SSH owner 相同的字面 argv channel 协议。它要求结构化 rootless 证明，默认禁用网络，丢弃全部 capability，启用 no-new-privileges，使用只读根文件系统与有界 tmpfs，并施加 PID、CPU 和内存限制。只有所选项目目录以读写方式 bind mount。

runtime 检查、创建与删除都有诊断上限和生命周期 deadline。创建失败会尝试幂等强制删除。dispose 会终止活动 channel、等待静默退出并删除容器。runtime 缺失或 rootless 证明失败绝不回退到宿主机执行。

## 考虑过的替代方案

**runtime 缺失时回退到宿主机。** 这会把隔离请求变成未限制的宿主机操作，因此被拒绝。

**把包含 “rootless” 的任何 runtime 输出都视为证明。** 无关诊断文字也可能命中，因此被拒绝；Docker 与 Podman 使用结构化字段。

**宣称达到虚拟机级隔离。** 读写宿主 bind mount 与共享内核不提供该安全边界，因此被拒绝。

## 影响

该 provider 提供项目进程隔离，不是虚拟机安全边界。镜像需要包含 Python 3 与项目工具链。需要运行敌对代码的部署应使用 gVisor 或 microVM 等更强 provider，同时保留执行世界接口。

## 验证

Hermetic 生命周期测试固定 Docker 与 Podman 的结构化证明、安全参数、失败回滚和清理行为，无需本机 runtime。独立 rootless OCI 工作流仅在 Podman 证明 rootless 运行、将测试镜像解析为不可变摘要、完成 provider 直接操作，并从持久 Inventory 目标创建 Agent 后才会通过；该 Agent 的文件系统、托管进程、PTY、健康检查、部署计划与清理都经过真实容器。
