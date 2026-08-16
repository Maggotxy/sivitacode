import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SIVITACODE_ACP_META } from '../src/index.ts'
import { makeBridgeHarness, textResponse, type BridgeHarness } from './harness.ts'

describe('automation-only ACP bridge', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  it('advertises persistent text-session lifecycle without presentation capabilities', async () => {
    harness = await makeBridgeHarness()
    const response = await harness.client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { _meta: { terminal_output: true } },
    })

    expect(response).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: { name: 'sivitacode-acp', version: '0.1.0-rc.5' },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: false, audio: false, embeddedContext: false },
        sessionCapabilities: { close: {}, delete: {}, fork: {}, list: {}, resume: {} },
      },
      authMethods: [],
    })
  })

  it('lists, closes, resumes, loads with replay, and forks one durable session', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('first answer'), textResponse('resumed answer')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.prompt({
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'first question' }],
    })
    await harness.client.closeSession({ sessionId: created.sessionId })

    const listed = await harness.client.listSessions({ cwd: process.cwd() })
    expect(listed.sessions).toContainEqual(expect.objectContaining({
      sessionId: created.sessionId,
      cwd: process.cwd(),
    }))

    await harness.client.resumeSession({
      sessionId: created.sessionId,
      cwd: process.cwd(),
      mcpServers: [],
    })
    await harness.client.prompt({
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'second question' }],
    })
    await harness.client.closeSession({ sessionId: created.sessionId })

    const updateBoundary = harness.sessionUpdates.length
    await harness.client.loadSession({
      sessionId: created.sessionId,
      cwd: process.cwd(),
      mcpServers: [],
    })
    expect(harness.sessionUpdates.slice(updateBoundary)).toEqual([
      { sessionId: created.sessionId, update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'first question' } } },
      { sessionId: created.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'first answer' } } },
      { sessionId: created.sessionId, update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'second question' } } },
      { sessionId: created.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'resumed answer' } } },
    ])
    await harness.client.closeSession({ sessionId: created.sessionId })

    const fork = await harness.client.unstable_forkSession({
      sessionId: created.sessionId,
      cwd: process.cwd(),
      mcpServers: [],
    })
    const forked = harness.ctx.agents.get(SessionId(fork.sessionId))?.session
    expect(forked?.header).toMatchObject({
      parentSession: created.sessionId,
      cwd: process.cwd(),
    })
    expect(forked?.header.seedLength).toBe(forked?.events.length)
    expect(forked?.deriveMessages().map(message => message.content)).toEqual([
      [{ type: 'text', text: 'first question' }],
      [{ type: 'text', text: 'first answer' }],
      [{ type: 'text', text: 'second question' }],
      [{ type: 'text', text: 'resumed answer' }],
    ])
  })

  it('deletes an owned live session only after settling it and removes the durable log', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('durable')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.prompt({
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'persist this' }],
    })

    await expect(harness.client.deleteSession({ sessionId: created.sessionId })).resolves.toEqual({})
    expect(harness.ctx.agents.get(SessionId(created.sessionId))).toBeUndefined()
    expect((await harness.client.listSessions({ cwd: process.cwd() })).sessions)
      .not.toContainEqual(expect.objectContaining({ sessionId: created.sessionId }))
    await expect(harness.client.loadSession({
      sessionId: created.sessionId,
      cwd: process.cwd(),
      mcpServers: [],
    })).rejects.toThrow(/Internal error/)
    await expect(harness.client.deleteSession({ sessionId: created.sessionId })).rejects.toThrow(/not found/)
  })

  it('advertises and persists an explicitly permitted execution target', async () => {
    harness = await makeBridgeHarness({ config: { executionTargets: ['target-a'] } })
    const setup = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    harness.ctx.executionWorldRouter.register({
      route: (runtime, target, cwd) => {
        expect(target).toBe('target-a')
        expect(cwd).toBe(process.cwd())
        return { context: runtime.extend(), setup }
      },
    })
    const initialized = await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    expect(initialized.agentCapabilities?._meta).toEqual({
      [SIVITACODE_ACP_META]: { executionTarget: true },
    })

    const created = await harness.client.newSession({
      cwd: process.cwd(),
      mcpServers: [],
      _meta: { [SIVITACODE_ACP_META]: { executionTarget: 'target-a' } },
    })

    expect(created._meta).toEqual({ [SIVITACODE_ACP_META]: { executionTarget: 'target-a' } })
    expect(harness.ctx.agents.get(SessionId(created.sessionId))?.session.header.executionTarget).toBe('target-a')
    expect(setup).toHaveBeenCalledOnce()
  })

  it('rejects unauthorized, malformed, and unavailable execution targets without publishing a session', async () => {
    harness = await makeBridgeHarness({ config: { executionTargets: ['allowed'] } })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const request = (extension: unknown) => harness!.client.newSession({
      cwd: process.cwd(), mcpServers: [], _meta: { [SIVITACODE_ACP_META]: extension },
    })

    await expect(request({ executionTarget: 'denied' })).rejects.toThrow(/not permitted/)
    await expect(request({ executionTarget: ' allowed ' })).rejects.toThrow(/unpadded/)
    await expect(request('allowed')).rejects.toThrow(/must be an object/)
    await expect(request({ executionTarget: 'allowed' })).rejects.toThrow(/could not be mounted.*no route provider/)
    expect(harness.ctx.agents.list()).toHaveLength(0)
  })

  it('ignores unrelated ACP metadata and keeps target selection disabled by default', async () => {
    harness = await makeBridgeHarness()
    const initialized = await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    expect(initialized.agentCapabilities?._meta).toBeUndefined()
    await expect(harness.client.newSession({
      cwd: process.cwd(), mcpServers: [], _meta: { 'client.example': { value: true } },
    })).resolves.toHaveProperty('sessionId')
    await expect(harness.client.newSession({
      cwd: process.cwd(), mcpServers: [],
      _meta: { [SIVITACODE_ACP_META]: { executionTarget: 'target-a' } },
    })).rejects.toThrow(/not permitted/)
  })

  it('negotiates an unsupported version and accepts the required no-op authentication call', async () => {
    harness = await makeBridgeHarness()
    const response = await harness.client.initialize({ protocolVersion: 0, clientCapabilities: {} })
    expect(response.protocolVersion).toBe(PROTOCOL_VERSION)
    await expect(harness.client.authenticate({ methodId: 'unused' })).resolves.toEqual({})
  })

  it('creates a session, streams one answer, and settles the prompt', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('hello there')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const result = await harness.client.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'say hello' }],
    })

    expect(result.stopReason).toBe('end_turn')
    await vi.waitFor(() => { expect(harness!.updates).toHaveLength('hello there'.length) })
    expect(harness.updates.map(update => update.sessionUpdate)).toEqual(
      Array.from('hello there', () => 'agent_message_chunk'),
    )
    expect(harness.updates.flatMap(update => update.sessionUpdate === 'agent_message_chunk'
      && update.content.type === 'text' ? [update.content.text] : []).join('')).toBe('hello there')
    expect(new Set(harness.updates.map(update => 'messageId' in update ? update.messageId : undefined)))
      .toEqual(new Set([`${sessionId}:1:1:message`]))
    expect(harness.ctx.agents.get(SessionId(sessionId))?.session.header.cwd).toBe(process.cwd())
    expect(harness.adapter.requests[0]?.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'say hello' }])
  })

  it('leaves absent agent targets for request listeners to supply', async () => {
    harness = await makeBridgeHarness({ config: { provider: undefined, model: undefined } })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })

    expect(harness.ctx.agents.get(SessionId(sessionId))?.options).toEqual({})
  })

  it('concatenates text blocks without exposing protocol framing to the model', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('done')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.prompt({
      sessionId,
      prompt: [
        { type: 'text', text: 'first' },
        { type: 'text', text: ' second' },
      ],
    })

    expect(harness.adapter.requests[0]?.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'first second' }])
  })

  it('renders the deployment persona for an ACP-created agent', async () => {
    harness = await makeBridgeHarness({ persona: 'Automation persona for {{model}} in {{cwd}}.', script: [textResponse('ok')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] })
    expect(harness.adapter.requests[0]?.system).toContain(`Automation persona for mock in ${process.cwd()}.`)
  })

  it('requires one absolute workspace and no MCP servers', async () => {
    harness = await makeBridgeHarness()
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })

    await expect(harness.client.newSession({ cwd: 'relative', mcpServers: [] })).rejects.toThrow(/absolute path/)
    await expect(harness.client.newSession({
      cwd: process.cwd(),
      mcpServers: [],
      additionalDirectories: ['/tmp/other'],
    })).rejects.toThrow(/additionalDirectories/)
    await expect(harness.client.newSession({
      cwd: process.cwd(),
      mcpServers: [{ name: 'fs', command: 'node', args: [], env: [] }],
    })).rejects.toThrow(/mcpServers/)

    await expect(harness.client.newSession({
      cwd: process.cwd(),
      mcpServers: [],
      additionalDirectories: [],
    })).resolves.toHaveProperty('sessionId')
  })

  it('rejects empty and beyond-baseline prompts before a turn starts', async () => {
    harness = await makeBridgeHarness()
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })

    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: '  ' }] }))
      .rejects.toThrow(/empty prompt/)
    await expect(harness.client.prompt({
      sessionId,
      prompt: [{ type: 'image', data: '', mimeType: 'image/png' }],
    })).rejects.toThrow(/only text and resource_link/)
    expect(harness.ctx.agents.get(SessionId(sessionId))?.session.events.some(event => event.type === 'turn/start')).toBe(false)
  })

  it('renders baseline resource links as textual references in the user message', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('done')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.prompt({
      sessionId,
      prompt: [
        { type: 'text', text: 'summarize' },
        { type: 'resource_link', name: 'notes.txt', uri: 'file:///tmp/notes.txt' },
      ],
    })
    expect(harness.adapter.requests[0]?.messages.at(-1)?.content).toEqual([{
      type: 'text',
      text: 'summarize\n[resource_link name="notes.txt" uri="file:///tmp/notes.txt"]\n',
    }])
  })

  it('rejects prompts for unknown sessions and ignores unknown cancellation', async () => {
    harness = await makeBridgeHarness()
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    await expect(harness.client.prompt({ sessionId: 'missing', prompt: [{ type: 'text', text: 'go' }] }))
      .rejects.toThrow(/unknown session/)
    await expect(harness.client.cancel({ sessionId: 'missing' })).resolves.toBeUndefined()
  })
})
