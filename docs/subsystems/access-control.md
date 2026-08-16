# Access Control

English | [中文](access-control.zh.md)

[`dsh-access-control`](../../packages/identity/access-control/README.md) owns persistent local accounts, Argon2id credentials, server-side sessions, request-local actors, global role permission ceilings, authorization decisions, and security audit records. Transport authentication attaches a verified actor; Host consumers enforce the global ceiling and may narrow it with resource-specific grants before dispatch.

The public types and service methods below are generated from the owning package. Browser payloads do not carry trusted `AccessActor` or role values.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxaccesscontrol--accesscontrolservice"></a>

### `ctx.accessControl` — `AccessControlService`

Persistent access-control service.

```ts cordis-catalog
/**
 * Run an operation with a trusted request-local actor.
 * @param actor - Verified actor.
 * @param operation - Work to scope.
 * @returns The operation result.
 */
runAs<T>(actor: AccessActor, operation: () => T): T

/**
 * Current trusted actor.
 * @returns Actor or undefined outside an authenticated request.
 */
currentActor(): AccessActor | undefined

/**
 * Associate a verified actor with one transport request.
 * @param request - Transport-owned object.
 * @param actor - Verified actor.
 */
bindRequest(request: object, actor: AccessActor): void

/**
 * Retrieve an attached actor.
 * @param request - Transport-owned object.
 * @returns Attached actor, if any.
 */
actorForRequest(request: object): AccessActor | undefined

/**
 * Require a permission.
 * @param permission - Required operation permission.
 * @param detail - Audited operation label.
 * @returns The authorized actor.
 */
async authorize(permission: AccessPermission, detail?: string): Promise<AccessActor>

/**
 * Test whether an authenticated actor's global roles include a permission.
 * @param actor - Trusted actor.
 * @param permission - Required permission.
 * @returns Whether at least one role includes it.
 */
permits(actor: AccessActor, permission: AccessPermission): boolean

/**
 * Test whether one permission includes another in the built-in ordering.
 * @param ceiling - Granted maximum permission.
 * @param required - Requested operation permission.
 * @returns Whether the ceiling includes the request.
 */
permissionIncludes(ceiling: AccessPermission, required: AccessPermission): boolean

/**
 * Create a durable session.
 * @param username - Account name.
 * @param password - Plain credential to verify.
 * @param clientAddress - Audited client address.
 * @returns Cookie token and actor.
 */
async login(username: string, password: string, clientAddress?: string): Promise<{ token: string; actor: AccessActor }>

/**
 * Resolve and refresh a session.
 * @param token - Cookie token.
 * @returns Verified actor, or undefined.
 */
async authenticate(token: string): Promise<AccessActor | undefined>

/**
 * Revoke one session.
 * @param token - Cookie token.
 * @param clientAddress - Audited client address.
 * @returns Resolution after revocation and audit.
 */
async logout(token: string, clientAddress?: string): Promise<void>

/**
 * List users.
 * @returns Public user projections.
 */
@Remote('listUsers') async listUsers(): Promise<AccessUserView[]>

/**
 * Create a user.
 * @param username - Unique account name.
 * @param password - Initial password.
 * @param roles - Built-in roles.
 * @returns Created public projection.
 */
@Remote('createUser') async createUser(username: string, password: string, roles: readonly AccessRole[]): Promise<AccessUserView>

/**
 * Change disabled state.
 * @param userId - Subject user.
 * @param disabled - New disabled state.
 * @returns Resolution after persistence and audit.
 */
@Remote('setUserDisabled') async setUserDisabled(userId: UserIdBrand, disabled: boolean): Promise<void>

/**
 * Replace one user's built-in roles and revoke their active sessions.
 * @param userId - Subject user.
 * @param roles - Non-empty unique role set.
 * @returns Updated public projection.
 */
@Remote('setUserRoles') async setUserRoles(userId: UserIdBrand, roles: readonly AccessRole[]): Promise<AccessUserView>

/**
 * Read audit records.
 * @param limit - Maximum entries.
 * @returns Newest entries first.
 */
@Remote('recentAudit') async recentAudit(limit: number): Promise<AccessAuditEntry[]>

/**
 * Append a trusted product-domain audit event.
 * @param action - Stable operation name.
 * @param outcome - Operation outcome.
 * @param fields - Optional actor, subject, client, and detail facts.
 * @returns Resolution after durable append.
 */
async audit( action: string, outcome: AccessAuditEntry['outcome'], fields: AccessAuditFields = {}, ): Promise<void>
```

Source: [`packages/identity/access-control/src/index.ts:84`](../../packages/identity/access-control/src/index.ts)
<!-- END GENERATED cordis-surface -->
