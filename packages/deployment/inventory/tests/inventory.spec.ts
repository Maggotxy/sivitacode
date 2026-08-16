/* oxlint-disable @stylistic/max-len -- complete test requests remain inline for transport-field review. */
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import AccessControl from '@deepseek-ai/dsh-access-control'
import CredentialProvider from '@deepseek-ai/dsh-credentials'
import ExecutionWorldRouter from '@deepseek-ai/dsh-execution-world'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { describe, expect, it } from 'vitest'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { execFile, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { promisify } from 'node:util'
import Inventory from '../src/index.ts'

async function harness(credentialValue = 'fixture-private-key', pool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
  await ctx.plugin(AccessControl, {
    bootstrapUsername: 'admin', bootstrapPassword: 'correct horse battery staple',
    idleTimeoutMinutes: 60, absoluteTimeoutHours: 24,
  })
  class Credentials extends CredentialProvider {
    async resolve() { return { value: credentialValue, source: 'test' } }
    async describe() { return { configured: true, source: 'test', writable: false } }
    async set() { throw new Error('read only') }
    async unset() { throw new Error('read only') }
  }
  new Credentials(ctx)
  await ctx.plugin(ExecutionWorldRouter)
  await ctx.plugin(Inventory)
  const admin = await ctx.accessControl.login('admin', 'correct horse battery staple')
  return { ctx, admin: admin.actor }
}

const sshTarget = {
  name: 'production-api',
  environment: 'production' as const,
  transport: 'ssh' as const,
  host: '203.0.113.10',
  port: 22,
  username: 'deploy',
  hostKey: `ssh-ed25519 ${Buffer.alloc(32, 1).toString('base64')}`,
  identityCredential: 'SIVITACODE_SSH_PROD_KEY',
  workspace: '/srv/api',
  enabled: true,
  labels: { region: 'cn-east' },
}

function createLocalTarget(ctx: Awaited<ReturnType<typeof harness>>['ctx'], admin: Awaited<ReturnType<typeof harness>>['admin'], name: string, workspace: string) {
  return ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create({
    name, environment: 'staging', transport: 'local', workspace, enabled: true, labels: {},
  }))
}

describe('deployment inventory', () => {
  it('persists non-secret SSH targets with optimistic revisions and audit', async () => {
    const { ctx, admin } = await harness()
    const created = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create(sshTarget))
    expect(created).toMatchObject({ revision: 1, identityCredential: 'SIVITACODE_SSH_PROD_KEY' })
    const updated = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.update(created.id, {
      expectedRevision: created.revision,
      value: { ...sshTarget, enabled: false },
    }))
    expect(updated).toMatchObject({ revision: 2, enabled: false })
    await expect(ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.update(created.id, {
      expectedRevision: 1,
      value: sshTarget,
    }))).rejects.toThrow('changed since revision 1')
    expect((await ctx.accessControl.runAs(admin, () => ctx.accessControl.recentAudit(100))).map(entry => entry.action)).toEqual(expect.arrayContaining([
      'deployment.target.create', 'deployment.target.update',
    ]))
    await ctx.fiber.dispose()
  })

  it('enforces role permissions and refuses secret or ambiguous target forms', async () => {
    const { ctx, admin } = await harness()
    await expect(ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create({
      ...sshTarget,
      workspace: 'relative',
    }))).rejects.toThrow('absolute POSIX path')
    const viewer = await ctx.accessControl.runAs(admin, () => ctx.accessControl.createUser(
      'reader', 'another correct battery staple', ['viewer'],
    ))
    const viewerLogin = await ctx.accessControl.login(viewer.username, 'another correct battery staple')
    await expect(ctx.accessControl.runAs(viewerLogin.actor, () => ctx.deploymentInventory.create(sshTarget)))
      .rejects.toMatchObject({ code: 'ACCESS_DENIED' })
    await expect(ctx.accessControl.runAs(viewerLogin.actor, () => ctx.deploymentInventory.list()))
      .resolves.toEqual([])
    await ctx.fiber.dispose()
  })

  it('filters targets by explicit grants and enforces the grant ceiling at each operation', async () => {
    const { ctx, admin } = await harness()
    const first = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create({
      name: 'project-a', environment: 'development', transport: 'local', workspace: process.cwd(), enabled: true, labels: {},
    }))
    const second = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create({
      name: 'project-b', environment: 'staging', transport: 'local', workspace: process.cwd(), enabled: true, labels: {},
    }))
    const developer = await ctx.accessControl.runAs(admin, () => ctx.accessControl.createUser(
      'developer', 'another correct battery staple', ['developer'],
    ))
    const developerLogin = await ctx.accessControl.login('developer', 'another correct battery staple')

    const readGrant = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.setGrant({
      targetId: first.id, userId: developer.id, permission: 'read',
    }))
    expect(await ctx.accessControl.runAs(developerLogin.actor, () => ctx.deploymentInventory.list()))
      .toEqual([expect.objectContaining({ id: first.id })])
    await expect(ctx.accessControl.runAs(developerLogin.actor, () => ctx.deploymentInventory.get(second.id)))
      .rejects.toThrow('cannot read')
    await expect(ctx.accessControl.runAs(developerLogin.actor, () => ctx.deploymentInventory.checkHealth(first.id)))
      .rejects.toThrow('cannot operate')
    expect(() => ctx.accessControl.runAs(developerLogin.actor, () => ctx.executionWorldRouter.route(ctx, first.id as never, process.cwd())))
      .toThrow('cannot operate')

    await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.setGrant({
      targetId: first.id, userId: developer.id, permission: 'operate', expectedRevision: readGrant!.revision,
    }))
    await expect(ctx.accessControl.runAs(developerLogin.actor, () => ctx.deploymentInventory.checkHealth(first.id)))
      .resolves.toMatchObject({ status: 'healthy' })
    await expect(ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.listGrants(first.id)))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({ userId: developer.id, permission: 'operate' })]))
    await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.setGrant({
      targetId: first.id, userId: developer.id, expectedRevision: 2,
    }))
    expect(await ctx.accessControl.runAs(developerLogin.actor, () => ctx.deploymentInventory.list())).toEqual([])
    await ctx.fiber.dispose()
  })

  it('executes non-production plans once and requires two-person production approval', async () => {
    const { ctx, admin } = await harness()
    const local = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create({
      name: 'local-dev', environment: 'development', transport: 'local', workspace: process.cwd(), enabled: true, labels: {},
    }))
    const plan = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.createPlan({
      targetId: local.id, argv: [process.execPath, '-e', 'process.stdout.write("deployed")'],
    }))
    expect(plan.status).toBe('ready')
    const settled = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.executePlan(plan.id, plan.revision))
    expect(settled).toMatchObject({ status: 'succeeded', exitCode: 0, output: 'deployed' })
    await expect(ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.executePlan(plan.id, settled.revision)))
      .rejects.toThrow('not ready')

    const { identityCredential: _credential, ...productionTarget } = sshTarget
    const production = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create(productionTarget))
    const productionPlan = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.createPlan({
      targetId: production.id, argv: ['true'],
    }))
    expect(productionPlan.status).toBe('pending-approval')
    await expect(ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.approvePlan(productionPlan.id, productionPlan.revision)))
      .rejects.toThrow('different administrator')
    const second = await ctx.accessControl.runAs(admin, () => ctx.accessControl.createUser(
      'second-admin', 'second correct battery staple', ['admin'],
    ))
    const secondLogin = await ctx.accessControl.login(second.username, 'second correct battery staple')
    const approved = await ctx.accessControl.runAs(secondLogin.actor, () => ctx.deploymentInventory.approvePlan(productionPlan.id, productionPlan.revision))
    expect(approved).toMatchObject({ status: 'ready', approvedBy: 'second-admin' })
    await ctx.fiber.dispose()
  })

  it('runs health-gated rollout batches and skips later targets after failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sivitacode-rollout-'))
    const firstDir = join(root, 'first'); const failingDir = join(root, 'failing'); const skippedDir = join(root, 'skipped')
    await Promise.all([firstDir, failingDir, skippedDir].map(directory => mkdir(directory)))
    const { ctx, admin } = await harness()
    try {
      const createLocal = async (name: string, workspace: string) => ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create({
        name, environment: 'development', transport: 'local', workspace, enabled: true, labels: {},
      }))
      const [first, failing, skipped] = await Promise.all([
        createLocal('rollout-first', firstDir), createLocal('rollout-failing', failingDir), createLocal('rollout-skipped', skippedDir),
      ])
      const rollout = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.createRollout({
        targetIds: [first.id, failing.id, skipped.id], batchSize: 1,
        argv: [process.execPath, '-e', 'process.stdout.write(process.cwd());process.exit(process.cwd().endsWith("failing")?7:0)'],
      }))
      expect(rollout).toMatchObject({ status: 'ready', batchSize: 1 })
      const settled = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.executeRollout(rollout.id, rollout.revision))
      expect(settled.status).toBe('failed')
      expect(settled.targets.map(target => target.status)).toEqual(['succeeded', 'failed', 'skipped'])
      expect(settled.targets[0]?.output).toContain('first')
      await expect(ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.executeRollout(settled.id, settled.revision)))
        .rejects.toThrow('not ready')

      const atomic = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.createRollout({
        targetIds: [first.id, skipped.id], batchSize: 1, argv: ['true'],
      }))
      const attempts = await Promise.allSettled([
        ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.executeRollout(atomic.id, atomic.revision)),
        ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.executeRollout(atomic.id, atomic.revision)),
      ])
      expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1)
      expect(attempts.filter(attempt => attempt.status === 'rejected')).toHaveLength(1)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('drains, verifies, rolls back, and restores traffic around a failed deployment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sivitacode-rollout-lifecycle-'))
    const firstDir = join(root, 'first')
    const secondDir = join(root, 'second')
    await Promise.all([mkdir(firstDir), mkdir(secondDir)])
    await writeFile(join(firstDir, 'verify-fails'), '')
    const { ctx, admin } = await harness()
    try {
      const [first, second] = await Promise.all([
        createLocalTarget(ctx, admin, 'lifecycle-first', firstDir), createLocalTarget(ctx, admin, 'lifecycle-second', secondDir),
      ])
      const rollout = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.createRollout({
        targetIds: [first.id, second.id], batchSize: 1,
        drainArgv: ['sh', '-c', 'printf drained >> events'],
        argv: ['sh', '-c', 'printf deployed >> events'],
        verifyArgv: ['sh', '-c', 'test ! -e verify-fails'],
        rollbackArgv: ['sh', '-c', 'printf rolled-back >> events'],
        restoreArgv: ['sh', '-c', 'printf restored >> events'],
      }))
      const settled = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.executeRollout(rollout.id, rollout.revision))
      expect(settled).toMatchObject({ status: 'failed' })
      expect(settled.targets[0]).toMatchObject({ status: 'failed', steps: [
        { phase: 'drain', status: 'succeeded' }, { phase: 'deploy', status: 'succeeded' },
        { phase: 'verify', status: 'failed' }, { phase: 'rollback', status: 'succeeded' }, { phase: 'restore', status: 'succeeded' },
      ] })
      expect(settled.targets[1]).toMatchObject({ status: 'skipped', steps: [] })
      expect(await readFile(join(firstDir, 'events'), 'utf8')).toBe('draineddeployedrolled-backrestored')
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('requires explicit recovery when traffic restoration fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sivitacode-rollout-recovery-'))
    const firstDir = join(root, 'first')
    const secondDir = join(root, 'second')
    await Promise.all([mkdir(firstDir), mkdir(secondDir)])
    await writeFile(join(firstDir, 'restore-fails'), '')
    const { ctx, admin } = await harness()
    try {
      const [first, second] = await Promise.all([
        createLocalTarget(ctx, admin, 'recovery-first', firstDir), createLocalTarget(ctx, admin, 'recovery-second', secondDir),
      ])
      const rollout = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.createRollout({
        targetIds: [first.id, second.id], drainArgv: ['touch', 'drained'], argv: ['touch', 'deployed'],
        restoreArgv: ['sh', '-c', 'test ! -e restore-fails && rm drained'],
      }))
      const unsettled = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.executeRollout(rollout.id, rollout.revision))
      expect(unsettled).toMatchObject({ status: 'recovery-required', targets: [{ status: 'recovery-required' }, { status: 'skipped' }] })
      await rm(join(firstDir, 'restore-fails'))
      const recovered = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.recoverRollout(unsettled.id, unsettled.revision))
      expect(recovered).toMatchObject({ status: 'failed', targets: [{ status: 'succeeded' }, { status: 'skipped' }] })
      expect(recovered.targets[0]?.steps.at(-1)).toMatchObject({ phase: 'restore', status: 'succeeded' })
      await expect(access(join(firstDir, 'drained'))).rejects.toThrow()
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reopens a drained running rollout as recovery-required without replaying deployment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sivitacode-rollout-restart-'))
    const firstDir = join(root, 'first')
    const secondDir = join(root, 'second')
    await Promise.all([mkdir(firstDir), mkdir(secondDir)])
    const pool = new MemoryMediaPool()
    const firstHarness = await harness('fixture-private-key', pool)
    const { ctx, admin } = firstHarness
    let rolloutId = ''
    let disposed = false
    try {
      const [first, second] = await Promise.all([
        createLocalTarget(ctx, admin, 'restart-first', firstDir), createLocalTarget(ctx, admin, 'restart-second', secondDir),
      ])
      const rollout = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.createRollout({
        targetIds: [first.id, second.id], drainArgv: ['touch', 'drained'], argv: ['touch', 'deployed'], restoreArgv: ['rm', 'drained'],
      }))
      rolloutId = rollout.id
      await ctx.fiber.dispose()
      disposed = true
      const medium = pool.media.get('deployment_inventory')
      const rollouts = medium?.tables.get('rollouts')
      const stored = rollouts?.get(rollout.id) as Record<string, unknown> | undefined
      if (stored === undefined) throw new Error('rollout fixture was not persisted')
      rollouts!.set(rollout.id, {
        ...stored, status: 'running', startedAt: new Date().toISOString(), revision: 2,
        targets: [
          { ...rollout.targets[0], status: 'running', steps: [{ phase: 'drain', status: 'succeeded', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), exitCode: 0 }] },
          rollout.targets[1],
        ],
      })
      await writeFile(join(firstDir, 'drained'), '')
      const reopened = await harness('fixture-private-key', pool)
      try {
        const login = await reopened.ctx.accessControl.login('admin', 'correct horse battery staple')
        const [reconciled] = await reopened.ctx.accessControl.runAs(login.actor, () => reopened.ctx.deploymentInventory.listRollouts())
        expect(reconciled).toMatchObject({ id: rolloutId, status: 'recovery-required', targets: [{ status: 'recovery-required' }, { status: 'skipped' }] })
        const recovered = await reopened.ctx.accessControl.runAs(login.actor, () => reopened.ctx.deploymentInventory.recoverRollout(reconciled!.id, reconciled!.revision))
        expect(recovered).toMatchObject({ status: 'failed', targets: [{ status: 'failed' }, { status: 'skipped' }] })
        await expect(access(join(firstDir, 'drained'))).rejects.toThrow()
        await expect(access(join(firstDir, 'deployed'))).rejects.toThrow()
      } finally {
        await reopened.ctx.fiber.dispose()
      }
    } finally {
      if (!disposed) await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('requires two-person approval for a rollout containing a production target', async () => {
    const { ctx, admin } = await harness()
    const createLocal = async (name: string, environment: 'staging' | 'production') => ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create({
      name, environment, transport: 'local', workspace: process.cwd(), enabled: true, labels: {},
    }))
    const [staging, production] = await Promise.all([createLocal('rollout-stage', 'staging'), createLocal('rollout-prod', 'production')])
    const rollout = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.createRollout({
      targetIds: [staging.id, production.id], argv: ['true'], batchSize: 1,
    }))
    expect(rollout.status).toBe('pending-approval')
    await expect(ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.approveRollout(rollout.id, rollout.revision)))
      .rejects.toThrow('different administrator')
    const second = await ctx.accessControl.runAs(admin, () => ctx.accessControl.createUser(
      'rollout-admin', 'second correct battery staple', ['admin'],
    ))
    const login = await ctx.accessControl.login(second.username, 'second correct battery staple')
    await expect(ctx.accessControl.runAs(login.actor, () => ctx.deploymentInventory.approveRollout(rollout.id, rollout.revision)))
      .resolves.toMatchObject({ status: 'ready', approvedBy: 'rollout-admin' })
    await ctx.fiber.dispose()
  })

  it('atomically reserves execution and retains bounded valid UTF-8 output', async () => {
    const { ctx, admin } = await harness()
    const local = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create({
      name: 'atomic-local', environment: 'development', transport: 'local', workspace: process.cwd(), enabled: true, labels: {},
    }))
    const plan = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.createPlan({
      targetId: local.id,
      argv: [process.execPath, '-e', 'setTimeout(()=>process.stdout.write("界".repeat(30000)),20)'],
    }))
    const attempts = await Promise.allSettled([
      ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.executePlan(plan.id, plan.revision)),
      ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.executePlan(plan.id, plan.revision)),
    ])
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1)
    const settled = attempts.find(result => result.status === 'fulfilled')!.value
    expect(settled.status).toBe('succeeded')
    expect(Buffer.byteLength(settled.output ?? '')).toBeLessThanOrEqual(65_536)
    expect(settled.output).not.toContain('\uFFFD')
    await ctx.fiber.dispose()
  })

  it('refuses target deletion while a plan can still execute', async () => {
    const { ctx, admin } = await harness()
    const local = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create({
      name: 'planned-local', environment: 'development', transport: 'local', workspace: process.cwd(), enabled: true, labels: {},
    }))
    await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.createPlan({ targetId: local.id, argv: ['true'] }))
    await expect(ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.delete(local.id, local.revision)))
      .rejects.toThrow('unsettled deployment plan')
    await ctx.fiber.dispose()
  })

  it('routes local filesystem and subprocess through one target-owned realm', async () => {
    const { ctx, admin } = await harness()
    const local = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create({
      name: 'agent-local', environment: 'development', transport: 'local', workspace: process.cwd(), enabled: true, labels: {},
    }))
    const route = ctx.executionWorldRouter.route(ctx, local.id as never, process.cwd())
    await route.setup(route.context)
    expect(route.context.fs.executionWorld).toBe(route.context.subprocess.executionWorld)
    const target = await route.context.fs.resolve('package.json')
    expect(await route.context.fs.readText(target)).toContain('dsh-root')
    const executable = await route.context.subprocess.resolveExecutable(process.execPath)
    const handle = route.context.subprocess.spawn({
      argv: [executable, '-e', 'process.stdout.write("routed")'], cwd: process.cwd(), env: {},
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } }, graceMs: 1000,
    })
    await handle.done
    expect(handle.collected.stdout!.readFrom(0).text).toBe('routed')
    await route.context.fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('routes Inventory health, filesystem, subprocess, and plans through a real pinned sshd', async () => {
    const server = await sshdFixture()
    const { ctx, admin } = await harness(await readFile(server.identity, 'utf8'))
    try {
      const target = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create({
        name: 'real-ssh', environment: 'development', transport: 'ssh', host: '127.0.0.1', port: server.port,
        username: userInfo().username, hostKey: server.publicHostKey, identityCredential: 'TEST_SSH_KEY',
        workspace: process.cwd(), enabled: true, labels: {},
      }))
      await expect(ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.checkHealth(target.id)))
        .resolves.toMatchObject({ status: 'healthy' })

      const route = ctx.accessControl.runAs(admin, () => ctx.executionWorldRouter.route(ctx, target.id as never, process.cwd()))
      await route.setup(route.context)
      expect(route.context.fs.executionWorld).toBe(route.context.subprocess.executionWorld)
      const packageFile = await route.context.fs.resolve('package.json')
      expect(await route.context.fs.readText(packageFile)).toContain('dsh-root')
      const executable = await route.context.subprocess.resolveExecutable('node')
      const handle = route.context.subprocess.spawn({
        argv: [executable, '-e', 'process.stdout.write("inventory-ssh")'], cwd: process.cwd(), env: {},
        stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } }, graceMs: 1_000,
      })
      await handle.done
      expect(handle.collected.stdout!.readFrom(0).text).toBe('inventory-ssh')
      const plan = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.createPlan({
        targetId: target.id, argv: ['node', '-e', 'process.stdout.write("deployed-over-ssh")'],
      }))
      await expect(ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.executePlan(plan.id, plan.revision)))
        .resolves.toMatchObject({ status: 'succeeded', output: 'deployed-over-ssh' })
    } finally {
      await ctx.fiber.dispose()
      await server.dispose()
    }
  })

  it('settles an interrupted SSH deployment as failed and reconnects for a new plan', async () => {
    const server = await sshdFixture()
    const { ctx, admin } = await harness(await readFile(server.identity, 'utf8'))
    try {
      const target = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create({
        name: 'recovering-ssh', environment: 'development', transport: 'ssh', host: '127.0.0.1', port: server.port,
        username: userInfo().username, hostKey: server.publicHostKey, identityCredential: 'TEST_SSH_KEY',
        workspace: process.cwd(), enabled: true, labels: {},
      }))
      const interrupted = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.createPlan({
        targetId: target.id, argv: ['sh', '-c', 'kill -KILL "$PPID"'], timeoutMs: 1_000,
      }))
      const failed = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.executePlan(interrupted.id, interrupted.revision))
      expect(failed).toMatchObject({ status: 'failed' })
      expect(failed.finishedAt).toBeTypeOf('string')
      await expect(ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.executePlan(failed.id, failed.revision)))
        .rejects.toThrow('not ready')

      const recovery = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.createPlan({
        targetId: target.id, argv: ['printf', '%s', 'recovered-over-new-connection'],
      }))
      await expect(ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.executePlan(recovery.id, recovery.revision)))
        .resolves.toMatchObject({ status: 'succeeded', output: 'recovered-over-new-connection' })
    } finally {
      await ctx.fiber.dispose()
      await server.dispose()
    }
  }, 20_000)

  it('health-gates a rollout across real pinned SSH servers and skips later nodes after failure', async () => {
    const firstServer = await sshdFixture()
    const secondServer = await sshdFixture(firstServer.identity)
    const firstWorkspace = await mkdtemp(join(tmpdir(), 'sivitacode-rollout-first-'))
    const failingWorkspace = await mkdtemp(join(tmpdir(), 'sivitacode-rollout-failing-'))
    const skippedWorkspace = await mkdtemp(join(tmpdir(), 'sivitacode-rollout-skipped-'))
    await writeFile(join(failingWorkspace, 'reject-deployment'), '')
    const { ctx, admin } = await harness(await readFile(firstServer.identity, 'utf8'))
    try {
      const createTarget = (name: string, port: number, hostKey: string, workspace: string) => ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create({
        name, environment: 'staging', transport: 'ssh', host: '127.0.0.1', port,
        username: userInfo().username, hostKey, identityCredential: 'TEST_SSH_KEY', workspace, enabled: true, labels: {},
      }))
      const first = await createTarget('ssh-node-a', firstServer.port, firstServer.publicHostKey, firstWorkspace)
      const failing = await createTarget('ssh-node-b', secondServer.port, secondServer.publicHostKey, failingWorkspace)
      const skipped = await createTarget('ssh-node-c', firstServer.port, firstServer.publicHostKey, skippedWorkspace)
      const rollout = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.createRollout({
        targetIds: [first.id, failing.id, skipped.id], batchSize: 1,
        drainArgv: ['sh', '-c', 'printf drained >> lifecycle'],
        argv: ['sh', '-c', 'printf deployed >> lifecycle; printf deployed'],
        verifyArgv: ['sh', '-c', 'test ! -e reject-deployment'],
        rollbackArgv: ['sh', '-c', 'printf rolled-back >> lifecycle'],
        restoreArgv: ['sh', '-c', 'printf restored >> lifecycle'],
      }))
      const settled = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.executeRollout(rollout.id, rollout.revision))
      expect(settled).toMatchObject({ status: 'failed' })
      expect(settled.targets).toMatchObject([
        { targetId: first.id, status: 'succeeded', output: 'deployed', steps: [
          { phase: 'drain', status: 'succeeded' }, { phase: 'deploy', status: 'succeeded' },
          { phase: 'verify', status: 'succeeded' }, { phase: 'restore', status: 'succeeded' },
        ] },
        { targetId: failing.id, status: 'failed', steps: [
          { phase: 'drain', status: 'succeeded' }, { phase: 'deploy', status: 'succeeded' },
          { phase: 'verify', status: 'failed' }, { phase: 'rollback', status: 'succeeded' },
          { phase: 'restore', status: 'succeeded' },
        ] },
        { targetId: skipped.id, status: 'skipped' },
      ])
      expect(await readFile(join(firstWorkspace, 'lifecycle'), 'utf8')).toBe('draineddeployedrestored')
      expect(await readFile(join(failingWorkspace, 'lifecycle'), 'utf8')).toBe('draineddeployedrolled-backrestored')
      expect(await readFile(join(skippedWorkspace, 'lifecycle'), 'utf8').catch(() => undefined)).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
      await Promise.all([firstServer.dispose(), secondServer.dispose()])
      await Promise.all([firstWorkspace, failingWorkspace, skippedWorkspace].map(path => rm(path, { recursive: true, force: true })))
    }
  }, 30_000)

  it('terminates timed-out deployment process trees and settles the plan', async () => {
    const { ctx, admin } = await harness()
    const local = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create({
      name: 'timeout-local', environment: 'development', transport: 'local', workspace: process.cwd(), enabled: true, labels: {},
    }))
    const plan = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.createPlan({
      targetId: local.id, timeoutMs: 1_000,
      argv: [process.execPath, '-e', 'setInterval(()=>{},1000)'],
    }))
    const started = Date.now()
    const settled = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.executePlan(plan.id, plan.revision))
    expect(settled.status).toBe('failed')
    expect(Date.now() - started).toBeLessThan(8_000)
    await ctx.fiber.dispose()
  })

  it('validates transport-specific container fields', async () => {
    const { ctx, admin } = await harness()
    await expect(ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create({
      name: 'missing-image', environment: 'development', transport: 'container', workspace: '/srv/app',
      enabled: true, labels: {}, containerRuntime: 'podman',
    }))).rejects.toThrow('require runtime and image')
    await expect(ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create({
      ...sshTarget, name: 'mixed-ssh', containerRuntime: 'podman', containerImage: 'image@sha256:abc',
    }))).rejects.toThrow('cannot carry container fields')
    await ctx.fiber.dispose()
  })

  it('manages Git worktrees through the target execution world', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'sivitacode-inventory-worktree-'))
    const { ctx, admin } = await harness()
    const run = async (...args: string[]): Promise<void> => { await promisify(execFile)('git', ['-C', repository, ...args]) }
    await run('init', '-b', 'main')
    await run('config', 'user.email', 'test@example.com')
    await run('config', 'user.name', 'SivitaCode Test')
    await writeFile(join(repository, 'README.md'), 'fixture\n')
    await run('add', 'README.md')
    await run('commit', '-m', 'initial')
    const target = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.create({
      name: 'worktree-local', environment: 'development', transport: 'local', workspace: repository, enabled: true, labels: {},
    }))
    const created = await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.createWorktree({
      targetId: target.id, branch: 'feature/web', createBranch: true,
    }))
    expect(created).toMatchObject({ branch: 'feature/web' })
    expect(await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.listWorktrees(target.id)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ path: created.path })]))
    await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.removeWorktree(target.id, created.path))
    expect(await ctx.accessControl.runAs(admin, () => ctx.deploymentInventory.listWorktrees(target.id)))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ path: created.path })]))
    await ctx.fiber.dispose()
  })
})

async function sshdFixture(sharedIdentity?: string): Promise<{ port: number; identity: string; publicHostKey: string; dispose: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'sivitacode-inventory-sshd-'))
  const hostKey = join(directory, 'host')
  const identity = sharedIdentity ?? join(directory, 'identity')
  generateSshKey(hostKey)
  if (sharedIdentity === undefined) generateSshKey(identity)
  const authorized = join(directory, 'authorized_keys')
  await writeFile(authorized, await readFile(`${identity}.pub`), { mode: 0o600 })
  const port = await freePort()
  const config = join(directory, 'sshd_config')
  await writeFile(config, [
    `Port ${String(port)}`, 'ListenAddress 127.0.0.1', `HostKey ${hostKey}`,
    `AuthorizedKeysFile ${authorized}`, `PidFile ${join(directory, 'pid')}`,
    'StrictModes no', 'PasswordAuthentication no', 'KbdInteractiveAuthentication no',
    'ChallengeResponseAuthentication no', 'UsePAM no', 'PermitRootLogin no', 'LogLevel ERROR',
  ].join('\n'))
  const process = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', config], { stdio: ['ignore', 'ignore', 'pipe'] })
  let diagnostic = ''
  process.stderr.on('data', (chunk) => { diagnostic += String(chunk) })
  await waitForSshd(port, process, () => diagnostic)
  const publicHostKey = (await readFile(`${hostKey}.pub`, 'utf8')).trim().split(/\s+/u).slice(0, 2).join(' ')
  return {
    port, identity, publicHostKey,
    dispose: async () => {
      process.kill('SIGTERM')
      if (process.exitCode === null) await new Promise(resolve => process.once('close', resolve))
      await rm(directory, { recursive: true, force: true })
    },
  }
}

function generateSshKey(path: string): void {
  const result = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', path])
  if (result.status !== 0) throw new Error(`ssh-keygen failed: ${String(result.stderr)}`)
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('failed to allocate port')
  await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
  return address.port
}

async function waitForSshd(port: number, process: ChildProcess, diagnostic: () => string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (process.exitCode !== null) throw new Error(`sshd exited: ${diagnostic()}`)
    const occupied = await new Promise<boolean>((resolve) => {
      const probe = createServer().listen(port, '127.0.0.1')
      probe.once('error', () => { resolve(true) })
      probe.once('listening', () => probe.close(() => { resolve(false) }))
    })
    if (occupied) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`sshd did not listen: ${diagnostic()}`)
}
