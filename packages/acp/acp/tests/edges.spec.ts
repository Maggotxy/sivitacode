import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { createUserMessage, CallId, type StreamChunk  } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { makeBridgeHarness, textResponse, type BridgeHarness } from './harness.ts'

function toolCallResponse(): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: CallId('call-1'), name: 'echo', argumentsDelta: '{}' },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('call-1'), name: 'echo', arguments: '{}' } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function blockEndOnlyResponse(type: 'text' | 'reasoning', text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: type },
    { type: type === 'text' ? 'text-delta' : 'reasoning-delta', index: 0, text: '' },
    { type: 'block-end', index: 0, block: { type, text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

describe('ACP automation live output', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  it('projects tool lifecycle and live answer deltas without duplicating the committed message', async () => {
    harness = await makeBridgeHarness({ script: [toolCallResponse(), textResponse('done')] })
    harness.ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: 'Return a deterministic result.',
      parameters: {},
      execute: () => Promise.resolve([{ type: 'text', text: 'tool result' }]),
    }))
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] })

    await vi.waitFor(() => { expect(harness!.updates).toHaveLength(6) })
    expect(harness.updates[0]).toEqual({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-1',
      title: 'echo',
      status: 'in_progress',
      kind: 'other',
      rawInput: {},
    })
    expect(harness.updates[1]).toEqual({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-1',
      status: 'completed',
      rawOutput: [{ type: 'text', text: 'tool result' }],
      content: [{ type: 'content', content: { type: 'text', text: 'tool result' } }],
    })
    expect(harness.updates.slice(2).flatMap(update => update.sessionUpdate === 'agent_message_chunk'
      && update.content.type === 'text' ? [update.content.text] : []).join('')).toBe('done')
    expect(new Set(harness.updates.slice(2).map(update => 'messageId' in update ? update.messageId : undefined)))
      .toEqual(new Set([`${sessionId}:1:2:message`]))
  })

  it('streams reasoning separately and reports context usage when model capacity is known', async () => {
    harness = await makeBridgeHarness({
      contextWindow: 128,
      script: [[
        { type: 'block-start', index: 0, blockType: 'reasoning' },
        { type: 'reasoning-delta', index: 0, text: 'think' },
        { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'think' } },
        { type: 'usage', usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 2, reasoningTokens: 2 } },
        { type: 'finish', reason: { kind: 'stop' } },
      ]],
    })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'reason' }] })

    await vi.waitFor(() => { expect(harness!.updates).toHaveLength(2) })
    expect(harness.updates).toEqual([
      {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'think' },
        messageId: `${sessionId}:1:1:thought`,
      },
      { sessionUpdate: 'usage_update', size: 128, used: 12 },
    ])
  })

  it.each([
    ['text', 'agent_message_chunk', 'message'],
    ['reasoning', 'agent_thought_chunk', 'thought'],
  ] as const)('falls back to a complete %s block when the provider emits no non-empty delta', async (
    type,
    sessionUpdate,
    suffix,
  ) => {
    harness = await makeBridgeHarness({ script: [blockEndOnlyResponse(type, 'complete')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] })

    await vi.waitFor(() => { expect(harness!.updates).toHaveLength(1) })
    expect(harness.updates).toEqual([{
      sessionUpdate,
      content: { type: 'text', text: 'complete' },
      messageId: `${sessionId}:1:1:${suffix}`,
    }])
  })

  it('does not repeat a completed block after a non-empty live delta', async () => {
    harness = await makeBridgeHarness({ script: [[
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '' },
      { type: 'text-delta', index: 0, text: 'live' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'live' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] })

    await vi.waitFor(() => { expect(harness!.updates).toHaveLength(1) })
    expect(harness.updates).toEqual([{
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'live' },
      messageId: `${sessionId}:1:1:message`,
    }])
  })

  it('preserves malformed tool arguments and contains throwing presentation callbacks', async () => {
    harness = await makeBridgeHarness({ script: [toolCallResponse(), textResponse('done')] })
    harness.ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: 'Return a deterministic result.',
      parameters: {},
      presentCall: () => { throw new Error('call presenter failed') },
      presentResult: () => { throw new Error('result presenter failed') },
      execute: () => Promise.resolve([{ type: 'text', text: 'tool result' }]),
    }))
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] }))
      .resolves.toEqual({ stopReason: 'end_turn' })

    await vi.waitFor(() => { expect(harness!.updates).toHaveLength(6) })
    expect(harness.updates[0]).toMatchObject({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-1',
      rawInput: {},
    })
    expect(harness.updates[1]).toMatchObject({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-1',
      status: 'completed',
    })
  })

  it('reports malformed tool input exactly and projects execution failure', async () => {
    harness = await makeBridgeHarness({ script: [[
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: CallId('call-1'), name: 'echo', argumentsDelta: '{broken' },
      { type: 'block-end', index: 0, block: {
        type: 'tool-call', id: CallId('call-1'), name: 'echo', arguments: '{broken',
      } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ], textResponse('recovered')] })
    harness.ctx.tools.register(defineContentToolFixture({
      name: 'echo',
      description: 'Reject invalid arguments before execution.',
      parameters: {},
      execute: () => Promise.resolve([{ type: 'text', text: 'unreachable' }]),
    }))
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] })

    await vi.waitFor(() => { expect(harness!.updates.length).toBeGreaterThanOrEqual(2) })
    expect(harness.updates[0]).toMatchObject({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-1',
      rawInput: '{broken',
    })
    expect(harness.updates[1]).toMatchObject({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-1',
      status: 'failed',
    })
  })

  it('ignores events from agents the bridge does not own', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('foreign')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const { agent } = await harness.ctx.agents.create({
      sessionId: SessionId('foreign'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(harness.updates).toHaveLength(0)
  })

  // `session/update` is a JSON-RPC notification, so a client-side handler
  // failure never reaches the bridge; this pins that the prompt still settles
  // normally with such a client. The bridge's own write-failure guard is
  // transport-level and documented untestable at `notify`.
  it('settles the prompt normally when the client rejects update notifications', async () => {
    harness = await makeBridgeHarness({ script: [textResponse('answer')] })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    harness.onSessionUpdateError = () => {}
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'go' }] }))
      .resolves.toEqual({ stopReason: 'end_turn' })
  })
})
