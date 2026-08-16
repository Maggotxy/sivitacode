/** MCP transports whose stdio processes use the configured subprocess execution world. */

/* oxlint-disable typescript/no-non-null-assertion, typescript/no-unnecessary-type-parameters */
/* oxlint-disable typescript/use-unknown-in-catch-callback-variable */
// The SDK callback is generic, promise rejection is untyped, and requested pipe handles are present by subprocess contract.

import type { Context } from '@deepseek-ai/cordis'
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { Config, StdioConfig } from './index.ts'

/** Stdio MCP transport backed by `ctx.subprocess`, including remote and container providers. */
export class SubprocessStdioTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: <T extends JSONRPCMessage>(message: T) => void
  private handle: SubprocessHandle | undefined
  private readonly buffer = new ReadBuffer()
  private closed = false

  constructor(private readonly ctx: Context, private readonly config: StdioConfig) {}

  /** Resolve and spawn the MCP server in the active execution world. */
  async start(): Promise<void> {
    if (this.handle !== undefined) throw new Error('MCP stdio transport is already started')
    const command = await this.ctx.subprocess.resolveExecutable(this.config.command, this.config.env)
    const handle = this.ctx.subprocess.spawn({
      argv: [command, ...this.config.args], cwd: this.config.cwd || process.cwd(), env: this.config.env,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }, graceMs: this.config.shutdownGraceMs ?? 5_000,
    })
    this.handle = handle
    handle.stdout!.on('data', (chunk: Buffer) => {
      this.buffer.append(chunk)
      try {
        for (let message = this.buffer.readMessage(); message !== null; message = this.buffer.readMessage()) this.onmessage?.(message)
      } catch (cause) {
        this.onerror?.(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
    handle.stderr!.resume()
    void handle.done.then(
      () => { this.notifyClosed() },
      (cause) => { this.onerror?.(cause instanceof Error ? cause : new Error(String(cause))); this.notifyClosed() },
    )
  }

  /** Send one newline-framed JSON-RPC message with stream backpressure. */
  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    const stdin = this.handle?.stdin
    if (stdin === undefined || this.closed) throw new Error('MCP stdio transport is not running')
    await new Promise<void>((resolve, reject) => {
      stdin.write(serializeMessage(message), (error) => { if (error === null || error === undefined) resolve(); else reject(error) })
    })
  }

  /** Terminate the owned process tree and await complete quiescence. */
  async close(): Promise<void> {
    const handle = this.handle
    if (handle !== undefined) {
      handle.terminate()
      await handle.waitForExit()
      await handle.done.catch(() => undefined)
    }
    this.notifyClosed()
  }

  private notifyClosed(): void {
    if (this.closed) return
    this.closed = true
    this.buffer.clear()
    this.onclose?.()
  }
}

/**
 * Create an MCP transport in the caller's capability context.
 * @param ctx - Context whose subprocess service owns stdio servers.
 * @param config - Validated stdio or HTTP transport configuration.
 * @returns Transport bound to the requested execution path.
 */
export function createTransport(ctx: Context, config: Config): Transport {
  switch (config.transport) {
    case 'stdio': return new SubprocessStdioTransport(ctx, config)
    case 'streamable-http': {
      const owner: unknown = config.networkOwner ?? 'control-plane'
      if (owner !== 'control-plane') {
        throw new Error('mcp-client: streamable-http networkOwner must be "control-plane"; use stdio for execution-target-local MCP')
      }
      return new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } }) as Transport
    }
  }
}
