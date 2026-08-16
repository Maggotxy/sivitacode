/** SivitaCode's headless ACP profile lifecycle. @module @deepseek-ai/dsh-acp-app */
import type { Context } from '@deepseek-ai/cordis'
import { Command } from 'commander'
import type {} from '@deepseek-ai/dsh-acp'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'acp-app'
/** The launcher command line must exist before lifecycle setup. */
export const inject = ['cmdlineArgs']
/** Service published only after a runnable ACP invocation parses. */
export const ACP_STARTUP_SERVICE = 'acpStartup'

/**
 * Validate the argument-free stdio invocation and close the profile after the
 * ACP bridge reports that input ended and its owned Agents have settled.
 * @param ctx - Profile context carrying launcher exit and command-line facts.
 */
export function apply(ctx: Context): void {
  const program = new Command()
    .name(process.env.SIVITACODE_PRODUCT === '1' ? 'sivitacode acp' : 'dsh --profile acp')
    .description('Serve Agent Client Protocol over newline-delimited JSON-RPC on stdio.')
    .helpOption('-h, --help', 'show this help')
  program.action(() => { ctx.provide(ACP_STARTUP_SERVICE, {}) })
  parseCmdline(ctx, program)
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error('acp-app: the launcher must provide ctx.appExit')
  ctx.on('acp/closed', () => { exit(0) })
}
