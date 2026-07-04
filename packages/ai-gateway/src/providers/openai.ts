import type { AiCallRequest, AiCallResponse, AiProvider } from '../provider.js';

/**
 * OpenAI provider over plain fetch (no SDK dependency). Activated with
 * AI_PROVIDER=openai + OPENAI_API_KEY. Requests JSON output and parses it.
 */
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai' as const;

  constructor(
    private readonly apiKey: string,
    private readonly model = 'gpt-4o-mini',
  ) {}

  async call<T = unknown>(
    _request: AiCallRequest,
    renderedPrompt: string,
  ): Promise<AiCallResponse<T>> {
    const startedAt = Date.now();
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: renderedPrompt }],
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = body.choices[0]?.message.content ?? '{}';
    const inputTokens = body.usage?.prompt_tokens ?? 0;
    const outputTokens = body.usage?.completion_tokens ?? 0;
    return {
      output: JSON.parse(content) as T,
      trace: {
        provider: this.name,
        model: this.model,
        latencyMs: Date.now() - startedAt,
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimateOpenAiCost(this.model, inputTokens, outputTokens),
      },
    };
  }
}

/** Rough per-1M-token prices; keep conservative and update as needed. */
function estimateOpenAiCost(model: string, inputTokens: number, outputTokens: number): number {
  const prices: Record<string, [number, number]> = {
    'gpt-4o-mini': [0.15, 0.6],
    'gpt-4o': [2.5, 10],
  };
  const [inPrice, outPrice] = prices[model] ?? [1, 3];
  return (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;
}
