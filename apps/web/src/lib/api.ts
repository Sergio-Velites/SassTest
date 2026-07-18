import { z } from 'zod';

/**
 * Typed API client. Every call goes to the FlowHub API with credentials
 * (session cookie) and parses the response with a Zod schema — the frontend
 * never trusts unvalidated payloads.
 */

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: init?.method ?? 'GET',
    credentials: 'include',
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : {},
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (response.status === 204) {
    return schema.parse(null);
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(json);
    if (parsed.success) {
      throw new ApiError(response.status, parsed.data.error.code, parsed.data.error.message);
    }
    throw new ApiError(response.status, 'INTERNAL_ERROR', `HTTP ${response.status}`);
  }
  return schema.parse(json);
}

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

// ---------------------------------------------------------------------------
// Shared schemas (mirror the API responses we consume)
// ---------------------------------------------------------------------------

export const meSchema = z.object({
  user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
  activeOrganizationId: z.string().nullable(),
  memberships: z.array(
    z.object({
      organizationId: z.string(),
      organizationName: z.string(),
      organizationSlug: z.string(),
      role: z.enum(['owner', 'admin', 'member', 'viewer']),
    }),
  ),
});
export type Me = z.infer<typeof meSchema>;

export const catalogSchema = z.object({
  templates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      category: z.string(),
      latestVersionId: z.string().nullable(),
      latestVersion: z.string().nullable(),
    }),
  ),
});

export const workflowsSchema = z.object({
  workflows: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(['active', 'paused', 'archived']),
      fromTemplateVersionId: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

export const workflowDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['active', 'paused', 'archived']),
  currentVersion: z.number(),
  createdAt: z.string(),
  definition: z.record(z.unknown()),
});

export const executionSchema = z.object({
  id: z.string(),
  installedWorkflowId: z.string(),
  status: z.enum([
    'pending',
    'running',
    'waiting',
    'waiting_approval',
    'succeeded',
    'failed',
    'cancelled',
  ]),
  triggerType: z.string(),
  currentNodeId: z.string().nullable(),
  error: z.record(z.unknown()).nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Execution = z.infer<typeof executionSchema>;

export const executionsSchema = z.object({ executions: z.array(executionSchema) });

export const stepsSchema = z.object({
  steps: z.array(
    z.object({
      id: z.string(),
      nodeId: z.string(),
      nodeKind: z.string(),
      status: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']),
      attempt: z.number(),
      branch: z.string().nullable(),
      output: z.unknown().nullable(),
      error: z.record(z.unknown()).nullable(),
      startedAt: z.string().nullable(),
      finishedAt: z.string().nullable(),
    }),
  ),
});

export const logsSchema = z.object({
  logs: z.array(
    z.object({
      id: z.string(),
      stepId: z.string().nullable(),
      level: z.enum(['debug', 'info', 'warn', 'error']),
      message: z.string(),
      fields: z.record(z.unknown()).nullable(),
      createdAt: z.string(),
    }),
  ),
});

export const approvalsSchema = z.object({
  approvals: z.array(
    z.object({
      id: z.string(),
      workflowExecutionId: z.string(),
      nodeId: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      payload: z.record(z.unknown()).nullable(),
      requiredRole: z.string(),
      status: z.enum(['pending', 'approved', 'rejected', 'expired', 'cancelled']),
      resolutionComment: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

export const workflowVersionsSchema = z.object({
  versions: z.array(
    z.object({
      id: z.string(),
      version: z.number(),
      isCurrent: z.boolean(),
      createdAt: z.string(),
    }),
  ),
});

export const connectorCatalogSchema = z.object({
  connectors: z.array(
    z.object({
      slug: z.string(),
      displayName: z.string(),
      auth: z.enum(['none', 'api_key', 'oauth2']),
      available: z.boolean(),
      kind: z.enum(['mock', 'real']),
    }),
  ),
});

export const connectorAccountsSchema = z.object({
  accounts: z.array(
    z.object({
      id: z.string(),
      connectorSlug: z.string(),
      name: z.string(),
      authType: z.enum(['none', 'api_key', 'oauth2']),
      status: z.enum(['active', 'revoked', 'error']),
      createdAt: z.string(),
    }),
  ),
});
