import type { Db } from '@flowhub/database';
import { schema } from '@flowhub/database';

export interface AuditEntry {
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  /** Must already be free of secrets/PII — callers pass safe fields only. */
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/** Fire-and-forget style audit write; failures must not break the request. */
export async function writeAudit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(schema.auditLogs).values({
    organizationId: entry.organizationId,
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    metadata: entry.metadata ?? null,
    ipAddress: entry.ipAddress ?? null,
  });
}
