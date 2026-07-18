import assert from 'node:assert/strict';
import { test } from 'node:test';

import { schema } from '@flowhub/database';

import {
  createTestApp,
  sessionCookieOf,
  skipWithoutDb,
  uniqueEmail,
  type TestApp,
} from '../../test-helpers.js';

const PASSWORD = 'correct-horse-battery';

const MINIMAL_DEFINITION = {
  name: 'Minimal flow',
  description: 'trigger → transform',
  nodes: [
    { id: 'start', kind: 'trigger', name: 'Manual', config: { type: 'manual' } },
    { id: 'step', kind: 'transform', name: 'Step', config: {} },
  ],
  edges: [{ from: 'start', to: 'step' }],
};

/** Registers a user and creates an organization; returns its session cookie. */
async function signupWithOrg(t: TestApp, prefix: string): Promise<{ cookie: string }> {
  const reg = await t.app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email: uniqueEmail(prefix), password: PASSWORD, name: prefix },
  });
  assert.equal(reg.statusCode, 201);
  const cookie = sessionCookieOf(reg);
  const org = await t.app.inject({
    method: 'POST',
    url: '/organizations',
    headers: { cookie },
    payload: {
      name: `${prefix} Org`,
      slug: `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e5)}`,
    },
  });
  assert.equal(org.statusCode, 201);
  return { cookie };
}

/** Seeds a published template directly in DB; returns its published version id. */
async function seedPublishedTemplate(t: TestApp): Promise<string> {
  const [orgRow] = await t.handle.db
    .insert(schema.organizations)
    .values({
      name: 'Creator Org',
      slug: `creator-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    })
    .returning();
  assert.ok(orgRow);
  const [template] = await t.handle.db
    .insert(schema.workflowTemplates)
    .values({
      organizationId: orgRow.id,
      name: 'Test Template',
      description: 'published for tests',
      category: 'ops',
      status: 'published',
    })
    .returning();
  assert.ok(template);
  const [version] = await t.handle.db
    .insert(schema.workflowTemplateVersions)
    .values({
      workflowTemplateId: template.id,
      version: '1.0.0',
      definition: MINIMAL_DEFINITION,
      publishedAt: new Date(),
    })
    .returning();
  assert.ok(version);
  return version.id;
}

test(
  'organization creation activates the tenant and lists members',
  { skip: skipWithoutDb },
  async () => {
    const t = await createTestApp();
    try {
      const { cookie } = await signupWithOrg(t, 'orgflow');
      const current = await t.app.inject({
        method: 'GET',
        url: '/organizations/current',
        headers: { cookie },
      });
      assert.equal(current.statusCode, 200);
      const members = await t.app.inject({
        method: 'GET',
        url: '/organizations/current/members',
        headers: { cookie },
      });
      assert.equal(members.statusCode, 200);
      assert.equal(members.json().members.length, 1);
      assert.equal(members.json().members[0].role, 'owner');
    } finally {
      await t.close();
    }
  },
);

test('invitation flow adds a member with the invited role', { skip: skipWithoutDb }, async () => {
  const t = await createTestApp();
  try {
    const { cookie: ownerCookie } = await signupWithOrg(t, 'inviter');
    // free allows a single user — upgrade first (mock checkout is synchronous).
    await t.app.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers: { cookie: ownerCookie },
      payload: { planSlug: 'starter' },
    });
    const invite = await t.app.inject({
      method: 'POST',
      url: '/organizations/current/invitations',
      headers: { cookie: ownerCookie },
      payload: { email: uniqueEmail('invitee'), role: 'member' },
    });
    assert.equal(invite.statusCode, 201);
    const token = invite.json().token as string;

    const invitee = await t.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: uniqueEmail('invitee'), password: PASSWORD, name: 'Invitee' },
    });
    const inviteeCookie = sessionCookieOf(invitee);
    const accept = await t.app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: { cookie: inviteeCookie },
      payload: { token },
    });
    assert.equal(accept.statusCode, 200);
    assert.equal(accept.json().role, 'member');

    // A second accept of the same token is rejected.
    const again = await t.app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: { cookie: inviteeCookie },
      payload: { token },
    });
    assert.equal(again.statusCode, 404);
  } finally {
    await t.close();
  }
});

test(
  'catalog lists published templates and install copies the definition',
  { skip: skipWithoutDb },
  async () => {
    const t = await createTestApp();
    try {
      const versionId = await seedPublishedTemplate(t);
      const { cookie } = await signupWithOrg(t, 'installer');

      const catalog = await t.app.inject({
        method: 'GET',
        url: '/catalog/templates',
        headers: { cookie },
      });
      assert.equal(catalog.statusCode, 200);
      assert.ok(
        catalog
          .json()
          .templates.some(
            (tpl: { latestVersionId: string | null }) => tpl.latestVersionId === versionId,
          ),
      );

      const install = await t.app.inject({
        method: 'POST',
        url: '/workflows/install',
        headers: { cookie },
        payload: { templateVersionId: versionId },
      });
      assert.equal(install.statusCode, 201);
      const workflowId = install.json().installedWorkflowId as string;

      const detail = await t.app.inject({
        method: 'GET',
        url: `/workflows/${workflowId}`,
        headers: { cookie },
      });
      assert.equal(detail.statusCode, 200);
      assert.equal(detail.json().currentVersion, 1);
      assert.equal(detail.json().definition.name, 'Minimal flow');
    } finally {
      await t.close();
    }
  },
);

test(
  'create from JSON validates the definition with clear errors',
  { skip: skipWithoutDb },
  async () => {
    const t = await createTestApp();
    try {
      const { cookie } = await signupWithOrg(t, 'jsonflow');
      const bad = await t.app.inject({
        method: 'POST',
        url: '/workflows',
        headers: { cookie },
        payload: { name: 'Broken', definition: { name: 'x', nodes: [], edges: [] } },
      });
      assert.equal(bad.statusCode, 400);
      assert.match(bad.json().error.message, /Invalid workflow definition/);

      const good = await t.app.inject({
        method: 'POST',
        url: '/workflows',
        headers: { cookie },
        payload: { name: 'Good', definition: MINIMAL_DEFINITION },
      });
      assert.equal(good.statusCode, 201);
    } finally {
      await t.close();
    }
  },
);

test(
  'workflows are tenant-isolated: foreign workflow is NOT_FOUND',
  { skip: skipWithoutDb },
  async () => {
    const t = await createTestApp();
    try {
      const { cookie: aCookie } = await signupWithOrg(t, 'tenant-a');
      const created = await t.app.inject({
        method: 'POST',
        url: '/workflows',
        headers: { cookie: aCookie },
        payload: { name: 'A private flow', definition: MINIMAL_DEFINITION },
      });
      const workflowId = created.json().installedWorkflowId as string;

      const { cookie: bCookie } = await signupWithOrg(t, 'tenant-b');
      const foreign = await t.app.inject({
        method: 'GET',
        url: `/workflows/${workflowId}`,
        headers: { cookie: bCookie },
      });
      assert.equal(foreign.statusCode, 404);
      assert.equal(foreign.json().error.code, 'NOT_FOUND');

      // And B's list does not contain A's workflow.
      const list = await t.app.inject({
        method: 'GET',
        url: '/workflows',
        headers: { cookie: bCookie },
      });
      assert.equal(list.json().workflows.length, 0);
    } finally {
      await t.close();
    }
  },
);

test('viewer role cannot install workflows (FORBIDDEN)', { skip: skipWithoutDb }, async () => {
  const t = await createTestApp();
  try {
    const versionId = await seedPublishedTemplate(t);
    const { cookie: ownerCookie } = await signupWithOrg(t, 'rbac-owner');
    await t.app.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers: { cookie: ownerCookie },
      payload: { planSlug: 'starter' },
    });
    const invite = await t.app.inject({
      method: 'POST',
      url: '/organizations/current/invitations',
      headers: { cookie: ownerCookie },
      payload: { email: uniqueEmail('viewer'), role: 'viewer' },
    });
    const token = invite.json().token as string;

    const viewer = await t.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: uniqueEmail('viewer'), password: PASSWORD, name: 'Viewer' },
    });
    const viewerCookie = sessionCookieOf(viewer);
    const accept = await t.app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: { cookie: viewerCookie },
      payload: { token },
    });
    const orgId = accept.json().organizationId as string;
    await t.app.inject({
      method: 'POST',
      url: '/auth/switch-organization',
      headers: { cookie: viewerCookie },
      payload: { organizationId: orgId },
    });

    const denied = await t.app.inject({
      method: 'POST',
      url: '/workflows/install',
      headers: { cookie: viewerCookie },
      payload: { templateVersionId: versionId },
    });
    assert.equal(denied.statusCode, 403);
  } finally {
    await t.close();
  }
});

test(
  'editing publishes a new current version and keeps history',
  { skip: skipWithoutDb },
  async () => {
    const t = await createTestApp();
    try {
      const { cookie } = await signupWithOrg(t, 'editor');
      const created = await t.app.inject({
        method: 'POST',
        url: '/workflows',
        headers: { cookie },
        payload: { name: 'Editable', definition: MINIMAL_DEFINITION },
      });
      const workflowId = created.json().installedWorkflowId as string;

      const edited = {
        ...MINIMAL_DEFINITION,
        nodes: [
          ...MINIMAL_DEFINITION.nodes,
          { id: 'extra', kind: 'transform', name: 'Extra step', config: {} },
        ],
        edges: [...MINIMAL_DEFINITION.edges, { from: 'step', to: 'extra' }],
      };
      const update = await t.app.inject({
        method: 'PUT',
        url: `/workflows/${workflowId}`,
        headers: { cookie },
        payload: { definition: edited },
      });
      assert.equal(update.statusCode, 200);
      assert.equal(update.json().version, 2);

      const detail = await t.app.inject({
        method: 'GET',
        url: `/workflows/${workflowId}`,
        headers: { cookie },
      });
      assert.equal(detail.json().currentVersion, 2);
      assert.equal(detail.json().definition.nodes.length, 3);

      const versions = await t.app.inject({
        method: 'GET',
        url: `/workflows/${workflowId}/versions`,
        headers: { cookie },
      });
      assert.equal(versions.statusCode, 200);
      const list = versions.json().versions as Array<{ version: number; isCurrent: boolean }>;
      assert.equal(list.length, 2);
      assert.deepEqual(
        list.map((v) => [v.version, v.isCurrent]),
        [
          [2, true],
          [1, false],
        ],
      );

      // Invalid edits are rejected without touching the version history.
      const bad = await t.app.inject({
        method: 'PUT',
        url: `/workflows/${workflowId}`,
        headers: { cookie },
        payload: { definition: { ...MINIMAL_DEFINITION, nodes: [] } },
      });
      assert.equal(bad.statusCode, 400);

      // Cross-tenant edit is NOT_FOUND.
      const { cookie: foreignCookie } = await signupWithOrg(t, 'editor-b');
      const foreign = await t.app.inject({
        method: 'PUT',
        url: `/workflows/${workflowId}`,
        headers: { cookie: foreignCookie },
        payload: { definition: MINIMAL_DEFINITION },
      });
      assert.equal(foreign.statusCode, 404);
    } finally {
      await t.close();
    }
  },
);
