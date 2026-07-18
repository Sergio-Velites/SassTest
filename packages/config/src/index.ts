import { z } from 'zod';

/**
 * @flowhub/config — typed environment configuration.
 * Apps call loadEnv() once at startup and pass the result down explicitly.
 * Never read process.env directly in business logic.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  AUTH_SESSION_SECRET: z.string().min(16).optional(),

  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),

  AI_PROVIDER: z.enum(['mock', 'openai', 'anthropic']).default('mock'),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MONTHLY_COST_CAP_USD: z.coerce.number().nonnegative().default(50),

  // Real connectors (Cycle 11). All optional: without credentials the
  // catalog marks each provider as unavailable and mocks keep working.
  API_PUBLIC_URL: z.string().url().default('http://localhost:3001'),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  /** 64 hex chars (32 bytes) — AES-256-GCM key for connector credentials. */
  CONNECTOR_SECRETS_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** Stripe test-mode keys; without them the mock gateway handles billing. */
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Never print raw env values — only which keys failed validation.
    const failed = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration for: ${failed}`);
  }
  return parsed.data;
}
