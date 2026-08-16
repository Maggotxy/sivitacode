# `@deepseek-ai/dsh-git-worktree`

[English](README.md) | 中文

通过当前子进程执行世界管理 Git 链接工作树。列表使用 `git worktree list --porcelain -z`；创建先由 Git 校验分支名，再将工作树放在 `<repository>/.sivitacode/worktrees` 下；删除不使用 `--force`，拒绝该目录之外的路径，并由 Git 拒绝脏、含未跟踪文件、已锁定和主工作树。

## 模型体验

通过选择会话目录的工作树消费者间接生效。

#### KV 缓存影响

无直接影响。

## 已知限制与后续工作

- 子模块需要 Git 版本原生支持工作树，并继续受 Git 自身删除检查约束。
