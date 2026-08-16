# Agent Note: 目标感知 Git 工作树

Status: implemented

[English](2026-08-14-target-aware-git-worktrees.md) | 中文

## 问题

并行编码会话需要在本机、SSH 与容器目标中使用独立 checkout。只在宿主机运行 Git 会在错误机器上创建工作树，自行检查 dirty 状态则可能竞争或删除未跟踪工作。

## 决策

Git worktree 操作使用当前受管子进程 provider，因此本机、SSH 与容器会话都在所选执行世界中运行 Git。列表解析 `git worktree list --porcelain -z`。创建通过 `git check-ref-format --branch` 让 Git 校验分支，并把链接工作树放在仓库自有 `.sivitacode/worktrees` 目录下。

部署 Inventory 通过已认证 Remote 命名空间提供这些操作。其 Web 设置页可选择目标、管理链接工作树，并以工作树路径作为工作目录创建固定到该目标的会话。

删除只接受 Git 返回的确切路径，拒绝主工作树和受管目录之外的路径，并且绝不传入 `--force`。Git 继续权威判断脏文件、未跟踪文件、子模块与锁定状态。

## 考虑过的替代方案

**复制 Mux worktree 实现。** Mux 是 AGPL 先例，而 MIT 主线使用基于 Git 公开协议的独立实现，因此被拒绝。

**强制删除前预先计算 dirty 与锁定状态。** 检查与删除会竞争，并重复 Git 的权威拒绝，因此被拒绝。服务绝不传入 `--force`。

**允许任意删除路径。** 管理失误可能删除 SivitaCode 受管目录之外的工作树，因此被拒绝。

## 影响

分支名编码为路径安全的目录叶节点，且绝不由 shell 解释。该服务是参考 Git 公开命令协议独立编写的 MIT 代码；它没有复制 AGPL Mux 实现。

## 验证

真实 Git 集成测试同时覆盖服务与 Inventory 组合：创建、列出并删除链接 feature 工作树，并证明主工作树、脏工作树与非法分支会被拒绝。
