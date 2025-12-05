import type { AgentProviderType } from './agents/types.js';

export interface ModelConfig {
  id: string;
  name: string;
  provider: AgentProviderType;
}

// OpenAI Codex models (via Codex SDK)
export const OPENAI_MODELS: ModelConfig[] = [
  { id: 'gpt-5.1-codex',      name: 'GPT-5.1 Codex',      provider: 'openai' },
  { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini', provider: 'openai' },
  { id: 'gpt-5.1',            name: 'GPT-5.1',            provider: 'openai' },
  { id: 'gpt-5',              name: 'GPT-5',              provider: 'openai' },
  { id: 'gpt-5-mini',         name: 'GPT-5 Mini',         provider: 'openai' },
  { id: 'gpt-5-nano',         name: 'GPT-5 Nano',         provider: 'openai' },
  { id: 'gpt-4.1',            name: 'GPT-4.1',            provider: 'openai' },
  { id: 'gpt-4.1-mini',       name: 'GPT-4.1 Mini',       provider: 'openai' },
  { id: 'gpt-4.1-nano',       name: 'GPT-4.1 Nano',       provider: 'openai' },
];

// Anthropic Claude models
export const ANTHROPIC_MODELS: ModelConfig[] = [
  { id: 'claude-sonnet-4-20250514',     name: 'Claude Sonnet 4',        provider: 'anthropic' },
  { id: 'claude-3-7-sonnet-20250219',   name: 'Claude 3.7 Sonnet',      provider: 'anthropic' },
  { id: 'claude-3-5-sonnet-20241022',   name: 'Claude 3.5 Sonnet',      provider: 'anthropic' },
  { id: 'claude-3-5-haiku-20241022',    name: 'Claude 3.5 Haiku',       provider: 'anthropic' },
  { id: 'claude-3-opus-20240229',       name: 'Claude 3 Opus',          provider: 'anthropic' },
];

// Google Gemini models
export const GEMINI_MODELS: ModelConfig[] = [
  { id: 'gemini-2.5-pro-preview-06-05',   name: 'Gemini 2.5 Pro',       provider: 'gemini' },
  { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash',     provider: 'gemini' },
  { id: 'gemini-2.0-flash',               name: 'Gemini 2.0 Flash',     provider: 'gemini' },
  { id: 'gemini-1.5-pro',                 name: 'Gemini 1.5 Pro',       provider: 'gemini' },
  { id: 'gemini-1.5-flash',               name: 'Gemini 1.5 Flash',     provider: 'gemini' },
];

// All available models
export const AVAILABLE_MODELS: ModelConfig[] = [
  ...OPENAI_MODELS,
  ...ANTHROPIC_MODELS,
  ...GEMINI_MODELS,
];

export const DEFAULT_MODEL = 'gpt-5.1-codex';
export const DEFAULT_PROVIDER: AgentProviderType = 'openai';

export type ModelId = (typeof AVAILABLE_MODELS)[number]['id'];

/**
 * Get the provider type for a given model ID
 */
export function getProviderForModel(modelId: string): AgentProviderType {
  const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
  return model?.provider ?? 'openai';
}

/**
 * Get models for a specific provider
 */
export function getModelsForProvider(provider: AgentProviderType): ModelConfig[] {
  return AVAILABLE_MODELS.filter((m) => m.provider === provider);
}

/**
 * Check if a model ID is valid
 */
export function isValidModel(modelId: string): boolean {
  return AVAILABLE_MODELS.some((m) => m.id === modelId);
}
