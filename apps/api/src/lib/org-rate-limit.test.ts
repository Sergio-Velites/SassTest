import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isAppError } from '@flowhub/shared';

import { OrgRateLimiter } from './org-rate-limit.js';

test('allows up to max hits per window, then throws RATE_LIMITED', () => {
  let clock = 1_000_000;
  const limiter = new OrgRateLimiter(3, 60_000, () => clock);
  limiter.check('org-a');
  limiter.check('org-a');
  limiter.check('org-a');
  assert.throws(
    () => limiter.check('org-a'),
    (e: unknown) => isAppError(e) && e.code === 'RATE_LIMITED',
  );
  // Another org is unaffected.
  limiter.check('org-b');
  // The window slides: after windowMs the org can run again.
  clock += 61_000;
  limiter.check('org-a');
});
