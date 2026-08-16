/**
 * Automation-only Agent Client Protocol server over JSON-RPC stdio.
 *
 * The bridge exposes persistent harness sessions to trusted programmatic
 * clients. It carries persistent lifecycle, live text/reasoning/tool updates,
 * context usage, cancellation, and one-shot permission decisions; richer
 * presentation and human interaction stay with the harness's UI modules.
 *
 * @module @deepseek-ai/dsh-acp
 */

import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { Readable, Writable } from 'node:stream'
import Schema from '@deepseek-ai/schemastery'
import { createUserMessage, errorChain } from '@deepseek-ai/dsh-llm'
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type Agent as AcpAgent,
  type AuthenticateRequest,
  type CancelNotification,
  type InitializeRequest,
  type InitializeResponse,
  type ForkSessionRequest,
  type ForkSessionResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type LoadSessionRequest,
  type LoadSessionResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type CloseSessionRequest,
  type DeleteSessionRequest,
  type DeleteSessionResponse,
  type SessionNotification,
  type StopReason,
  type Stream,
} from '@agentclientprotocol/sdk'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent, type SessionHeader, type TurnEndReason } from '@deepseek-ai/dsh-session'
import { SessionQueryError, type SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { ExecutionTargetId, type ExecutionTargetId as ExecutionTargetIdValue } from '@deepseek-ai/dsh-execution-world'
// Side-effect type import: declaration-merges the approval waterfall answered below.
import type {} from '@deepseek-ai/dsh-user-approval'
import { acpPromptToText, promptHasUnsupportedContent, turnEndToStopReason } from './codec.ts'
import { paginateSessions } from './list-pagination.ts'
import {
  latestContextWindow,
  parseToolInput,
  safePresentCall,
  safePresentResult,
  streamBlockKey,
  toolCallFromView,
  toolResultFromEvent,
  toolResultFromView,
  usedTokens,
  type LiveToolCall,
} from './live-updates.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The ACP input stream closed and every Agent owned by that connection
     * reached its teardown settlement point. A teardown failure is logged
     * before this notification so a process host can still terminate.
     * @mode emit
     */
    'acp/closed'(): void
  }
}

export const name = 'acp'
/** ACP extension namespace advertised by SivitaCode and accepted in request metadata. */
export const SIVITACODE_ACP_META = 'sivitacode.dev'
/** The bridge owns live agents and reads the shared durable session corpus. */
export const inject = ['agents']

/**
 * The single continuable-subagent teardown the bridge needs. Declared
 * structurally so this package does not depend on the subagent seam for one
 * shutdown hook; an absent service means nothing continuable was materialized.
 */
interface ContinuableDrain {
  /**
   * Close admission below exact host-owned parents, then dispose only their
   * continuable descendants child-first.
   */
  drainContinuableDescendants(parents: readonly Agent[]): Promise<void>
}

/** Preserve invalid-parameter detail in the SDK wire error message. */
function invalidParams(detail: string): RequestError {
  return RequestError.invalidParams(undefined, detail)
}

/** Preserve failed-turn detail; plain handler errors become a generic wire internal error. */
function internalError(detail: string): RequestError {
  return RequestError.internalError(undefined, detail)
}

/** Plugin config: the provider/model selection used for each ACP-created agent. */
export interface AcpConfig {
  /** Provider route for created agents. */
  provider?: string
  /** Model name for created agents. */
  model?: string
  /** Exact execution-target ids trusted ACP clients may select; `*` explicitly permits every registered target. */
  executionTargets?: string[]
  /** Runtime-only transport override; production uses stdio. */
  stream?: Stream
}

export const Config: Schema<Omit<AcpConfig, 'stream'>> = Schema.object({
  provider: Schema.string(),
  model: Schema.string(),
  executionTargets: Schema.array(Schema.string()),
})

/** Per-session protocol state. */
interface SessionRecord {
  agent: Agent
  /** Exact owned-agent disposer; resolves after registry, loop, and session teardown. */
  dispose: () => Promise<void>
  /** In-flight prompt and its captured turn number for exact settlement. */
  inflight: {
    resolve: (reason: StopReason) => void
    reject: (error: Error) => void
    messageId: string
    turn: number | undefined
    /** The correlated turn's ending, set at turn/end and settled at whole-agent idle. */
    endReason: TurnEndReason | undefined
  } | undefined
  /** Blocks that already emitted at least one live delta, keyed by turn/step/index/type. */
  streamedBlocks: Set<string>
  /** Exact call-time presentation callbacks and parsed input retained through result settlement. */
  toolCalls: Map<string, LiveToolCall>
  /** Latest resolved model context capacity, when the adapter advertises one. */
  contextWindow: number | undefined
}


/**
 * Mount the automation-only ACP server.
 * @param ctx - Cordis context carrying the agent factory and session events.
 * @param config - Initial provider/model selection and optional test transport.
 */
export function apply(ctx: Context, config: AcpConfig): void {
  // ACP handlers execute outside this plugin's injection scope, so capture the
  // injected service during apply rather than reading it lazily in a callback.
  const agents = ctx.agents
  const sessionStore = ctx.get('sessions')
  const sessionQuery: SessionQueryEngine | undefined = ctx.get('sessionQuery')
  const sessionPersistence = ctx.get('sessionPersistence') as { supportsDeletion?: boolean } | undefined
  const tools: ToolRuntime | undefined = ctx.get('tools')
  const logger = ctx.logger
  const sessions = new Map<SessionId, SessionRecord>()
  const executionTargets = permittedExecutionTargets(config.executionTargets)
  let closed = false
  let conn: AgentSideConnection

  /** Return the bridge-owned record for an agent, rejecting same-id impostors. */
  const ownedRecord = (agent: Agent): SessionRecord | undefined => {
    const record = sessions.get(agent.session.id)
    return record?.agent === agent ? record : undefined
  }

  const assertOpen = (): void => {
    if (closed) throw internalError('the ACP bridge has been disposed')
  }

  const requireSession = (sessionId: SessionId): SessionRecord => {
    const record = sessions.get(sessionId)
    if (record === undefined) throw invalidParams(`unknown session: ${sessionId}`)
    return record
  }

  const authorizeStoredTarget = (header: SessionHeader): void => {
    const target = header.executionTarget
    if (target !== undefined && (executionTargets === undefined
      || (executionTargets !== '*' && !executionTargets.has(target)))) {
      throw invalidParams(`execution target '${target}' is not permitted by this ACP deployment`)
    }
  }

  const requireSessionQuery = (): SessionQueryEngine => {
    if (sessionQuery === undefined) throw internalError('persistent session lifecycle is not configured')
    return sessionQuery
  }

  const registerHandle = async (handle: Awaited<ReturnType<typeof agents.create>>, operation: string): Promise<SessionRecord> => {
    if (closed) {
      await handle.dispose()
      throw internalError(`connection closed during ${operation}`)
    }
    const record: SessionRecord = {
      agent: handle.agent,
      dispose: () => handle.dispose(),
      inflight: undefined,
      streamedBlocks: new Set(),
      toolCalls: new Map(),
      contextWindow: latestContextWindow(handle.agent.session.events),
    }
    sessions.set(handle.agent.session.id, record)
    return record
  }

  /** Cancel, durably settle, and release one connection-owned live handle. */
  const closeRecord = async (sessionId: SessionId, record: SessionRecord): Promise<void> => {
    sessions.delete(sessionId)
    record.agent.cancel({ kind: 'user' })
    settlePrompt(record, 'cancelled')
    await record.agent.whenIdle()
    if (sessionStore !== undefined) await sessionStore.flush(record.agent.session)
    const subagents = ctx.get('subagents') as ContinuableDrain | undefined
    if (subagents !== undefined) await subagents.drainContinuableDescendants([record.agent])
    await record.dispose()
  }

  const validateExistingSessionParams = (
    params: LoadSessionRequest | ResumeSessionRequest | ForkSessionRequest,
    header: SessionHeader,
  ): void => {
    validateWorkspaceParams(params)
    if (header.cwd !== params.cwd) {
      throw invalidParams(`cwd does not match session '${header.id}'`)
    }
    authorizeStoredTarget(header)
  }

  const resume = async (
    params: LoadSessionRequest | ResumeSessionRequest,
    operation: 'session/load' | 'session/resume',
  ): Promise<SessionRecord> => {
    assertOpen()
    const sessionId = SessionId(params.sessionId)
    if (sessions.has(sessionId)) throw invalidParams(`session is already active: ${sessionId}`)
    const snapshot = await requireSessionQuery().readSession(sessionId)
    validateExistingSessionParams(params, snapshot.session)
    try {
      return await registerHandle(await agents.resume({
        resumeSessionId: sessionId,
        agentOptions: agentOptions(config),
      }), operation)
    } catch (error: unknown) {
      if (error instanceof RequestError) throw error
      throw internalError(`${operation} failed: ${errorChain(error)}`)
    }
  }

  const replayMessages = async (record: SessionRecord): Promise<void> => {
    for (const event of record.agent.session.events) {
      if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
      const sessionUpdate = event.type === 'user/message' ? 'user_message_chunk' : 'agent_message_chunk'
      const message = event.type === 'user/message' ? event.data : event.data.message
      for (const block of message.content) {
        if (block.type === 'text' && block.text.length > 0) {
          await conn.sessionUpdate({
            sessionId: record.agent.session.id,
            update: { sessionUpdate, content: { type: 'text', text: block.text } },
          })
        } else if (block.type === 'image') {
          await conn.sessionUpdate({
            sessionId: record.agent.session.id,
            update: {
              sessionUpdate,
              content: { type: 'text', text: `[image attachment ${block.attachment.attachmentId}]` },
            },
          })
        }
      }
    }
  }

  /** Send a protocol update without letting a disconnected client fail an agent turn. */
  const notify = (notification: SessionNotification): void => {
    /* v8 ignore next 3 -- only a transport write failure reaches this guard. */
    void conn.sessionUpdate(notification).catch((error: unknown) => {
      logger.warn(`acp: session/update failed: ${String(error)}`)
    })
  }

  const settlePrompt = (record: SessionRecord, reason: StopReason): void => {
    const inflight = record.inflight
    if (inflight === undefined) return
    record.inflight = undefined
    inflight.resolve(reason)
  }

  const rejectFromError = (
    inflight: NonNullable<SessionRecord['inflight']>,
    reason: Extract<TurnEndReason, { kind: 'error' }>,
  ): void => {
    inflight.reject(internalError(`turn failed: ${reason.error.message}`))
  }

  // Project the canonical session stream onto ACP live updates. The durable
  // event stays authoritative; notification failure is contained by notify().
  ctx.on('session/event', (session, event: SessionEvent) => {
    const record = sessions.get(session.header.id)
    if (record === undefined || record.agent.session !== session) return
    try {
      if (event.type === 'request/context') {
        record.contextWindow = event.data.contextWindow
      } else if (event.type === 'assistant/chunk') {
        const { turn, step, chunk } = event.data
        const messageId = `${session.id}:${turn}:${step}:${chunk.type === 'reasoning-delta' ? 'thought' : 'message'}`
        if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
          if (chunk.text.length > 0) {
            record.streamedBlocks.add(streamBlockKey(turn, step, chunk.index, chunk.type === 'text-delta' ? 'text' : 'reasoning'))
            notify({
              sessionId: session.id,
              update: {
                sessionUpdate: chunk.type === 'text-delta' ? 'agent_message_chunk' : 'agent_thought_chunk',
                content: { type: 'text', text: chunk.text },
                messageId,
              },
            })
          }
        } else if (chunk.type === 'block-end') {
          const block = chunk.block
          if ((block.type === 'text' || block.type === 'reasoning') && block.text.length > 0
            && !record.streamedBlocks.has(streamBlockKey(turn, step, chunk.index, block.type))) {
            notify({
              sessionId: session.id,
              update: {
                sessionUpdate: block.type === 'text' ? 'agent_message_chunk' : 'agent_thought_chunk',
                content: { type: 'text', text: block.text },
                messageId: `${session.id}:${turn}:${step}:${block.type === 'text' ? 'message' : 'thought'}`,
              },
            })
          } else if (block.type === 'image') {
            notify({
              sessionId: session.id,
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: `[image attachment ${block.attachment.attachmentId}]` },
                messageId: `${session.id}:${turn}:${step}:message`,
              },
            })
          }
        } else if (chunk.type === 'usage' && record.contextWindow !== undefined) {
          notify({
            sessionId: session.id,
            update: {
              sessionUpdate: 'usage_update',
              size: record.contextWindow,
              used: usedTokens(chunk.usage),
            },
          })
        }
      } else if (event.type === 'tool/call') {
        const args = parseToolInput(event.data.arguments)
        const definition = tools?.get(event.data.name, record.agent)
        const view = safePresentCall(definition, args)
        record.toolCalls.set(event.data.callId, {
          name: event.data.name,
          args,
          presentResult: definition?.presentResult === undefined
            ? undefined
            : (toolArgs, result) => definition.presentResult?.(toolArgs, result),
        })
        notify({
          sessionId: session.id,
          update: {
            sessionUpdate: 'tool_call',
            ...toolCallFromView(event.data.callId, event.data.name, args, view),
          },
        })
      } else if (event.type === 'tool/result') {
        const callId = event.data.message.source.callId
        const tracked = record.toolCalls.get(callId)
        record.toolCalls.delete(callId)
        const result = toolResultFromEvent(event)
        const view = safePresentResult(tracked, result)
        notify({
          sessionId: session.id,
          update: {
            sessionUpdate: 'tool_call_update',
            ...toolResultFromView(callId, result, view),
          },
        })
      } else if (event.type === 'step/end') {
        const prefix = `${event.data.turn}:${event.data.step}:`
        for (const key of record.streamedBlocks) {
          if (key.startsWith(prefix)) record.streamedBlocks.delete(key)
        }
      }
    } finally {
      const inflight = record.inflight
      if (inflight !== undefined && event.type === 'turn/end' && inflight.turn === event.data.turn) {
        if (event.data.reason.kind === 'error') {
          // Model failures surface immediately as prompt errors; ordinary
          // endings wait for whole-agent idle below.
          record.inflight = undefined
          rejectFromError(inflight, event.data.reason)
        } else {
          inflight.endReason = event.data.reason
        }
      }
    }
  })

  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    const record = ownedRecord(agent)
    const inflight = record?.inflight
    if (inflight !== undefined && inflight.messageId === message.id) inflight.turn = turn
  })

  ctx.on('agent/error', ({ agent, turn, error }) => {
    const record = ownedRecord(agent)
    const inflight = record?.inflight
    if (record === undefined || inflight === undefined || inflight.turn === turn) return
    record.inflight = undefined
    inflight.reject(internalError(`turn failed: ${errorChain(error)}`))
  })

  // Permission requests are a machine policy channel for ACP clients such as
  // dsh-subagent-acp. The bridge offers one-shot choices only and never infers a
  // durable grant from an unknown client response.
  ctx.on('approval/request', (request, next) => {
    const record = ownedRecord(request.agent)
    if (record === undefined || request.callId === undefined) return next()
    return conn.requestPermission({
      sessionId: record.agent.session.id,
      toolCall: { toolCallId: request.callId },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ],
    }).then(({ outcome }) => {
      if (outcome.outcome === 'cancelled') return 'cancelled'
      return outcome.optionId === 'allow-once' ? 'allowed-once' : 'rejected'
    })
  })

  const makeAgent = (connection: AgentSideConnection): AcpAgent => {
    conn = connection
    return {
      initialize(_params: InitializeRequest): Promise<InitializeResponse> {
        // Single-version agent: the spec's "same version if supported, else
        // the latest supported" both resolve to this server's one version.
        return Promise.resolve({
          protocolVersion: PROTOCOL_VERSION,
          agentInfo: { name: 'sivitacode-acp', version: '0.1.0-rc.5' },
          agentCapabilities: {
            loadSession: sessionQuery !== undefined,
            promptCapabilities: { image: false, audio: false, embeddedContext: false },
            sessionCapabilities: sessionQuery === undefined
              ? { close: {} }
              : {
                close: {},
                fork: {},
                list: {},
                resume: {},
                ...(sessionPersistence?.supportsDeletion === true ? { delete: {} } : {}),
              },
            ...(executionTargets === undefined ? {} : {
              _meta: { [SIVITACODE_ACP_META]: { executionTarget: true } },
            }),
          },
          authMethods: [],
        })
      },

      authenticate(_params: AuthenticateRequest): Promise<void> {
        return Promise.resolve()
      },

      async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
        assertOpen()
        validateSessionParams(params)
        const executionTarget = executionTargetOf(params, executionTargets)
        const sessionId = SessionId(randomUUID())
        // No preset composition: the ACP bundle keeps the model-facing rows in
        // the host plane, so this agent reads them from the global layer. A
        // deployment that configures a roster has to join one here first
        // (@deepseek-ai/dsh-agent-presets README, "Composing a child agent").
        let handle
        try {
          handle = await agents.create({
            sessionId,
            meta: {
              cwd: params.cwd,
              ...(executionTarget === undefined ? {} : { executionTarget }),
            },
            agentOptions: agentOptions(config),
          })
        } catch (error: unknown) {
          if (executionTarget === undefined) throw error
          throw internalError(`execution target '${executionTarget}' could not be mounted: ${errorChain(error)}`)
        }
        await registerHandle(handle, 'session/new')
        return {
          sessionId,
          ...(executionTarget === undefined ? {} : {
            _meta: { [SIVITACODE_ACP_META]: { executionTarget } },
          }),
        }
      },

      async loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
        const record = await resume(params, 'session/load')
        try {
          await replayMessages(record)
          return {}
        } catch (error: unknown) {
          sessions.delete(record.agent.session.id)
          await record.dispose()
          throw internalError(`session/load history replay failed: ${errorChain(error)}`)
        }
      },

      async resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse> {
        await resume(params, 'session/resume')
        return {}
      },

      async listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
        assertOpen()
        if (params.cwd !== undefined && params.cwd !== null && !isAbsolute(params.cwd)) {
          throw invalidParams(`cwd must be an absolute path: ${params.cwd}`)
        }
        const query = requireSessionQuery()
        const filtered = (await query.listSessions())
          .filter((record): record is typeof record & { header: SessionHeader & { cwd: string } } => record.header.cwd !== undefined)
          .filter(record => params.cwd === undefined || params.cwd === null || record.header.cwd === params.cwd)
          .filter((record) => {
            const target = record.header.executionTarget
            return target === undefined || executionTargets === '*'
              || (executionTargets !== undefined && executionTargets.has(target))
          })
        let page: ReturnType<typeof paginateSessions<(typeof filtered)[number]>>
        try {
          page = paginateSessions(filtered, params.cursor, params.cwd)
        } catch (error: unknown) {
          throw invalidParams(error instanceof Error ? error.message : 'invalid session/list cursor')
        }
        const records = page.records
        const titles = await query.readTitleSnapshots(records.map(record => record.header.id))
        return {
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
          sessions: records.map((record, index) => {
            const title = titles[index]
            return {
              sessionId: record.header.id,
              cwd: record.header.cwd,
              updatedAt: new Date(record.header.createdAt).toISOString(),
              ...(title?.status === 'fulfilled' && title.value.title !== undefined
                ? { title: title.value.title.title, updatedAt: new Date(title.value.title.updatedAt).toISOString() }
                : {}),
              ...(record.header.executionTarget === undefined ? {} : {
                _meta: { [SIVITACODE_ACP_META]: { executionTarget: record.header.executionTarget } },
              }),
            }
          }),
        }
      },

      async deleteSession(params: DeleteSessionRequest): Promise<DeleteSessionResponse> {
        assertOpen()
        if (sessionPersistence?.supportsDeletion !== true) {
          throw internalError('persistent session deletion is not configured')
        }
        const sessionId = SessionId(params.sessionId)
        const record = sessions.get(sessionId)
        if (record !== undefined) await closeRecord(sessionId, record)
        try {
          await requireSessionQuery().deleteSession(sessionId)
          return {}
        } catch (error: unknown) {
          if (error instanceof SessionQueryError
            && (error.code === 'SESSION_QUERY_SESSION_NOT_FOUND' || error.code === 'SESSION_QUERY_SOURCE_CONFLICT')) {
            throw invalidParams(error.message)
          }
          throw internalError(`session/delete failed: ${errorChain(error)}`)
        }
      },

      async unstable_forkSession(params: ForkSessionRequest): Promise<ForkSessionResponse> {
        assertOpen()
        const parentId = SessionId(params.sessionId)
        const snapshot = await requireSessionQuery().readSession(parentId)
        validateExistingSessionParams(params, snapshot.session)
        const sessionId = SessionId(randomUUID())
        const handle = await agents.create({
          sessionId,
          seed: snapshot.events,
          meta: {
            ...(snapshot.session.cwd === undefined ? {} : { cwd: snapshot.session.cwd }),
            parentSession: parentId,
            seedLength: snapshot.events.length,
            ...(snapshot.session.executionTarget === undefined ? {} : { executionTarget: snapshot.session.executionTarget }),
            ...(snapshot.session.agentPreset === undefined ? {} : { agentPreset: snapshot.session.agentPreset }),
          },
          agentOptions: agentOptions(config),
        })
        await registerHandle(handle, 'session/fork')
        return {
          sessionId,
          ...(snapshot.session.executionTarget === undefined ? {} : {
            _meta: { [SIVITACODE_ACP_META]: { executionTarget: snapshot.session.executionTarget } },
          }),
        }
      },

      async closeSession(params: CloseSessionRequest): Promise<void> {
        assertOpen()
        const sessionId = SessionId(params.sessionId)
        const record = requireSession(sessionId)
        await closeRecord(sessionId, record)
      },

      async prompt(params: PromptRequest): Promise<PromptResponse> {
        assertOpen()
        const record = requireSession(SessionId(params.sessionId))
        if (record.inflight !== undefined) {
          throw invalidParams('a prompt is already in flight for this session')
        }
        if (promptHasUnsupportedContent(params.prompt)) {
          throw invalidParams('only text and resource_link prompt content is supported')
        }
        const text = acpPromptToText(params.prompt)
        if (text.trim().length === 0) throw invalidParams('empty prompt')

        // Not driving a retired agent is this bridge's contract: an
        // agent-loop-only reload disposes the loop's agents while the bridge
        // record survives, so validate the record against the live registry
        // before sending — a disposed machine would accept the item silently.
        if (ctx.agents.get(record.agent.id) !== record.agent) {
          throw internalError('prompt was not queued: the agent was disposed outside the bridge')
        }
        const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
        const stopReason = await new Promise<StopReason>((resolve, reject) => {
          // Arm the slot before followup() so a listener-driven synchronous
          // turn cannot slip past correlation; a synchronous followup()
          // failure (invalid input) must free the slot again or the session
          // would reject every later prompt as already in flight.
          const inflight: NonNullable<SessionRecord['inflight']> = {
            resolve, reject, messageId: message.id, turn: undefined, endReason: undefined,
          }
          record.inflight = inflight
          try {
            record.agent.followup(message)
            // The machine's send() contains listener failures and accepts
            // any typed input; this guards a future synchronous throw so the
            // slot cannot wedge.
            /* v8 ignore start -- future-proofing guard, see above */
          } catch (error: unknown) {
            record.inflight = undefined
            const detail = error instanceof Error ? error.message : String(error)
            throw internalError(`prompt was not queued: ${detail}`)
          }
          /* v8 ignore stop */
          // Settlement waits for whole-agent idle: a correlated turn/end arms
          // `endReason`, while a turnless slot (admission discarded the
          // prompt) stays cancelled. Other producers may run further turns
          // before quiescence; the prompt settles only when the agent stops.
          void record.agent.whenIdle().then(() => {
            if (record.inflight !== inflight) return
            record.inflight = undefined
            const end = inflight.endReason
            if (end === undefined) {
              inflight.resolve('cancelled')
            } else {
              // Token-limit and other non-terminal endings are not prompt-level
              // stop reasons (see README); only normal quiescence reports end_turn.
              inflight.resolve(end.kind === 'max-tokens' ? 'end_turn' : turnEndToStopReason(end))
            }
          })
        })
        return { stopReason }
      },

      cancel(params: CancelNotification): Promise<void> {
        const record = sessions.get(SessionId(params.sessionId))
        if (record === undefined) return Promise.resolve()
        record.agent.cancel({ kind: 'user' })
        settlePrompt(record, 'cancelled')
        return Promise.resolve()
      },
    }
  }

  /* v8 ignore next 4 -- production stdio wiring; tests inject config.stream. */
  const stream: Stream = config.stream ?? ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  )
  conn = new AgentSideConnection(makeAgent, stream)

  let quiescing: Promise<void> | undefined
  const quiesce = (): Promise<void> => {
    if (quiescing !== undefined) return quiescing
    closed = true
    const records = [...sessions.values()]
    sessions.clear()
    // Stop the bridge's own work before any await: a descendant drain can block
    // on persistence or scoped cleanup, and the top-level agents must not keep
    // running model and tool calls for its whole duration.
    for (const record of records) {
      record.agent.cancel({ kind: 'user' })
      settlePrompt(record, 'cancelled')
    }
    quiescing = (async () => {
      // Continuable subagents outlive the turn that started them, and their
      // Activations own descendant teardown. Drain only these sessions' forests
      // child-first BEFORE disposing the top-level agents, so no descendant is
      // left holding a runtime its owner already released and another frontend
      // sharing this Context remains live.
      // Read the one teardown method structurally: the bridge needs no other
      // part of the subagent seam, so it does not depend on that package.
      const subagents = ctx.get('subagents') as ContinuableDrain | undefined
      if (subagents !== undefined) {
        try {
          await subagents.drainContinuableDescendants(records.map(record => record.agent))
        } catch (error: unknown) {
          logger.warn(`acp: continuable subagent teardown failed: ${String(error)}`)
        }
      }
      const disposals = await Promise.allSettled(records.map(record => record.dispose()))
      const failures: unknown[] = []
      for (const result of disposals) {
        if (result.status === 'rejected') failures.push(result.reason as unknown)
      }
      if (failures.length > 0) {
        // The production consumer logs this AggregateError through `String`,
        // which renders only its message. Embed every per-session diagnostic,
        // including nested causes and aggregate members, in that message.
        const detail = failures.map(failure => errorChain(failure)).join('; ')
        throw new AggregateError(
          failures,
          `ACP agent teardown failed for ${failures.length} session(s): ${detail}`,
        )
      }
    })()
    return quiescing
  }

  /* v8 ignore start -- production transport rejection and teardown failure. */
  void conn.closed
    .catch((error: unknown) => {
      logger.warn(`acp: connection closed with an error: ${String(error)}`)
    })
    .then(async () => {
      try {
        await quiesce()
      } catch (error: unknown) {
        logger.warn(`acp: connection-close teardown failed: ${String(error)}`)
      }
      ctx.emit('acp/closed')
    })
  /* v8 ignore stop */

  ctx.effect(() => quiesce, 'acp.connection')
}

/**
 * Build per-agent options from plugin config without assigning absent optional fields.
 * @param config - ACP provider/model configuration.
 * @returns the configured fields only.
 */
function agentOptions(config: AcpConfig): { provider?: string; model?: string } {
  return {
    ...config.provider !== undefined ? { provider: config.provider } : {},
    ...config.model !== undefined ? { model: config.model } : {},
  }
}

/** Reject session features outside the automation contract. */
function validateWorkspaceParams(params: {
  cwd: string
  additionalDirectories?: string[]
  mcpServers?: unknown[]
}): void {
  if (!isAbsolute(params.cwd)) throw invalidParams(`cwd must be an absolute path: ${params.cwd}`)
  if (params.additionalDirectories !== undefined && params.additionalDirectories.length > 0) {
    throw invalidParams('additionalDirectories is not supported')
  }
  if (params.mcpServers !== undefined && params.mcpServers.length > 0) throw invalidParams('mcpServers is not supported')
}

/** Reject session features outside the automation contract. */
function validateSessionParams(params: NewSessionRequest): void {
  validateWorkspaceParams(params)
}

/** Read the optional SivitaCode target selector without interpreting unrelated ACP metadata. */
function executionTargetOf(
  params: NewSessionRequest,
  permitted: ReadonlySet<string> | '*' | undefined,
): ExecutionTargetIdValue | undefined {
  const extension = params._meta?.[SIVITACODE_ACP_META]
  if (extension === undefined) return undefined
  if (typeof extension !== 'object' || extension === null || Array.isArray(extension)) {
    throw invalidParams(`_meta[${JSON.stringify(SIVITACODE_ACP_META)}] must be an object`)
  }
  const target = (extension as Record<string, unknown>).executionTarget
  if (target === undefined) return undefined
  if (typeof target !== 'string' || target.length === 0 || target.trim() !== target) {
    throw invalidParams(`_meta[${JSON.stringify(SIVITACODE_ACP_META)}].executionTarget must be a non-empty unpadded string`)
  }
  if (permitted === undefined || (permitted !== '*' && !permitted.has(target))) {
    throw invalidParams(`execution target '${target}' is not permitted by this ACP deployment`)
  }
  return ExecutionTargetId(target)
}

/** Validate and detach the deployment-owned target allowlist once at activation. */
function permittedExecutionTargets(values: readonly string[] | undefined): ReadonlySet<string> | '*' | undefined {
  if (values === undefined || values.length === 0) return undefined
  if (values.includes('*')) {
    if (values.length !== 1) throw new Error('acp executionTargets: wildcard must be the only entry')
    return '*'
  }
  const result = new Set<string>()
  for (const value of values) {
    if (value.length === 0 || value.trim() !== value) {
      throw new Error('acp executionTargets: entries must be non-empty unpadded strings')
    }
    if (result.has(value)) throw new Error(`acp executionTargets: duplicate target '${value}'`)
    result.add(value)
  }
  return result
}
