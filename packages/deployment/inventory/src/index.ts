/* oxlint-disable typescript/no-non-null-assertion, @stylistic/max-len -- validated transport discriminants refine persisted optional fields; remote signatures stay readable on one line. */
/** Persistent non-secret deployment inventory with RBAC and audit. */
import { posix } from 'node:path'
import { randomUUID } from 'node:crypto'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import SshConnection from '@deepseek-ai/dsh-ssh'
import SshFileSystem from '@deepseek-ai/dsh-fs-ssh'
import SshSubprocessRuntime from '@deepseek-ai/dsh-subprocess-ssh'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import BashLocal from '@deepseek-ai/dsh-bash-local'
import OciContainer from '@deepseek-ai/dsh-oci'
import GitWorktreeService from '@deepseek-ai/dsh-git-worktree'
import type { ExecutionTargetId, ExecutionWorldRoute, ExecutionWorldRouteProvider } from '@deepseek-ai/dsh-execution-world'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-access-control'
import { deploymentInventoryDomain } from './spec.ts'
import type { DeploymentPlanRecord, DeploymentRolloutRecord, DeploymentTargetGrantRecord, DeploymentTargetRecord } from './spec.ts'
import { DeploymentPlanId, DeploymentRolloutId, DeploymentTargetId } from './types.ts'
import type { DeploymentPlan, DeploymentPlanCreate, DeploymentRollout, DeploymentRolloutCreate, DeploymentRolloutPhase, DeploymentRolloutStep, DeploymentTarget, DeploymentTargetCreate, DeploymentTargetGrant, DeploymentTargetGrantSet, DeploymentTargetHealth, DeploymentTargetUpdate, DeploymentWorktree, DeploymentWorktreeCreate } from './types.ts'
import type { AccessActor, AccessPermission, UserId } from '@deepseek-ai/dsh-access-control'

const DEFAULT_DEPLOYMENT_TIMEOUT_MS = 15 * 60_000
const MAX_DEPLOYMENT_TIMEOUT_MS = 24 * 60 * 60_000

export type { DeploymentEnvironment, DeploymentPlan, DeploymentPlanCreate, DeploymentPlanId, DeploymentPlanStatus, DeploymentRollout, DeploymentRolloutCreate, DeploymentRolloutId, DeploymentRolloutPhase, DeploymentRolloutStatus, DeploymentRolloutStep, DeploymentRolloutTarget, DeploymentRolloutTargetStatus, DeploymentTarget, DeploymentTargetCreate, DeploymentTargetGrant, DeploymentTargetGrantSet, DeploymentTargetHealth, DeploymentTargetId, DeploymentTargetUpdate, DeploymentTransport, DeploymentWorktree, DeploymentWorktreeCreate } from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { deploymentInventory: DeploymentInventoryService } }

/** Persistent deployment target inventory. */
export class DeploymentInventoryService extends TypertRemoteService implements ExecutionWorldRouteProvider {
  static inject = ['storageDomain', 'accessControl', 'credentials']
  private targets?: KvTable<DeploymentTargetId, DeploymentTargetRecord>
  private plans?: KvTable<DeploymentPlanId, DeploymentPlanRecord>
  private rollouts?: KvTable<DeploymentRolloutId, DeploymentRolloutRecord>
  private grants?: KvTable<string, DeploymentTargetGrantRecord>
  private planMutationTail: Promise<void> = Promise.resolve()

  constructor(ctx: Context) { super(ctx, 'deploymentInventory') }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(deploymentInventoryDomain)
    this.ctx.effect(() => () => domain.close(), 'deployment-inventory.domainClose')
    this.targets = domain.table('targets')
    this.plans = domain.table('plans')
    this.rollouts = domain.table('rollouts')
    this.grants = domain.table('grants')
    const router = this.ctx.get('executionWorldRouter')
    if (router !== undefined) this.ctx.effect(() => router.register(this), 'deployment-inventory.executionRoutes')
    for (const [id, record] of this.plans.entries()) {
      if (record.status !== 'running') continue
      await this.plans.put(id, {
        ...record, status: 'failed', failure: 'control plane restarted during execution',
        finishedAt: new Date().toISOString(), revision: record.revision + 1,
      })
    }
    for (const [id, record] of this.rollouts.entries()) {
      if (record.status !== 'running') continue
      const at = new Date().toISOString()
      await this.rollouts.put(id, {
        ...record, status: record.targets.some(target => target.status === 'running' && target.steps.some(step => step.phase === 'drain' && step.status === 'succeeded')) ? 'recovery-required' : 'failed', finishedAt: at, revision: record.revision + 1,
        targets: record.targets.map(target => target.status === 'running'
          ? { ...target, status: target.steps.some(step => step.phase === 'drain' && step.status === 'succeeded') ? 'recovery-required' : 'failed', failure: 'control plane restarted during execution', finishedAt: at }
          : target.status === 'pending' ? { ...target, status: 'skipped', failure: 'rollout stopped after control plane restart', finishedAt: at } : target),
      })
    }
  }

  /**
   * Resolve an enabled inventory target into isolated Agent capability realms.
   * @param runtimeContext - AgentLoop runtime Context carrying the complete capability graph.
   * @param targetId - Durable Inventory target id.
   * @param cwd - Control-plane path mapped to the target workspace.
   * @returns Route mounted before Agent publication.
   */
  route(runtimeContext: Context, targetId: ExecutionTargetId, cwd: string | undefined): ExecutionWorldRoute {
    const id = String(targetId) as DeploymentTargetId
    const actor = this.ctx.accessControl.currentActor()
    if (actor !== undefined && !this.actorCan(actor, id, 'operate')) {
      void this.ctx.accessControl.audit('deployment.target.route', 'denied', { actorUserId: actor.userId, detail: String(id) })
      throw new Error(`authenticated actor cannot operate deployment target '${targetId}'`)
    }
    const record = this.requireTargets().get(id)
    if (record === undefined) throw new Error(`execution target '${targetId}' was not found`)
    if (!record.enabled) throw new Error(`execution target '${targetId}' is disabled`)
    const context = this.executionContext(runtimeContext, String(targetId), record.transport !== 'local')
    return {
      context,
      setup: async agentContext => this.mountExecutionTarget(agentContext, record, cwd, undefined, true),
    }
  }

  private executionContext(runtimeContext: Context, label: string, isolateShell = false): Context {
    const context = runtimeContext
      .isolate('fs', Symbol(`execution-target:${label}:fs`))
      .isolate('subprocess', Symbol(`execution-target:${label}:subprocess`))
      .isolate('ssh', Symbol(`execution-target:${label}:ssh`))
    return isolateShell ? context.isolate('shell', Symbol(`execution-target:${label}:shell`)) : context
  }

  private async mountExecutionTarget(agentContext: Context, target: DeploymentTargetRecord, controlCwd: string | undefined, disposers?: Array<() => Promise<void>>, includeAgentCapabilities = false): Promise<void> {
    const mount = async (plugin: Parameters<Context['plugin']>[0], config?: unknown): Promise<void> => {
      const fiber = await agentContext.plugin(plugin, config).await()
      disposers?.push(fiber.dispose)
    }
    if (target.transport === 'local') {
      await mount(LocalFileSystem, { cwd: target.workspace })
      await mount(LocalSubprocessRuntime)
      return
    }
    if (target.transport === 'container') {
      await mount(OciContainer, {
        runtime: target.containerRuntime!, image: target.containerImage!, workspace: target.workspace,
        network: target.containerNetwork ?? 'none', requireRootless: true,
      })
      await mount(SshFileSystem, { cwd: target.workspace, localAnchor: controlCwd ?? target.workspace })
      await mount(SshSubprocessRuntime, { cwd: target.workspace, localAnchor: controlCwd ?? target.workspace })
      if (includeAgentCapabilities) await mount(BashLocal)
      return
    }
    let privateDirectory: string | undefined
    let identityFile: string | undefined
    if (target.identityCredential !== undefined) {
      const resolved = await this.ctx.credentials.resolve(credentialRef(target.identityCredential))
      if (resolved === undefined) throw new Error('configured SSH identity credential is unavailable')
      privateDirectory = await mkdtemp(join(tmpdir(), 'sivitacode-agent-key-'))
      identityFile = join(privateDirectory, 'identity')
      await writeFile(identityFile, resolved.value.endsWith('\n') ? resolved.value : `${resolved.value}\n`, { mode: 0o600 })
      agentContext.effect(() => async () => { await rm(privateDirectory!, { recursive: true, force: true }) }, 'execution-target.identityFile')
    }
    await mount(SshConnection, {
      host: target.host!, username: target.username!, pinnedHostKey: target.hostKey!,
      ...(target.port === undefined ? {} : { port: target.port }),
      ...(identityFile === undefined ? {} : { identityFile }),
    })
    await mount(SshFileSystem, { cwd: target.workspace, localAnchor: controlCwd ?? target.workspace })
    await mount(SshSubprocessRuntime, { cwd: target.workspace, localAnchor: controlCwd ?? target.workspace })
    if (includeAgentCapabilities) await mount(BashLocal)
  }

  /**
   * List targets visible to the authenticated actor.
   * @returns Authorized target projections in name order.
   */
  @Remote('list')
  async list(): Promise<DeploymentTarget[]> {
    const actor = await this.ctx.accessControl.authorize('read', 'list deployment targets')
    return [...this.requireTargets().entries()].filter(([id]) => this.actorCan(actor, id, 'read')).map(([id, record]) => view(id, record))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  /**
   * Read one target.
   * @param id - Target identifier.
   * @returns Authorized target projection, or undefined when absent.
   */
  @Remote('get')
  async get(id: DeploymentTargetId): Promise<DeploymentTarget | undefined> {
    await this.authorizeTarget(id, 'read', `read deployment target ${id}`)
    const record = this.requireTargets().get(id)
    return record === undefined ? undefined : view(id, record)
  }

  /**
   * Create one target after configuration authorization.
   * @param input - Valid non-secret target configuration.
   * @returns Created target at revision one.
   */
  @Remote('create')
  async create(input: DeploymentTargetCreate): Promise<DeploymentTarget> {
    const actor = await this.ctx.accessControl.authorize('configure', `create deployment target ${input.name}`)
    validate(input)
    if ([...this.requireTargets().entries()].some(([, target]) => target.name === input.name)) {
      throw new Error(`deployment target name '${input.name}' already exists`)
    }
    const id = DeploymentTargetId(randomUUID())
    const at = new Date().toISOString()
    const record: DeploymentTargetRecord = { ...input, labels: { ...input.labels }, revision: 1, createdAt: at, updatedAt: at }
    await this.requireTargets().put(id, record)
    await this.requireGrants().put(grantKey(id, actor.userId), {
      targetId: id, userId: actor.userId, permission: 'administer', revision: 1, createdAt: at, updatedAt: at,
    })
    await this.ctx.accessControl.audit('deployment.target.create', 'success', { actorUserId: actor.userId, detail: `${id}:${input.name}` })
    return view(id, record)
  }

  /**
   * List one target's explicit user grants.
   * @param targetId - Target whose grants are requested.
   * @returns Grants ordered by user id.
   */
  @Remote('listGrants')
  async listGrants(targetId: DeploymentTargetId): Promise<DeploymentTargetGrant[]> {
    await this.authorizeTarget(targetId, 'administer', `list grants for deployment target ${targetId}`)
    return [...this.requireGrants().entries()].map(([, grant]) => grant)
      .filter(grant => grant.targetId === targetId)
      .map(grantView).sort((left, right) => String(left.userId).localeCompare(String(right.userId)))
  }

  /**
   * Create, replace, or delete one explicit target grant.
   * @param input - Target, user, permission, and observed revision.
   * @returns New grant, or undefined after deletion.
   */
  @Remote('setGrant')
  async setGrant(input: DeploymentTargetGrantSet): Promise<DeploymentTargetGrant | undefined> {
    const actor = await this.authorizeTarget(input.targetId, 'administer', `set grant for deployment target ${input.targetId}`)
    if (this.requireTargets().get(input.targetId) === undefined) throw new Error(`deployment target '${input.targetId}' was not found`)
    if (!(await this.ctx.accessControl.listUsers()).some(user => user.id === input.userId)) {
      throw new Error(`user '${input.userId}' was not found`)
    }
    const key = grantKey(input.targetId, input.userId)
    const current = this.requireGrants().get(key)
    if (current === undefined && input.expectedRevision !== undefined) throw new Error('deployment target grant does not exist at the observed revision')
    if (current !== undefined && current.revision !== input.expectedRevision) throw new Error(`deployment target grant changed since revision ${String(input.expectedRevision)}`)
    if (input.permission === undefined) {
      if (current !== undefined) await this.requireGrants().delete(key)
      await this.ctx.accessControl.audit('deployment.grant.delete', 'success', { actorUserId: actor.userId, subjectUserId: input.userId, detail: String(input.targetId) })
      return undefined
    }
    const at = new Date().toISOString()
    const record: DeploymentTargetGrantRecord = {
      targetId: input.targetId, userId: input.userId, permission: input.permission,
      revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? at, updatedAt: at,
    }
    await this.requireGrants().put(key, record)
    await this.ctx.accessControl.audit('deployment.grant.set', 'success', { actorUserId: actor.userId, subjectUserId: input.userId, detail: `${input.targetId}:${input.permission}` })
    return grantView(record)
  }

  /**
   * Replace one target when its observed revision is current.
   * @param id - Target identifier.
   * @param input - Replacement and observed revision.
   * @returns Updated target with an incremented revision.
   */
  @Remote('update')
  async update(id: DeploymentTargetId, input: DeploymentTargetUpdate): Promise<DeploymentTarget> {
    const actor = await this.authorizeTarget(id, 'configure', `update deployment target ${id}`)
    validate(input.value)
    const current = this.requireTargets().get(id)
    if (current === undefined) throw new Error(`deployment target '${id}' was not found`)
    if (current.revision !== input.expectedRevision) throw new Error(`deployment target '${id}' changed since revision ${input.expectedRevision}`)
    if ([...this.requireTargets().entries()].some(([otherId, target]) => otherId !== id && target.name === input.value.name)) {
      throw new Error(`deployment target name '${input.value.name}' already exists`)
    }
    const record: DeploymentTargetRecord = {
      ...input.value,
      labels: { ...input.value.labels },
      revision: current.revision + 1,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    }
    await this.requireTargets().put(id, record)
    await this.ctx.accessControl.audit('deployment.target.update', 'success', { actorUserId: actor.userId, detail: `${id}:${record.revision}` })
    return view(id, record)
  }

  /**
   * Delete a target after administrative authorization.
   * @param id - Target identifier.
   * @param expectedRevision - Revision observed by the administrator.
   * @returns Resolution after delete and audit.
   */
  @Remote('delete')
  async delete(id: DeploymentTargetId, expectedRevision: number): Promise<void> {
    const actor = await this.authorizeTarget(id, 'administer', `delete deployment target ${id}`)
    const current = this.requireTargets().get(id)
    if (current === undefined) return
    if (current.revision !== expectedRevision) throw new Error(`deployment target '${id}' changed since revision ${expectedRevision}`)
    const unsettled = [...this.requirePlans().entries()].find(([, plan]) =>
      plan.targetId === id && (plan.status === 'pending-approval' || plan.status === 'ready' || plan.status === 'running'))
    if (unsettled !== undefined) {
      throw new Error(`deployment target '${id}' has unsettled deployment plan '${unsettled[0]}'`)
    }
    const rollout = [...this.requireRollouts().entries()].find(([, candidate]) =>
      candidate.targets.some(target => target.targetId === id)
      && (candidate.status === 'pending-approval' || candidate.status === 'ready' || candidate.status === 'running' || candidate.status === 'recovery-required'))
    if (rollout !== undefined) throw new Error(`deployment target '${id}' has unsettled rollout '${rollout[0]}'`)
    await this.requireTargets().delete(id)
    for (const [key, grant] of this.requireGrants().entries()) {
      if (grant.targetId === id) await this.requireGrants().delete(key)
    }
    await this.ctx.accessControl.audit('deployment.target.delete', 'success', { actorUserId: actor.userId, detail: String(id) })
  }

  /**
   * Verify target reachability and its configured workspace without changing it.
   * @param id - Target identifier.
   * @returns Point-in-time health result with no secret material.
   */
  @Remote('checkHealth')
  async checkHealth(id: DeploymentTargetId): Promise<DeploymentTargetHealth> {
    const actor = await this.authorizeTarget(id, 'operate', `check deployment target ${id}`)
    const record = this.requireTargets().get(id)
    if (record === undefined) throw new Error(`deployment target '${id}' was not found`)
    const started = Date.now()
    if (!record.enabled) return health(id, 'disabled', started, 'target is disabled')
    try {
      if (record.transport === 'local') await access(record.workspace)
      else if (record.transport === 'ssh') await this.checkSsh(record)
      else await this.checkContainer(record)
      await this.ctx.accessControl.audit('deployment.target.health', 'success', { actorUserId: actor.userId, detail: String(id) })
      return health(id, 'healthy', started, 'workspace is reachable')
    } catch (cause) {
      await this.ctx.accessControl.audit('deployment.target.health', 'failure', { actorUserId: actor.userId, detail: String(id) })
      return health(id, 'unhealthy', started, safeHealthDetail(cause))
    }
  }

  /**
   * List Git worktrees inside one authorized execution target.
   * @param targetId - Inventory target owning the repository and process realm.
   * @returns Git-authoritative worktree records.
   */
  @Remote('listWorktrees')
  async listWorktrees(targetId: DeploymentTargetId): Promise<DeploymentWorktree[]> {
    const actor = await this.authorizeTarget(targetId, 'read', `list worktrees for deployment target ${targetId}`)
    const result = await this.withGitWorktrees(targetId, service => service.list(this.requireEnabledTarget(targetId).workspace))
    await this.ctx.accessControl.audit('deployment.worktree.list', 'success', { actorUserId: actor.userId, detail: String(targetId) })
    return result
  }

  /**
   * Create a managed linked worktree inside one execution target.
   * @param input - Target, branch, and optional starting revision.
   * @returns The created Git-authoritative record.
   */
  @Remote('createWorktree')
  async createWorktree(input: DeploymentWorktreeCreate): Promise<DeploymentWorktree> {
    const actor = await this.authorizeTarget(input.targetId, 'operate', `create worktree for deployment target ${input.targetId}`)
    const target = this.requireEnabledTarget(input.targetId)
    const result = await this.withGitWorktrees(input.targetId, service => service.create({
      repository: target.workspace,
      branch: input.branch,
      ...(input.startPoint === undefined ? {} : { startPoint: input.startPoint }),
      ...(input.createBranch === undefined ? {} : { createBranch: input.createBranch }),
    }))
    await this.ctx.accessControl.audit('deployment.worktree.create', 'success', { actorUserId: actor.userId, detail: `${input.targetId}:${result.path}` })
    return result
  }

  /**
   * Remove a clean managed linked worktree inside one execution target.
   * @param targetId - Inventory target owning the repository.
   * @param path - Exact managed path returned by {@link listWorktrees}.
   */
  @Remote('removeWorktree')
  async removeWorktree(targetId: DeploymentTargetId, path: string): Promise<void> {
    const actor = await this.authorizeTarget(targetId, 'operate', `remove worktree for deployment target ${targetId}`)
    const target = this.requireEnabledTarget(targetId)
    await this.withGitWorktrees(targetId, service => service.remove(target.workspace, path))
    await this.ctx.accessControl.audit('deployment.worktree.remove', 'success', { actorUserId: actor.userId, detail: `${targetId}:${path}` })
  }

  private requireEnabledTarget(id: DeploymentTargetId): DeploymentTargetRecord {
    const target = this.requireTargets().get(id)
    if (target === undefined) throw new Error(`deployment target '${id}' was not found`)
    if (!target.enabled) throw new Error(`deployment target '${id}' is disabled`)
    return target
  }

  private async withGitWorktrees<T>(targetId: DeploymentTargetId, operation: (service: GitWorktreeService) => Promise<T>): Promise<T> {
    const target = this.requireEnabledTarget(targetId)
    const child = this.executionContext(this.ctx, `worktree:${target.name}:${target.revision}`)
    const disposers: Array<() => Promise<void>> = []
    try {
      await this.mountExecutionTarget(child, target, target.workspace, disposers)
      const fiber = await child.plugin(GitWorktreeService).await()
      disposers.push(fiber.dispose)
      return await operation(child.gitWorktrees)
    } finally {
      for (const dispose of disposers.reverse()) await dispose()
    }
  }

  private async checkSsh(record: DeploymentTargetRecord): Promise<void> {
    let privateDirectory: string | undefined
    try {
      let identityFile: string | undefined
      if (record.identityCredential !== undefined) {
        const resolved = await this.ctx.credentials.resolve(credentialRef(record.identityCredential))
        if (resolved === undefined) throw new Error('configured SSH identity credential is unavailable')
        privateDirectory = await mkdtemp(join(tmpdir(), 'sivitacode-deploy-key-'))
        identityFile = join(privateDirectory, 'identity')
        await writeFile(identityFile, resolved.value.endsWith('\n') ? resolved.value : `${resolved.value}\n`, { mode: 0o600 })
      }
      const child = this.ctx.isolate('ssh', Symbol(`deployment-health:${record.host}:${String(record.port ?? 22)}`))
      const fiber = await child.plugin(SshConnection, {
        host: record.host!, username: record.username!, pinnedHostKey: record.hostKey!,
        ...(record.port === undefined ? {} : { port: record.port }),
        ...(identityFile === undefined ? {} : { identityFile }), connectTimeoutMs: 10_000, keepAliveSeconds: 5,
      }).await()
      try {
        const result = await child.ssh.command(['python3', '-c', 'import os,sys; sys.exit(0 if os.path.isdir(sys.argv[1]) else 4)', record.workspace])
        if (result.exitCode !== 0) throw new Error(`remote workspace check exited ${String(result.exitCode)}`)
      } finally {
        await fiber.dispose()
      }
    } finally {
      if (privateDirectory !== undefined) await rm(privateDirectory, { recursive: true, force: true })
    }
  }

  private async checkContainer(record: DeploymentTargetRecord): Promise<void> {
    const child = this.ctx.isolate('ssh')
    try {
      await child.plugin(OciContainer, {
        runtime: record.containerRuntime!, image: record.containerImage!, workspace: record.workspace,
        network: record.containerNetwork ?? 'none', requireRootless: true,
      }).await()
      const result = await child.ssh.command(['python3', '-c', 'import os,sys; sys.exit(0 if os.path.isdir(sys.argv[1]) else 4)', record.workspace])
      if (result.exitCode !== 0) throw new Error(`container workspace check exited ${String(result.exitCode)}`)
    } finally {
      await child.fiber.dispose()
    }
  }

  /**
   * List deployment plans after read authorization.
   * @returns Plans newest first.
   */
  @Remote('listPlans')
  async listPlans(): Promise<DeploymentPlan[]> {
    const actor = await this.ctx.accessControl.authorize('read', 'list deployment plans')
    return [...this.requirePlans().entries()].filter(([, record]) => this.actorCan(actor, DeploymentTargetId(record.targetId), 'read'))
      .map(([id, record]) => planView(id, record))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  /**
   * Create an immutable deployment plan.
   * @param input - Target and literal argv.
   * @returns Durable plan.
   */
  @Remote('createPlan')
  async createPlan(input: DeploymentPlanCreate): Promise<DeploymentPlan> {
    const actor = await this.authorizeTarget(input.targetId, 'operate', `create deployment plan for ${input.targetId}`)
    const target = this.requireTargets().get(input.targetId)
    if (target === undefined) throw new Error(`deployment target '${input.targetId}' was not found`)
    if (!target.enabled) throw new Error(`deployment target '${input.targetId}' is disabled`)
    validateArgv(input.argv)
    const timeoutMs = input.timeoutMs ?? DEFAULT_DEPLOYMENT_TIMEOUT_MS
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_DEPLOYMENT_TIMEOUT_MS) {
      throw new Error(`deployment timeoutMs must be an integer from 1000 to ${String(MAX_DEPLOYMENT_TIMEOUT_MS)}`)
    }
    const id = DeploymentPlanId(randomUUID())
    const record: DeploymentPlanRecord = {
      targetId: input.targetId, targetRevision: target.revision, environment: target.environment,
      argv: [...input.argv], timeoutMs, status: target.environment === 'production' ? 'pending-approval' : 'ready',
      createdBy: actor.username, createdAt: new Date().toISOString(), revision: 1,
    }
    await this.requirePlans().put(id, record)
    await this.ctx.accessControl.audit('deployment.plan.create', 'success', { actorUserId: actor.userId, detail: `${id}:${input.targetId}` })
    return planView(id, record)
  }

  /**
   * Approve a production deployment as an administrator.
   * @param id - Plan id.
   * @param expectedRevision - Observed revision.
   * @returns Approved plan.
   */
  @Remote('approvePlan')
  async approvePlan(id: DeploymentPlanId, expectedRevision: number): Promise<DeploymentPlan> {
    const preview = this.requirePlan(id, expectedRevision)
    const actor = await this.authorizeTarget(DeploymentTargetId(preview.targetId), 'administer', `approve deployment plan ${id}`)
    const record = await this.serializePlanMutation(async () => {
      const current = this.requirePlan(id, expectedRevision)
      if (current.status !== 'pending-approval') throw new Error(`deployment plan '${id}' is not pending approval`)
      if (current.createdBy === actor.username) throw new Error('production deployment requires approval by a different administrator')
      const approved = { ...current, status: 'ready' as const, approvedBy: actor.username, approvedAt: new Date().toISOString(), revision: current.revision + 1 }
      await this.requirePlans().put(id, approved)
      return approved
    })
    await this.ctx.accessControl.audit('deployment.plan.approve', 'success', { actorUserId: actor.userId, detail: String(id) })
    return planView(id, record)
  }

  /**
   * Execute one ready plan exactly once.
   * @param id - Plan id.
   * @param expectedRevision - Observed revision.
   * @returns Settled plan.
   */
  @Remote('executePlan')
  async executePlan(id: DeploymentPlanId, expectedRevision: number): Promise<DeploymentPlan> {
    const preview = this.requirePlan(id, expectedRevision)
    const actor = await this.authorizeTarget(DeploymentTargetId(preview.targetId), 'operate', `execute deployment plan ${id}`)
    const reserved = await this.serializePlanMutation(async () => {
      const current = this.requirePlan(id, expectedRevision)
      if (current.status !== 'ready') throw new Error(`deployment plan '${id}' is not ready`)
      const target = this.requireTargets().get(current.targetId as DeploymentTargetId)
      if (target === undefined || !target.enabled || target.revision !== current.targetRevision) {
        throw new Error(`deployment plan '${id}' target changed or is unavailable`)
      }
      const running = { ...current, status: 'running' as const, startedAt: new Date().toISOString(), revision: current.revision + 1 }
      await this.requirePlans().put(id, running)
      return { current, running, target }
    })
    const { current, running, target } = reserved
    await this.ctx.accessControl.audit('deployment.plan.execute', 'success', { actorUserId: actor.userId, detail: String(id) })
    const timeout = AbortSignal.timeout(current.timeoutMs)
    try {
      const result = await this.runTarget(target, current.argv, timeout)
      const record: DeploymentPlanRecord = {
        ...running, status: result.exitCode === 0 ? 'succeeded' : 'failed', exitCode: result.exitCode,
        output: boundedOutput(result.stdout, result.stderr), finishedAt: new Date().toISOString(), revision: running.revision + 1,
      }
      await this.requirePlans().put(id, record)
      return planView(id, record)
    } catch (cause) {
      const record: DeploymentPlanRecord = {
        ...running, status: 'failed', failure: safeHealthDetail(cause), finishedAt: new Date().toISOString(), revision: running.revision + 1,
      }
      await this.requirePlans().put(id, record)
      return planView(id, record)
    }
  }

  private async runTarget(target: DeploymentTargetRecord, argv: readonly string[], signal: AbortSignal): Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer }> {
    const child = this.executionContext(this.ctx, `deployment:${target.name}:${target.revision}`)
    const disposers: Array<() => Promise<void>> = []
    try {
      await this.mountExecutionTarget(child, target, target.workspace, disposers)
      const executable = await child.subprocess.resolveExecutable(argv[0]!, {}, signal)
      const handle = child.subprocess.spawn({
        argv: [executable, ...argv.slice(1)], cwd: target.workspace, env: {}, signal, graceMs: 5_000,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 65_536 }, stderr: { maxBytes: 65_536 } },
      })
      const outcome = await handle.done
      const stdout = handle.collected.stdout!.readFrom(0)
      const stderr = handle.collected.stderr!.readFrom(0)
      return { exitCode: outcome.exitCode ?? 255, stdout: Buffer.from(stdout.text), stderr: Buffer.from(stderr.text) }
    } finally {
      for (const dispose of disposers.reverse()) await dispose()
    }
  }

  /**
   * List rolling deployments whose complete target set is readable by the actor.
   * @returns Authorized rollouts newest first.
   */
  @Remote('listRollouts')
  async listRollouts(): Promise<DeploymentRollout[]> {
    const actor = await this.ctx.accessControl.authorize('read', 'list deployment rollouts')
    return [...this.requireRollouts().entries()]
      .filter(([, record]) => record.targets.every(target => this.actorCan(actor, DeploymentTargetId(target.targetId), 'read')))
      .map(([id, record]) => rolloutView(id, record)).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  /**
   * Create one immutable health-gated multi-target rollout.
   * @param input - Ordered targets, literal argv, timeout, and batch size.
   * @returns Durable rollout awaiting approval when any target is production.
   */
  @Remote('createRollout')
  async createRollout(input: DeploymentRolloutCreate): Promise<DeploymentRollout> {
    validateArgv(input.argv)
    for (const argv of [input.drainArgv, input.verifyArgv, input.rollbackArgv, input.restoreArgv]) {
      if (argv !== undefined) validateArgv(argv)
    }
    if (input.drainArgv !== undefined && input.restoreArgv === undefined) throw new Error('deployment rollout drainArgv requires restoreArgv')
    if (input.targetIds.length < 2 || input.targetIds.length > 64) throw new Error('deployment rollout requires 2 to 64 targets')
    if (new Set(input.targetIds).size !== input.targetIds.length) throw new Error('deployment rollout targets must be unique')
    const timeoutMs = input.timeoutMs ?? DEFAULT_DEPLOYMENT_TIMEOUT_MS
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_DEPLOYMENT_TIMEOUT_MS) {
      throw new Error(`deployment timeoutMs must be an integer from 1000 to ${String(MAX_DEPLOYMENT_TIMEOUT_MS)}`)
    }
    const batchSize = input.batchSize ?? 1
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 16 || batchSize > input.targetIds.length) {
      throw new Error('deployment rollout batchSize must be an integer from 1 to 16 and no larger than its target count')
    }
    const targets: DeploymentRolloutRecord['targets'] = []
    const [firstTargetId, ...remainingTargetIds] = input.targetIds
    if (firstTargetId === undefined) throw new Error('deployment rollout requires at least one target')
    const actor = await this.authorizeTarget(firstTargetId, 'operate', `create deployment rollout for ${firstTargetId}`)
    for (const id of input.targetIds) {
      if (remainingTargetIds.includes(id)) await this.authorizeTarget(id, 'operate', `create deployment rollout for ${id}`)
      const target = this.requireEnabledTarget(id)
      targets.push({ targetId: id, targetRevision: target.revision, environment: target.environment, status: 'pending', steps: [] })
    }
    const id = DeploymentRolloutId(randomUUID())
    const record: DeploymentRolloutRecord = {
      targets, argv: [...input.argv],
      ...(input.drainArgv === undefined ? {} : { drainArgv: [...input.drainArgv] }),
      ...(input.verifyArgv === undefined ? {} : { verifyArgv: [...input.verifyArgv] }),
      ...(input.rollbackArgv === undefined ? {} : { rollbackArgv: [...input.rollbackArgv] }),
      ...(input.restoreArgv === undefined ? {} : { restoreArgv: [...input.restoreArgv] }),
      timeoutMs, batchSize,
      status: targets.some(target => target.environment === 'production') ? 'pending-approval' : 'ready',
      createdBy: actor.username, createdAt: new Date().toISOString(), revision: 1,
    }
    await this.requireRollouts().put(id, record)
    await this.ctx.accessControl.audit('deployment.rollout.create', 'success', { actorUserId: actor.userId, detail: `${id}:${targets.length}` })
    return rolloutView(id, record)
  }

  /**
   * Approve a production rollout as a different administrator authorized for every target.
   * @param id - Rollout id.
   * @param expectedRevision - Observed revision.
   * @returns Approved rollout.
   */
  @Remote('approveRollout')
  async approveRollout(id: DeploymentRolloutId, expectedRevision: number): Promise<DeploymentRollout> {
    const current = this.requireRollout(id, expectedRevision)
    const [firstTarget, ...remainingTargets] = current.targets
    if (firstTarget === undefined) throw new Error(`deployment rollout '${id}' has no targets`)
    const actor = await this.authorizeTarget(DeploymentTargetId(firstTarget.targetId), 'administer', `approve deployment rollout ${id}`)
    for (const target of remainingTargets) await this.authorizeTarget(DeploymentTargetId(target.targetId), 'administer', `approve deployment rollout ${id}`)
    const record = await this.serializePlanMutation(async () => {
      const observed = this.requireRollout(id, expectedRevision)
      if (observed.status !== 'pending-approval') throw new Error(`deployment rollout '${id}' is not pending approval`)
      if (observed.createdBy === actor.username) throw new Error('production deployment requires approval by a different administrator')
      const approved: DeploymentRolloutRecord = {
        ...observed, status: 'ready', approvedBy: actor.username, approvedAt: new Date().toISOString(), revision: observed.revision + 1,
      }
      await this.requireRollouts().put(id, approved)
      return approved
    })
    await this.ctx.accessControl.audit('deployment.rollout.approve', 'success', { actorUserId: actor.userId, detail: String(id) })
    return rolloutView(id, record)
  }

  /**
   * Execute one ready rollout exactly once in health-gated bounded batches.
   * @param id - Rollout id.
   * @param expectedRevision - Observed revision.
   * @returns Settled rollout with every target result.
   */
  @Remote('executeRollout')
  async executeRollout(id: DeploymentRolloutId, expectedRevision: number): Promise<DeploymentRollout> {
    const preview = this.requireRollout(id, expectedRevision)
    const [firstTarget, ...remainingTargets] = preview.targets
    if (firstTarget === undefined) throw new Error(`deployment rollout '${id}' has no targets`)
    const actor = await this.authorizeTarget(DeploymentTargetId(firstTarget.targetId), 'operate', `execute deployment rollout ${id}`)
    for (const target of remainingTargets) await this.authorizeTarget(DeploymentTargetId(target.targetId), 'operate', `execute deployment rollout ${id}`)
    const running = await this.serializePlanMutation(async () => {
      const observed = this.requireRollout(id, expectedRevision)
      if (observed.status !== 'ready') throw new Error(`deployment rollout '${id}' is not ready`)
      for (const target of observed.targets) {
        const current = this.requireTargets().get(DeploymentTargetId(target.targetId))
        if (current === undefined || !current.enabled || current.revision !== target.targetRevision) {
          throw new Error(`deployment rollout '${id}' target '${target.targetId}' changed or is unavailable`)
        }
      }
      const reserved: DeploymentRolloutRecord = {
        ...observed, status: 'running', startedAt: new Date().toISOString(), revision: observed.revision + 1,
      }
      await this.requireRollouts().put(id, reserved)
      return reserved
    })
    await this.ctx.accessControl.audit('deployment.rollout.execute', 'success', { actorUserId: actor.userId, detail: String(id) })
    let record = running
    let failed = false
    for (let offset = 0; offset < record.targets.length && !failed; offset += record.batchSize) {
      const indexes = Array.from({ length: Math.min(record.batchSize, record.targets.length - offset) }, (_, index) => offset + index)
      const at = new Date().toISOString()
      record = { ...record, targets: record.targets.map((target, index) => indexes.includes(index) ? { ...target, status: 'running', startedAt: at } : target) }
      await this.requireRollouts().put(id, record)
      const results = await Promise.all(indexes.map(index => this.executeRolloutTarget(record.targets[index]!, record)))
      failed = results.some(result => result.status === 'failed' || result.status === 'recovery-required')
      record = { ...record, targets: record.targets.map((target, index) => indexes.includes(index) ? results[indexes.indexOf(index)]! : target) }
      await this.requireRollouts().put(id, record)
    }
    const finishedAt = new Date().toISOString()
    if (failed) record = { ...record, status: record.targets.some(target => target.status === 'recovery-required') ? 'recovery-required' : 'failed', finishedAt, revision: record.revision + 1, targets: record.targets.map(target => target.status === 'pending' ? { ...target, status: 'skipped', failure: 'rollout stopped after an earlier target failed', finishedAt } : target) }
    else record = { ...record, status: 'succeeded', finishedAt, revision: record.revision + 1 }
    await this.requireRollouts().put(id, record)
    return rolloutView(id, record)
  }

  /**
   * Retry traffic restoration for targets left drained after an interrupted or failed rollout.
   * @param id - Rollout requiring operator recovery.
   * @param expectedRevision - Observed rollout revision.
   * @returns Failed rollout after restoration, or recovery-required when any restore still fails.
   */
  @Remote('recoverRollout')
  async recoverRollout(id: DeploymentRolloutId, expectedRevision: number): Promise<DeploymentRollout> {
    const preview = this.requireRollout(id, expectedRevision)
    if (preview.status !== 'recovery-required') throw new Error(`deployment rollout '${id}' does not require recovery`)
    const recoverable = preview.targets.filter(target => target.status === 'recovery-required')
    const [firstTarget, ...remainingTargets] = recoverable
    if (firstTarget === undefined || preview.restoreArgv === undefined) throw new Error(`deployment rollout '${id}' has no recoverable restore command`)
    const actor = await this.authorizeTarget(DeploymentTargetId(firstTarget.targetId), 'operate', `recover deployment rollout ${id}`)
    for (const target of remainingTargets) await this.authorizeTarget(DeploymentTargetId(target.targetId), 'operate', `recover deployment rollout ${id}`)
    const reserved = await this.serializePlanMutation(async () => {
      const observed = this.requireRollout(id, expectedRevision)
      if (observed.status !== 'recovery-required') throw new Error(`deployment rollout '${id}' does not require recovery`)
      const running = { ...observed, revision: observed.revision + 1 }
      await this.requireRollouts().put(id, running)
      return running
    })
    const replacements = new Map<string, DeploymentRolloutRecord['targets'][number]>()
    await Promise.all(reserved.targets.filter(target => target.status === 'recovery-required').map(async (target) => {
      const result = await this.runRolloutPhase(this.requireEnabledTarget(DeploymentTargetId(target.targetId)), 'restore', reserved.restoreArgv!, reserved.timeoutMs)
      const knownFailure = target.steps.some(step => (step.phase === 'deploy' || step.phase === 'verify') && step.status === 'failed')
      const deploymentSettled = target.steps.some(step => step.phase === 'deploy')
      replacements.set(target.targetId, {
        ...target, status: result.status === 'failed' ? 'recovery-required' : knownFailure || !deploymentSettled ? 'failed' : 'succeeded',
        steps: [...target.steps, result],
        failure: result.status === 'failed' ? 'traffic restoration failed' : !deploymentSettled ? 'deployment outcome unknown after control plane interruption; traffic restored' : knownFailure ? 'deployment or verification failed; traffic restored' : undefined,
        finishedAt: new Date().toISOString(),
      })
    }))
    const targets = reserved.targets.map(target => replacements.get(target.targetId) ?? target)
    const record: DeploymentRolloutRecord = { ...reserved, targets, status: targets.some(target => target.status === 'recovery-required') ? 'recovery-required' : 'failed', revision: reserved.revision + 1, finishedAt: new Date().toISOString() }
    await this.requireRollouts().put(id, record)
    await this.ctx.accessControl.audit('deployment.rollout.recover', record.status === 'failed' ? 'success' : 'failure', { actorUserId: actor.userId, detail: String(id) })
    return rolloutView(id, record)
  }

  private async executeRolloutTarget(target: DeploymentRolloutRecord['targets'][number], rollout: DeploymentRolloutRecord): Promise<DeploymentRolloutRecord['targets'][number]> {
    const id = DeploymentTargetId(target.targetId)
    const healthResult = await this.checkHealth(id)
    if (healthResult.status !== 'healthy') return { ...target, status: 'failed', failure: `preflight health failed: ${healthResult.detail}`, finishedAt: new Date().toISOString() }
    const current = this.requireEnabledTarget(id)
    const steps: DeploymentRolloutStep[] = target.steps.map(stepView)
    let drained = false
    if (rollout.drainArgv !== undefined) {
      const drain = await this.runRolloutPhase(current, 'drain', rollout.drainArgv, rollout.timeoutMs)
      steps.push(drain)
      if (drain.status === 'failed') return { ...target, status: 'failed', steps, failure: 'traffic drain failed', finishedAt: new Date().toISOString() }
      drained = true
    }
    const deploy = await this.runRolloutPhase(current, 'deploy', rollout.argv, rollout.timeoutMs)
    steps.push(deploy)
    let failed = deploy.status === 'failed'
    if (!failed && rollout.verifyArgv !== undefined) {
      const verify = await this.runRolloutPhase(current, 'verify', rollout.verifyArgv, rollout.timeoutMs)
      steps.push(verify)
      failed = verify.status === 'failed'
    }
    if (failed && rollout.rollbackArgv !== undefined) steps.push(await this.runRolloutPhase(current, 'rollback', rollout.rollbackArgv, rollout.timeoutMs))
    if (drained) {
      const restore = await this.runRolloutPhase(current, 'restore', rollout.restoreArgv!, rollout.timeoutMs)
      steps.push(restore)
      if (restore.status === 'failed') return { ...target, status: 'recovery-required', steps, failure: 'traffic restoration failed', finishedAt: new Date().toISOString() }
    }
    return { ...target, status: failed ? 'failed' : 'succeeded', steps, exitCode: deploy.exitCode, output: deploy.output, failure: failed ? 'deployment or verification failed' : undefined, finishedAt: new Date().toISOString() }
  }

  private async runRolloutPhase(target: DeploymentTargetRecord, phase: DeploymentRolloutPhase, argv: readonly string[], timeoutMs: number): Promise<DeploymentRolloutStep> {
    const startedAt = new Date().toISOString()
    try {
      const result = await this.runTarget(target, argv, AbortSignal.timeout(timeoutMs))
      const finishedAt = new Date().toISOString()
      return { phase, status: result.exitCode === 0 ? 'succeeded' : 'failed', startedAt, finishedAt, exitCode: result.exitCode, output: boundedOutput(result.stdout, result.stderr) }
    } catch (cause) {
      return { phase, status: 'failed', startedAt, finishedAt: new Date().toISOString(), failure: safeHealthDetail(cause) }
    }
  }

  private requireTargets(): KvTable<DeploymentTargetId, DeploymentTargetRecord> {
    if (this.targets === undefined) throw new Error('deployment inventory is not initialized')
    return this.targets
  }

  private requirePlans(): KvTable<DeploymentPlanId, DeploymentPlanRecord> {
    if (this.plans === undefined) throw new Error('deployment inventory is not initialized')
    return this.plans
  }

  private requireRollouts(): KvTable<DeploymentRolloutId, DeploymentRolloutRecord> {
    if (this.rollouts === undefined) throw new Error('deployment inventory is not initialized')
    return this.rollouts
  }

  private requireGrants(): KvTable<string, DeploymentTargetGrantRecord> {
    if (this.grants === undefined) throw new Error('deployment inventory is not initialized')
    return this.grants
  }

  private actorCan(actor: AccessActor, targetId: DeploymentTargetId, permission: AccessPermission): boolean {
    if (!this.ctx.accessControl.permits(actor, permission)) return false
    if (actor.roles.includes('admin')) return true
    const grant = this.requireGrants().get(grantKey(targetId, actor.userId))
    return grant !== undefined && this.ctx.accessControl.permissionIncludes(grant.permission, permission)
  }

  private async authorizeTarget(targetId: DeploymentTargetId, permission: AccessPermission, detail: string): Promise<AccessActor> {
    const actor = await this.ctx.accessControl.authorize(permission, detail)
    if (this.actorCan(actor, targetId, permission)) return actor
    await this.ctx.accessControl.audit('deployment.target.authorize', 'denied', { actorUserId: actor.userId, detail: `${targetId}:${permission}` })
    throw new Error(`authenticated actor cannot ${permission} deployment target '${targetId}'`)
  }

  private requirePlan(id: DeploymentPlanId, expectedRevision: number): DeploymentPlanRecord {
    const record = this.requirePlans().get(id)
    if (record === undefined) throw new Error(`deployment plan '${id}' was not found`)
    if (record.revision !== expectedRevision) throw new Error(`deployment plan '${id}' changed since revision ${expectedRevision}`)
    return record
  }

  private requireRollout(id: DeploymentRolloutId, expectedRevision: number): DeploymentRolloutRecord {
    const record = this.requireRollouts().get(id)
    if (record === undefined) throw new Error(`deployment rollout '${id}' was not found`)
    if (record.revision !== expectedRevision) throw new Error(`deployment rollout '${id}' changed since revision ${String(expectedRevision)}`)
    return record
  }

  private async serializePlanMutation<T>(operation: () => Promise<T>): Promise<T> {
    const preceding = this.planMutationTail
    const settled = Promise.withResolvers<void>()
    this.planMutationTail = preceding.then(() => settled.promise, () => settled.promise)
    await preceding.catch(() => undefined)
    try {
      return await operation()
    } finally {
      settled.resolve()
    }
  }
}

function validate(input: DeploymentTargetCreate): void {
  if (!posix.isAbsolute(input.workspace)) throw new Error('deployment target workspace must be an absolute POSIX path')
  if (Object.keys(input.labels).length > 64) throw new Error('deployment target labels exceed 64 entries')
  if (input.transport === 'local') {
    if (input.host !== undefined || input.port !== undefined || input.username !== undefined
      || input.hostKey !== undefined || input.identityCredential !== undefined || input.containerRuntime !== undefined
      || input.containerImage !== undefined || input.containerNetwork !== undefined) {
      throw new Error('local deployment targets cannot carry SSH fields')
    }
    return
  }
  if (input.transport === 'container') {
    if (input.host !== undefined || input.port !== undefined || input.username !== undefined
      || input.hostKey !== undefined || input.identityCredential !== undefined) {
      throw new Error('container deployment targets cannot carry SSH fields')
    }
    if (input.containerRuntime === undefined || input.containerImage === undefined) {
      throw new Error('container deployment targets require runtime and image')
    }
    return
  }
  if (input.containerRuntime !== undefined || input.containerImage !== undefined || input.containerNetwork !== undefined) {
    throw new Error('SSH deployment targets cannot carry container fields')
  }
  if (input.identityCredential !== undefined) credentialRef(input.identityCredential)
  if (input.host === undefined || input.username === undefined || input.hostKey === undefined) {
    throw new Error('SSH deployment targets require host, username, and an exact pinned host key')
  }
  if (/\s|\0/u.test(input.host) || /[\s@\0]/u.test(input.username)) throw new Error('deployment target SSH authority is invalid')
  if (!/^(?:ssh-ed25519|ecdsa-sha2-nistp(?:256|384|521)|rsa-sha2-(?:256|512)|ssh-rsa) [A-Za-z0-9+/]+={0,2}$/u.test(input.hostKey)) {
    throw new Error('deployment target hostKey must be one exact OpenSSH public host key')
  }
}

function health(targetId: DeploymentTargetId, status: DeploymentTargetHealth['status'], started: number, detail: string): DeploymentTargetHealth {
  return { targetId, status, checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, detail }
}

function safeHealthDetail(cause: unknown): string {
  const code = (cause as NodeJS.ErrnoException | null)?.code
  return code === undefined ? 'connectivity check failed' : `connectivity check failed (${code})`
}

function validateArgv(argv: readonly string[]): void {
  if (argv.length === 0 || argv.length > 128) throw new Error('deployment argv must contain 1 to 128 arguments')
  if (argv.some(argument => argument.includes('\0') || Buffer.byteLength(argument) > 16_384)) {
    throw new Error('deployment argv contains an invalid or oversized argument')
  }
}

function boundedOutput(stdout: Buffer, stderr: Buffer): string {
  const combined = Buffer.concat([stdout, stderr])
  let start = Math.max(0, combined.length - 65_536)
  while (start < combined.length && (combined[start]! & 0xc0) === 0x80) start += 1
  return combined.subarray(start).toString('utf8')
}

function planView(id: DeploymentPlanId, record: DeploymentPlanRecord): DeploymentPlan {
  return {
    id, targetId: record.targetId as DeploymentTargetId, targetRevision: record.targetRevision,
    environment: record.environment, argv: [...record.argv], timeoutMs: record.timeoutMs, status: record.status, createdBy: record.createdBy,
    createdAt: record.createdAt, revision: record.revision,
    ...(record.approvedBy === undefined ? {} : { approvedBy: record.approvedBy }),
    ...(record.approvedAt === undefined ? {} : { approvedAt: record.approvedAt }),
    ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt }),
    ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
    ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }),
    ...(record.output === undefined ? {} : { output: record.output }),
    ...(record.failure === undefined ? {} : { failure: record.failure }),
  }
}

function rolloutView(id: DeploymentRolloutId, record: DeploymentRolloutRecord): DeploymentRollout {
  return {
    id, argv: [...record.argv], timeoutMs: record.timeoutMs, batchSize: record.batchSize,
    status: record.status, createdBy: record.createdBy, createdAt: record.createdAt, revision: record.revision,
    ...(record.drainArgv === undefined ? {} : { drainArgv: [...record.drainArgv] }),
    ...(record.verifyArgv === undefined ? {} : { verifyArgv: [...record.verifyArgv] }),
    ...(record.rollbackArgv === undefined ? {} : { rollbackArgv: [...record.rollbackArgv] }),
    ...(record.restoreArgv === undefined ? {} : { restoreArgv: [...record.restoreArgv] }),
    targets: record.targets.map(target => ({
      targetId: DeploymentTargetId(target.targetId), targetRevision: target.targetRevision,
      environment: target.environment, status: target.status, steps: target.steps.map(stepView),
      ...(target.startedAt === undefined ? {} : { startedAt: target.startedAt }),
      ...(target.finishedAt === undefined ? {} : { finishedAt: target.finishedAt }),
      ...(target.exitCode === undefined ? {} : { exitCode: target.exitCode }),
      ...(target.output === undefined ? {} : { output: target.output }),
      ...(target.failure === undefined ? {} : { failure: target.failure }),
    })),
    ...(record.approvedBy === undefined ? {} : { approvedBy: record.approvedBy }),
    ...(record.approvedAt === undefined ? {} : { approvedAt: record.approvedAt }),
    ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt }),
    ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
  }
}

function stepView(step: DeploymentRolloutRecord['targets'][number]['steps'][number]): DeploymentRolloutStep {
  return {
    phase: step.phase, status: step.status, startedAt: step.startedAt, finishedAt: step.finishedAt,
    ...(step.exitCode === undefined ? {} : { exitCode: step.exitCode }),
    ...(step.output === undefined ? {} : { output: step.output }),
    ...(step.failure === undefined ? {} : { failure: step.failure }),
  }
}

function grantKey(targetId: DeploymentTargetId, userId: UserId): string { return `${targetId}\0${userId}` }

function grantView(record: DeploymentTargetGrantRecord): DeploymentTargetGrant {
  return {
    targetId: DeploymentTargetId(record.targetId), userId: record.userId as UserId,
    permission: record.permission, revision: record.revision, createdAt: record.createdAt, updatedAt: record.updatedAt,
  }
}

function view(id: DeploymentTargetId, record: DeploymentTargetRecord): DeploymentTarget {
  return {
    id,
    name: record.name,
    environment: record.environment,
    transport: record.transport,
    workspace: record.workspace,
    enabled: record.enabled,
    labels: { ...record.labels },
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.host === undefined ? {} : { host: record.host }),
    ...(record.port === undefined ? {} : { port: record.port }),
    ...(record.username === undefined ? {} : { username: record.username }),
    ...(record.hostKey === undefined ? {} : { hostKey: record.hostKey }),
    ...(record.identityCredential === undefined ? {} : { identityCredential: record.identityCredential }),
    ...(record.containerRuntime === undefined ? {} : { containerRuntime: record.containerRuntime }),
    ...(record.containerImage === undefined ? {} : { containerImage: record.containerImage }),
    ...(record.containerNetwork === undefined ? {} : { containerNetwork: record.containerNetwork }),
  }
}

export default DeploymentInventoryService
