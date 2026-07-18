import type { Db } from '@flowhub/database';
import { schema } from '@flowhub/database';
import type { Logger } from '@flowhub/observability';
import type { PaymentGateway } from '@flowhub/payments';
import { AppError } from '@flowhub/shared';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { writeAudit } from '../../lib/audit.js';
import { getPlanForOrganization, getPlanUsage } from '../../lib/limits.js';
import { requireAuth, requireTenant } from '../../plugins/auth.js';

const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export interface BillingDeps {
  db: Db;
  logger: Logger;
  gateway: PaymentGateway;
  webUrl: string;
}

const PLAN_ORDER = ['free', 'starter', 'pro', 'business', 'enterprise'];

async function applyPlanChange(
  deps: BillingDeps,
  input: {
    organizationId: string;
    planSlug: string;
    status?: string;
    externalRef?: string;
    actorUserId?: string;
    periodStart?: Date;
    periodEnd?: Date;
  },
): Promise<void> {
  await deps.db
    .update(schema.subscriptions)
    .set({
      planSlug: input.planSlug,
      status: input.status ?? 'active',
      ...(input.externalRef ? { externalRef: input.externalRef } : {}),
      ...(input.periodStart ? { currentPeriodStart: input.periodStart } : {}),
      ...(input.periodEnd ? { currentPeriodEnd: input.periodEnd } : {}),
    })
    .where(eq(schema.subscriptions.organizationId, input.organizationId));
  await writeAudit(deps.db, {
    organizationId: input.organizationId,
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: 'billing.plan_changed',
    resourceType: 'subscription',
    resourceId: input.organizationId,
    metadata: { planSlug: input.planSlug, status: input.status ?? 'active' },
  });
  deps.logger.info('plan changed', {
    organizationId: input.organizationId,
    planSlug: input.planSlug,
  });
}

export function billingRoutes(deps: BillingDeps) {
  return async function routes(instance: FastifyInstance): Promise<void> {
    const app = instance.withTypeProvider<ZodTypeProvider>();
    const auth = requireAuth(deps.db);

    app.route({
      method: 'GET',
      url: '/billing/plans',
      preHandler: [auth, requireTenant('viewer')],
      schema: {
        tags: ['billing'],
        response: {
          200: z.object({
            plans: z.array(
              z.object({
                slug: z.string(),
                name: z.string(),
                priceCents: z.number(),
                currency: z.string(),
                limits: z.record(z.number()),
              }),
            ),
          }),
        },
      },
      handler: async (_request, reply) => {
        const rows = await deps.db.select().from(schema.plans).orderBy(schema.plans.priceCents);
        // Stable business order (enterprise is custom-priced at 0).
        rows.sort((a, b) => PLAN_ORDER.indexOf(a.slug) - PLAN_ORDER.indexOf(b.slug));
        return reply.status(200).send({
          plans: rows.map((p) => ({
            slug: p.slug,
            name: p.name,
            priceCents: p.priceCents,
            currency: p.currency,
            limits: p.limits as Record<string, number>,
          })),
        });
      },
    });

    app.route({
      method: 'GET',
      url: '/billing/subscription',
      preHandler: [auth, requireTenant('viewer')],
      schema: {
        tags: ['billing'],
        response: {
          200: z.object({
            planSlug: z.string(),
            status: z.string(),
            limits: z.record(z.number()),
            usage: z.object({
              users: z.number(),
              workflows: z.number(),
              executionsThisMonth: z.number(),
            }),
            gateway: z.enum(['mock', 'stripe']),
          }),
        },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        const [subscription] = await deps.db
          .select()
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.organizationId, tenant.organizationId));
        const plan = await getPlanForOrganization(deps.db, tenant.organizationId);
        const usage = await getPlanUsage(deps.db, tenant.organizationId);
        return reply.status(200).send({
          planSlug: plan.planSlug,
          status: subscription?.status ?? 'active',
          limits: plan.limits as unknown as Record<string, number>,
          usage,
          gateway: deps.gateway.kind,
        });
      },
    });

    app.route({
      method: 'POST',
      url: '/billing/checkout',
      preHandler: [auth, requireTenant('admin')],
      schema: {
        tags: ['billing'],
        body: z.object({ planSlug: z.string().min(1).max(40) }),
        response: {
          200: z.object({ url: z.string() }),
          404: errorResponseSchema,
        },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        const [plan] = await deps.db
          .select()
          .from(schema.plans)
          .where(eq(schema.plans.slug, request.body.planSlug));
        if (!plan) throw new AppError('NOT_FOUND', 'Plan not found');
        if (plan.slug === 'enterprise') {
          throw new AppError('VALIDATION_ERROR', 'Enterprise is quoted manually — contact sales');
        }

        const session = await deps.gateway.createCheckoutSession({
          organizationId: tenant.organizationId,
          planSlug: plan.slug,
          priceCents: plan.priceCents,
          currency: plan.currency,
          successUrl: `${deps.webUrl}/billing?upgraded=${plan.slug}`,
          cancelUrl: `${deps.webUrl}/billing?cancelled=1`,
        });
        // The mock gateway has no webhook: the "payment" succeeds instantly,
        // so the plan change applies synchronously (local/dev without keys).
        if (deps.gateway.kind === 'mock') {
          await applyPlanChange(deps, {
            organizationId: tenant.organizationId,
            planSlug: plan.slug,
            actorUserId: tenant.userId,
            externalRef: session.sessionId,
          });
        }
        return reply.status(200).send({ url: session.url });
      },
    });

    app.route({
      method: 'POST',
      url: '/billing/portal',
      preHandler: [auth, requireTenant('admin')],
      schema: {
        tags: ['billing'],
        response: { 200: z.object({ url: z.string() }), 404: errorResponseSchema },
      },
      handler: async (request, reply) => {
        const tenant = request.tenant;
        if (!tenant) throw new AppError('FORBIDDEN', 'An active organization is required');
        const [subscription] = await deps.db
          .select()
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.organizationId, tenant.organizationId));
        if (!subscription?.externalRef) {
          throw new AppError('NOT_FOUND', 'No billing profile yet — upgrade a plan first');
        }
        const session = await deps.gateway.createPortalSession({
          externalCustomerRef: subscription.externalRef,
          returnUrl: `${deps.webUrl}/billing`,
        });
        return reply.status(200).send({ url: session.url });
      },
    });

    /**
     * Stripe webhook. Registered in a child scope where application/json is
     * parsed as a raw string, because the signature covers the exact bytes.
     */
    await app.register(async (scope) => {
      scope.removeContentTypeParser('application/json');
      scope.addContentTypeParser(
        'application/json',
        { parseAs: 'string' },
        (_request, body, done) => done(null, body),
      );
      scope.withTypeProvider<ZodTypeProvider>().route({
        method: 'POST',
        url: '/billing/webhooks/stripe',
        schema: { tags: ['billing'] },
        handler: async (request, reply) => {
          const signature = request.headers['stripe-signature'];
          if (typeof signature !== 'string') {
            throw new AppError('UNAUTHORIZED', 'Missing Stripe-Signature header');
          }
          let event;
          try {
            event = deps.gateway.verifyWebhook(String(request.body), signature);
          } catch (error) {
            deps.logger.warn('webhook signature rejected', {
              error: (error as Error).message,
            });
            throw new AppError('UNAUTHORIZED', 'Invalid webhook signature');
          }

          if (event.type === 'checkout.session.completed') {
            const metadata = (event.data['metadata'] ?? {}) as Record<string, string>;
            const organizationId = metadata['organizationId'];
            const planSlug = metadata['planSlug'];
            const subscriptionRef =
              typeof event.data['subscription'] === 'string'
                ? event.data['subscription']
                : undefined;
            if (organizationId && planSlug) {
              await applyPlanChange(deps, {
                organizationId,
                planSlug,
                ...(subscriptionRef ? { externalRef: subscriptionRef } : {}),
              });
            }
          } else if (
            event.type === 'customer.subscription.updated' ||
            event.type === 'customer.subscription.deleted'
          ) {
            const ref = String(event.data['id'] ?? '');
            const stripeStatus = String(event.data['status'] ?? 'active');
            const status =
              event.type === 'customer.subscription.deleted'
                ? 'cancelled'
                : stripeStatus === 'past_due'
                  ? 'past_due'
                  : stripeStatus === 'trialing'
                    ? 'trialing'
                    : stripeStatus === 'canceled'
                      ? 'cancelled'
                      : 'active';
            const [subscription] = await deps.db
              .select()
              .from(schema.subscriptions)
              .where(eq(schema.subscriptions.externalRef, ref))
              .orderBy(desc(schema.subscriptions.updatedAt));
            if (subscription) {
              const downgrade = status === 'cancelled' ? { planSlug: 'free' } : {};
              await deps.db
                .update(schema.subscriptions)
                .set({ status, ...downgrade })
                .where(eq(schema.subscriptions.id, subscription.id));
              await writeAudit(deps.db, {
                organizationId: subscription.organizationId,
                action: 'billing.subscription_updated',
                resourceType: 'subscription',
                resourceId: subscription.id,
                metadata: { status, eventType: event.type },
              });
            }
          }
          return reply.status(200).send({ received: true });
        },
      });
    });
  };
}
