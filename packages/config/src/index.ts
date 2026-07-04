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
