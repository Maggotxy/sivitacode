# `@deepseek-ai/dsh-execution-world`

[English](README.md) | 中文

定义不透明的运行时身份，用于证明文件系统与进程提供方指向同一台机器、容器、虚拟机或远程沙箱。等价性只由对象身份决定；标签仅用于诊断。`LOCAL_EXECUTION_WORLD` 是宿主本地提供方共享的身份。远程所有者把自己的稳定对象暴露给由同一个远程实例支持的所有适配器。

`ExecutionWorldRouter` 在 Agent 构造前解析 session 的持久目标。route 提供承载隔离能力 realm 的 context，以及在发布前挂载共同所有者和适配器的 setup。已存储目标无法被提供方解析时会明确失败。

## 已知限制与延期工作

- **身份仅在进程内有效** — 分布式控制平面在构造适配器前比较已登记的环境 ID；这些对象身份不会跨越网络协议。
