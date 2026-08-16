/* oxlint-disable @stylistic/max-len -- compact administrative JSX keeps each authorized action beside its subject. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { AccessAuditEntry, AccessRole, AccessUserView, UserId } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DeploymentTargetsTab.module.css'

/** Authorized identity and audit operations used by the administrator page. */
export interface AccessControlInjected {
  listUsers: () => Promise<AccessUserView[]>
  createUser: (username: string, password: string, roles: readonly AccessRole[]) => Promise<AccessUserView>
  setUserDisabled: (id: UserId, disabled: boolean) => Promise<void>
  setUserRoles: (id: UserId, roles: readonly AccessRole[]) => Promise<AccessUserView>
  recentAudit: (limit: number) => Promise<AccessAuditEntry[]>
}

/** Props assembled by the Settings slot renderer. */
export type AccessControlTabProps = PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<AccessControlInjected>

const ROLES: readonly AccessRole[] = ['viewer', 'developer', 'operator', 'admin']

/** Administer durable users, built-in roles, revocation, and security audit. */
export function AccessControlTab({ listUsers, createUser, setUserDisabled, setUserRoles, recentAudit, t }: AccessControlTabProps): ReactNode {
  const [users, setUsers] = useState<AccessUserView[]>([])
  const [audit, setAudit] = useState<AccessAuditEntry[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AccessRole>('viewer')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  const refresh = (): void => {
    setBusy(true)
    void Promise.all([listUsers(), recentAudit(100)]).then(([nextUsers, nextAudit]) => {
      setUsers(nextUsers); setAudit(nextAudit); setError(''); setBusy(false)
    }, fail)
  }
  useEffect(refresh, [listUsers])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    setBusy(true)
    void createUser(username, password, [role]).then(() => {
      setUsername(''); setPassword(''); setRole('viewer'); refresh()
    }, fail)
  }

  return <div className={css.section} aria-busy={busy}>
    <div className={css.heading}><div><h3>{t('access.title')}</h3><p>{t('access.description')}</p></div><button type="button" onClick={refresh}>{t('retry')}</button></div>
    {error !== '' ? <p className={css.error} role="alert">{error}</p> : null}
    <ul className={css.targets}>{users.map(user => <li key={user.id}>
      <div><strong>{user.username}</strong><span>{user.roles.join(', ')} · {user.disabled ? t('access.disabled') : t('access.enabled')}</span><code>{user.id}</code></div>
      <div className={css.actions}>
        <select aria-label={`${t('access.roles')}: ${user.username}`} value={user.roles.length === 1 ? user.roles[0] : ''} onChange={(event) => { const selected = event.currentTarget.value as AccessRole; setBusy(true); void setUserRoles(user.id, [selected]).then(refresh, fail) }}><option value="" disabled>{user.roles.join(', ')}</option>{ROLES.map(value => <option key={value} value={value}>{value}</option>)}</select>
        <button type="button" onClick={() => { setBusy(true); void setUserDisabled(user.id, !user.disabled).then(refresh, fail) }}>{user.disabled ? t('access.enable') : t('access.disable')}</button>
      </div>
    </li>)}</ul>
    <form className={css.form} onSubmit={submit}>
      <h3>{t('access.add')}</h3>
      <div className={css.row}><label>{t('access.username')}<input required minLength={3} value={username} onChange={(event) => { setUsername(event.currentTarget.value) }} /></label><label>{t('access.role')}<select value={role} onChange={(event) => { setRole(event.currentTarget.value as AccessRole) }}>{ROLES.map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
      <label>{t('access.password')}<input required minLength={12} type="password" autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.currentTarget.value) }} /></label>
      <button className={css.primary} type="submit" disabled={busy}>{t('access.create')}</button>
    </form>
    <div className={css.form}><h3>{t('access.audit')}</h3><ul className={css.audit}>{audit.map(entry => <li key={entry.id}><time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time><strong>{entry.action}</strong><span>{entry.outcome}{entry.detail ? ` · ${entry.detail}` : ''}</span></li>)}</ul>{audit.length === 0 && !busy ? <p className={css.empty}>{t('access.auditEmpty')}</p> : null}</div>
  </div>

  function fail(cause: unknown): void {
    setError(cause instanceof Error ? cause.message : String(cause))
    setBusy(false)
  }
}
