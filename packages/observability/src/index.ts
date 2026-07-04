/**
 * @flowhub/observability — structured logging with mandatory sanitization.
 *
 * Rules (see docs/security/SECURITY_MODEL.md):
 * - Logs are structured JSON, one event per line (pino transport).
 * - Tokens, API keys, passwords and connector secrets are NEVER logged.
 *   redact() is applied to every log payload as defense-in-depth.
 * - Every log line in request/job scope carries organizationId for tenancy tracing.
 *
 * The Logger interface is stable; the transport (pino) is an implementation detail.
 */

import { pino, type Logger as PinoLogger } from 'pino';

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

function wrap(instance: PinoLogger): Logger {
  return {
    debug: (message, fields) => instance.debug(fields ? redact(fields) : {}, message),
    info: (message, fields) => instance.info(fields ? redact(fields) : {}, message),
    warn: (message, fields) => instance.warn(fields ? redact(fields) : {}, message),
    error: (message, fields) => instance.error(fields ? redact(fields) : {}, message),
    child: (fields) => wrap(instance.child(redact(fields))),
  };
}

/**
 * Creates a JSON logger. `destination` is injectable for tests; production
 * writes to stdout, which Cloud Logging ingests directly (message/level keys
 * are set to what Cloud Logging expects).
 */
export function createLogger(
  minLevel: LogLevel = 'info',
  baseFields: LogFields = {},
  destination?: NodeJS.WritableStream,
): Logger {
  const instance = pino(
    {
      level: minLevel,
      // Drop pid/hostname noise; Cloud Run adds instance metadata itself.
      base: null,
      messageKey: 'message',
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
    },
    destination ?? process.stdout,
  );
  return wrap(instance.child(redact(baseFields)));
}
