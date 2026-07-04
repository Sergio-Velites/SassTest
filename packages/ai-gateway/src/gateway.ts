import { AppError } from '@flowhub/shared';

import type { AiCallTrace, AiProvider } from './provider.js';
import { validateAgainstSchema, type JsonSchemaLike } from './schema-validate.js';

/** Where prompt templates come from (ai_prompt_templates in production). */
export interface PromptTemplateSource {
  /** Org-specific template wins; organizationId null = system template. */
  get(
    organizationId: string,
    slug: string,
    version: number,
  ): Promise<{
    id: string;
    template: string;
    outputSchema: JsonSchemaLike | null;
  } | null>;
}

export interface AiCallRecord {
  organizationId: string;
  executionId?: string | undefined;
  promptTemplateId: string;
  trace: AiCallTrace;
  status: 'succeeded' | 'failed' | 'schema_mismatch';
  /** Safe metadata only — never prompt/response content. */
  error?: { code: string; message: string };
}

/** Persistence for mandatory per-call traces (ai_calls in production). */
export interface AiCallSink {
  record(call: AiCallRecord): Promise<void>;
}

/** Monthly spend lookup for the budget guardrail. */
export interface AiBudget {
  spentThisMonthUsd(organizationId: string): Promise<number>;
}

export interface AiGatewayOptions {
  provider: AiProvider;
  templates: PromptTemplateSource;
  sink: AiCallSink;
  budget: AiBudget;
  /** Hard monthly cap in USD per organization; <= 0 disables the guardrail. */
  monthlyCostCapUsd: number;
  /** Per-call provider timeout. */
  timeoutMs?: number;
  /** Each interpolated variable is truncated to this many characters. */
  maxVariableChars?: number;
}

export interface GatewayCallInput {
  organizationId: string;
  /** Logical template id: `slug@version`, e.g. 'invoice-classify@1'. */
  promptTemplateId: string;
  variables: Record<string, string>;
  executionId?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_VARIABLE_CHARS = 8_000;

/**
 * The single entry point for AI calls (ADR-0007). Renders versioned
 * templates, enforces the org budget, times out slow providers, validates
 * structured output and records a trace for every call.
 */
export class AiGateway {
  constructor(private readonly options: AiGatewayOptions) {}

  async call(input: GatewayCallInput): Promise<{ output: unknown; trace: AiCallTrace }> {
    const { provider, templates, sink, budget, monthlyCostCapUsd } = this.options;

    if (monthlyCostCapUsd > 0) {
      const spent = await budget.spentThisMonthUsd(input.organizationId);
      if (spent >= monthlyCostCapUsd) {
        throw new AppError('RATE_LIMITED', 'Monthly AI budget exceeded for this organization', {
          spentUsd: Number(spent.toFixed(4)),
          capUsd: monthlyCostCapUsd,
        });
      }
    }

    const parsed = /^(.+)@(\d+)$/.exec(input.promptTemplateId);
    if (!parsed || !parsed[1] || !parsed[2]) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Invalid prompt template id '${input.promptTemplateId}' — expected slug@version`,
      );
    }
    const template = await templates.get(input.organizationId, parsed[1], Number(parsed[2]));
    if (!template) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Prompt template not found: ${input.promptTemplateId}`,
      );
    }

    const renderedPrompt = renderTemplate(
      template.template,
      input.variables,
      this.options.maxVariableChars ?? DEFAULT_MAX_VARIABLE_CHARS,
    );

    let response;
    try {
      response = await withTimeout(
        provider.call(
          { promptTemplateId: input.promptTemplateId, variables: input.variables },
          renderedPrompt,
        ),
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
    } catch (error) {
      const message = (error as Error).message;
      await sink.record({
        organizationId: input.organizationId,
        executionId: input.executionId,
        promptTemplateId: input.promptTemplateId,
        trace: emptyTrace(provider),
        status: 'failed',
        error: { code: 'AI_PROVIDER_ERROR', message },
      });
      throw new AppError('AI_PROVIDER_ERROR', `AI provider call failed: ${message}`);
    }

    if (template.outputSchema) {
      const problems = validateAgainstSchema(response.output, template.outputSchema);
      if (problems.length > 0) {
        await sink.record({
          organizationId: input.organizationId,
          executionId: input.executionId,
          promptTemplateId: input.promptTemplateId,
          trace: response.trace,
          status: 'schema_mismatch',
          error: { code: 'AI_PROVIDER_ERROR', message: problems.join('; ') },
        });
        throw new AppError(
          'AI_PROVIDER_ERROR',
          `AI output did not match the expected schema: ${problems.join('; ')}`,
        );
      }
    }

    await sink.record({
      organizationId: input.organizationId,
      executionId: input.executionId,
      promptTemplateId: input.promptTemplateId,
      trace: response.trace,
      status: 'succeeded',
    });
    return { output: response.output, trace: response.trace };
  }
}

function renderTemplate(
  template: string,
  variables: Record<string, string>,
  maxVariableChars: number,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (_all, name: string) => {
    const value = variables[name] ?? '';
    return value.length > maxVariableChars
      ? `${value.slice(0, maxVariableChars)}…[truncated]`
      : value;
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function emptyTrace(provider: AiProvider): AiCallTrace {
  return {
    provider: provider.name,
    model: 'unknown',
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  };
}

// ---------------------------------------------------------------------------
// In-memory implementations for tests and keyless local development
// ---------------------------------------------------------------------------

export class InMemoryPromptSource implements PromptTemplateSource {
  constructor(
    private readonly templates: Record<string, { template: string; outputSchema?: JsonSchemaLike }>,
  ) {}

  async get(_organizationId: string, slug: string, version: number) {
    const key = `${slug}@${version}`;
    const found = this.templates[key];
    if (!found) return null;
    return { id: key, template: found.template, outputSchema: found.outputSchema ?? null };
  }
}

export class InMemoryAiCallSink implements AiCallSink {
  readonly calls: AiCallRecord[] = [];
  async record(call: AiCallRecord): Promise<void> {
    this.calls.push(call);
  }
}

export class FixedBudget implements AiBudget {
  constructor(private readonly spentUsd: number) {}
  async spentThisMonthUsd(): Promise<number> {
    return this.spentUsd;
  }
}

/**
 * Adapts a bare AiProvider to the engine's AI port shape — used in tests and
 * anywhere the full gateway (templates/budget/sink) is not needed.
 */
export function providerPort(provider: AiProvider): {
  call(input: {
    organizationId: string;
    executionId?: string;
    promptTemplateId: string;
    variables: Record<string, string>;
  }): Promise<{ output: unknown }>;
} {
  return {
    call: async (input) => {
      const response = await provider.call(
        { promptTemplateId: input.promptTemplateId, variables: input.variables },
        `[${input.promptTemplateId}] ${JSON.stringify(input.variables)}`,
      );
      return { output: response.output };
    },
  };
}
