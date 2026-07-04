/**
 * Result type for explicit, typed error handling in domain logic.
 * Throwing is reserved for programmer errors / unrecoverable states;
 * expected failures (validation, not-found, permission) return a Result.
 */

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw result.error instanceof Error
      ? result.error
      : new Error(`unwrap() called on err result: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}
