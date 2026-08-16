# @deepseek-ai/dsh-host-directory-picker-auto

[English](README.md) | 中文

[目录选择 seam](../directory-picker/README.md) 的**自适应选择器**：一个只有 node 半侧的插件，在启动时一次性判定宿主处境，并把匹配的双面后端——[`-native`](../directory-picker-native/README.md) 或 [`-browse`](../directory-picker-browse/README.md)——作为真实的 Loader 条目挂进内存根树（绝不持久化到配置文件；根树的 `write()` 是 no-op）。由于后端以普通条目的形式到达，其 browser half 被 client 模块表发现的方式与配置行完全相同，因此对判定出的选择，seam 的“一行同时换两面”不变式依然成立。卸载该选择器会再次移除该条目，连同两面一起卸载。

判定是一次纯函数的启动时采样（`resolveDirectoryPickerBackend`），已导出供复用。`native` 要求“操作者看得到宿主屏幕、且 native 后端能服务它”的全部信号：`remoteBrowserAccess: false`（默认值）；仅回环的绑定（从注入的 `webServer` 读取；全网卡绑定会接入任何 OS 选择器都触及不到的远程浏览器）；非 SSH 启动（`SSH_CONNECTION`／`SSH_TTY` 未设置或为空）；以及可服务的显示会话——darwin／win32 上视为存在；linux 上要求 `DISPLAY`／`WAYLAND_DISPLAY`，外加 `PATH` 上有 zenity 或 kdialog 二进制；其余任何平台上都不成立。私有服务器仍绑定回环地址的反向代理或隧道应设置 `remoteBrowserAccess: true`；随附的 Web 组合会根据已配置的公网 origin 或 `--trusted-host` 派生该值。任何含糊情形都判定为处处可用的 `browse`。采样每次启动恰好发生一次，因此挂载的能力在服务生命周期内保持稳定。固定某种交互在这里不是配置字段——直接组合 `-native` 或 `-browse` 行来替代本行；同时挂载选择器**和**某个后端行会明确报错（重复的 `directoryPicker` 服务、`single` 类 slot 中的重复 client 流程）。

## 模型体验

无。该选择器仅组合 GUI 宿主的目录选择；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **探测仍依赖已经声明的可达性**——从 SSH 启动中脱离的 tmux 会话会丢失 `SSH_*` 标记；Aqua 会话之外的 Darwin 进程仍被算作有显示；未声明的 `ssh -L` 路由看起来仍是回环本地访问。反向代理和隧道必须直接设置 `remoteBrowserAccess`，或通过随附 Web 组合暴露公网 origin／可信 authority。错误的 `native` 选择会退化为后端既有的可重试失败对话框；直接组合 `-browse` 仍是显式的安全交互。
- **Linux 选择器探查只读 `PATH`**——以其他途径可用的 zenity／kdialog（shell 别名、未装在 PATH 上）仍判定为 `browse`；把任一二进制装到 `PATH` 上，下次启动即恢复 `native` 资格。
- **仅在启动时判定**——一次判定服务本次启动的所有客户端；按连接自适应（同一台服务器，本地浏览器用 native、远程浏览器用 browse）需要按客户端的能力对象以及 seam 有意删除的协议通告，等到出现同时服务两种形态的部署再做。
