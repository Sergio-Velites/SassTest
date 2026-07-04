/**
 * Typed application errors. Every error carries a stable machine-readable
 * code so the API layer can map it to an HTTP status and clients can react
 * programmatically. Messages must NEVER contain secrets or PII.
 */

export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'TENANT_MISMATCH'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'CONNECTOR_ERROR'
  | 'AI_PROVIDER_ERROR'
  | 'EXECUTION_ERROR'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: AppErrorCode;
  /** Safe-to-log, non-sensitive structured context. */
  readonly context: Record<string, string | number | boolean> | undefined;

  constructor(
    code: AppErrorCode,
    message: string,
    context?: Record<string, string | number | boolean>,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.context = context;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
