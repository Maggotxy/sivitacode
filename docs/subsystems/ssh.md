# SSH

English | [中文](ssh.zh.md)

[`dsh-ssh`](../../packages/ssh/ssh/README.md) owns one authenticated OpenSSH ControlMaster connection shared by remote filesystem, subprocess, and terminal providers. It pins an exact host key in a private `known_hosts` file, disables interactive authentication, and exposes the common execution-world identity used to reject incoherent provider compositions.

Each command or terminal is an independent channel over the master connection. Closing a channel only stops its local SSH transport; the consuming provider remains responsible for proving remote workload ownership and terminating that workload. Disposing the service closes all channels, exits the master, and removes its private connection files.

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
