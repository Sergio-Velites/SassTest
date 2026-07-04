import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

const healthResponseSchema = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number(),
});

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: '/health',
    schema: {
      description: 'Liveness probe',
      tags: ['system'],
      response: { 200: healthResponseSchema },
    },
    // Health must stay reachable for load balancers even under rate-limit pressure.
    config: { rateLimit: false },
    handler: async () => ({ status: 'ok' as const, uptimeSeconds: Math.round(process.uptime()) }),
  });
}
