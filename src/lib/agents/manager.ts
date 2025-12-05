import type { AgentProviderInterface, AgentProviderType, AgentSession } from './types.js';
import { getOpenAIProvider } from './openai.js';
import { getAnthropicProvider } from './anthropic.js';
import { getGeminiProvider } from './gemini.js';

/**
 * Get an agent provider by type
 */
export function getAgentProvider(type: AgentProviderType): AgentProviderInterface {
  switch (type) {
    case 'openai':
      return getOpenAIProvider();
    case 'anthropic':
      return getAnthropicProvider();
    case 'gemini':
      return getGeminiProvider();
    default:
      throw new Error(`Unknown agent provider type: ${type}`);
  }
}

/**
 * Get all available providers (ones that are authenticated)
 */
export async function getAvailableProviders(): Promise<AgentProviderType[]> {
  const providers: AgentProviderType[] = ['openai', 'anthropic', 'gemini'];
  const available: AgentProviderType[] = [];

  for (const type of providers) {
    const provider = getAgentProvider(type);
    if (await provider.isAvailable()) {
      available.push(type);
    }
  }

  return available;
}

/**
 * Create an agent session for a specific provider and model
 */
export function createAgentSession(
  providerType: AgentProviderType,
  model: string,
): AgentSession {
  const provider = getAgentProvider(providerType);
  return provider.createSession(model);
}

/**
 * Try to resume an agent session, or create a new one if resumption fails
 */
export async function getOrCreateAgentSession(
  providerType: AgentProviderType,
  sessionId: string | null,
  model: string,
): Promise<AgentSession> {
  const provider = getAgentProvider(providerType);

  if (sessionId) {
    const resumed = await provider.resumeSession(sessionId, model);
    if (resumed) {
      return resumed;
    }
  }

  return provider.createSession(model);
}
