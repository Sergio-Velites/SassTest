/**
 * Idempotent development seed. Run with: pnpm --filter @flowhub/database db:seed
 * Creates: plan catalog, permission catalog, demo org + user, Invoice Intake
 * Demo template (published) and system AI prompt templates.
 *
 * NEVER run against production — guarded below.
 */
import { eq } from 'drizzle-orm';

import { createDb } from './client.js';
import {
  AI_PROMPT_SEED,
  INVOICE_INTAKE_DEFINITION,
  PERMISSION_SEED,
  PLAN_SEED,
} from './seed-data.js';
import {
  aiPromptTemplates,
  organizationMembers,
  organizations,
  permissions,
  plans,
  subscriptions,
  users,
  workflowTemplates,
  workflowTemplateVersions,
} from './schema/index.js';

const DEMO_ORG_SLUG = 'demo';
const DEMO_USER_EMAIL = 'demo@flowhub.local';

async function seed(databaseUrl: string): Promise<void> {
  const handle = createDb(databaseUrl, { maxConnections: 2 });
  const { db } = handle;

  try {
    // --- global catalogs -----------------------------------------------
    for (const plan of PLAN_SEED) {
      await db
        .insert(plans)
        .values({ ...plan, limits: plan.limits })
        .onConflictDoNothing({ target: plans.slug });
    }
    for (const permission of PERMISSION_SEED) {
      await db.insert(permissions).values(permission).onConflictDoNothing({
        target: permissions.key,
      });
    }

    // --- demo user + organization --------------------------------------
    let [demoUser] = await db.select().from(users).where(eq(users.email, DEMO_USER_EMAIL));
    if (!demoUser) {
      // passwordHash is set in Cycle 5 when auth lands; NULL blocks login until then.
      [demoUser] = await db
        .insert(users)
        .values({ email: DEMO_USER_EMAIL, name: 'Demo User', passwordHash: null })
        .returning();
    }
    if (!demoUser) throw new Error('failed to seed demo user');

    let [demoOrg] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, DEMO_ORG_SLUG));
    if (!demoOrg) {
      [demoOrg] = await db
        .insert(organizations)
        .values({ name: 'Demo Corp', slug: DEMO_ORG_SLUG, plan: 'free', createdBy: demoUser.id })
        .returning();
    }
    if (!demoOrg) throw new Error('failed to seed demo organization');

    await db
      .insert(organizationMembers)
      .values({ organizationId: demoOrg.id, userId: demoUser.id, role: 'owner' })
      .onConflictDoNothing();

    const [existingSub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, demoOrg.id));
    if (!existingSub) {
      await db
        .insert(subscriptions)
        .values({ organizationId: demoOrg.id, planSlug: 'free', status: 'active' });
    }

    // --- Invoice Intake Demo template -----------------------------------
    const [existingTemplate] = await db
      .select()
      .from(workflowTemplates)
      .where(eq(workflowTemplates.name, 'Invoice Intake Demo'));
    if (!existingTemplate) {
      const [template] = await db
        .insert(workflowTemplates)
        .values({
          organizationId: demoOrg.id,
          name: 'Invoice Intake Demo',
          description: INVOICE_INTAKE_DEFINITION.description,
          category: 'finance',
          status: 'published',
          createdBy: demoUser.id,
        })
        .returning();
      if (!template) throw new Error('failed to seed workflow template');
      await db.insert(workflowTemplateVersions).values({
        workflowTemplateId: template.id,
        version: '1.0.0',
        definition: INVOICE_INTAKE_DEFINITION,
        changelog: 'Initial published version',
        publishedAt: new Date(),
        createdBy: demoUser.id,
      });
    }

    // --- system AI prompt templates -------------------------------------
    for (const prompt of AI_PROMPT_SEED) {
      await db
        .insert(aiPromptTemplates)
        .values({ organizationId: null, ...prompt, outputSchema: prompt.outputSchema })
        .onConflictDoNothing();
    }

    // eslint-disable-next-line no-console -- CLI script feedback, not app logging
    console.log('Seed completed: plans, permissions, demo org/user, Invoice Intake Demo template');
  } finally {
    await handle.close();
  }
}

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('DATABASE_URL is required (see .env.example)');
  process.exit(1);
}
if (process.env['NODE_ENV'] === 'production') {
  console.error('Refusing to seed a production environment');
  process.exit(1);
}

await seed(databaseUrl);
