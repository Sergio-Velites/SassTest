/**
 * Live-database tests. They run when DATABASE_URL is set (local dev and CI
 * with the postgres service) and skip otherwise, so `pnpm test` never breaks
 * on machines without PostgreSQL.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { and, eq } from 'drizzle-orm';

import { createDb } from './client.js';
import {
  installedWorkflows,
  organizationMembers,
  organizations,
  users,
  workflowVersions,
} from './schema/index.js';

const databaseUrl = process.env['DATABASE_URL'];
const skip = databaseUrl ? false : 'DATABASE_URL not set — skipping live DB tests';

function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** Drizzle wraps pg errors ("Failed query: …") — match against the full chain. */
function rejectionMatching(pattern: RegExp): (error: unknown) => boolean {
  return (error: unknown) => {
    let message = '';
    let current: unknown = error;
    while (current instanceof Error) {
      message += ` ${current.message}`;
      current = current.cause;
    }
    return pattern.test(message);
  };
}

test('tenant filtering returns only the requesting organization data', { skip }, async () => {
  const handle = createDb(databaseUrl as string, { maxConnections: 2 });
  const { db } = handle;
  try {
    const [alice] = await db
      .insert(users)
      .values({ email: `${uniqueSlug('alice')}@test.local`, name: 'Alice' })
      .returning();
    const [orgA] = await db
      .insert(organizations)
      .values({ name: 'Org A', slug: uniqueSlug('org-a'), createdBy: alice?.id })
      .returning();
    const [orgB] = await db
      .insert(organizations)
      .values({ name: 'Org B', slug: uniqueSlug('org-b'), createdBy: alice?.id })
      .returning();
    assert.ok(alice && orgA && orgB);

    await db.insert(organizationMembers).values([
      { organizationId: orgA.id, userId: alice.id, role: 'owner' },
      { organizationId: orgB.id, userId: alice.id, role: 'viewer' },
    ]);

    // The tenant-scoped query pattern every repository must follow:
    const membersOfA = await db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, orgA.id));
    assert.equal(membersOfA.length, 1);
    assert.equal(membersOfA[0]?.role, 'owner');

    // Cross-tenant lookup with both filters yields nothing (NOT_FOUND path).
    const crossTenant = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, orgB.id),
          eq(organizationMembers.id, membersOfA[0]?.id ?? ''),
        ),
      );
    assert.equal(crossTenant.length, 0);
  } finally {
    await handle.close();
  }
});

test(
  'only one current workflow version per installation (partial unique index)',
  { skip },
  async () => {
    const handle = createDb(databaseUrl as string, { maxConnections: 2 });
    const { db } = handle;
    try {
      const [org] = await db
        .insert(organizations)
        .values({ name: 'Versioning Org', slug: uniqueSlug('org-v') })
        .returning();
      assert.ok(org);
      const [installed] = await db
        .insert(installedWorkflows)
        .values({ organizationId: org.id, name: 'Demo install' })
        .returning();
      assert.ok(installed);

      await db.insert(workflowVersions).values({
        organizationId: org.id,
        installedWorkflowId: installed.id,
        version: 1,
        definition: {},
        isCurrent: true,
      });
      await assert.rejects(
        db.insert(workflowVersions).values({
          organizationId: org.id,
          installedWorkflowId: installed.id,
          version: 2,
          definition: {},
          isCurrent: true,
        }),
        rejectionMatching(/duplicate key|unique/i),
      );
    } finally {
      await handle.close();
    }
  },
);

test('CHECK constraints reject invalid enum values', { skip }, async () => {
  const handle = createDb(databaseUrl as string, { maxConnections: 2 });
  const { db } = handle;
  try {
    const [org] = await db
      .insert(organizations)
      .values({ name: 'Check Org', slug: uniqueSlug('org-c') })
      .returning();
    assert.ok(org);
    const [user] = await db
      .insert(users)
      .values({ email: `${uniqueSlug('bob')}@test.local`, name: 'Bob' })
      .returning();
    assert.ok(user);
    await assert.rejects(
      db
        .insert(organizationMembers)
        .values({ organizationId: org.id, userId: user.id, role: 'superadmin' }),
      rejectionMatching(/check constraint|violates/i),
    );
  } finally {
    await handle.close();
  }
});
