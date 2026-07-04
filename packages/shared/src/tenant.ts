import { AppError } from './errors.js';
import type { OrganizationId, UserId } from './ids.js';

/**
 * TenantContext travels with every request and every job. Any data access
 * without a TenantContext is a bug by definition (see docs/security/SECURITY_MODEL.md).
 */
export interface TenantContext {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
  /** Role of the user inside this organization. */
  readonly role: 'owner' | 'admin' | 'member' | 'viewer';
}

/**
 * Guard that a row loaded from the database belongs to the tenant in context.
 * Defense-in-depth: repositories must already filter by organization_id,
 * but services re-assert ownership before returning data.
 */
export function assertSameTenant(
  ctx: TenantContext,
  row: { organizationId: string },
  resource: string,
): void {
  if (row.organizationId !== ctx.organizationId) {
    // Report as NOT_FOUND to callers: existence of other tenants' data must not leak.
    throw new AppError('NOT_FOUND', `${resource} not found`, {
      reason: 'TENANT_MISMATCH',
      resource,
    });
  }
}
