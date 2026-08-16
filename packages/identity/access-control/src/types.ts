/** Authenticated identity and authorization types. @module @deepseek-ai/dsh-access-control/src/types */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Durable authenticated user identifier. */
export type UserId = Branded<'AccessUserId'>
/** Durable server-side session identifier. */
export type AccessSessionId = Branded<'AccessSessionId'>

/** Built-in roles. Authorization expands these into permissions server-side. */
export type AccessRole = 'admin' | 'operator' | 'developer' | 'viewer'
/** Operations enforced by Host consumers. */
export type AccessPermission = 'read' | 'operate' | 'configure' | 'administer'

/** Trusted request identity constructed from a verified server-side session. */
export interface AccessActor {
  readonly userId: UserId
  readonly username: string
  readonly roles: readonly AccessRole[]
  readonly sessionId: AccessSessionId
}

/** Public user projection; password hashes never leave the service. */
export interface AccessUserView {
  readonly id: UserId
  readonly username: string
  readonly roles: readonly AccessRole[]
  readonly disabled: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

/** Append-only security audit entry. */
export interface AccessAuditEntry {
  readonly id: string
  readonly at: string
  readonly action: string
  readonly outcome: 'success' | 'failure' | 'denied'
  readonly actorUserId?: UserId
  readonly subjectUserId?: UserId
  readonly clientAddress?: string
  readonly detail?: string
}

/** Trusted fields accepted when a product domain appends an audit entry. */
export type AccessAuditFields = Omit<AccessAuditEntry, 'id' | 'at' | 'action' | 'outcome'>
