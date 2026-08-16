import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { describe, expect, it, vi } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import * as AcpApp from '@deepseek-ai/dsh-acp-app'

describe('SivitaCode ACP bundle', () => {
  it('composes durable storage, Inventory, and the allowlisted stdio bridge', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema })
    if (!Array.isArray(parsed)) throw new TypeError('ACP patch must be a list')
    const rows = parsed.flatMap(patch => (patch as { insert?: Array<Record<string, unknown>> }).insert ?? [])
    expect(rows.map(row => row.id)).toEqual([
      'acp-startup', 'storage', 'storage-sqlite', 'storage-domain',
      'access-control', 'deployment-inventory', 'acp',
    ])
    expect(rows.find(row => row.id === 'storage-domain')?.config).toEqual({ backend: 'sqlite' })
    expect(rows.find(row => row.id === 'acp')?.inject).toEqual(['deploymentInventory'])
  })

  it('requests bounded application exit only after the ACP bridge settles', async () => {
    const ctx = new Context()
    const exit = vi.fn<(code: number) => void>()
    provideCmdline(ctx, { args: [], exit })
    await ctx.plugin(AcpApp)

    expect(exit).not.toHaveBeenCalled()
    ctx.emit('acp/closed')
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)
    await ctx.fiber.dispose()
  })
})
