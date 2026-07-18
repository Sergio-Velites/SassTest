import { schema, type Db } from '@flowhub/database';
import { AppError, type TenantContext } from '@flowhub/shared';
import { and, count, eq, gte, isNull, sql } from 'drizzle-orm';

/**
 * Plan limit enforcement (Cycle 13). Limits live in plans.limits jsonb:
 * { maxUsers, maxInstalledWorkflows, maxExecutionsPerMonth, aiBudgetUsd }.
 * -1 means unlimited. Missing subscription falls back to the free plan.
 */

export type LimitedResource = 'users' | 'workflows' | 'executions';

interface PlanLimits {
  maxUsers: number;
  maxInstalledWorkflows: number;
  maxExecutionsPerMonth: number;
}

export async function getPlanForOrganization(
  db: Db,
  organizationId: string,
): Promise<{ planSlug: string; limits: PlanLimits }> {
  const [row] = await db
    .select({ planSlug: schema.subscriptions.planSlug, limits: schema.plans.limits })
    .from(schema.subscriptions)
    .innerJoin(schema.plans, eq(schema.subscriptions.planSlug, schema.plans.slug))
    .where(eq(schema.subscriptions.organizationId, organizationId));
  const raw = (row?.limits ?? {}) as Partial<PlanLimits>;
  return {
    planSlug: row?.planSlug ?? 'free',
    limits: {
      maxUsers: raw.maxUsers ?? 1,
      maxInstalledWorkflows: raw.maxInstalledWorkflows ?? 2,
      maxExecutionsPerMonth: raw.maxExecutionsPerMonth ?? 50,
    },
  };
}

/** Current consumption of each limited resource, for enforcement and the UI. */
export async function getPlanUsage(
  db: Db,
  organizationId: string,
): Promise<{ users: number; workflows: number; executionsThisMonth: number }> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [members] = await db
    .select({ value: count() })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.organizationId, organizationId));
  const [workflows] = await db
    .select({ value: count() })
    .from(schema.installedWorkflows)
    .where(
      and(
        eq(schema.installedWorkflows.organizationId, organizationId),
        isNull(schema.installedWorkflows.deletedAt),
      ),
    );
  const [executions] = await db
    .select({ value: sql<number>`coalesce(sum(${schema.usageEvents.quantity}), 0)::int` })
    .from(schema.usageEvents)
    .where(
      and(
        eq(schema.usageEvents.organizationId, organizationId),
        eq(schema.usageEvents.eventType, 'execution.triggered'),
        gte(schema.usageEvents.occurredAt, monthStart),
      ),
    );
  return {
    users: members?.value ?? 0,
    workflows: workflows?.value ?? 0,
    executionsThisMonth: executions?.value ?? 0,
  };
}

/**
 * Throws when adding one more unit of `resource` would exceed the plan.
 * users/workflows → FORBIDDEN (upgrade required); executions → RATE_LIMITED.
 */
export async function assertWithinPlanLimits(
  db: Db,
  tenant: TenantContext,
  resource: LimitedResource,
): Promise<void> {
  const { planSlug, limits } = await getPlanForOrganization(db, tenant.organizationId);
  const usage = await getPlanUsage(db, tenant.organizationId);

  const checks: Record<LimitedResource, { limit: number; current: number; label: string }> = {
    users: { limit: limits.maxUsers, current: usage.users, label: 'members' },
    workflows: {
      limit: limits.maxInstalledWorkflows,
      current: usage.workflows,
      label: 'installed workflows',
    },
    executions: {
      limit: limits.maxExecutionsPerMonth,
      current: usage.executionsThisMonth,
      label: 'executions this month',
    },
  };
  const check = checks[resource];
  if (check.limit < 0 || check.current < check.limit) return;

  const code = resource === 'executions' ? 'RATE_LIMITED' : 'FORBIDDEN';
  throw new AppError(
    code,
    `Plan limit reached (${planSlug}): ${check.current}/${check.limit} ${check.label}. Upgrade the plan to continue.`,
    { planSlug, resource, limit: check.limit },
  );
}
