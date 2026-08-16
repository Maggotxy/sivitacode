# Agent Note: 目录选择交互的自适应默认值

Status: implemented

[English](2026-07-29-directory-picker-adaptive-default.md) | 中文

## 问题

[目录选择 seam](../architecture/2026-07-28-directory-picker-capability-seam.md) 把交互形态做成了 `cordis.yml` 的切换点，但随附的组合仍必须固定一个后端：处处用 `-browse` 意味着本地操作者永远得不到 OS 选择器，处处用 `-native` 则弄坏所有远程部署。正确的默认值取决于只有运行中的宿主才知道的事实——服务器绑定在哪里、进程是否经 SSH 启动、是否存在显示会话——因此没有哪一静态行对所有部署都正确。

## 决策

第三个同级包 **`dsh-host-directory-picker-auto`**：一个只有 node 半侧的*选择器*，不持有任何选取代码，也没有 UI。它的 `apply` 在启动时恰好采样一次宿主事实——已声明的远程浏览器访问、从注入的 `webServer` 读取的绑定宿主、`SSH_CONNECTION`／`SSH_TTY`、平台、`DISPLAY`／`WAYLAND_DISPLAY`，以及对 Linux 选择器二进制（zenity／kdialog）的一次 `PATH` 探查——经由一个导出的纯函数判定，再用 `ctx.loader.create({name})` 把选中的双面后端挂进 Loader 的**内存根树**；该 effect 的 disposer 会移除该条目并汇入后端 fiber 的拆卸，因此只有后端完全停稳后，选择器的卸载才会完成。`native` 要求全部“有人值守且可服务”信号：未声明远程浏览器 ∧ 回环绑定 ∧ 无 SSH 标记 ∧ native 后端能驱动的显示会话——darwin／win32 上视为存在，linux 上要求 `DISPLAY`／`WAYLAND_DISPLAY` 外加一个选择器二进制，其余平台一律不成立。任何含糊情形都判定为处处可用的 `browse`。Web 组合在配置了公网 origin 或 `--trusted-host` 时设置 `remoteBrowserAccess`，从而覆盖反向代理或隧道之后仍采用回环地址的私有链路。直接组合 `-native` 或 `-browse` 仍是固定交互的方式。

条目级挂载之所以是承重机制：client 模块表（`dsh-client-modules`）基于 `internal/plugin` 对 **Loader 条目**做响应式协调，因此以真实条目挂载的后端，其 browser half 被发现的方式与配置行完全相同——seam 的“一行同时换两面”不变式在自适应下依然成立，且没有一行重复的 client 代码。开发环境的 HMR 行（`AppCLIEntry`）是该机制的先例。瞄准根树很关键：根树的 `write()` 是 no-op，因此判定出的行绝不会被持久化回 `cordis.yml`（Include 子树*会*写回）。

## 曾考虑的替代方案

- **在 `AppCLIEntry` 里做启动胶水判定**（随附两行并带静态 `disabled`，由 `--directory-picker=auto|native|browse` 标志修补 `disabled`）。可行——`PatchOptions` 能修补元数据，模块扫描也会跳过禁用行——但把决策留成应用私有，此后每个组合都要重新实现；选择器插件让任何 `cordis.yml` 都获得同样的一行自适应。只有当某个部署需要不改自己的 yml 就*强制*指定后端时，才重新引入该标志。
- **仅从服务器绑定地址推断远程可达性。** 否决，因为反向代理和隧道通常保留仅回环的私有链路，同时通过另一 authority 接收浏览器。显式的部署事实让通用选择器保持独立，并允许 Web 组合从它已有的配置中派生该值。
- **合并成一个按调用分支的插件**（client 先试 `pick`，收到 `directory-picker-unavailable` 再回退到浏览对话框）。否决：client 得把两套流程装进同一个 bundle——bundle 纯净门禁禁止跨插件的值导入，jscpd 禁止复制对话框——而且按调用探测让 browse 宿主每次打开都付出一次注定失败的 RPC。
- **复活 wire 广播**，让两套 client 流程都挂载并按宿主的 kind 分支。否决：推翻 seam Agent Note 的那次删除，却服务不了任何选择器尚未服务的消费方，还与 `single` 目录流洞相冲突。
- **按连接自适应**（同一台服务器，回环浏览器用 native、远程浏览器用 browse）。延期：需要按客户端的能力对象、上述广播，以及同时挂载两套流程；今天没有部署同时服务两种操作者形态。

## 后果

- 随附的 web GUI 开箱即自适应：有人值守的本地宿主 → OS 选择器；已声明的公网 authority、SSH 启动、全网卡绑定、无头宿主、不支持的平台，或没有选择器二进制的 Linux → 应用内浏览器。探测仍依赖已经声明的可达性：脱离的 tmux 会话会丢失 `SSH_*`；非 Aqua 的 darwin 进程仍被算作有显示；未声明的 `ssh -L` 路由看起来仍是回环本地访问。错误的 `native` 选择会退化为后端既有的可重试失败对话框；这类部署设置 `remoteBrowserAccess`，或直接组合 `-browse`。
- 选择器按运行时字符串（已导出的 `BACKEND_PACKAGES`）挂载后端，yml 行扫描看不到这一点；因此 `verify-cordis-config` 要求每个挂载 `-auto` 的组合把两个后端都声明为依赖，使无密钥的 Linux CI（它永远只会判定出 `browse`）无法掩盖被丢掉的 `-native` 依赖。随附树的 web e2e／快照通道（`apps/web/tests/scaffold.ts`）以 disable+insert 补丁固定 `-browse`——其预期输出取决于具体交互，绝不能依赖运行该套件的宿主。
- 每次启动只判定一次，维持 seam 的能力稳定性约定；按连接的形态在有部署提出需求前仍不在范围内。
- 同时挂载选择器**和**某个后端行会明确报错（重复的 `directoryPicker` 服务；`single` 洞中的重复流程）。
- host 类型检查聚合现在引用两个后端项目（仅声明，node 入口不携带 client 合并），使选择器的 REAL-composition 测试能挂载它们——与 client 聚合对 `webserver` 的引用互为镜像。
