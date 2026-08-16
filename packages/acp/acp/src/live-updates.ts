/** Pure projection from durable harness events and tool render intents to ACP live updates. */

import type {
  ToolCall,
  ToolCallContent,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk'
import type { ContentBlock, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolDefinition, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'

/** Call-time facts needed to project the matching durable result. */
export interface LiveToolCall {
  name: string
  args: unknown
  presentResult: ToolDefinition['presentResult'] | undefined
}

/**
 * Locate the latest advertised context capacity in a replayed session.
 * @param events - Durable events in append order.
 * @returns The latest advertised window, or undefined when none exists.
 */
export function latestContextWindow(events: readonly SessionEvent[]): number | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'request/context') return event.data.contextWindow
  }
  return undefined
}

/**
 * Stable key for suppressing a complete block after its deltas were sent.
 * @param turn - Owning turn number.
 * @param step - Owning step number.
 * @param index - Provider block index.
 * @param type - Textual block family.
 * @returns A session-record-local block identity.
 */
export function streamBlockKey(turn: number, step: number, index: number, type: 'text' | 'reasoning'): string {
  return `${turn}:${step}:${index}:${type}`
}

/**
 * Compute ACP's current-context count from provider-neutral disjoint usage fields.
 * @param usage - Provider-neutral token accounting.
 * @returns Input, output, and cache tokens without double-counting reasoning.
 */
export function usedTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens
    + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

/**
 * Preserve valid JSON input as data and malformed provider input as exact text.
 * @param raw - Provider-emitted tool arguments.
 * @returns Parsed JSON or the unchanged malformed string.
 */
export function parseToolInput(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

/**
 * Contain a third-party call-presentation callback.
 * @param definition - Resolved tool definition, when registered.
 * @param args - Parsed tool arguments.
 * @returns Presentation intent, or undefined on absence or failure.
 */
export function safePresentCall(definition: ToolDefinition | undefined, args: unknown): ToolCallView | undefined {
  try {
    return definition?.presentCall?.(args)
  } catch {
    return undefined
  }
}

/**
 * Contain a captured result-presentation callback.
 * @param tracked - Call-time tool facts, when the call was observed.
 * @param result - Canonical tool result.
 * @returns Presentation intent, or undefined on absence or failure.
 */
export function safePresentResult(tracked: LiveToolCall | undefined, result: ToolResult): ToolResultView | undefined {
  try {
    return tracked?.presentResult?.(tracked.args, result)
  } catch {
    return undefined
  }
}

/**
 * Convert harness content to ACP text without inventing fetchable attachment URLs.
 * @param block - Provider-neutral content block.
 * @returns Transport-safe ACP text content.
 */
export function acpContent(block: ContentBlock): { type: 'text'; text: string } {
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return { type: 'text', text: block.text }
    case 'image':
      return { type: 'text', text: `[image attachment ${block.attachment.attachmentId}]` }
    case 'tool-call':
      return { type: 'text', text: `[tool call ${block.name} ${block.arguments}]` }
    case 'tool-result':
      return { type: 'text', text: block.content.map(content => acpContent(content).text).join('\n') }
    default:
      return { type: 'text', text: `[unsupported content ${(block as { type: string }).type}]` }
  }
}

/**
 * Wrap harness content for ACP tool cards.
 * @param blocks - Provider-neutral content blocks.
 * @returns ACP tool-card content entries.
 */
export function toolContent(blocks: readonly ContentBlock[]): ToolCallContent[] {
  return blocks.map(block => ({ type: 'content', content: acpContent(block) }))
}

/**
 * Map a pending tool's provider-neutral render intent onto ACP.
 * @param callId - Durable tool call identity.
 * @param name - Raw registered tool name.
 * @param args - Parsed or exact malformed arguments.
 * @param view - Optional tool-owned presentation intent.
 * @returns An in-progress ACP tool call.
 */
export function toolCallFromView(
  callId: string,
  name: string,
  args: unknown,
  view: ToolCallView | undefined,
): ToolCall {
  if (view?.card === 'generic') {
    return {
      toolCallId: callId,
      title: view.title,
      status: 'in_progress',
      kind: view.kind ?? 'other',
      rawInput: view.rawInput ?? args,
      ...(view.content === undefined ? {} : { content: toolContent(view.content) }),
      ...(view.locations === undefined ? {} : { locations: view.locations.map(location => ({ ...location })) }),
    }
  }
  if (view?.card === 'terminal') {
    return {
      toolCallId: callId,
      title: view.title,
      status: 'in_progress',
      kind: 'execute',
      rawInput: args,
      ...(view.description === undefined ? {} : {
        content: [{ type: 'content', content: { type: 'text', text: view.description } }],
      }),
    }
  }
  if (view?.card === 'diff') {
    return {
      toolCallId: callId,
      title: view.title,
      status: 'in_progress',
      kind: 'edit',
      rawInput: args,
      content: view.diffs.map(diff => ({ type: 'diff', ...diff })),
      ...(view.locations === undefined ? {} : { locations: view.locations.map(location => ({ ...location })) }),
    }
  }
  return { toolCallId: callId, title: name, status: 'in_progress', kind: 'other', rawInput: args }
}

/**
 * Extract the model-facing tool result from its durable event.
 * @param event - Durable tool-result event.
 * @returns Canonical content, failure state, and optional metadata.
 */
export function toolResultFromEvent(event: SessionEvent<'tool/result'>): ToolResult {
  const result = event.data.message.content.at(0)
  return {
    content: result?.content ?? [],
    isError: event.data.error !== undefined || result?.isError === true,
    ...(event.data.meta === undefined ? {} : { meta: event.data.meta }),
  }
}

/**
 * Map a completed tool's render intent and canonical result onto ACP.
 * @param callId - Durable tool call identity.
 * @param result - Canonical tool result.
 * @param view - Optional captured presentation intent.
 * @returns A completed or failed ACP tool update.
 */
export function toolResultFromView(
  callId: string,
  result: ToolResult,
  view: ToolResultView | undefined,
): ToolCallUpdate {
  const fallbackContent = toolContent(result.content)
  if (view?.card === 'generic') {
    return {
      toolCallId: callId,
      status: result.isError ? 'failed' : 'completed',
      rawOutput: result.content,
      content: view.content === undefined ? fallbackContent : toolContent(view.content),
      ...(view.title === undefined ? {} : { title: view.title }),
    }
  }
  if (view?.card === 'terminal') {
    const ending = view.signal === undefined
      ? view.exitCode === undefined ? '' : `\n[exit ${view.exitCode}]`
      : `\n[signal ${view.signal}]`
    return {
      toolCallId: callId,
      status: result.isError ? 'failed' : 'completed',
      rawOutput: result.content,
      content: view.output === undefined
        ? fallbackContent
        : [{ type: 'content', content: { type: 'text', text: `${view.output}${ending}` } }],
      ...(view.title === undefined ? {} : { title: view.title }),
    }
  }
  if (view?.card === 'diff') {
    return {
      toolCallId: callId,
      status: result.isError ? 'failed' : 'completed',
      rawOutput: result.content,
      content: view.diffs.map(diff => ({ type: 'diff', ...diff })),
      ...(view.title === undefined ? {} : { title: view.title }),
    }
  }
  return {
    toolCallId: callId,
    status: result.isError ? 'failed' : 'completed',
    rawOutput: result.content,
    content: fallbackContent,
    ...(view?.title === undefined ? {} : { title: view.title }),
  }
}
