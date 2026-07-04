import type { AiCallRequest, AiCallResponse, AiProvider } from './provider.js';

/**
 * Deterministic mock provider for tests and local development.
 * Returns canned responses keyed by prompt template id; falls back to an
 * echo response. Never touches the network.
 */
export class MockAiProvider implements AiProvider {
  readonly name = 'mock' as const;

  private readonly cannedResponses: Map<string, unknown>;

  constructor(cannedResponses?: Record<string, unknown>) {
    this.cannedResponses = new Map(Object.entries(cannedResponses ?? {}));
  }

  async call<T = unknown>(
    request: AiCallRequest,
    renderedPrompt: string,
  ): Promise<AiCallResponse<T>> {
    const canned = this.cannedResponses.get(request.promptTemplateId);
    const output = (canned ?? { mock: true, echo: renderedPrompt.slice(0, 200) }) as T;
    if (request.outputSchema && canned !== undefined) {
      request.outputSchema.parse(canned);
    }
    return {
      output,
      trace: {
        provider: this.name,
        model: 'mock-model-v1',
        latencyMs: 0,
        inputTokens: Math.ceil(renderedPrompt.length / 4),
        outputTokens: 32,
        estimatedCostUsd: 0,
      },
    };
  }
}
