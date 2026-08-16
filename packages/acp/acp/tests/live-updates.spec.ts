import { describe, expect, it } from 'vitest'
import { CallId, createToolResultMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolDefinition, ToolResult } from '@deepseek-ai/dsh-tools'
import {
  acpContent,
  latestContextWindow,
  parseToolInput,
  safePresentCall,
  safePresentResult,
  streamBlockKey,
  toolCallFromView,
  toolContent,
  toolResultFromEvent,
  toolResultFromView,
  usedTokens,
} from '../src/live-updates.ts'

const textResult: ToolResult = { content: [{ type: 'text', text: 'raw' }], isError: false }

function event(type: string, data: unknown): SessionEvent {
  return { type, data, seq: 0, time: 0 } as SessionEvent
}

function resultEvent(options: {
  content?: ContentBlock[]
  isError?: boolean
  error?: { name: string; code: string }
  meta?: unknown
} = {}): SessionEvent<'tool/result'> {
  return event('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: CallId('call-1'),
      content: options.content ?? [],
      isError: options.isError ?? false,
    }),
    ...(options.error === undefined ? {} : { error: options.error }),
    ...(options.meta === undefined ? {} : { meta: options.meta }),
  }) as SessionEvent<'tool/result'>
}

describe('ACP live-update primitives', () => {
  it('reads the latest context capacity and computes stable stream and usage values', () => {
    expect(latestContextWindow([])).toBeUndefined()
    expect(latestContextWindow([
      event('turn/start', { turn: 1 }),
    ])).toBeUndefined()
    expect(latestContextWindow([
      event('request/context', { provider: 'p', model: 'm', contextWindow: 10 }),
      event('turn/start', { turn: 1 }),
      event('request/context', { provider: 'p', model: 'm', contextWindow: 20 }),
    ])).toBe(20)
    expect(latestContextWindow([
      event('request/context', { provider: 'p', model: 'm', contextWindow: 20 }),
      event('request/context', { provider: 'p', model: 'm' }),
    ])).toBeUndefined()
    expect(streamBlockKey(1, 2, 3, 'reasoning')).toBe('1:2:3:reasoning')
    expect(usedTokens({ inputTokens: 4, outputTokens: 3 })).toBe(7)
    expect(usedTokens({ inputTokens: 4, outputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 1 })).toBe(10)
  })

  it('parses valid tool JSON and preserves malformed provider text', () => {
    expect(parseToolInput('{"path":"a"}')).toEqual({ path: 'a' })
    expect(parseToolInput('{broken')).toBe('{broken')
  })

  it('contains absent, successful, and throwing call and result presenters', () => {
    expect(safePresentCall(undefined, {})).toBeUndefined()
    expect(safePresentCall({} as ToolDefinition, {})).toBeUndefined()
    expect(safePresentCall({
      presentCall: () => ({ card: 'generic', title: 'Shown' }),
    } as unknown as ToolDefinition, {}))
      .toEqual({ card: 'generic', title: 'Shown' })
    expect(safePresentCall({
      presentCall: () => { throw new Error('bad') },
    } as unknown as ToolDefinition, {})).toBeUndefined()

    expect(safePresentResult(undefined, textResult)).toBeUndefined()
    expect(safePresentResult({ name: 'x', args: {}, presentResult: undefined }, textResult)).toBeUndefined()
    expect(safePresentResult({
      name: 'x', args: {}, presentResult: () => ({ card: 'generic', title: 'Done' }),
    }, textResult)).toEqual({ card: 'generic', title: 'Done' })
    expect(safePresentResult({
      name: 'x', args: {}, presentResult: () => { throw new Error('bad') },
    }, textResult)).toBeUndefined()
  })

  it('converts every harness content family to transport-safe text', () => {
    const attachmentId = `sha256:${'a'.repeat(64)}` as never
    expect(acpContent({ type: 'text', text: 'plain' })).toEqual({ type: 'text', text: 'plain' })
    expect(acpContent({ type: 'reasoning', text: 'thought' })).toEqual({ type: 'text', text: 'thought' })
    expect(acpContent({
      type: 'image',
      attachment: { attachmentId, mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
    })).toEqual({ type: 'text', text: `[image attachment ${String(attachmentId)}]` })
    expect(acpContent({ type: 'tool-call', id: CallId('c'), name: 'read', arguments: '{}' }))
      .toEqual({ type: 'text', text: '[tool call read {}]' })
    expect(acpContent({
      type: 'tool-result', toolCallId: CallId('c'),
      content: [{ type: 'text', text: 'one' }, { type: 'reasoning', text: 'two' }],
    })).toEqual({ type: 'text', text: 'one\ntwo' })
    expect(acpContent({ type: 'future' } as never)).toEqual({ type: 'text', text: '[unsupported content future]' })
    expect(toolContent([{ type: 'text', text: 'wrapped' }])).toEqual([
      { type: 'content', content: { type: 'text', text: 'wrapped' } },
    ])
  })
})

describe('ACP tool presentation projection', () => {
  it('maps fallback and both minimal and complete generic call views', () => {
    expect(toolCallFromView('c', 'raw-tool', '{bad', undefined)).toEqual({
      toolCallId: 'c', title: 'raw-tool', status: 'in_progress', kind: 'other', rawInput: '{bad',
    })
    expect(toolCallFromView('c', 'tool', { original: true }, { card: 'generic', title: 'Minimal' })).toEqual({
      toolCallId: 'c', title: 'Minimal', status: 'in_progress', kind: 'other', rawInput: { original: true },
    })
    expect(toolCallFromView('c', 'tool', {}, {
      card: 'generic', title: 'Complete', kind: 'read', rawInput: 'shown',
      content: [{ type: 'text', text: 'detail' }], locations: [{ path: 'a', line: 2 }],
    })).toEqual({
      toolCallId: 'c', title: 'Complete', status: 'in_progress', kind: 'read', rawInput: 'shown',
      content: [{ type: 'content', content: { type: 'text', text: 'detail' } }],
      locations: [{ path: 'a', line: 2 }],
    })
  })

  it('maps minimal and described terminal calls', () => {
    expect(toolCallFromView('c', 'bash', {}, { card: 'terminal', title: 'pwd' })).toEqual({
      toolCallId: 'c', title: 'pwd', status: 'in_progress', kind: 'execute', rawInput: {},
    })
    expect(toolCallFromView('c', 'bash', {}, { card: 'terminal', title: 'pwd', description: 'Inspect cwd' }))
      .toEqual({
        toolCallId: 'c', title: 'pwd', status: 'in_progress', kind: 'execute', rawInput: {},
        content: [{ type: 'content', content: { type: 'text', text: 'Inspect cwd' } }],
      })
  })

  it('maps diff calls with and without follow locations', () => {
    const diff = { path: 'a', oldText: 'x', newText: 'y' }
    expect(toolCallFromView('c', 'edit', {}, { card: 'diff', title: 'Edit a', diffs: [diff] })).toEqual({
      toolCallId: 'c', title: 'Edit a', status: 'in_progress', kind: 'edit', rawInput: {},
      content: [{ type: 'diff', ...diff }],
    })
    expect(toolCallFromView('c', 'edit', {}, {
      card: 'diff', title: 'Edit a', diffs: [diff], locations: [{ path: 'a' }],
    })).toHaveProperty('locations', [{ path: 'a' }])
  })

  it('extracts successful, failed, metadata, and structurally absent tool results', () => {
    expect(toolResultFromEvent(resultEvent({ content: [{ type: 'text', text: 'ok' }], meta: { card: true } })))
      .toEqual({ content: [{ type: 'text', text: 'ok' }], isError: false, meta: { card: true } })
    expect(toolResultFromEvent(resultEvent({ isError: true }))).toEqual({ content: [], isError: true })
    expect(toolResultFromEvent(resultEvent({ error: { name: 'Error', code: 'FAILED' } })))
      .toEqual({ content: [], isError: true })
    const malformed = event('tool/result', {
      turn: 1, step: 1,
      message: { source: { kind: 'tool', callId: CallId('call-1') }, content: [] },
    }) as SessionEvent<'tool/result'>
    expect(toolResultFromEvent(malformed)).toEqual({ content: [], isError: false })
  })

  it('maps generic result fallbacks, replacements, titles, and failure', () => {
    expect(toolResultFromView('c', textResult, { card: 'generic' })).toEqual({
      toolCallId: 'c', status: 'completed', rawOutput: textResult.content,
      content: [{ type: 'content', content: { type: 'text', text: 'raw' } }],
    })
    expect(toolResultFromView('c', { ...textResult, isError: true }, {
      card: 'generic', title: 'Failed', content: [{ type: 'text', text: 'shown' }],
    })).toEqual({
      toolCallId: 'c', status: 'failed', title: 'Failed', rawOutput: textResult.content,
      content: [{ type: 'content', content: { type: 'text', text: 'shown' } }],
    })
  })

  it('maps terminal result output, exit, signal, fallback, and titles', () => {
    expect(toolResultFromView('c', textResult, { card: 'terminal' })).toEqual({
      toolCallId: 'c', status: 'completed', rawOutput: textResult.content,
      content: [{ type: 'content', content: { type: 'text', text: 'raw' } }],
    })
    expect(toolResultFromView('c', textResult, { card: 'terminal', title: 'Done', output: 'out', exitCode: 0 }))
      .toMatchObject({ title: 'Done', content: [{ type: 'content', content: { type: 'text', text: 'out\n[exit 0]' } }] })
    expect(toolResultFromView('c', { ...textResult, isError: true }, { card: 'terminal', output: 'out', signal: 'SIGTERM' }))
      .toMatchObject({ status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'out\n[signal SIGTERM]' } }] })
    expect(toolResultFromView('c', textResult, { card: 'terminal', output: 'out' }))
      .toMatchObject({ content: [{ type: 'content', content: { type: 'text', text: 'out' } }] })
  })

  it('maps diff and non-native result views with complete fallback semantics', () => {
    const diff = { path: 'a', oldText: null, newText: 'new' }
    expect(toolResultFromView('c', textResult, { card: 'diff', title: 'Changed', diffs: [diff] })).toEqual({
      toolCallId: 'c', status: 'completed', title: 'Changed', rawOutput: textResult.content,
      content: [{ type: 'diff', ...diff }],
    })
    expect(toolResultFromView('c', { ...textResult, isError: true }, { card: 'diff', diffs: [] }))
      .toMatchObject({ status: 'failed', content: [] })
    expect(toolResultFromView('c', textResult, undefined)).toEqual({
      toolCallId: 'c', status: 'completed', rawOutput: textResult.content,
      content: [{ type: 'content', content: { type: 'text', text: 'raw' } }],
    })
    expect(toolResultFromView('c', { ...textResult, isError: true }, {
      card: 'search', shape: 'paths', title: 'Matches', paths: [], truncated: false, total: 0,
    })).toMatchObject({ status: 'failed', title: 'Matches' })
  })
})
