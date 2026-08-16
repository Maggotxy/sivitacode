# `@deepseek-ai/dsh-execution-world-coherence`

[English](README.md) | 中文

面向已组装 Coding Agent 运行时的启动守卫。它注入 `ctx.fs` 与 `ctx.subprocess`，只有两个提供方暴露同一个执行环境对象时才能完成激活。这可以阻止文件工具检查一台机器，而 Bash、搜索、LSP、Git、任务、MCP stdio 或 PTY 进程却在另一台机器执行的分裂组合。

检查比较提供方持有的不透明身份，而不是显示标签。本地提供方共享 `LOCAL_EXECUTION_WORLD`；远程适配器共享其确切沙箱所有者的身份。

## 已知限制与延期工作

- **当前只比较已挂载的 FS 与 subprocess 根能力** — 提供方特有的子能力必须继续从这些根能力派生，或增加自己的身份检查。
