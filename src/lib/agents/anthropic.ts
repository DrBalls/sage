import Anthropic from '@anthropic-ai/sdk';
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
} from './types.js';
import { buildInitialPromptPayload, buildFollowupPromptPayload } from './prompts.js';

/**
 * Anthropic Claude-based agent session
 */
class AnthropicSession implements AgentSession {
  private client: Anthropic;
  private model: string;
  private sessionId: string;
  private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  constructor(client: Anthropic, model: string) {
    this.client = client;
    this.model = model;
    this.sessionId = `anthropic-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  get id(): string | null {
    return this.sessionId;
  }

  async runInitialReview(
    context: InitialReviewContext,
    options?: RunReviewOptions,
  ): Promise<ReviewResult> {
    const payload = options?.promptPayload ?? buildInitialPromptPayload(context);
    return this.executeReview(payload.prompt, options?.onEvent);
  }

  async runFollowupReview(
    context: FollowupReviewContext,
    options?: RunReviewOptions,
  ): Promise<ReviewResult> {
    const payload = options?.promptPayload ?? buildFollowupPromptPayload(context);
    return this.executeReview(payload.prompt, options?.onEvent);
  }

  async chat(userQuestion: string): Promise<ChatResult> {
    const prompt = `You are now chatting directly with the developer. Respond conversationally - you don't need to follow the structured output schema from your reviews.

${userQuestion}`;

    this.conversationHistory.push({ role: 'user', content: prompt });

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      messages: this.conversationHistory,
    });

    const assistantMessage = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    this.conversationHistory.push({ role: 'assistant', content: assistantMessage });

    return { response: assistantMessage };
  }

  private async executeReview(
    prompt: string,
    onEvent?: (event: StreamEvent) => void,
  ): Promise<ReviewResult> {
    const events: StreamEvent[] = [];
    const timestamp = Date.now();

    // Add status event
    const startEvent = makeStreamEvent('status', 'Sending request to Claude...', timestamp);
    events.push(startEvent);
    onEvent?.(startEvent);

    // Add prompt to conversation history
    this.conversationHistory.push({ role: 'user', content: prompt });

    // Create the system prompt for structured output
    const systemPrompt = `You are Sage, an AI code reviewer. You MUST respond with a valid JSON object following this exact schema:
{
  "verdict": "Approved" | "Concerns" | "Critical Issues",
  "why": string (empty string "" for Approved, required content for other verdicts),
  "alternatives": string (suggested alternatives or empty string if none),
  "message_for_agent": string (direct message to Claude Code agent, or empty string if none)
}

IMPORTANT: Your response must be ONLY the JSON object, no additional text or markdown formatting.`;

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: this.conversationHistory,
      });

      const assistantMessage = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      this.conversationHistory.push({ role: 'assistant', content: assistantMessage });

      // Parse the JSON response
      const critique = parseAnthropicResponse(assistantMessage);

      // Add completion event
      const inputTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;
      const completionEvent = makeStreamEvent(
        'status',
        `Turn completed • ${(inputTokens + outputTokens).toLocaleString()} tokens used`,
        Date.now(),
      );
      events.push(completionEvent);
      onEvent?.(completionEvent);

      // Add assistant response event
      const verdictPreview = `${critique.verdict}: ${critique.why.slice(0, 100)}${critique.why.length > 100 ? '...' : ''}`;
      const assistantEvent = makeStreamEvent('assistant', verdictPreview, Date.now());
      events.push(assistantEvent);
      onEvent?.(assistantEvent);

      return { critique, streamEvents: events };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Anthropic API error';
      const errorEvent = makeStreamEvent('error', `Review failed: ${errorMessage}`, Date.now());
      events.push(errorEvent);
      onEvent?.(errorEvent);
      throw error;
    }
  }
}

/**
 * Anthropic Claude provider implementation
 */
export class AnthropicProvider implements AgentProviderInterface {
  readonly name = 'anthropic' as const;
  private client: Anthropic | null = null;

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }
    return this.client;
  }

  createSession(model: string): AgentSession {
    return new AnthropicSession(this.getClient(), model);
  }

  async resumeSession(sessionId: string, model: string): Promise<AgentSession | null> {
    // Anthropic doesn't support session resumption in the same way as OpenAI Codex
    // For now, we create a new session
    // In the future, we could implement conversation state persistence
    return null;
  }
}

// Singleton instance
let anthropicProviderInstance: AnthropicProvider | null = null;

export function getAnthropicProvider(): AnthropicProvider {
  if (!anthropicProviderInstance) {
    anthropicProviderInstance = new AnthropicProvider();
  }
  return anthropicProviderInstance;
}

// Helper functions

let streamEventCounter = 0;

function makeStreamEvent(
  tag: StreamEvent['tag'],
  message: string,
  timestamp: number,
): StreamEvent {
  return {
    id: `evt-${timestamp}-${++streamEventCounter}`,
    timestamp,
    tag,
    message: message.slice(0, 600),
  };
}

function parseAnthropicResponse(response: string): CritiqueResponse {
  // Try to extract JSON from the response
  let jsonStr = response.trim();

  // Remove markdown code blocks if present
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // Try to find JSON object in the response
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonStr = objectMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);

    // Validate and normalize the response
    const verdict = normalizeVerdict(parsed.verdict);
    const why = typeof parsed.why === 'string' ? parsed.why : '';
    const alternatives = typeof parsed.alternatives === 'string' ? parsed.alternatives : '';
    const messageForAgent = typeof parsed.message_for_agent === 'string' ? parsed.message_for_agent : '';

    // Enforce non-empty why for non-Approved verdicts
    if (verdict !== 'Approved' && !why.trim()) {
      throw new Error('Non-Approved verdict requires a "why" explanation');
    }

    return {
      verdict,
      why,
      alternatives,
      message_for_agent: messageForAgent,
    };
  } catch (parseError) {
    // If JSON parsing fails, try to extract structured data from text
    return extractCritiqueFromText(response);
  }
}

function normalizeVerdict(verdict: unknown): CritiqueResponse['verdict'] {
  if (typeof verdict !== 'string') {
    return 'Concerns';
  }

  const normalized = verdict.toLowerCase().trim();
  if (normalized === 'approved' || normalized === 'approve') {
    return 'Approved';
  }
  if (normalized.includes('critical')) {
    return 'Critical Issues';
  }
  return 'Concerns';
}

function extractCritiqueFromText(text: string): CritiqueResponse {
  // Fallback: try to extract structured data from unstructured text
  const lowerText = text.toLowerCase();

  let verdict: CritiqueResponse['verdict'] = 'Concerns';
  if (lowerText.includes('approved') || lowerText.includes('looks good') || lowerText.includes('no issues')) {
    verdict = 'Approved';
  } else if (lowerText.includes('critical') || lowerText.includes('serious') || lowerText.includes('major issue')) {
    verdict = 'Critical Issues';
  }

  return {
    verdict,
    why: text.slice(0, 1000),
    alternatives: '',
    message_for_agent: '',
  };
}
