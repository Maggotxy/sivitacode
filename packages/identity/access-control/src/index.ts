/** Persistent identity, server-side sessions, request actors, RBAC, and audit. @module @deepseek-ai/dsh-access-control */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Algorithm, hash, verify, Version } from '@node-rs/argon2'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { accessControlDomainSpec } from './spec.ts'
import type { AccessAuditEntry, AccessAuditFields, AccessActor, AccessPermission, AccessRole, AccessSessionId as AccessSessionIdBrand, AccessUserView, UserId as UserIdBrand } from './types.ts'
import type { AccessSessionRecord, AccessUserRecord } from './spec.ts'

export type { AccessAuditEntry, AccessAuditFields, AccessActor, AccessPermission, AccessRole, AccessUserView } from './types.ts'
/** Durable authenticated user identifier. */
export type UserId = UserIdBrand
/** Durable server-side session identifier. */
export type AccessSessionId = AccessSessionIdBrand
export { accessControlDomainSpec } from './spec.ts'

/**
 * Brand a raw string as a user identifier.
 * @param value - Raw id.
 * @returns Branded id.
 */
export const UserId = (value: string): UserIdBrand => value as UserIdBrand
/**
 * Brand a raw string as an access-session identifier.
 * @param value - Raw id.
 * @returns Branded id.
 */
export const AccessSessionId = (value: string): AccessSessionIdBrand => value as AccessSessionIdBrand

const ROLE_PERMISSIONS: Readonly<Record<AccessRole, ReadonlySet<AccessPermission>>> = {
  admin: new Set(['read', 'operate', 'configure', 'administer']),
  operator: new Set(['read', 'operate', 'configure']),
  developer: new Set(['read', 'operate']),
  viewer: new Set(['read']),
}
const PERMISSION_RANK: Readonly<Record<AccessPermission, number>> = {
  read: 0, operate: 1, configure: 2, administer: 3,
}

const USERNAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/
const PASSWORD_MIN_LENGTH = 12

/** Stable authorization failure. */
export class AccessDeniedError extends Error {
  /** Permission the actor lacked. */
  readonly permission: AccessPermission
  /** Stable machine-readable error code. */
  readonly code = 'ACCESS_DENIED' as const
  /** @param permission - Permission the actor lacked. */
  constructor(permission: AccessPermission) {
    super(`authenticated actor lacks '${permission}' permission`)
    this.name = 'AccessDeniedError'
    this.permission = permission
  }
}

/** Service configuration. */
export interface Config {
  /** Username used only to create the first administrator in an empty store. */
  bootstrapUsername?: string
  /** Password used only to create the first administrator in an empty store. */
  bootstrapPassword?: string
  /** Maximum inactivity before a session expires. */
  idleTimeoutMinutes?: number
  /** Maximum session lifetime from creation. */
  absoluteTimeoutHours?: number
}

export const Config: z<Config> = z.object({
  bootstrapUsername: z.string(),
  bootstrapPassword: z.string(),
  idleTimeoutMinutes: z.natural().min(1).default(60),
  absoluteTimeoutHours: z.natural().min(1).default(24),
})

declare module '@deepseek-ai/cordis' {
  interface Context { accessControl: AccessControlService }
}

/** Persistent access-control service. */
export class AccessControlService extends TypertRemoteService {
  static inject = ['storageDomain']
  static Config = Config

  private users?: KvTable<UserIdBrand, AccessUserRecord>
  private sessions?: KvTable<AccessSessionIdBrand, AccessSessionRecord>
  private auditTable?: KvTable<string, AccessAuditEntry>
  private readonly actors = new AsyncLocalStorage<AccessActor>()
  private readonly requestActors = new WeakMap<object, AccessActor>()

  constructor(ctx: Context, private readonly config: Config = {}) { super(ctx, 'accessControl') }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(accessControlDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'access-control.domainClose')
    this.users = domain.table('users')
    this.sessions = domain.table('sessions')
    this.auditTable = domain.table('audit') as KvTable<string, AccessAuditEntry>
    await this.bootstrap()
    await this.removeExpiredSessions()
  }

  /**
   * Run an operation with a trusted request-local actor.
   * @param actor - Verified actor.
   * @param operation - Work to scope.
   * @returns The operation result.
   */
  runAs<T>(actor: AccessActor, operation: () => T): T { return this.actors.run(actor, operation) }
  /**
   * Current trusted actor.
   * @returns Actor or undefined outside an authenticated request.
   */
  currentActor(): AccessActor | undefined { return this.actors.getStore() }
  /**
   * Associate a verified actor with one transport request.
   * @param request - Transport-owned object.
   * @param actor - Verified actor.
   */
  bindRequest(request: object, actor: AccessActor): void { this.requestActors.set(request, actor) }
  /**
   * Retrieve an attached actor.
   * @param request - Transport-owned object.
   * @returns Attached actor, if any.
   */
  actorForRequest(request: object): AccessActor | undefined { return this.requestActors.get(request) }

  /**
   * Require a permission.
   * @param permission - Required operation permission.
   * @param detail - Audited operation label.
   * @returns The authorized actor.
   */
  async authorize(permission: AccessPermission, detail?: string): Promise<AccessActor> {
    const actor = this.currentActor()
    if (actor !== undefined && actor.roles.some(role => ROLE_PERMISSIONS[role].has(permission))) return actor
    await this.recordAudit({ action: `authorize:${permission}`, outcome: 'denied', ...(actor === undefined ? {} : { actorUserId: actor.userId }), ...(detail === undefined ? {} : { detail }) })
    throw new AccessDeniedError(permission)
  }

  /**
   * Test whether an authenticated actor's global roles include a permission.
   * @param actor - Trusted actor.
   * @param permission - Required permission.
   * @returns Whether at least one role includes it.
   */
  permits(actor: AccessActor, permission: AccessPermission): boolean {
    return actor.roles.some(role => ROLE_PERMISSIONS[role].has(permission))
  }

  /**
   * Test whether one permission includes another in the built-in ordering.
   * @param ceiling - Granted maximum permission.
   * @param required - Requested operation permission.
   * @returns Whether the ceiling includes the request.
   */
  permissionIncludes(ceiling: AccessPermission, required: AccessPermission): boolean {
    return PERMISSION_RANK[ceiling] >= PERMISSION_RANK[required]
  }

  /**
   * Create a durable session.
   * @param username - Account name.
   * @param password - Plain credential to verify.
   * @param clientAddress - Audited client address.
   * @returns Cookie token and actor.
   */
  async login(username: string, password: string, clientAddress?: string): Promise<{ token: string; actor: AccessActor }> {
    const found = [...this.requireUsers().entries()].find(([, user]) => user.username === username)
    const valid = found !== undefined && !found[1].disabled && await verify(found[1].passwordHash, password)
    if (!valid) {
      await this.recordAudit({ action: 'login', outcome: 'failure', detail: username, ...(clientAddress === undefined ? {} : { clientAddress }) })
      throw new AccessDeniedError('read')
    }
    const [userId, user] = found
    const sessionId = AccessSessionId(randomUUID())
    const token = randomBytes(32).toString('base64url')
    const now = new Date()
    const absoluteHours = this.config.absoluteTimeoutHours ?? 24
    await this.requireSessions().put(sessionId, {
      userId,
      tokenHash: digestToken(token),
      sessionVersion: user.sessionVersion,
      createdAt: now.toISOString(),
      touchedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + absoluteHours * 3_600_000).toISOString(),
    })
    const actor = actorFrom(sessionId, userId, user)
    await this.recordAudit({ action: 'login', outcome: 'success', actorUserId: userId, ...(clientAddress === undefined ? {} : { clientAddress }) })
    return { token: `${sessionId}.${token}`, actor }
  }

  /**
   * Resolve and refresh a session.
   * @param token - Cookie token.
   * @returns Verified actor, or undefined.
   */
  async authenticate(token: string): Promise<AccessActor | undefined> {
    const split = token.indexOf('.')
    if (split < 1) return undefined
    const sessionId = AccessSessionId(token.slice(0, split))
    const secret = token.slice(split + 1)
    const session = this.requireSessions().get(sessionId)
    if (session === undefined || !safeEqualHex(session.tokenHash, digestToken(secret))) return undefined
    const userId = UserId(session.userId)
    const user = this.requireUsers().get(userId)
    const now = Date.now()
    const idleMs = (this.config.idleTimeoutMinutes ?? 60) * 60_000
    if (user === undefined || user.disabled || user.sessionVersion !== session.sessionVersion
      || Date.parse(session.expiresAt) <= now || now - Date.parse(session.touchedAt) > idleMs) {
      await this.requireSessions().delete(sessionId)
      return undefined
    }
    await this.requireSessions().update(sessionId, current => ({ ...current, touchedAt: new Date(now).toISOString() }))
    return actorFrom(sessionId, userId, user)
  }

  /**
   * Revoke one session.
   * @param token - Cookie token.
   * @param clientAddress - Audited client address.
   * @returns Resolution after revocation and audit.
   */
  async logout(token: string, clientAddress?: string): Promise<void> {
    const sessionId = AccessSessionId(token.split('.', 1)[0] ?? '')
    const session = this.requireSessions().get(sessionId)
    await this.requireSessions().delete(sessionId)
    await this.recordAudit({ action: 'logout', outcome: 'success', ...(session === undefined ? {} : { actorUserId: UserId(session.userId) }), ...(clientAddress === undefined ? {} : { clientAddress }) })
  }

  /**
   * List users.
   * @returns Public user projections.
   */
  @Remote('listUsers')
  async listUsers(): Promise<AccessUserView[]> {
    await this.authorize('administer', 'list users')
    return [...this.requireUsers().entries()].map(([id, user]) => viewUser(id, user))
      .sort((left, right) => left.username.localeCompare(right.username))
  }

  /**
   * Create a user.
   * @param username - Unique account name.
   * @param password - Initial password.
   * @param roles - Built-in roles.
   * @returns Created public projection.
   */
  @Remote('createUser')
  async createUser(username: string, password: string, roles: readonly AccessRole[]): Promise<AccessUserView> {
    const actor = await this.authorize('administer', `create user ${username}`)
    validateCredentialInput(username, password, roles)
    if ([...this.requireUsers().entries()].some(([, user]) => user.username === username)) throw new Error(`username '${username}' already exists`)
    const id = UserId(randomUUID())
    const at = new Date().toISOString()
    const record: AccessUserRecord = {
      username, passwordHash: await passwordHash(password), roles: [...roles], disabled: false,
      sessionVersion: 0, createdAt: at, updatedAt: at,
    }
    await this.requireUsers().put(id, record)
    await this.recordAudit({ action: 'user.create', outcome: 'success', actorUserId: actor.userId, subjectUserId: id })
    return viewUser(id, record)
  }

  /**
   * Change disabled state.
   * @param userId - Subject user.
   * @param disabled - New disabled state.
   * @returns Resolution after persistence and audit.
   */
  @Remote('setUserDisabled')
  async setUserDisabled(userId: UserIdBrand, disabled: boolean): Promise<void> {
    const actor = await this.authorize('administer', `${disabled ? 'disable' : 'enable'} user ${userId}`)
    const current = this.requireUsers().get(userId)
    if (current === undefined) throw new Error(`user '${userId}' was not found`)
    if (disabled && !current.disabled && current.roles.includes('admin') && this.enabledAdminCount() === 1) {
      await this.recordAudit({ action: 'user.disable', outcome: 'denied', actorUserId: actor.userId, subjectUserId: userId, detail: 'last enabled administrator' })
      throw new Error('access-control: cannot disable the last enabled administrator')
    }
    await this.requireUsers().update(userId, user => ({
      ...user, disabled, sessionVersion: user.sessionVersion + 1, updatedAt: new Date().toISOString(),
    }))
    await this.recordAudit({ action: disabled ? 'user.disable' : 'user.enable', outcome: 'success', actorUserId: actor.userId, subjectUserId: userId })
  }

  /**
   * Replace one user's built-in roles and revoke their active sessions.
   * @param userId - Subject user.
   * @param roles - Non-empty unique role set.
   * @returns Updated public projection.
   */
  @Remote('setUserRoles')
  async setUserRoles(userId: UserIdBrand, roles: readonly AccessRole[]): Promise<AccessUserView> {
    const actor = await this.authorize('administer', `set roles for user ${userId}`)
    validateRoles(roles)
    const current = this.requireUsers().get(userId)
    if (current === undefined) throw new Error(`user '${userId}' was not found`)
    if (!current.disabled && current.roles.includes('admin') && !roles.includes('admin') && this.enabledAdminCount() === 1) {
      await this.recordAudit({ action: 'user.roles', outcome: 'denied', actorUserId: actor.userId, subjectUserId: userId, detail: 'last enabled administrator' })
      throw new Error('access-control: cannot demote the last enabled administrator')
    }
    const updated: AccessUserRecord = {
      ...current, roles: [...roles], sessionVersion: current.sessionVersion + 1, updatedAt: new Date().toISOString(),
    }
    await this.requireUsers().put(userId, updated)
    await this.recordAudit({ action: 'user.roles', outcome: 'success', actorUserId: actor.userId, subjectUserId: userId, detail: roles.join(',') })
    return viewUser(userId, updated)
  }

  /**
   * Read audit records.
   * @param limit - Maximum entries.
   * @returns Newest entries first.
   */
  @Remote('recentAudit')
  async recentAudit(limit: number): Promise<AccessAuditEntry[]> {
    await this.authorize('administer', 'read security audit')
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new Error('access-control: audit limit must be an integer from 1 to 1000')
    }
    return [...this.requireAudit().entries()].map(([, entry]) => entry)
      .sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
  }

  /**
   * Append a trusted product-domain audit event.
   * @param action - Stable operation name.
   * @param outcome - Operation outcome.
   * @param fields - Optional actor, subject, client, and detail facts.
   * @returns Resolution after durable append.
   */
  async audit(
    action: string,
    outcome: AccessAuditEntry['outcome'],
    fields: AccessAuditFields = {},
  ): Promise<void> {
    if (action.length === 0 || action.length > 128) throw new Error('access-control: audit action must contain 1 to 128 characters')
    await this.recordAudit({ action, outcome, ...fields })
  }

  private async bootstrap(): Promise<void> {
    if (this.requireUsers().size > 0) return
    const username = this.config.bootstrapUsername
    const password = this.config.bootstrapPassword
    if (username === undefined || password === undefined) {
      throw new Error('access-control: first startup requires bootstrapUsername and bootstrapPassword')
    }
    validateCredentialInput(username, password, ['admin'])
    const id = UserId(randomUUID())
    const at = new Date().toISOString()
    await this.requireUsers().put(id, {
      username, passwordHash: await passwordHash(password), roles: ['admin'], disabled: false,
      sessionVersion: 0, createdAt: at, updatedAt: at,
    })
    await this.recordAudit({ action: 'bootstrap', outcome: 'success', subjectUserId: id })
  }

  private async removeExpiredSessions(): Promise<void> {
    const now = Date.now()
    for (const [id, session] of this.requireSessions().entries()) {
      if (Date.parse(session.expiresAt) <= now) await this.requireSessions().delete(id)
    }
  }

  private async recordAudit(entry: Omit<AccessAuditEntry, 'id' | 'at'>): Promise<void> {
    const id = randomUUID()
    await this.requireAudit().put(id, { id, at: new Date().toISOString(), ...entry })
  }
  private requireUsers(): KvTable<UserIdBrand, AccessUserRecord> {
    if (this.users === undefined) throw new Error('access-control is not initialized')
    return this.users
  }
  private requireSessions(): KvTable<AccessSessionIdBrand, AccessSessionRecord> {
    if (this.sessions === undefined) throw new Error('access-control is not initialized')
    return this.sessions
  }
  private requireAudit(): KvTable<string, AccessAuditEntry> {
    if (this.auditTable === undefined) throw new Error('access-control is not initialized')
    return this.auditTable
  }
  private enabledAdminCount(): number {
    return [...this.requireUsers().entries()].filter(([, user]) => !user.disabled && user.roles.includes('admin')).length
  }
}

function actorFrom(sessionId: AccessSessionIdBrand, userId: UserIdBrand, user: AccessUserRecord): AccessActor {
  return { userId, username: user.username, roles: [...user.roles], sessionId }
}
function viewUser(id: UserIdBrand, user: AccessUserRecord): AccessUserView {
  return {
    id, username: user.username, roles: [...user.roles], disabled: user.disabled,
    createdAt: user.createdAt, updatedAt: user.updatedAt,
  }
}
function digestToken(token: string): string { return createHash('sha256').update(token).digest('hex') }
function safeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
async function passwordHash(password: string): Promise<string> {
  return hash(password, {
    algorithm: Algorithm.Argon2id, version: Version.V0x13, memoryCost: 19_456,
    timeCost: 2, parallelism: 1, outputLen: 32,
  })
}
function validateCredentialInput(username: string, password: string, roles: readonly AccessRole[]): void {
  if (!USERNAME.test(username)) throw new Error('username must be 3-64 characters using letters, numbers, dot, underscore, or hyphen')
  if (password.length < PASSWORD_MIN_LENGTH) throw new Error(`password must contain at least ${PASSWORD_MIN_LENGTH} characters`)
  validateRoles(roles)
}
function validateRoles(roles: readonly AccessRole[]): void {
  if (roles.length === 0 || new Set(roles).size !== roles.length) throw new Error('roles must be non-empty and unique')
}

export default AccessControlService
