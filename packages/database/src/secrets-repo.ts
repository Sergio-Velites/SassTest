import { and, eq } from 'drizzle-orm';

import type { Db } from './client.js';
import { connectorSecrets } from './schema/index.js';

/**
 * Raw row store for encrypted connector credentials. Crypto lives in
 * @flowhub/connectors (DbSecretsStore); this only persists ciphertext,
 * always scoped by organization.
 */
export function createSecretRowStore(db: Db) {
  return {
    async insert(organizationId: string, ciphertext: string): Promise<string> {
      const [row] = await db
        .insert(connectorSecrets)
        .values({ organizationId, ciphertext })
        .returning({ id: connectorSecrets.id });
      if (!row) throw new Error('failed to persist secret');
      return row.id;
    },
    async get(organizationId: string, id: string): Promise<string | null> {
      const [row] = await db
        .select({ ciphertext: connectorSecrets.ciphertext })
        .from(connectorSecrets)
        .where(
          and(eq(connectorSecrets.id, id), eq(connectorSecrets.organizationId, organizationId)),
        );
      return row?.ciphertext ?? null;
    },
    async update(organizationId: string, id: string, ciphertext: string): Promise<void> {
      await db
        .update(connectorSecrets)
        .set({ ciphertext })
        .where(
          and(eq(connectorSecrets.id, id), eq(connectorSecrets.organizationId, organizationId)),
        );
    },
    async remove(organizationId: string, id: string): Promise<void> {
      await db
        .delete(connectorSecrets)
        .where(
          and(eq(connectorSecrets.id, id), eq(connectorSecrets.organizationId, organizationId)),
        );
    },
  };
}
