import { GoogleGenerativeAI, GenerativeModel, Content, Part } from '@google/generative-ai';
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
 * Google Gemini-based agent session
 */
class GeminiSession implements AgentSession {
  private model: GenerativeModel;
  private sessionId: string;
  private conversationHistory: Content[] = [];

  constructor(model: GenerativeModel) {
    this.model = model;
    this.sessionId = `gemini-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
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

    this.conversationHistory.push({
      role: 'user',
      parts: [{ text: prompt }],
    });

    const chat = this.model.startChat({
      history: this.conversationHistory.slice(0, -1),
    });

    const result = await chat.sendMessage(prompt);
    const response = result.response;
    const assistantMessage = response.text();

    this.conversationHistory.push({
      role: 'model',
      parts: [{ text: assistantMessage }],
    });

    return { response: assistantMessage };
  }

  private async executeReview(
    prompt: string,
    onEvent?: (event: StreamEvent) => void,
  ): Promise<ReviewResult> {
    const events: StreamEvent[] = [];
    const timestamp = Date.now();

    // Add status event
    const startEvent = makeStreamEvent('status', 'Sending request to Gemini...', timestamp);
    events.push(startEvent);
    onEvent?.(startEvent);

    // Create the system instruction for structured output
    const systemInstruction = `You are Sage, an AI code reviewer. You MUST respond with a valid JSON object following this exact schema:
{
  "verdict": "Approved" | "Concerns" | "Critical Issues",
  "why": string (empty string "" for Approved, required content for other verdicts),
  "alternatives": string (suggested alternatives or empty string if none),
  "message_for_agent": string (direct message to Claude Code agent, or empty string if none)
}

IMPORTANT: Your response must be ONLY the JSON object, no additional text or markdown formatting.`;

    // Add prompt to conversation history
    this.conversationHistory.push({
      role: 'user',
      parts: [{ text: prompt }],
    });

    try {
      // Create a chat with history and system instruction
      const chat = this.model.startChat({
        history: this.conversationHistory.slice(0, -1),
        systemInstruction: systemInstruction,
      });

      const result = await chat.sendMessage(prompt);
      const response = result.response;
      const assistantMessage = response.text();

      this.conversationHistory.push({
        role: 'model',
        parts: [{ text: assistantMessage }],
      });

      // Parse the JSON response
      const critique = parseGeminiResponse(assistantMessage);

      // Add completion event
      const usageMetadata = response.usageMetadata;
      const totalTokens = (usageMetadata?.promptTokenCount ?? 0) + (usageMetadata?.candidatesTokenCount ?? 0);
      const completionEvent = makeStreamEvent(
        'status',
        `Turn completed • ${totalTokens.toLocaleString()} tokens used`,
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
      const errorMessage = error instanceof Error ? error.message : 'Gemini API error';
      const errorEvent = makeStreamEvent('error', `Review failed: ${errorMessage}`, Date.now());
      events.push(errorEvent);
      onEvent?.(errorEvent);
      throw error;
    }
  }
}

/**
 * Google Gemini provider implementation
 */
export class GeminiProvider implements AgentProviderInterface {
  readonly name = 'gemini' as const;
  private genAI: GoogleGenerativeAI | null = null;

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
  }

  private getGenAI(): GoogleGenerativeAI {
    if (!this.genAI) {
      const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY environment variable is required');
      }
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
    return this.genAI;
  }

  createSession(model: string): AgentSession {
    const generativeModel = this.getGenAI().getGenerativeModel({ model });
    return new GeminiSession(generativeModel);
  }

  async resumeSession(sessionId: string, model: string): Promise<AgentSession | null> {
    // Gemini doesn't support session resumption in the same way as OpenAI Codex
    // For now, we create a new session
    return null;
  }
}

// Singleton instance
let geminiProviderInstance: GeminiProvider | null = null;

export function getGeminiProvider(): GeminiProvider {
  if (!geminiProviderInstance) {
    geminiProviderInstance = new GeminiProvider();
  }
  return geminiProviderInstance;
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

function parseGeminiResponse(response: string): CritiqueResponse {
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
