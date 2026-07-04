import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { workflowExecutionSteps, workflowExecutions } from './executions.js';
import { id, timestamps } from './helpers.js';
import { organizations } from './identity.js';

export const aiPromptTemplates = pgTable(
  'ai_prompt_templates',
  {
    id: id(),
    /** NULL = first-party system template. */
    organizationId: uuid('organization_id').references(() => organizations.id),
    slug: text('slug').notNull(),
    /** Logical id is `slug@version`. */
    version: integer('version').notNull(),
    /** Template body with {{var}} placeholders. */
    template: text('template').notNull(),
    /** JSON schema for structured output, when required. */
    outputSchema: jsonb('output_schema'),
    modelHint: text('model_hint'),
    ...timestamps,
  },
  (t) => [uniqueIndex('ai_prompt_templates_unique').on(t.organizationId, t.slug, t.version)],
);

/** Mandatory trace for every AI call (ADR-0007). Append-only. */
export const aiCalls = pgTable(
  'ai_calls',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    workflowExecutionId: uuid('workflow_execution_id').references(() => workflowExecutions.id),
    stepId: uuid('step_id').references(() => workflowExecutionSteps.id),
    promptTemplateId: uuid('prompt_template_id')
      .notNull()
      .references(() => aiPromptTemplates.id),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 10, scale: 6 })
      .notNull()
      .default('0'),
    latencyMs: integer('latency_ms'),
    status: text('status').notNull(),
    /** Never contains prompt/response content — codes and safe messages only. */
    error: jsonb('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_calls_org_created_idx').on(t.organizationId, t.createdAt),
    check(
      'ai_calls_provider_check',
      sql`${t.provider} IN ('mock', 'openai', 'anthropic', 'gemini')`,
    ),
    check('ai_calls_status_check', sql`${t.status} IN ('succeeded', 'failed', 'schema_mismatch')`),
  ],
);
