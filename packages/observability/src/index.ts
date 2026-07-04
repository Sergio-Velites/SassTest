/**
 * @flowhub/observability — structured logging with mandatory sanitization.
 *
 * Rules (see docs/security/SECURITY_MODEL.md):
 * - Logs are structured JSON, one event per line.
 * - Tokens, API keys, passwords and connector secrets are NEVER logged.
 *   redact() is applied to every log payload as defense-in-depth.
 * - Every log line in request/job scope carries organizationId for tenancy tracing.
 *
 * Cycle 3 replaces the console transport with pino; the Logger interface is stable.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Returns a logger that automatically attaches the given fields. */
  child(fields: LogFields): Logger;
}

const SENSITIVE_KEY_PATTERN = /(secret|token|password|api[-_]?key|authorization|credential)/i;

/** Recursively masks values under sensitive-looking keys. */
export function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = '[REDACTED]';
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redact(value as LogFields);
    } else {
      out[key] = value;
    }
  }
  return out;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(minLevel: LogLevel = 'info', baseFields: LogFields = {}): Logger {
  const emit = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const line = JSON.stringify({
      level,
      time: new Date().toISOString(),
      message,
      ...redact({ ...baseFields, ...fields }),
    });
    if (level === 'error' || level === 'warn') {
      console.error(line);
    } else {
      // eslint-disable-next-line no-console -- console transport is the Cycle 2 placeholder for pino
      console.log(line);
    }
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (fields) => createLogger(minLevel, { ...baseFields, ...fields }),
  };
}
