/**
 * Template interpolation for node configs: {{nodes.<id>.<path>}},
 * {{variables.<name>}} and {{trigger.<path>}} references are resolved against
 * the execution context. No code evaluation — pure path lookup.
 */

export interface InterpolationScope {
  nodes: Record<string, unknown>;
  variables: Record<string, unknown>;
  trigger?: unknown;
}

const TEMPLATE_PATTERN = /\{\{\s*([a-zA-Z0-9_.$[\]-]+)\s*\}\}/g;

function lookupPath(scope: InterpolationScope, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = scope;
  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Interpolates a string. A string that is EXACTLY one template returns the
 * raw referenced value (preserving numbers/booleans/objects); mixed strings
 * concatenate stringified values.
 */
export function interpolateString(template: string, scope: InterpolationScope): unknown {
  const exactMatch = /^\{\{\s*([a-zA-Z0-9_.$[\]-]+)\s*\}\}$/.exec(template);
  if (exactMatch && exactMatch[1]) {
    return lookupPath(scope, exactMatch[1]);
  }
  return template.replace(TEMPLATE_PATTERN, (_all, path: string) => {
    const value = lookupPath(scope, path);
    if (value === undefined || value === null) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

/** Deep-interpolates every string inside a config value. */
export function interpolateValue(value: unknown, scope: InterpolationScope): unknown {
  if (typeof value === 'string') return interpolateString(value, scope);
  if (Array.isArray(value)) return value.map((v) => interpolateValue(v, scope));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = interpolateValue(inner, scope);
    }
    return out;
  }
  return value;
}
