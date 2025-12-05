import type { TurnSummary } from '../jsonl.js';

export interface CritiqueResponse {
  verdict: 'Approved' | 'Concerns' | 'Critical Issues';
  why: string;
  alternatives: string;
  message_for_agent: string;
}

export interface InitialReviewContext {
  sessionId: string;
  turns: TurnSummary[];
  latestTurnSummary?: {
    user: string;
    agent?: string;
  };
}

export interface FollowupReviewContext {
  sessionId: string;
  newTurns: TurnSummary[];
  isPartial?: boolean;
}

export interface PromptPayload {
  prompt: string;
  promptText: string;
  contextText: string;
}

export type StreamEventTag =
  | 'assistant'
  | 'reasoning'
  | 'command'
  | 'file'
  | 'todo'
  | 'status'
  | 'error';

export interface StreamEvent {
  id: string;
  timestamp: number;
  tag: StreamEventTag;
  message: string;
}

export interface RunReviewOptions {
  promptPayload?: PromptPayload;
  onEvent?: (event: StreamEvent) => void;
}

export interface ReviewResult {
  critique: CritiqueResponse;
  streamEvents: StreamEvent[];
}

export interface ChatResult {
  response: string;
}

/**
 * Abstract interface for agent sessions.
 * Each provider (OpenAI, Anthropic, Gemini) implements this interface
 * to provide review capabilities.
 */
export interface AgentSession {
  /**
   * Unique identifier for this session (provider-specific)
   */
  readonly id: string | null;

  /**
   * Run an initial review of a Claude Code session
   */
  runInitialReview(
    context: InitialReviewContext,
    options?: RunReviewOptions,
  ): Promise<ReviewResult>;

  /**
   * Run a follow-up review with new turns
   */
  runFollowupReview(
    context: FollowupReviewContext,
    options?: RunReviewOptions,
  ): Promise<ReviewResult>;

  /**
   * Chat with the agent (not a structured review)
   */
  chat(userQuestion: string): Promise<ChatResult>;
}

export type AgentProviderType = 'openai' | 'anthropic' | 'gemini';

/**
 * Factory interface for creating agent sessions
 */
export interface AgentProviderInterface {
  /**
   * Provider identifier
   */
  readonly name: AgentProviderType;

  /**
   * Check if this provider is available (authenticated)
   */
  isAvailable(): Promise<boolean>;

  /**
   * Create a new agent session
   */
  createSession(model: string): AgentSession;

  /**
   * Resume an existing session by ID (if supported)
   * Returns null if session cannot be resumed
   */
  resumeSession(sessionId: string, model: string): Promise<AgentSession | null>;
}
