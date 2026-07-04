import { AppError } from '@flowhub/shared';

/**
 * Sliding-window rate limiter keyed by organization. In-memory and therefore
 * per-instance — good enough for the MVP's single API instance; swap for a
 * Redis-backed window before scaling Cloud Run horizontally (noted in the
 * tech debt list). The @fastify/rate-limit plugin cannot key by tenant
 * because it runs before the auth preHandler resolves the TenantContext.
 */
export class OrgRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Throws RATE_LIMITED when the organization exceeded the window. */
  check(organizationId: string): void {
    const cutoff = this.now() - this.windowMs;
    const entries = (this.hits.get(organizationId) ?? []).filter((t) => t > cutoff);
    if (entries.length >= this.max) {
      throw new AppError('RATE_LIMITED', 'Too many executions for this organization, slow down', {
        maxPerWindow: this.max,
        windowMs: this.windowMs,
      });
    }
    entries.push(this.now());
    this.hits.set(organizationId, entries);
  }
}
