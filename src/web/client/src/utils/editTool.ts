export interface EditOperation {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

function isEditOperation(value: unknown): value is EditOperation {
  return !!value
    && typeof value === 'object'
    && typeof (value as { old_string?: unknown }).old_string === 'string'
    && typeof (value as { new_string?: unknown }).new_string === 'string';
}

function getNormalizedEditOperations(value: unknown): EditOperation[] {
  if (!Array.isArray(value)) return [];

  const operations = value.filter(isEditOperation);
  return operations.length > 0 ? operations : [];
}

export function getEditOperations(input: any): EditOperation[] {
  const batchEdits = getNormalizedEditOperations(input?.batch_edits);
  if (batchEdits.length > 0) {
    return batchEdits;
  }

  const multiEdits = getNormalizedEditOperations(input?.edits);
  if (multiEdits.length > 0) {
    return multiEdits;
  }

  if (typeof input?.old_string === 'string' && typeof input?.new_string === 'string') {
    return [{
      old_string: input.old_string,
      new_string: input.new_string,
      replace_all: input?.replace_all,
    }];
  }

  return [];
}

export function getToolResultText(result?: unknown): string {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (typeof result !== 'object') return '';

  const { output, error } = result as { output?: unknown; error?: unknown };
  if (typeof output === 'string' && output) return output;
  if (typeof error === 'string') return error;

  return '';
}
