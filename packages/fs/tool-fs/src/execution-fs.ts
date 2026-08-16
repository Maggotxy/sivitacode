/** Resolve the filesystem owned by the Agent executing a tool call. */

import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/**
 * Select the Agent-scoped filesystem when execution-target routing mounted one.
 * @param ctx - Plugin context providing the host fallback.
 * @param exec - Current tool execution carrying the exact Agent scope.
 * @returns The routed provider, or the plugin's host provider for agentless/local calls.
 */
export function executionFileSystem(ctx: Context, exec: ToolExecution): FileSystem {
  if (exec.agent?.session.header.executionTarget === undefined) return ctx.fs
  const fs = exec.agent.ctx.get('fs')
  if (fs === undefined) throw new Error('execution target has no routed filesystem provider')
  return fs
}
