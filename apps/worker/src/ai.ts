import type {
  AiBudget,
  AiCallRecord,
  AiCallSink,
  JsonSchemaLike,
  PromptTemplateSource,
} from '@flowhub/ai-gateway';
import type { Db } from '@flowhub/database';
import { schema } from '@flowhub/database';
import { and, desc, eq, gte, isNull, or, sql } from 'drizzle-orm';

/**
 * Drizzle implementations of the AI Gateway ports. Org-specific templates
 * override system ones (organization_id NULL).
 */
export class DrizzlePromptSource implements PromptTemplateSource {
  constructor(private readonly db: Db) {}

  async get(organizationId: string, slug: string, version: number) {
    const [row] = await this.db
      .select()
      .from(schema.aiPromptTemplates)
      .where(
        and(
          eq(schema.aiPromptTemplates.slug, slug),
          eq(schema.aiPromptTemplates.version, version),
          or(
            eq(schema.aiPromptTemplates.organizationId, organizationId),
            isNull(schema.aiPromptTemplates.organizationId),
          ),
        ),
      )
      // Org-specific first (NULLs last), then latest.
      .orderBy(sql`${schema.aiPromptTemplates.organizationId} NULLS LAST`)
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      template: row.template,
      outputSchema: (row.outputSchema ?? null) as JsonSchemaLike | null,
    };
  }
}

export class DrizzleAiCallSink implements AiCallSink {
  private readonly templateIdCache = new Map<string, string>();

  constructor(private readonly db: Db) {}

  async record(call: AiCallRecord): Promise<void> {
    const templateDbId = await this.resolveTemplateId(call);
    if (!templateDbId) return; // template vanished — never block the execution on tracing
    await this.db.insert(schema.aiCalls).values({
      organizationId: call.organizationId,
      workflowExecutionId: call.executionId ?? null,
      promptTemplateId: templateDbId,
      provider: call.trace.provider,
      model: call.trace.model,
      inputTokens: call.trace.inputTokens,
      outputTokens: call.trace.outputTokens,
      estimatedCostUsd: call.trace.estimatedCostUsd.toFixed(6),
      latencyMs: call.trace.latencyMs,
      status: call.status,
      error: call.error ?? null,
    });
  }

  private async resolveTemplateId(call: AiCallRecord): Promise<string | null> {
    const cached = this.templateIdCache.get(call.promptTemplateId);
    if (cached) return cached;
    const parsed = /^(.+)@(\d+)$/.exec(call.promptTemplateId);
    if (!parsed || !parsed[1] || !parsed[2]) return null;
    const [row] = await this.db
      .select({ id: schema.aiPromptTemplates.id })
      .from(schema.aiPromptTemplates)
      .where(
        and(
          eq(schema.aiPromptTemplates.slug, parsed[1]),
          eq(schema.aiPromptTemplates.version, Number(parsed[2])),
          or(
            eq(schema.aiPromptTemplates.organizationId, call.organizationId),
            isNull(schema.aiPromptTemplates.organizationId),
          ),
        ),
      )
      .orderBy(desc(schema.aiPromptTemplates.createdAt))
      .limit(1);
    if (!row) return null;
    this.templateIdCache.set(call.promptTemplateId, row.id);
    return row.id;
  }
}

export class DrizzleAiBudget implements AiBudget {
  constructor(private readonly db: Db) {}

  async spentThisMonthUsd(organizationId: string): Promise<number> {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${schema.aiCalls.estimatedCostUsd}), 0)` })
      .from(schema.aiCalls)
      .where(
        and(
          eq(schema.aiCalls.organizationId, organizationId),
          gte(schema.aiCalls.createdAt, monthStart),
        ),
      );
    return Number(row?.total ?? 0);
  }
}
