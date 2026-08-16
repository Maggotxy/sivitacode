/* oxlint-disable typescript/no-unnecessary-type-conversion -- explicit fixture conversions document
 * the fake runtime wire representation. */
import { EventEmitter } from 'node:events'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import OciContainer, { internals } from '../src/index.ts'

const originalSpawn = internals.spawn
afterEach(() => { internals.spawn = originalSpawn })

describe('rootless OCI owner', () => {
  it('accepts only structured runtime rootless proof', () => {
    expect(internals.provesRootless('docker', '["name=rootless"]')).toBe(true)
    expect(internals.provesRootless('docker', '["name=seccomp"]')).toBe(false)
    expect(internals.provesRootless('podman', '{"host":{"security":{"rootless":true}}}')).toBe(true)
    expect(internals.provesRootless('podman', '{"host":{"security":{"rootless":false}},"note":"rootless"}')).toBe(false)
    expect(internals.provesRootless('podman', 'rootless')).toBe(false)
  })

  it('creates a hardened container with literal argv and removes it at disposal', async () => {
    const invocations: string[][] = []
    internals.spawn = mockSpawn((command, args) => {
      const argv = [String(command), ...(args ?? []).map(String)]
      invocations.push(argv)
      const stdout = argv[1] === 'info' ? '{"host":{"security":{"rootless":true}}}' : ''
      return fakeChild(0, stdout)
    })
    const ctx = new Context()
    await ctx.plugin(OciContainer, {
      runtime: 'podman', image: 'example.invalid/sivitacode@sha256:abc', workspace: '/srv/project',
      network: 'none', requireRootless: true, lifecycleTimeoutMs: 2_000, memory: '1g', cpus: 1,
    }).await()
    await ctx.ssh.ready()
    const run = invocations.find(argv => argv[1] === 'run')
    expect(run).toEqual(expect.arrayContaining([
      '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--memory', '1g', '--cpus', '1', '--network', 'none',
      '--mount', 'type=bind,src=/srv/project,dst=/srv/project',
    ]))
    await ctx.fiber.dispose()
    expect(invocations.some(argv => argv[1] === 'rm' && argv[2] === '--force')).toBe(true)
  })

  it('fails loud without rootless proof and never starts a container', async () => {
    const invocations: string[][] = []
    internals.spawn = mockSpawn((command, args) => {
      invocations.push([String(command), ...(args ?? []).map(String)])
      return fakeChild(0, '{"host":{"security":{"rootless":false}}}')
    })
    const ctx = new Context()
    const owner = new OciContainer(ctx, {
      runtime: 'podman', image: 'image@sha256:abc', workspace: '/srv/project', requireRootless: true,
    })
    await expect(owner.ready()).rejects.toThrow('did not prove rootless')
    expect(invocations.some(argv => argv[1] === 'run')).toBe(false)
    await ctx.fiber.dispose()
  })

  it('rolls back a possibly-created container when run reports failure', async () => {
    const invocations: string[][] = []
    internals.spawn = mockSpawn((command, args) => {
      const argv = [String(command), ...(args ?? []).map(String)]
      invocations.push(argv)
      if (argv[1] === 'info') return fakeChild(0, '{"host":{"security":{"rootless":true}}}')
      if (argv[1] === 'run') return fakeChild(125, '', 'runtime failure')
      return fakeChild(0)
    })
    const ctx = new Context()
    const owner = new OciContainer(ctx, {
      runtime: 'podman', image: 'image@sha256:abc', workspace: '/srv/project', requireRootless: true,
    })
    await expect(owner.ready()).rejects.toThrow('container creation failed')
    expect(invocations.some(argv => argv[1] === 'rm' && argv[2] === '--force')).toBe(true)
    await ctx.fiber.dispose()
  })
})

function fakeChild(code: number, output = '', diagnostic = ''): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams
  const stdout = new PassThrough(); const stderr = new PassThrough()
  Object.assign(child, {
    stdin: new PassThrough(), stdout, stderr,
    pid: 1234, exitCode: null, signalCode: null,
    kill: () => true,
  })
  queueMicrotask(() => {
    stdout.end(output); stderr.end(diagnostic)
    Object.assign(child, { exitCode: code })
    child.emit('close', code, null)
  })
  return child
}

function mockSpawn(handler: (command: string, args: readonly string[]) => ChildProcessWithoutNullStreams): typeof internals.spawn {
  return ((command: string, args?: readonly string[]) => handler(command, args ?? [])) as typeof internals.spawn
}
