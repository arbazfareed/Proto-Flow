import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { compareCondition, CONDITION_COMPARE_RUNTIME_SOURCE } from "./conditionCompare";

describe("condition comparison | B40", () => {
  it("compares numeric text as numbers", () => {
    expect(compareCondition("greaterThan", "10", 9)).toBe(true);
    expect(compareCondition("greaterThan", "10", "9")).toBe(true);
    expect(compareCondition("lessThan", "9", "10")).toBe(true);
    expect(compareCondition("greaterThanOrEqual", "18", 18)).toBe(true);
    expect(compareCondition("lessThanOrEqual", " 18 ", 18)).toBe(true);
    expect(compareCondition("equals", "10", 10)).toBe(true);
    expect(compareCondition("equals", "10.0", "10")).toBe(true);
    expect(compareCondition("notEquals", "10", 10)).toBe(false);
  });

  it("keeps the old rules for text that is not a number", () => {
    expect(compareCondition("equals", "abc", "abc")).toBe(true);
    expect(compareCondition("equals", "abc", "ABC")).toBe(false);
    expect(compareCondition("notEquals", "abc", "abd")).toBe(true);
    expect(compareCondition("equals", true, true)).toBe(true);
    expect(compareCondition("equals", true, "true")).toBe(false);
    expect(compareCondition("greaterThan", "abc", 1)).toBe(false);
    expect(compareCondition("greaterThan", "", 0)).toBe(false);
    expect(compareCondition("lessThan", undefined, 5)).toBe(false);
    expect(compareCondition("contains", "hello world", "lo w")).toBe(true);
    expect(compareCondition("contains", "123", 2)).toBe(false);
    expect(compareCondition("unknown", 1, 1)).toBe(false);
  });

  it("the text copy used by exports gives the same answers", () => {
    const copy = runInNewContext(`${CONDITION_COMPARE_RUNTIME_SOURCE}\ncompareCondition`) as typeof compareCondition;
    const operators = ["equals", "notEquals", "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual", "contains", "nope"];
    const values: unknown[] = ["10", "9", 10, 9, "abc", "", " 7 ", "10.0", true, false, undefined, "lo", "hello", 0, "0", "1e3", 1000];
    for (const operator of operators) {
      for (const actual of values) {
        for (const expected of values) {
          expect(copy(operator, actual as never, expected as never), `${operator} ${String(actual)} ${String(expected)}`)
            .toBe(compareCondition(operator, actual, expected));
        }
      }
    }
  });
});
