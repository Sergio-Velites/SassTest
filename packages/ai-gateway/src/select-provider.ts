import { MockAiProvider } from './mock-provider.js';
import type { AiProvider } from './provider.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAiProvider } from './providers/openai.js';

export interface ProviderEnv {
  AI_PROVIDER: 'mock' | 'openai' | 'anthropic';
  OPENAI_API_KEY?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
}

/**
 * Provider selection by configuration (ADR-0007). Mock needs no keys and is
 * the default; real providers fail fast when their key is missing.
 */
export function createProviderFromEnv(
  env: ProviderEnv,
  mockResponses?: Record<string, unknown>,
): AiProvider {
  switch (env.AI_PROVIDER) {
    case 'openai':
      if (!env.OPENAI_API_KEY) throw new Error('AI_PROVIDER=openai requires OPENAI_API_KEY');
      return new OpenAiProvider(env.OPENAI_API_KEY);
    case 'anthropic':
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error('AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
      }
      return new AnthropicProvider(env.ANTHROPIC_API_KEY);
    default:
      return new MockAiProvider(mockResponses);
  }
}
