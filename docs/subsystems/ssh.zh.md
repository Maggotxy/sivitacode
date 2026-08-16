# SSH

[English](ssh.md) | 中文

[`dsh-ssh`](../../packages/ssh/ssh/README.md) 负责一个由远端文件系统、子进程和终端提供方共享的已认证 OpenSSH ControlMaster 连接。它在私有 `known_hosts` 文件中固定精确主机密钥、禁用交互式认证，并公开用于拒绝不一致提供方组合的公共 execution-world 标识。

每个命令或终端都是主连接上的独立通道。关闭通道只会停止本地 SSH transport；消费提供方仍负责证明远端工作负载的所有权并终止该工作负载。销毁服务会关闭全部通道、退出主连接并删除私有连接文件。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxssh--sshconnection"></a>

### `ctx.ssh` — `SshConnection`

One connection owner shared by filesystem and subprocess providers.

```ts cordis-catalog
/** Await the authenticated ControlMaster connection. */
async ready(): Promise<void>

/**
 * Run one remote argv through the authenticated shared connection.
 * @param argv - Program and literal arguments.
 * @param options - Optional input and cancellation.
 * @returns Captured exit status and output.
 */
async command(argv: readonly string[], options: SshCommandOptions = {}): Promise<SshCommandResult>

/**
 * Start one live remote argv through the authenticated shared connection.
 * @param argv - Program and literal arguments.
 * @param options - PTY and transport cancellation options.
 * @returns Live multiplexed channel.
 */
async spawnChannel(argv: readonly string[], options: SshChannelOptions = {}): Promise<SshChannel>
```

Source: [`packages/ssh/ssh/src/index.ts:109`](../../packages/ssh/ssh/src/index.ts)
<!-- END GENERATED cordis-surface -->
