import type { AiCallRequest, AiCallResponse, AiProvider } from '../provider.js';

/**
 * Anthropic provider over plain fetch (no SDK dependency). Activated with
 * AI_PROVIDER=anthropic + ANTHROPIC_API_KEY. Requests JSON-only answers.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const;

  constructor(
    private readonly apiKey: string,
    private readonly model = 'claude-haiku-4-5-20251001',
  ) {}

  async call<T = unknown>(
    _request: AiCallRequest,
    renderedPrompt: string,
  ): Promise<AiCallResponse<T>> {
    const startedAt = Date.now();
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2048,
        system: 'Respond with a single valid JSON object and nothing else.',
        messages: [{ role: 'user', content: renderedPrompt }],
      }),
    });
    if (!response.ok) {
      throw new Error(`Anthropic HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = body.content.find((c) => c.type === 'text')?.text ?? '{}';
    const inputTokens = body.usage?.input_tokens ?? 0;
    const outputTokens = body.usage?.output_tokens ?? 0;
    return {
      output: JSON.parse(extractJson(text)) as T,
      trace: {
        provider: this.name,
        model: this.model,
        latencyMs: Date.now() - startedAt,
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimateAnthropicCost(this.model, inputTokens, outputTokens),
      },
    };
  }
}

/** Tolerates fenced or prefixed JSON in the model answer. */
function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : '{}';
}

/** Rough per-1M-token prices; keep conservative and update as needed. */
function estimateAnthropicCost(model: string, inputTokens: number, outputTokens: number): number {
  const prices: Record<string, [number, number]> = {
    'claude-haiku-4-5-20251001': [1, 5],
    'claude-sonnet-5': [3, 15],
  };
  const [inPrice, outPrice] = prices[model] ?? [3, 15];
  return (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;
}
