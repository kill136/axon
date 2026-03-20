import type { ToolDefinition } from '../../../types/index.js';

type JsonSchemaLike = {
  type?: unknown;
  properties?: Record<string, unknown>;
  required?: string[];
  items?: unknown;
  anyOf?: unknown[];
  oneOf?: unknown[];
};

function asSchema(value: unknown): JsonSchemaLike | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonSchemaLike;
}

function resolveSchemaVariant(schema: JsonSchemaLike | undefined): JsonSchemaLike | undefined {
  if (!schema) return undefined;
  if (schema.type) return schema;

  const variants = [...(schema.anyOf || []), ...(schema.oneOf || [])];
  for (const candidate of variants) {
    const resolved = asSchema(candidate);
    if (resolved?.type) {
      return resolved;
    }
  }

  return schema;
}

function isOptionalStringField(schema: JsonSchemaLike | undefined): boolean {
  const resolved = resolveSchemaVariant(schema);
  return resolved?.type === 'string';
}

function normalizeValue(input: unknown, schema: JsonSchemaLike | undefined): unknown {
  const resolved = resolveSchemaVariant(schema);
  if (!resolved) {
    return input;
  }

  if (resolved.type === 'object' && input && typeof input === 'object' && !Array.isArray(input)) {
    const properties = resolved.properties || {};
    const required = new Set(resolved.required || []);
    const output: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const propertySchema = asSchema(properties[key]);

      if (value === '' && !required.has(key) && isOptionalStringField(propertySchema)) {
        continue;
      }

      output[key] = normalizeValue(value, propertySchema);
    }

    return output;
  }

  if (resolved.type === 'array' && Array.isArray(input)) {
    const itemSchema = asSchema(resolved.items);
    return input.map(item => normalizeValue(item, itemSchema));
  }

  return input;
}

export function normalizeToolInputForWebRuntime(
  input: unknown,
  schema?: ToolDefinition['inputSchema'],
): unknown {
  return normalizeValue(input, asSchema(schema));
}
