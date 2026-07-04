/**
 * Safe condition evaluator for `condition` nodes. Supports exactly one
 * binary comparison — `<lhs> <op> <rhs>` with ==, !=, <, <=, >, >= — over
 * already-interpolated values, or a single truthy value. No eval, ever.
 */

const COMPARISON = /^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/;

function parseOperand(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '') return null;
  const asNumber = Number(trimmed);
  if (!Number.isNaN(asNumber) && trimmed !== '') return asNumber;
  // Strip optional quotes for string literals.
  return trimmed.replace(/^['"]|['"]$/g, '');
}

export function evaluateCondition(expression: string): boolean {
  const match = COMPARISON.exec(expression);
  if (!match || !match[1] || !match[2] || !match[3]) {
    // Single-value truthiness: "true", "1", non-empty string.
    const value = parseOperand(expression);
    return Boolean(value);
  }
  const left = parseOperand(match[1]);
  const right = parseOperand(match[3]);
  switch (match[2]) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '<':
      return Number(left) < Number(right);
    case '<=':
      return Number(left) <= Number(right);
    case '>':
      return Number(left) > Number(right);
    case '>=':
      return Number(left) >= Number(right);
    default:
      return false;
  }
}
