import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import {
  EXPRESSION_RUNTIME_OUTPUT,
  generateExpressionRuntimeSource,
} from "../../scripts/generate-expression-runtime.mjs";
import {
  clearExpressionCache,
  evaluateExpression,
  EXPRESSION_FUNCTIONS,
  getExpressionCacheSize,
  interpolateExpressions,
  MAX_PAD_LENGTH,
} from "./expressions";
import { EXPRESSION_RUNTIME_SOURCE } from "./expressionRuntime.generated";
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
    expect(evaluateExpression("userName.toUpperCase()", {
      variables: { userName: "Avery" },
    })).toBe("AVERY");
    expect(evaluateExpression('toLowerCase("HI")')).toBe("hi");
    expect(evaluateExpression('length("hello")')).toBe(5);
    expect(evaluateExpression('toString(12)')).toBe("12");
    expect(evaluateExpression('toNumber("12.5")')).toBe(12.5);
    expect(evaluateExpression('toBoolean("false")')).toBe(false);
    // A timestamp is an instant shown in local time, so build it from local parts: the result is the same in every time zone.
    const localMoment = new Date(2024, 2, 10, 15, 30).getTime();
    expect(evaluateExpression(`formatDate(${localMoment}, "yyyy-MM-dd HH:mm")`)).toBe("2024-03-10 15:30");
    expect(evaluateExpression('padStart("7", 3, "0")')).toBe("007");
    expect(evaluateExpression('padEnd("x", 3, "!")')).toBe("x!!");
  });

  it("keeps the day of a date-only string in every time zone (B18)", () => {
    expect(evaluateExpression('formatDate("2024-03-10", "dd/MM/yyyy")')).toBe("10/03/2024");
    expect(evaluateExpression('formatDate("2024-01-01", "yyyy-MM-dd")')).toBe("2024-01-01");
    expect(evaluateExpression('formatDate("2024-12-31", "MM/dd/yyyy")')).toBe("12/31/2024");
    // the exported/standalone runtime copy behaves the same
    const runtime = runInNewContext(`${EXPRESSION_RUNTIME_SOURCE}\nevaluateExpression('formatDate("2024-03-10", "dd/MM/yyyy")')`);
    expect(runtime).toBe("10/03/2024");
  });

  it("caps padStart/padEnd length so a huge value cannot freeze the preview (B19)", () => {
    const padStart = evaluateExpression('padStart("x", 100000000)') as string;
    const padEnd = evaluateExpression('padEnd("x", 100000000, "ab")') as string;
    expect(padStart).toHaveLength(MAX_PAD_LENGTH);
    expect(padEnd).toHaveLength(MAX_PAD_LENGTH);
    // normal padding is unchanged
    expect(evaluateExpression('padStart("7", 3, "0")')).toBe("007");
    // the exported/standalone runtime copy enforces the same cap
    const runtime = runInNewContext(`${EXPRESSION_RUNTIME_SOURCE}\nevaluateExpression('padStart("x", 100000000)')`);
    expect((runtime as string).length).toBe(MAX_PAD_LENGTH);
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
    expect(evaluateExpression("window.location")).toBeUndefined();
    expect(() => evaluateExpression("1 / 0")).toThrow(/finite/i);
    expect(() => evaluateExpression("1".repeat(2_001))).toThrow(/too long/i);
  });

  it("keeps the browser/export parser in sync without dynamic code evaluation", () => {
    expect(runInNewContext(`${EXPRESSION_RUNTIME_SOURCE}\nevaluateExpression('max(2, 4) + item.score', { item: { score: 3 } })`))
      .toBe(7);
    expect(runInNewContext(`${EXPRESSION_RUNTIME_SOURCE}\nevaluateExpression('userName.toUpperCase()', { variables: { userName: 'Avery' } })`))
      .toBe("AVERY");
    expect(EXPRESSION_RUNTIME_SOURCE).not.toMatch(/\beval\s*\(/);
  });
});

describe("B20: exports run the same engine as the editor", () => {
  it("keeps the committed export runtime in step with expressions.ts", () => {
    // If this fails, expressions.ts changed: run `npm run generate:expression-runtime` and commit the result.
    expect(
      EXPRESSION_RUNTIME_SOURCE,
      `${EXPRESSION_RUNTIME_OUTPUT} is out of date. Run: npm run generate:expression-runtime`,
    ).toBe(
      // The generated file stores the runtime inside a template literal, so compare what that literal evaluates to.
      new Function(`return ${generateExpressionRuntimeSource().replace(/^[^]*?export const EXPRESSION_RUNTIME_SOURCE = /, "").replace(/;\s*$/, "")}`)(),
    );
  });

  it("is generated, not a second hand-written engine", () => {
    // The old copy kept its own token cache on the function and had its own error texts.
    expect(EXPRESSION_RUNTIME_SOURCE).not.toContain("tokenCache");
    expect(EXPRESSION_RUNTIME_SOURCE).not.toMatch(/String\.raw/);
    // Only these two names are visible to the page the runtime is pasted into.
    expect(EXPRESSION_RUNTIME_SOURCE).toMatch(/^\s*const \{ evaluateExpression, clearExpressionCache \} = \(\(\) => \{/);
    // It is inlined into an HTML <script>, so it must not be able to close it.
    expect(EXPRESSION_RUNTIME_SOURCE).not.toMatch(/<\/script|<!--/i);
  });

  const runtimeValue = (source: string, context: Record<string, unknown> = {}) => {
    try {
      return { value: runInNewContext(`${EXPRESSION_RUNTIME_SOURCE}\nevaluateExpression(${JSON.stringify(source)}, ctx)`, { ctx: context }) };
    } catch (error) {
      return { error: (error as Error).message };
    }
  };
  const engineValue = (source: string, context: Record<string, unknown> = {}) => {
    try {
      return { value: evaluateExpression(source, context as never) };
    } catch (error) {
      return { error: (error as Error).message };
    }
  };

  it("gives the same answer or the same error as the editor for a wide set of expressions", () => {
    const cases: Array<[string, Record<string, unknown>?]> = [
      ["1 + 2 * 3"], ["(1 + 2) * 3"], ["2 ** 3 ** 2"], ["10 % 4"], ["1 < 2 && 2 < 3"], ["!true"], ["1 == '1'"],
      ["abs(-3)"], ["ceil(1.2)"], ["floor(1.8)"], ["round(2.5)"], ["min(3, 1, 2)"], ["max(3, 1, 2)"], ["min()"],
      ["concat('a', 'b', 1)"], ["substring('hello', 1, 3)"], ["replace('a-a', '-', '+')"],
      ["toUpperCase('abc')"], ["trim('  x ')"], ["length('abcd')"], ["toString(12)"], ["toNumber('7')"],
      ["formatDate('2024-03-10', 'dd/MM/yyyy')"], ["padStart('7', 3, '0')"], ["padEnd('7', 3, '0')"],
      ["userName.toUpperCase()", { variables: { userName: "Avery" } }],
      ["item.score + 1", { item: { score: 3 } }], ["a.b.c", { variables: { a: { b: { c: 5 } } } }],
      ["missing + 1"], ["1 / 0"], ["1 +"], ["1 2"], ["'unterminated"], ["constructor"], ["__proto__.x"],
      ["abs('x')"], ["unknownFn(1)"], ["now()", { now: () => 1000 }],
      ["length(123)"], ["length(true)"], ["-2 ** 2"], ["(-2) ** 2"], ["-(2 ** 2)"], ["2 ** -1"], ["min()"], ["max()"],
      ["replaceAll('a-b-c', '-', '+')"], ["replace('Price', 'Price', '$&$&')"],
    ];
    for (const [source, context] of cases) {
      expect(runtimeValue(source, context), source).toEqual(engineValue(source, context));
    }
  });

  it("no longer differs where the old copy did", () => {
    // The old copy threw "Expected an expression value" here and ignored the supplied clock.
    expect(runtimeValue("replace('a-a', '-', '+')")).toEqual({ value: "a+a" });
    expect(runtimeValue("now()", { now: () => 1000 })).toEqual({ value: 1000 });
    expect(runtimeValue("1 2")).toEqual({ error: 'Unexpected token "2".' });
  });
});

describe("B21: small expression details", () => {
  it("length() counts the characters of a number or true/false as well as of text and lists", () => {
    expect(evaluateExpression("length(123)")).toBe(3);
    expect(evaluateExpression("length(-4.5)")).toBe(4);
    expect(evaluateExpression("length(true)")).toBe(4);
    expect(evaluateExpression("length('abc')")).toBe(3);
    expect(evaluateExpression("length(items)", { variables: { items: [1, 2, 3, 4] } })).toBe(4);
    // Nothing there is still 0.
    expect(evaluateExpression("length(missing)")).toBe(0);
  });

  it("asks for brackets when a sign sits directly before **, instead of silently returning 4", () => {
    for (const source of ["-2 ** 2", "+2 ** 2", "-x ** 2", "1 + -2 ** 2", "2 * -3 ** 2", "!2 ** 2", "- 2 ** 2"]) {
      expect(() => evaluateExpression(source, { variables: { x: 2 } }), source).toThrow(/sign directly before \*\*/);
    }
    // With brackets the meaning is explicit, and the maths agrees.
    expect(evaluateExpression("(-2) ** 2")).toBe(4);
    expect(evaluateExpression("-(2 ** 2)")).toBe(-4);
    expect(evaluateExpression("(-x) ** 2", { variables: { x: 3 } })).toBe(9);
  });

  it("still accepts a sign anywhere that is not directly before **", () => {
    expect(evaluateExpression("2 ** -1")).toBe(0.5);
    expect(evaluateExpression("2 ** -2 + 1")).toBe(1.25);
    expect(evaluateExpression("-2 * 3")).toBe(-6);
    expect(evaluateExpression("-2 + 2 ** 2")).toBe(2);
    expect(evaluateExpression("2 ** 3 ** 2")).toBe(512);
    expect(evaluateExpression("-abs(-3)")).toBe(-3);
    expect(evaluateExpression("5 - -2")).toBe(7);
  });

  it("replace() changes the first match and replaceAll() every match", () => {
    expect(evaluateExpression("replace('a-b-c', '-', '+')")).toBe("a+b-c");
    expect(evaluateExpression("replaceAll('a-b-c', '-', '+')")).toBe("a+b+c");
    expect(evaluateExpression("replaceAll('aaa', 'a', 'bb')")).toBe("bbbbbb");
    expect(evaluateExpression("replaceAll('abc', 'x', 'y')")).toBe("abc");
    expect(evaluateExpression("replaceAll(name, ' ', '_')", { variables: { name: "Ada Lovelace King" } })).toBe("Ada_Lovelace_King");
  });

  it("inserts the replacement as written, so $ in it is text", () => {
    expect(evaluateExpression("replace('Total: X', 'X', '$&')")).toBe("Total: $&");
    expect(evaluateExpression("replaceAll('X and X', 'X', '$1')")).toBe("$1 and $1");
    expect(evaluateExpression("replaceAll('price', 'price', '$')")).toBe("$");
  });

  it("is offered in the function list, so the expression field suggests replaceAll", () => {
    expect(EXPRESSION_FUNCTIONS).toContain("replaceAll");
  });

  it("says min() and max() need a value, in plain words", () => {
    expect(() => evaluateExpression("min()")).toThrow("min needs at least one value.");
    expect(() => evaluateExpression("max()")).toThrow("max needs at least one value.");
    expect(evaluateExpression("min(3)")).toBe(3);
    expect(evaluateExpression("max(1, 2, 3)")).toBe(3);
    expect(() => evaluateExpression("min('x')")).toThrow(/requires finite numeric arguments/);
  });

  it("gives the exported runtime the same behaviour, since it is generated from this engine", () => {
    const run = (source: string) => runInNewContext(`${EXPRESSION_RUNTIME_SOURCE}\nevaluateExpression(${JSON.stringify(source)}, {})`);
    expect(run("length(123)")).toBe(3);
    expect(run("replaceAll('a-b-c', '-', '+')")).toBe("a+b+c");
    expect(() => run("-2 ** 2")).toThrow(/sign directly before \*\*/);
    expect(() => run("min()")).toThrow("min needs at least one value.");
  });
});
