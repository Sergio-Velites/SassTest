import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema',
  out: './migrations',
  dbCredentials: {
    // Never a hardcoded credential: comes from the environment (.env locally).
    url:
      process.env['DATABASE_URL'] ??
      'postgresql://flowhub:flowhub_dev_password@localhost:5432/flowhub',
  },
  strict: true,
  verbose: true,
});
