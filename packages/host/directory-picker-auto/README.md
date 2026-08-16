# @deepseek-ai/dsh-host-directory-picker-auto

English | [中文](README.zh.md)

The **adaptive chooser** of the [directory-picker seam](../directory-picker/README.md): a node-half-only plugin that resolves the host's situation once at boot and mounts the matching dual-face backend — [`-native`](../directory-picker-native/README.md) or [`-browse`](../directory-picker-browse/README.md) — as a real Loader entry in the in-memory root tree (never persisted to a config file; the root tree's `write()` is a no-op). Because the backend arrives as an ordinary entry, its browser half is discovered by the client module table exactly as a config-row's would be, so the seam's one-row-swaps-both-faces invariant holds for the resolved choice. Unloading the chooser removes the entry again, unloading both faces with it.

Resolution is one pure boot-time sample (`resolveDirectoryPickerBackend`), exported for reuse. `native` requires every signal that the operator can see the host display and the native backend can serve it: `remoteBrowserAccess: false` (the default), a loopback-only bind (read from the injected `webServer`; an all-interfaces bind admits remote browsers no OS chooser can reach), no SSH launch (`SSH_CONNECTION`/`SSH_TTY` unset or blank), and a servable display session — assumed on darwin/win32; on linux `DISPLAY`/`WAYLAND_DISPLAY` plus a zenity or kdialog binary on `PATH`; never on any other platform. A reverse proxy or tunnel that keeps the private server loopback-bound sets `remoteBrowserAccess: true`; the shipped Web bundle derives it from a configured public origin or `--trusted-host`. Anything ambiguous resolves to `browse`, which works everywhere. The sample happens exactly once per boot so the mounted capability stays stable for the service lifetime. Pinning an interaction is not a config field here — compose the `-native` or `-browse` row directly instead of this one; mounting the chooser **and** a backend row together fails loud (duplicate `directoryPicker` service, duplicate client flow in the `single` holes).

## Model Experience

None, as the chooser only composes the GUI host's directory selection; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Detection still depends on declared reachability** — a tmux session detached from its SSH launch loses the `SSH_*` markers, a Darwin process outside an Aqua session still counts as displayed, and an undeclared `ssh -L` route looks loopback-local. Reverse proxies and tunnels must set `remoteBrowserAccess` directly or expose a public origin / trusted authority through the shipped Web bundle. A wrong `native` choice degrades to the backend's existing retryable failure dialog; composing `-browse` directly remains the explicit safe interaction.
- **The Linux chooser probe reads `PATH` only** — a zenity/kdialog reachable some other way (shell alias, non-PATH install) still resolves `browse`; installing either binary on `PATH` restores `native` eligibility at the next boot.
- **Boot-time only** — one resolution serves every client of the boot; per-connection adaptivity (native for a local browser, browse for a remote one, same server) would need a per-client capability and the wire advertisement the seam deliberately deleted, and waits for a deployment that serves both at once.
