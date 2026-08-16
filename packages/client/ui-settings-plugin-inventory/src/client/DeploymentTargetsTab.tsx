/* oxlint-disable @stylistic/max-len, typescript/use-unknown-in-catch-callback-variable -- compact JSX keeps each administrative action beside its control; every rejection is normalized by handleError. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { AccessPermission, AccessUserView, DeploymentPlan, DeploymentPlanId, DeploymentRollout, DeploymentRolloutCreate, DeploymentRolloutId, DeploymentTarget, DeploymentTargetCreate, DeploymentTargetGrant, DeploymentTargetHealth, DeploymentTargetId, DeploymentWorktree, DeploymentWorktreeCreate, UserId } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DeploymentTargetsTab.module.css'

/** Remote operations used by the deployment target page. */
export interface DeploymentTargetsInjected {
  list: () => Promise<DeploymentTarget[]>
  create: (input: DeploymentTargetCreate) => Promise<DeploymentTarget>
  delete: (id: DeploymentTargetId, revision: number) => Promise<void>
  checkHealth: (id: DeploymentTargetId) => Promise<DeploymentTargetHealth>
  listPlans: () => Promise<DeploymentPlan[]>
  createPlan: (targetId: DeploymentTargetId, argv: readonly string[]) => Promise<DeploymentPlan>
  approvePlan: (id: DeploymentPlanId, revision: number) => Promise<DeploymentPlan>
  executePlan: (id: DeploymentPlanId, revision: number) => Promise<DeploymentPlan>
  listRollouts: () => Promise<DeploymentRollout[]>
  createRollout: (input: DeploymentRolloutCreate) => Promise<DeploymentRollout>
  approveRollout: (id: DeploymentRolloutId, revision: number) => Promise<DeploymentRollout>
  executeRollout: (id: DeploymentRolloutId, revision: number) => Promise<DeploymentRollout>
  recoverRollout: (id: DeploymentRolloutId, revision: number) => Promise<DeploymentRollout>
  listWorktrees: (targetId: DeploymentTargetId) => Promise<DeploymentWorktree[]>
  createWorktree: (input: DeploymentWorktreeCreate) => Promise<DeploymentWorktree>
  removeWorktree: (targetId: DeploymentTargetId, path: string) => Promise<void>
  listUsers: () => Promise<AccessUserView[]>
  listGrants: (targetId: DeploymentTargetId) => Promise<DeploymentTargetGrant[]>
  setGrant: (targetId: DeploymentTargetId, userId: UserId, permission: AccessPermission | undefined, revision?: number) => Promise<DeploymentTargetGrant | undefined>
  openSession: (target: DeploymentTarget) => Promise<void>
  openWorktreeSession: (target: DeploymentTarget, path: string) => Promise<void>
}

/** Props assembled by the Settings slot renderer. */
export type DeploymentTargetsTabProps = PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<DeploymentTargetsInjected>

const EMPTY: DeploymentTargetCreate = {
  name: '', environment: 'development', transport: 'local', workspace: '', enabled: true, labels: {},
}

/** Manage non-secret local and pinned-SSH deployment targets. */
export function DeploymentTargetsTab({ list, create, delete: remove, checkHealth, listPlans, createPlan, approvePlan, executePlan, listRollouts, createRollout, approveRollout, executeRollout, recoverRollout, listWorktrees, createWorktree, removeWorktree, listUsers, listGrants, setGrant, openSession, openWorktreeSession, t }: DeploymentTargetsTabProps): ReactNode {
  const [targets, setTargets] = useState<DeploymentTarget[]>([])
  const [draft, setDraft] = useState<DeploymentTargetCreate>(EMPTY)
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [error, setError] = useState('')
  const [health, setHealth] = useState<Readonly<Record<string, DeploymentTargetHealth>>>({})
  const [plans, setPlans] = useState<DeploymentPlan[]>([])
  const [rollouts, setRollouts] = useState<DeploymentRollout[]>([])
  const [rolloutTargets, setRolloutTargets] = useState<string[]>([])
  const [rolloutCandidate, setRolloutCandidate] = useState('')
  const [rolloutCommand, setRolloutCommand] = useState('')
  const [rolloutDrain, setRolloutDrain] = useState('')
  const [rolloutVerify, setRolloutVerify] = useState('')
  const [rolloutRollback, setRolloutRollback] = useState('')
  const [rolloutRestore, setRolloutRestore] = useState('')
  const [rolloutBatchSize, setRolloutBatchSize] = useState(1)
  const [planTarget, setPlanTarget] = useState('')
  const [planCommand, setPlanCommand] = useState('')
  const [worktreeTarget, setWorktreeTarget] = useState('')
  const [worktreeBranch, setWorktreeBranch] = useState('')
  const [worktrees, setWorktrees] = useState<DeploymentWorktree[]>([])
  const [users, setUsers] = useState<AccessUserView[]>([])
  const [grantTarget, setGrantTarget] = useState('')
  const [grants, setGrants] = useState<DeploymentTargetGrant[]>([])
  const [grantUser, setGrantUser] = useState('')
  const [grantPermission, setGrantPermission] = useState<AccessPermission>('read')

  const refresh = (): void => {
    setStatus('loading')
    void Promise.all([list(), listPlans(), listRollouts()]).then(([value, nextPlans, nextRollouts]) => { setTargets(value); setPlans(nextPlans); setRollouts(nextRollouts); setStatus('ready') }, (cause) => {
      setError(cause instanceof Error ? cause.message : String(cause)); setStatus('error')
    })
    void listUsers().then(setUsers, () => { setUsers([]) })
  }
  useEffect(refresh, [list])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    setStatus('saving')
    void create(draft).then(() => {
      setDraft(EMPTY)
      refresh()
    }, (cause) => {
      setError(cause instanceof Error ? cause.message : String(cause)); setStatus('error')
    })
  }

  return <div className={css.section} aria-busy={status === 'loading' || status === 'saving'}>
    <div className={css.heading}><div><h3>{t('targets.title')}</h3><p>{t('targets.description')}</p></div><button type="button" onClick={refresh}>{t('retry')}</button></div>
    {status === 'error' ? <p className={css.error} role="alert">{error}</p> : null}
    <ul className={css.targets}>
      {targets.map(target => <li key={target.id}>
        <div><strong>{target.name}</strong><span>{target.environment} · {target.transport} · {target.workspace}</span>{target.transport === 'ssh' ? <code>{target.username}@{target.host}:{target.port ?? 22}</code> : null}</div>
        <div className={css.actions}>{health[target.id] ? <span data-health={health[target.id]?.status}>{health[target.id]?.status} · {health[target.id]?.latencyMs}ms</span> : null}<button type="button" onClick={() => { void openSession(target).catch((cause) => { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('error') }) }}>{t('targets.open')}</button><button type="button" onClick={() => { void checkHealth(target.id).then((result) => { setHealth(current => ({ ...current, [target.id]: result })) }, (cause) => { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('error') }) }}>{t('targets.health')}</button><button type="button" onClick={() => { void remove(target.id, target.revision).then(refresh, (cause) => { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('error') }) }}>{t('targets.delete')}</button></div>
      </li>)}
    </ul>
    {status === 'ready' && targets.length === 0 ? <p className={css.empty}>{t('targets.empty')}</p> : null}
    <form className={css.form} onSubmit={submit}>
      <h3>{t('targets.add')}</h3>
      <label>{t('targets.name')}<input required value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.currentTarget.value }) }} /></label>
      <div className={css.row}>
        <label>{t('targets.environment')}<select value={draft.environment} onChange={(event) => { setDraft({ ...draft, environment: event.currentTarget.value as DeploymentTargetCreate['environment'] }) }}><option value="development">development</option><option value="staging">staging</option><option value="production">production</option></select></label>
        <label>{t('targets.transport')}<select value={draft.transport} onChange={(event) => { const transport = event.currentTarget.value as 'local' | 'ssh' | 'container'; setDraft(transport === 'local' ? { ...EMPTY, name: draft.name, environment: draft.environment, workspace: draft.workspace } : transport === 'container' ? { ...EMPTY, name: draft.name, environment: draft.environment, workspace: draft.workspace, transport, containerRuntime: 'podman', containerImage: '', containerNetwork: 'none' } : { ...EMPTY, name: draft.name, environment: draft.environment, workspace: draft.workspace, transport }) }}><option value="local">local</option><option value="ssh">ssh</option><option value="container">container</option></select></label>
      </div>
      <label>{t('targets.workspace')}<input required placeholder="/srv/project" value={draft.workspace} onChange={(event) => { setDraft({ ...draft, workspace: event.currentTarget.value }) }} /></label>
      {draft.transport === 'ssh' ? <>
        <div className={css.row}><label>{t('targets.host')}<input required value={draft.host ?? ''} onChange={(event) => { setDraft({ ...draft, host: event.currentTarget.value }) }} /></label><label>{t('targets.user')}<input required value={draft.username ?? ''} onChange={(event) => { setDraft({ ...draft, username: event.currentTarget.value }) }} /></label></div>
        <label>{t('targets.hostKey')}<textarea required placeholder="ssh-ed25519 AAAA…" value={draft.hostKey ?? ''} onChange={(event) => { setDraft({ ...draft, hostKey: event.currentTarget.value }) }} /></label>
        <label>{t('targets.credential')}<input value={draft.identityCredential ?? ''} onChange={(event) => { const value = event.currentTarget.value; const { identityCredential: _discarded, ...rest } = draft; setDraft(value === '' ? rest : { ...rest, identityCredential: value }) }} /></label>
      </> : null}
      {draft.transport === 'container' ? <>
        <div className={css.row}><label>{t('targets.runtime')}<select value={draft.containerRuntime} onChange={(event) => { setDraft({ ...draft, containerRuntime: event.currentTarget.value as 'docker' | 'podman' }) }}><option value="podman">podman</option><option value="docker">docker</option></select></label><label>{t('targets.network')}<select value={draft.containerNetwork} onChange={(event) => { setDraft({ ...draft, containerNetwork: event.currentTarget.value as 'none' | 'host' }) }}><option value="none">none</option><option value="host">host</option></select></label></div>
        <label>{t('targets.image')}<input required placeholder="ubuntu@sha256:…" value={draft.containerImage ?? ''} onChange={(event) => { setDraft({ ...draft, containerImage: event.currentTarget.value }) }} /></label>
      </> : null}
      <button className={css.primary} type="submit" disabled={status === 'saving'}>{t('targets.save')}</button>
    </form>
    <form className={css.form} onSubmit={(event) => { event.preventDefault(); const target = targets.find(item => item.id === planTarget); if (target === undefined) return; void createPlan(target.id, parseCommand(planCommand)).then(() => { setPlanCommand(''); refresh() }, (cause) => { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('error') }) }}>
      <h3>{t('plans.title')}</h3>
      <label>{t('plans.target')}<select required value={planTarget} onChange={(event) => { setPlanTarget(event.currentTarget.value) }}><option value="">—</option>{targets.map(target => <option key={target.id} value={target.id}>{target.name} · {target.environment}</option>)}</select></label>
      <label>{t('plans.command')}<input required value={planCommand} placeholder={'["pnpm","deploy"]'} onChange={(event) => { setPlanCommand(event.currentTarget.value) }} /></label>
      <button className={css.primary} type="submit">{t('plans.create')}</button>
    </form>
    <ul className={css.targets}>{plans.map(plan => <li key={plan.id}><div><strong>{plan.status} · {plan.environment}</strong><code>{plan.argv.join(' ')}</code><span>{plan.createdBy}{plan.approvedBy ? ` → ${plan.approvedBy}` : ''}</span></div><div className={css.actions}>{plan.status === 'pending-approval' ? <button type="button" onClick={() => { void approvePlan(plan.id, plan.revision).then(refresh, (cause) => { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('error') }) }}>{t('plans.approve')}</button> : null}{plan.status === 'ready' ? <button type="button" onClick={() => { void executePlan(plan.id, plan.revision).then(refresh, (cause) => { setError(cause instanceof Error ? cause.message : String(cause)); setStatus('error') }) }}>{t('plans.execute')}</button> : null}</div></li>)}</ul>
    <form className={css.form} onSubmit={(event) => { event.preventDefault(); void createRollout({ targetIds: rolloutTargets as DeploymentTargetId[], argv: parseCommand(rolloutCommand), batchSize: rolloutBatchSize, ...optionalCommand('drainArgv', rolloutDrain), ...optionalCommand('verifyArgv', rolloutVerify), ...optionalCommand('rollbackArgv', rolloutRollback), ...optionalCommand('restoreArgv', rolloutRestore) }).then(() => { setRolloutCommand(''); setRolloutDrain(''); setRolloutVerify(''); setRolloutRollback(''); setRolloutRestore(''); setRolloutTargets([]); refresh() }, handleError) }}>
      <h3>{t('rollouts.title')}</h3>
      <label>{t('rollouts.targets')}<div className={css.targetPicker}><select value={rolloutCandidate} onChange={(event) => { setRolloutCandidate(event.currentTarget.value) }}><option value="">—</option>{targets.filter(target => !rolloutTargets.includes(target.id)).map(target => <option key={target.id} value={target.id}>{target.name} · {target.environment}</option>)}</select><button type="button" disabled={rolloutCandidate === ''} onClick={() => { setRolloutTargets(current => [...current, rolloutCandidate]); setRolloutCandidate('') }}>{t('rollouts.add')}</button></div></label>
      <ol className={css.rolloutOrder}>{rolloutTargets.map((id, index) => { const target = targets.find(item => item.id === id); return <li key={id}><span>{String(index + 1)}. {target?.name ?? id} · {target?.environment}</span><div><button type="button" disabled={index === 0} aria-label={`${t('rollouts.up')} ${target?.name ?? id}`} onClick={() => { setRolloutTargets(moveItem(rolloutTargets, index, index - 1)) }}>↑</button><button type="button" disabled={index === rolloutTargets.length - 1} aria-label={`${t('rollouts.down')} ${target?.name ?? id}`} onClick={() => { setRolloutTargets(moveItem(rolloutTargets, index, index + 1)) }}>↓</button><button type="button" aria-label={`${t('rollouts.remove')} ${target?.name ?? id}`} onClick={() => { setRolloutTargets(rolloutTargets.filter(item => item !== id)) }}>×</button></div></li> })}</ol>
      <div className={css.row}><label>{t('rollouts.command')}<input required value={rolloutCommand} placeholder={'["pnpm","deploy"]'} onChange={(event) => { setRolloutCommand(event.currentTarget.value) }} /></label><label>{t('rollouts.batch')}<input type="number" min="1" max="16" value={rolloutBatchSize} onChange={(event) => { setRolloutBatchSize(event.currentTarget.valueAsNumber) }} /></label></div>
      <div className={css.row}><label>{t('rollouts.drain')}<input value={rolloutDrain} placeholder={'["lbctl","drain"]'} onChange={(event) => { setRolloutDrain(event.currentTarget.value) }} /></label><label>{t('rollouts.restore')}<input value={rolloutRestore} placeholder={'["lbctl","enable"]'} onChange={(event) => { setRolloutRestore(event.currentTarget.value) }} /></label></div>
      <div className={css.row}><label>{t('rollouts.verify')}<input value={rolloutVerify} placeholder={'["curl","--fail","http://127.0.0.1/health"]'} onChange={(event) => { setRolloutVerify(event.currentTarget.value) }} /></label><label>{t('rollouts.rollback')}<input value={rolloutRollback} placeholder={'["./rollback"]'} onChange={(event) => { setRolloutRollback(event.currentTarget.value) }} /></label></div>
      <button className={css.primary} type="submit" disabled={rolloutTargets.length < 2}>{t('rollouts.create')}</button>
    </form>
    <ul className={css.targets}>{rollouts.map(rollout => <li key={rollout.id}><div><strong>{rollout.status} · {rollout.targets.length} {t('rollouts.nodes')}</strong><code>{rollout.argv.join(' ')}</code><span>{t('rollouts.batch')} {rollout.batchSize} · {rollout.targets.map(target => `${target.status}[${target.steps.map(step => step.phase).join(',')}]`).join(' → ')}</span></div><div className={css.actions}>{rollout.status === 'pending-approval' ? <button type="button" onClick={() => { void approveRollout(rollout.id, rollout.revision).then(refresh, handleError) }}>{t('plans.approve')}</button> : null}{rollout.status === 'ready' ? <button type="button" onClick={() => { void executeRollout(rollout.id, rollout.revision).then(refresh, handleError) }}>{t('plans.execute')}</button> : null}{rollout.status === 'recovery-required' ? <button type="button" onClick={() => { void recoverRollout(rollout.id, rollout.revision).then(refresh, handleError) }}>{t('rollouts.recover')}</button> : null}</div></li>)}</ul>
    <form className={css.form} onSubmit={(event) => { event.preventDefault(); const target = targets.find(item => item.id === worktreeTarget); if (target === undefined) return; void createWorktree({ targetId: target.id, branch: worktreeBranch, createBranch: true }).then(async () => { setWorktreeBranch(''); setWorktrees(await listWorktrees(target.id)) }, handleError) }}>
      <h3>{t('worktrees.title')}</h3>
      <label>{t('worktrees.target')}<select required value={worktreeTarget} onChange={(event) => { const id = event.currentTarget.value; setWorktreeTarget(id); setWorktrees([]); const target = targets.find(item => item.id === id); if (target !== undefined) void listWorktrees(target.id).then(setWorktrees, handleError) }}><option value="">—</option>{targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>
      <label>{t('worktrees.branch')}<input required value={worktreeBranch} placeholder="feature/my-change" onChange={(event) => { setWorktreeBranch(event.currentTarget.value) }} /></label>
      <button className={css.primary} type="submit">{t('worktrees.create')}</button>
    </form>
    <ul className={css.targets}>{worktrees.map(worktree => <li key={worktree.path}><div><strong>{worktree.branch ?? t('worktrees.detached')}</strong><code>{worktree.path}</code><span>{worktree.head.slice(0, 12)}{worktree.locked ? ` · ${t('worktrees.locked')}` : ''}</span></div><div className={css.actions}>{worktreeTarget !== '' ? <button type="button" onClick={() => { const target = targets.find(item => item.id === worktreeTarget); if (target !== undefined) void openWorktreeSession(target, worktree.path).catch(handleError) }}>{t('worktrees.open')}</button> : null}{worktreeTarget !== '' && worktree.path.includes('/.sivitacode/worktrees/') ? <button type="button" onClick={() => { const target = targets.find(item => item.id === worktreeTarget); if (target !== undefined) void removeWorktree(target.id, worktree.path).then(() => listWorktrees(target.id)).then(setWorktrees, handleError) }}>{t('worktrees.remove')}</button> : null}</div></li>)}</ul>
    <form className={css.form} onSubmit={(event) => { event.preventDefault(); const target = targets.find(item => item.id === grantTarget); const user = users.find(item => item.id === grantUser); if (target === undefined || user === undefined) return; const existing = grants.find(item => item.userId === user.id); void setGrant(target.id, user.id, grantPermission, existing?.revision).then(async () => { setGrants(await listGrants(target.id)) }, handleError) }}>
      <h3>{t('grants.title')}</h3>
      <label>{t('grants.target')}<select required value={grantTarget} onChange={(event) => { const id = event.currentTarget.value; setGrantTarget(id); setGrants([]); const target = targets.find(item => item.id === id); if (target !== undefined) void listGrants(target.id).then(setGrants, handleError) }}><option value="">—</option>{targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</select></label>
      <div className={css.row}><label>{t('grants.user')}<select required value={grantUser} onChange={(event) => { setGrantUser(event.currentTarget.value) }}><option value="">—</option>{users.map(user => <option key={user.id} value={user.id}>{user.username}</option>)}</select></label><label>{t('grants.permission')}<select value={grantPermission} onChange={(event) => { setGrantPermission(event.currentTarget.value as AccessPermission) }}><option value="read">read</option><option value="operate">operate</option><option value="configure">configure</option><option value="administer">administer</option></select></label></div>
      <button className={css.primary} type="submit">{t('grants.save')}</button>
    </form>
    <ul className={css.targets}>{grants.map((grant) => { const user = users.find(item => item.id === grant.userId); return <li key={grant.userId}><div><strong>{user?.username ?? grant.userId}</strong><span>{grant.permission}</span></div><div className={css.actions}><button type="button" onClick={() => { const target = targets.find(item => item.id === grant.targetId); if (target !== undefined) void setGrant(target.id, grant.userId, undefined, grant.revision).then(async () => { setGrants(await listGrants(target.id)) }, handleError) }}>{t('grants.remove')}</button></div></li> })}</ul>
  </div>

  function handleError(cause: unknown): void {
    setError(cause instanceof Error ? cause.message : String(cause))
    setStatus('error')
  }
}

function parseCommand(value: string): string[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(item => typeof item === 'string')) {
    throw new Error('command must be a non-empty JSON string array')
  }
  return parsed
}

function optionalCommand<K extends 'drainArgv' | 'verifyArgv' | 'rollbackArgv' | 'restoreArgv'>(key: K, value: string): { [P in K]?: string[] } {
  return value.trim() === '' ? {} : { [key]: parseCommand(value) } as { [P in K]?: string[] }
}

function moveItem(values: readonly string[], from: number, to: number): string[] {
  const result = [...values]
  const value = result[from]
  if (value === undefined) return result
  result.splice(from, 1)
  result.splice(to, 0, value)
  return result
}
