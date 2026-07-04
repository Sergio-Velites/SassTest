/**
 * Minimal JSON-schema validator for structured AI outputs. Covers the subset
 * our prompt templates use: object type, property types, required keys.
 * Deliberately small — swap for ajv if templates ever need more.
 */

export interface JsonSchemaLike {
  type?: string;
  properties?: Record<string, { type?: string }>;
  required?: string[];
}

export function validateAgainstSchema(value: unknown, schema: JsonSchemaLike): string[] {
  const errors: string[] = [];
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return [`expected object, got ${value === null ? 'null' : typeof value}`];
    }
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record)) errors.push(`missing required property '${key}'`);
    }
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      if (!(key in record) || propSchema.type === undefined) continue;
      const actual = Array.isArray(record[key]) ? 'array' : typeof record[key];
      const expected = propSchema.type === 'integer' ? 'number' : propSchema.type;
      if (actual !== expected) {
        errors.push(`property '${key}' should be ${expected}, got ${actual}`);
      }
    }
  }
  return errors;
}
