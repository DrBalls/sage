import { Codex } from '@openai/codex-sdk';
import type { Thread, ThreadEvent, ThreadItem, ThreadOptions } from '@openai/codex-sdk';
import { existsSync } from 'fs';
import path from 'path';
import { homedir } from 'os';
import type {
  AgentSession,
  AgentProviderInterface,
  InitialReviewContext,
  FollowupReviewContext,
  RunReviewOptions,
  ReviewResult,
  ChatResult,
  CritiqueResponse,
  StreamEvent,
  StreamEventTag,
} from './types.js';
import { buildInitialPromptPayload, buildFollowupPromptPayload, CRITIQUE_SCHEMA } from './prompts.js';

const MAX_STREAM_MESSAGE_LENGTH = 600;
let streamEventCounter = 0;

/**
 * OpenAI Codex-based agent session
 */
class OpenAISession implements AgentSession {
  private thread: Thread;

  constructor(thread: Thread) {
    this.thread = thread;
  }

  get id(): string | null {
    return this.thread.id ?? null;
  }

  async runInitialReview(
    context: InitialReviewContext,
    options?: RunReviewOptions,
  ): Promise<ReviewResult> {
    const payload = options?.promptPayload ?? buildInitialPromptPayload(context);
    const { critique, events } = await this.executeStreamedTurn(payload.prompt, options?.onEvent);
    return { critique, streamEvents: events };
  }

  async runFollowupReview(
    context: FollowupReviewContext,
    options?: RunReviewOptions,
  ): Promise<ReviewResult> {
    const payload = options?.promptPayload ?? buildFollowupPromptPayload(context);
    const { critique, events } = await this.executeStreamedTurn(payload.prompt, options?.onEvent);
    return { critique, streamEvents: events };
  }

  async chat(userQuestion: string): Promise<ChatResult> {
    const prompt = `You are now chatting directly with the developer. Respond conversationally - you don't need to follow the structured output schema from your reviews.

${userQuestion}`;

    const turn = await this.thread.run(prompt);
    return { response: turn.finalResponse as string };
  }

  private async executeStreamedTurn(
    prompt: string,
    onEvent?: (event: StreamEvent) => void,
  ): Promise<{ critique: CritiqueResponse; events: StreamEvent[] }> {
    const { events } = await this.thread.runStreamed(prompt, { outputSchema: CRITIQUE_SCHEMA });
    const collected: StreamEvent[] = [];
    let critique: CritiqueResponse | null = null;

    const iterator = events[Symbol.asyncIterator]() as AsyncIterator<ThreadEvent>;
    let sawTerminalEvent = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await iterator.next();
      if (done) {
        break;
      }

      const event = value as ThreadEvent;
      const derived = this.convertThreadEventToStreamEvents(event);
      if (derived.length) {
        for (const entry of derived) {
          collected.push(entry);
          onEvent?.(entry);
        }
      }

      const maybeCritique = this.extractCritiqueFromEvent(event);
      if (maybeCritique) {
        critique = maybeCritique;
      }

      if (event.type === 'turn.failed') {
        sawTerminalEvent = true;
        await this.closeIterator(iterator);
        const errorMessage = event.error?.message ?? 'Codex turn failed';
        throw new Error(errorMessage);
      }

      if (event.type === 'turn.completed') {
        sawTerminalEvent = true;
        await this.closeIterator(iterator);
        break;
      }
    }

    if (!critique) {
      throw new Error('Codex returned no structured critique.');
    }

    if (!sawTerminalEvent) {
      collected.push(makeStreamEvent('status', 'Stream ended unexpectedly without a terminal event.', Date.now()));
    }

    return { critique, events: collected };
  }

  private async closeIterator(iterator: AsyncIterator<ThreadEvent>): Promise<void> {
    if (typeof iterator.return === 'function') {
      try {
        await iterator.return();
      } catch {
        // Iterator may already be closed; ignore errors.
      }
    }
  }

  private convertThreadEventToStreamEvents(event: ThreadEvent): StreamEvent[] {
    const timestamp = Date.now();

    switch (event.type) {
      case 'item.started':
        return this.describeItemEvent('started', event.item, timestamp);
      case 'item.updated':
        return this.describeItemEvent('updated', event.item, timestamp);
      case 'item.completed':
        return this.describeItemEvent('completed', event.item, timestamp);
      case 'turn.completed': {
        const usage = event.usage ?? {};
        const inputTokens = usage.input_tokens ?? 0;
        const cachedTokens = usage.cached_input_tokens ?? 0;
        const outputTokens = usage.output_tokens ?? 0;

        const newInputTokens = inputTokens - cachedTokens;
        const effectiveTokens = Math.round(newInputTokens + (cachedTokens * 0.1) + outputTokens);

        const message = effectiveTokens > 0
          ? `Turn completed • ${effectiveTokens.toLocaleString()} tokens used`
          : 'Turn completed';

        return [makeStreamEvent('status', message, timestamp)];
      }
      case 'turn.failed': {
        const message = event.error?.message ?? 'Codex turn failed';
        return [makeStreamEvent('error', `Turn failed: ${message}`, timestamp)];
      }
      default:
        return [];
    }
  }

  private describeItemEvent(
    stage: 'started' | 'updated' | 'completed',
    item: ThreadItem,
    timestamp: number,
  ): StreamEvent[] {
    if (stage !== 'completed') {
      return [];
    }
    const value: any = item;

    switch (item.type) {
      case 'agent_message': {
        const payload = this.extractStructuredPayload(value);
        if (payload && isCritiqueResponse(payload)) {
          const verdict = payload.verdict;
          const why = payload.why ? truncateString(payload.why, 100) : '';
          return [makeStreamEvent('assistant', `${verdict}: ${why}`, timestamp)];
        }

        const raw = extractItemText(value);
        const message = raw ? truncateString(raw, 150) : 'Assistant message';
        return [makeStreamEvent('assistant', message, timestamp)];
      }
      case 'reasoning': {
        const raw = extractItemText(value);
        const message = raw ? truncateString(raw, 150) : 'Reasoning step';
        return [makeStreamEvent('reasoning', message, timestamp)];
      }
      case 'command_execution': {
        const command = typeof value?.command === 'string' ? value.command : 'command';
        const truncated = command.length > 100 ? command.slice(0, 100) + '...' : command;
        const status = typeof value?.status === 'string' ? value.status : 'completed';
        const exitCode = typeof value?.exit_code === 'number' ? ` (exit ${value.exit_code})` : '';
        return [makeStreamEvent('command', `${truncated} ${status}${exitCode}`, timestamp)];
      }
      case 'file_change': {
        const changes = Array.isArray(value?.changes) ? value.changes : [];
        if (!changes.length) {
          return [makeStreamEvent('file', 'File changed', timestamp)];
        }
        return changes.map((change: any) => {
          const kind = typeof change?.kind === 'string' ? change.kind : 'updated';
          const path = typeof change?.path === 'string' ? change.path : '(unknown path)';
          return makeStreamEvent('file', `${kind}: ${path}`, timestamp);
        });
      }
      case 'todo_list': {
        return [makeStreamEvent('todo', summarizeTodoList(value), timestamp)];
      }
      default: {
        const typeLabel = typeof value?.type === 'string' ? value.type : 'item';
        return [makeStreamEvent('status', `${typeLabel} completed`, timestamp)];
      }
    }
  }

  private extractCritiqueFromEvent(event: ThreadEvent): CritiqueResponse | null {
    if (event.type !== 'item.completed') return null;
    if (!event.item || event.item.type !== 'agent_message') return null;

    const payload = this.extractStructuredPayload(event.item);
    if (!payload) return null;
    return isCritiqueResponse(payload) ? payload : null;
  }

  private extractStructuredPayload(item: ThreadItem): unknown {
    const value: any = item;
    if (value?.json && typeof value.json === 'object') {
      return value.json;
    }

    if (typeof value?.text === 'string') {
      const text = value.text.trim();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }

    return null;
  }
}

/**
 * OpenAI Codex provider implementation
 */
export class OpenAIProvider implements AgentProviderInterface {
  readonly name = 'openai' as const;
  private codex: Codex;

  constructor() {
    this.codex = new Codex();
  }

  async isAvailable(): Promise<boolean> {
    // Check if Codex is authenticated (env var or auth file)
    const authFile = path.join(homedir(), '.codex', 'auth.json');
    return Boolean(process.env.CODEX_API_KEY) || existsSync(authFile);
  }

  createSession(model: string): AgentSession {
    const options: ThreadOptions = model ? { model } : {};
    const thread = this.codex.startThread(options);
    return new OpenAISession(thread);
  }

  async resumeSession(sessionId: string, model: string): Promise<AgentSession | null> {
    try {
      const options: ThreadOptions = model ? { model } : {};
      const thread = this.codex.resumeThread(sessionId, options);
      return new OpenAISession(thread);
    } catch {
      return null;
    }
  }

  /**
   * Get the underlying Codex instance for direct access (for backward compatibility)
   */
  getCodex(): Codex {
    return this.codex;
  }
}

// Singleton instance
let openaiProviderInstance: OpenAIProvider | null = null;

export function getOpenAIProvider(): OpenAIProvider {
  if (!openaiProviderInstance) {
    openaiProviderInstance = new OpenAIProvider();
  }
  return openaiProviderInstance;
}

// Helper functions

function summarizeTodoList(item: any): string {
  const items = Array.isArray(item?.items) ? item.items : [];
  if (!items.length) {
    return 'Todo list (empty)';
  }

  const lines = items.map((todo: any) => {
    const symbol = todo?.completed ? '✓' : '□';
    const text = typeof todo?.text === 'string' ? todo.text : '';
    return `${symbol} ${text}`.trim();
  });

  return `Todo list:\n${lines.join('\n')}`;
}

function extractItemText(item: any): string {
  if (typeof item?.text === 'string' && item.text.trim().length > 0) {
    return item.text.trim();
  }

  if (Array.isArray(item?.content)) {
    const parts = item.content
      .map((chunk: any) => (typeof chunk?.text === 'string' ? chunk.text : null))
      .filter((chunk: string | null): chunk is string => Boolean(chunk));
    if (parts.length) {
      return parts.join('\n').trim();
    }
  }

  if (item?.json && typeof item.json === 'object') {
    try {
      return JSON.stringify(item.json, null, 2);
    } catch {
      return '';
    }
  }

  return '';
}

function truncateString(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

function isCritiqueResponse(value: any): value is CritiqueResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const hasRequiredFields = (
    typeof value.verdict === 'string'
    && typeof value.why === 'string'
    && typeof value.alternatives === 'string'
    && typeof value.message_for_agent === 'string'
  );

  if (!hasRequiredFields) return false;

  // Enforce non-empty why for non-Approved verdicts
  if (value.verdict !== 'Approved' && value.why.trim() === '') {
    return false;
  }

  return true;
}

function makeStreamEvent(tag: StreamEventTag, message: string, timestamp: number): StreamEvent {
  const normalized = truncateForDisplay(message.replace(/\r\n/g, '\n'));
  if (!normalized) {
    return {
      id: `evt-${timestamp}-${++streamEventCounter}`,
      timestamp,
      tag,
      message: '(no details)',
    };
  }

  return {
    id: `evt-${timestamp}-${++streamEventCounter}`,
    timestamp,
    tag,
    message: normalized,
  };
}

function truncateForDisplay(text: string, maxLength = MAX_STREAM_MESSAGE_LENGTH): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}
