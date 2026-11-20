// B40: an input field always holds text, so "10" must compare as the number 10.
// Both numbers, or text that is clearly a number, are compared as numbers; anything else keeps the old rules.
function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

export function compareCondition(operator: string, actual: unknown, expected: unknown): boolean {
  const left = asNumber(actual);
  const right = asNumber(expected);
  const numeric = Number.isFinite(left) && Number.isFinite(right);
  switch (operator) {
    case "equals": return numeric ? left === right : actual === expected;
    case "notEquals": return numeric ? left !== right : actual !== expected;
    case "greaterThan": return numeric && left > right;
    case "greaterThanOrEqual": return numeric && left >= right;
    case "lessThan": return numeric && left < right;
    case "lessThanOrEqual": return numeric && left <= right;
    case "contains": return typeof actual === "string" && typeof expected === "string" && actual.includes(expected);
    default: return false;
  }
}

// The same function as plain JavaScript text for published prototypes and the React export.
// A test checks that it gives the same answers as compareCondition above.
export const CONDITION_COMPARE_RUNTIME_SOURCE = String.raw`
function compareCondition(operator, actual, expected) {
  const asNumber = (value) => typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  const left = asNumber(actual);
  const right = asNumber(expected);
  const numeric = Number.isFinite(left) && Number.isFinite(right);
  switch (operator) {
    case "equals": return numeric ? left === right : actual === expected;
    case "notEquals": return numeric ? left !== right : actual !== expected;
    case "greaterThan": return numeric && left > right;
    case "greaterThanOrEqual": return numeric && left >= right;
    case "lessThan": return numeric && left < right;
    case "lessThanOrEqual": return numeric && left <= right;
    case "contains": return typeof actual === "string" && typeof expected === "string" && actual.includes(expected);
    default: return false;
  }
}
`;
