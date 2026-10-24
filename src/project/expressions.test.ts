import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import {
  clearExpressionCache,
  evaluateExpression,
  EXPRESSION_RUNTIME_SOURCE,
  getExpressionCacheSize,
  interpolateExpressions,
} from "./expressions";
import type { Widget } from "./schema";

function widget(name: string, x: number, width: number): Widget {
  return {
    id: crypto.randomUUID(),
    name,
    type: "rectangle",
    x,
    y: 10,
    width,
    height: 20,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 0,
    style: {},
    props: {},
  };
}

describe("safe expression engine", () => {
  it("evaluates arithmetic, precedence, grouping, comparison, and logical operators", () => {
    expect(evaluateExpression("2 + 3 * 4")).toBe(14);
    expect(evaluateExpression("(2 + 3) * 4")).toBe(20);
    expect(evaluateExpression("2 ** 3 ** 2")).toBe(512);
    expect(evaluateExpression("10 % 3 == 1 && !(2 > 4)")).toBe(true);
    expect(evaluateExpression("false || 3 >= 3")).toBe(true);
    expect(evaluateExpression('"a" + "b"')).toBe("ab");
  });

  it("supports all documented math, string, type, date, and format functions", () => {
    expect(evaluateExpression("abs(-4) + ceil(1.2) + floor(2.8) + round(2.5)")).toBe(11);
    expect(evaluateExpression("min(4, 2, 3) + max(4, 2, 3)")).toBe(6);
    expect(evaluateExpression("random() >= 0 && random() < 1")).toBe(true);
    expect(evaluateExpression('concat("Proto", "Flow")')).toBe("ProtoFlow");
    expect(evaluateExpression('substring("abcdef", 1, 4)')).toBe("bcd");
    expect(evaluateExpression('replace("one one", "one", "two")')).toBe("two one");
    expect(evaluateExpression('toUpperCase(trim("  hi "))')).toBe("HI");
    expect(evaluateExpression('toLowerCase("HI")')).toBe("hi");
    expect(evaluateExpression('length("hello")')).toBe(5);
    expect(evaluateExpression('toString(12)')).toBe("12");
    expect(evaluateExpression('toNumber("12.5")')).toBe(12.5);
    expect(evaluateExpression('toBoolean("false")')).toBe(false);
    expect(evaluateExpression('formatDate(0, "yyyy-MM-dd")')).toBe("1970-01-01");
    expect(evaluateExpression('padStart("7", 3, "0")')).toBe("007");
    expect(evaluateExpression('padEnd("x", 3, "!")')).toBe("x!!");
  });

  it("resolves variables, item fields, widget properties, and this-widget geometry", () => {
    const box = widget("Card", 24, 120);
    expect(evaluateExpression("count * 2", {
      variables: { count: 3 },
    })).toBe(6);
    expect(evaluateExpression("item.price * item.quantity", {
      item: { price: 4, quantity: 3 },
    })).toBe(12);
    expect(evaluateExpression("Card.width + this.x", {
      widgets: [box],
      thisWidget: box,
    })).toBe(144);
  });

  it("reuses compiled expressions across changing contexts and clears its bounded cache", () => {
    clearExpressionCache();
    expect(evaluateExpression("count * 2", { variables: { count: 3 } })).toBe(6);
    expect(evaluateExpression("count * 2", { variables: { count: 8 } })).toBe(16);
    expect(getExpressionCacheSize()).toBe(1);
    clearExpressionCache();
    expect(getExpressionCacheSize()).toBe(0);
  });

  it("does not re-evaluate a pure expression when only unrelated variables change", () => {
    clearExpressionCache();
    let countReads = 0;
    const variables = {
      unrelated: 0,
      get count() {
        countReads += 1;
        return 3;
      },
    };
    expect(evaluateExpression("count * 2", { variables })).toBe(6);
    variables.unrelated = 1;
    expect(evaluateExpression("count * 2", { variables })).toBe(6);
    expect(countReads).toBe(3);
  });

  it("does not cache expressions with time-dependent functions", () => {
    let time = 0;
    const context = { now: () => ++time };
    expect(evaluateExpression("now()", context)).toBe(1);
    expect(evaluateExpression("now()", context)).toBe(2);
  });

  it("bounds the compiled expression cache", () => {
    clearExpressionCache();
    for (let index = 0; index <= 1_000; index += 1) {
      evaluateExpression(String(index));
    }
    expect(getExpressionCacheSize()).toBe(1_000);
    clearExpressionCache();
  });

  it("interpolates expressions without failing on invalid tokens", () => {
    expect(interpolateExpressions("Total: [[price * count]]", {
      variables: { price: 3, count: 4 },
    })).toBe("Total: 12");
    expect(interpolateExpressions("Bad: [[missing(]]")).toBe("Bad: [[missing(]]");
  });

  it("rejects malformed syntax, unknown functions, unsafe property access, and oversized input", () => {
    expect(() => evaluateExpression("1 + )")).toThrow();
    expect(() => evaluateExpression("fetch(1)")).toThrow(/unknown expression function/i);
    expect(() => evaluateExpression("item.constructor", { item: {} })).toThrow(/not allowed/i);
    expect(() => evaluateExpression("1".repeat(2_001))).toThrow(/too long/i);
  });

  it("keeps the browser/export parser in sync without dynamic code evaluation", () => {
    expect(runInNewContext(`${EXPRESSION_RUNTIME_SOURCE}\nevaluateExpression('max(2, 4) + item.score', { item: { score: 3 } })`))
      .toBe(7);
    expect(EXPRESSION_RUNTIME_SOURCE).not.toMatch(/\beval\s*\(/);
  });
});
