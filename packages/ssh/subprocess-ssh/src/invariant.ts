import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@deepseek-ai/dsh-ssh'

const PACKAGE_NAME = '@deepseek-ai/dsh-subprocess-ssh'

/** Cordis companion name. */
export const name = 'subprocess-ssh-invariant'
/** Required services. */
export const inject = ['invariants']
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    if (ctx.subprocess.executionWorld !== ctx.ssh.executionWorld) fail('SSH subprocess provider does not share its connection execution world')
  },
  { inject: ['subprocess', 'ssh'] },
)
/** Register package ownership. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
