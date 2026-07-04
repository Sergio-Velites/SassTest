import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AppError } from './errors.js';
import { isUuid, type OrganizationId, type UserId } from './ids.js';
import { err, ok, unwrap } from './result.js';
import { assertSameTenant, type TenantContext } from './tenant.js';

test('isUuid accepts valid v4 UUIDs and rejects garbage', () => {
  assert.equal(isUuid('4fa2c8a2-9d1b-4f6e-8b6a-2f0d3c4e5a6b'), true);
  assert.equal(isUuid('not-a-uuid'), false);
  assert.equal(isUuid(''), false);
});

test('Result ok/err/unwrap behave as expected', () => {
  const good = ok(42);
  assert.equal(good.ok, true);
  assert.equal(unwrap(good), 42);

  const bad = err(new AppError('NOT_FOUND', 'missing'));
  assert.equal(bad.ok, false);
  assert.throws(() => unwrap(bad), /missing/);
});

test('assertSameTenant hides cross-tenant rows as NOT_FOUND', () => {
  const ctx: TenantContext = {
    organizationId: 'org-a' as OrganizationId,
    userId: 'user-1' as UserId,
    role: 'admin',
  };
  assert.doesNotThrow(() => assertSameTenant(ctx, { organizationId: 'org-a' }, 'workflow'));
  assert.throws(
    () => assertSameTenant(ctx, { organizationId: 'org-b' }, 'workflow'),
    (e: unknown) => e instanceof AppError && e.code === 'NOT_FOUND',
  );
});
