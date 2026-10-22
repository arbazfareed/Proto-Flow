import type { Widget } from "./schema";

export interface ExpressionContext {
  variables?: Record<string, unknown>;
  widgets?: Widget[];
  item?: Record<string, unknown>;
  thisWidget?: Widget | Record<string, unknown>;
  now?: () => number;
}

export const EXPRESSION_FUNCTIONS = [
  "abs", "ceil", "floor", "round", "min", "max", "random",
  "concat", "substring", "replace", "toUpperCase", "toLowerCase",
  "trim", "length", "toString", "toNumber", "toBoolean", "now",
  "formatDate", "padStart", "padEnd",
] as const;

export const EXPRESSION_RUNTIME_SOURCE = String.raw`
function evaluateExpression(source, context = {}) {
  if (source.length > 2000) throw new Error("Expression is too long.");
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    if (/\s/.test(source[index])) { index++; continue; }
    const rest = source.slice(index);
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    const identifier = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(rest);
    if (number) { tokens.push({ type: "value", value: Number(number[0]) }); index += number[0].length; }
    else if (source[index] === "'" || source[index] === '"') {
      const quote = source[index++]; let value = ""; let closed = false;
      while (index < source.length) {
        const character = source[index++];
        if (character === quote) { closed = true; break; }
        if (character === "\\") {
          const escaped = source[index++];
          value += escaped === "n" ? "\n" : escaped === "r" ? "\r" : escaped === "t" ? "\t" : escaped;
        } else value += character;
      }
      if (!closed) throw new Error("Unterminated string literal.");
      tokens.push({ type: "value", value });
    } else if (identifier) { tokens.push({ type: "identifier", value: identifier[0] }); index += identifier[0].length; }
    else {
      const operator = ["**", "==", "!=", "<=", ">=", "&&", "||"].find((item) => source.startsWith(item, index))
        || ("+-*/%<>!(),".includes(source[index]) ? source[index] : "");
      if (!operator) throw new Error("Unexpected expression character.");
      tokens.push({ type: "operator", value: operator }); index += operator.length;
    }
    if (tokens.length > 500) throw new Error("Expression contains too many tokens.");
  }
  tokens.push({ type: "eof", value: "" });
  let cursor = 0;
  let depth = 0;
  const peek = () => tokens[cursor];
  const precedence = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, ">": 4, "<=": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6, "**": 7 };
  function primary() {
    const token = peek(); cursor++;
    if (token.type === "value") return token.value;
    if (token.type === "identifier") {
      if (token.value === "true") return true;
      if (token.value === "false") return false;
      if (token.value === "null") return null;
      if (peek().value === "(") {
        cursor++;
        const args = [];
        if (peek().value !== ")") { do { args.push(binary(0)); if (peek().value !== ",") break; cursor++; } while (true); }
        if (peek().value !== ")") throw new Error('Expected ")".');
        cursor++;
        return call(token.value, args, context);
      }
      const path = token.value.split(".");
      if (path.some((part) => ["__proto__", "prototype", "constructor"].includes(part))) throw new Error("Access to that property is not allowed.");
      let value = path[0] === "item" ? context.item : path[0] === "this" ? context.thisWidget : context.variables?.[path[0]];
      for (const part of path.slice(1)) value = value == null ? undefined : value[part];
      if (path.length > 1 && path[0] !== "item" && path[0] !== "this" && value === undefined) {
        const widget = context.widgets?.find((entry) => entry.name === path[0] || entry.props?.name === path[0] || entry.props?.label === path[0]);
        value = widget;
        for (const part of path.slice(1)) value = value == null ? undefined : value[part];
      }
      return value;
    }
    if (token.value === "(") {
      const value = binary(0);
      if (peek().value !== ")") throw new Error('Expected ")".');
      cursor++;
      return value;
    }
    throw new Error("Expected an expression value.");
  }
  function unary() {
    if (["!", "+", "-"].includes(peek().value)) {
      const op = tokens[cursor++].value; const value = unary();
      return op === "!" ? !value : op === "+" ? finite(value) : -finite(value);
    }
    return primary();
  }
  function binary(min) {
    if (++depth > 64) throw new Error("Expression nesting is too deep.");
    let left = unary();
    while (precedence[peek().value] !== undefined && precedence[peek().value] >= min) {
      const op = tokens[cursor++].value;
      if (op === "&&" && !left) { binary(precedence[op] + 1); left = false; continue; }
      if (op === "||" && left) { binary(precedence[op] + 1); left = true; continue; }
      const right = binary(precedence[op] + (op === "**" ? 0 : 1));
      switch (op) {
        case "&&": left = left && right; break; case "||": left = left || right; break;
        case "==": left = left === right; break; case "!=": left = left !== right; break;
        case "<": left = left < right; break; case ">": left = left > right; break;
        case "<=": left = left <= right; break; case ">=": left = left >= right; break;
        case "+": left = typeof left === "string" || typeof right === "string" ? String(left ?? "") + String(right ?? "") : finite(left) + finite(right); break;
        case "-": left = finite(left) - finite(right); break; case "*": left = finite(left) * finite(right); break;
        case "/": left = finite(left) / finite(right); break; case "%": left = finite(left) % finite(right); break;
        case "**": left = finite(left) ** finite(right); break;
      }
    }
    depth--;
    return left;
  }
  const finite = (value) => { const number = Number(value); if (!Number.isFinite(number)) throw new Error("Expected a finite number."); return number; };
  function call(name, args, ctx) {
    const value = args[0];
    const numeric = (item) => finite(item);
    switch (name) {
      case "abs": return Math.abs(numeric(value)); case "ceil": return Math.ceil(numeric(value));
      case "floor": return Math.floor(numeric(value)); case "round": return Math.round(numeric(value));
      case "min": return Math.min(...args.map(numeric)); case "max": return Math.max(...args.map(numeric));
      case "random": return Math.random(); case "concat": return args.map((item) => String(item ?? "")).join("");
      case "substring": return String(value ?? "").substring(numeric(args[1] ?? 0), args[2] === undefined ? undefined : numeric(args[2]));
      case "replace": return String(value ?? "").replace(String(args[1] ?? ""), String(args[2] ?? ""));
      case "toUpperCase": return String(value ?? "").toUpperCase(); case "toLowerCase": return String(value ?? "").toLowerCase();
      case "trim": return String(value ?? "").trim();
      case "length": return typeof value === "string" || Array.isArray(value) ? value.length : 0;
      case "toString": return String(value ?? "");
      case "toNumber": { const number = Number(value); if (!Number.isFinite(number)) throw new Error("Invalid number."); return number; }
      case "toBoolean": return typeof value === "string" ? value.length > 0 && value.toLowerCase() !== "false" : Boolean(value);
      case "now": return Date.now();
      case "formatDate": {
        const date = new Date(value === undefined ? Date.now() : value);
        if (!Number.isFinite(date.getTime())) throw new Error("Invalid date.");
        const parts = { yyyy: String(date.getFullYear()), MM: String(date.getMonth() + 1).padStart(2, "0"), dd: String(date.getDate()).padStart(2, "0"), HH: String(date.getHours()).padStart(2, "0"), mm: String(date.getMinutes()).padStart(2, "0"), ss: String(date.getSeconds()).padStart(2, "0") };
        return String(args[1] ?? "yyyy-MM-dd").replace(/yyyy|MM|dd|HH|mm|ss/g, (part) => parts[part]);
      }
      case "padStart": return String(value ?? "").padStart(numeric(args[1] ?? 0), String(args[2] ?? " "));
      case "padEnd": return String(value ?? "").padEnd(numeric(args[1] ?? 0), String(args[2] ?? " "));
      default: throw new Error('Unknown expression function "' + name + '".');
    }
  }
  const result = binary(0);
  if (peek().type !== "eof") throw new Error("Unexpected expression token.");
  if (typeof result === "number" && !Number.isFinite(result)) throw new Error("Expression result is not finite.");
  return result;
}
`;

type Token = { type: "number" | "string" | "identifier" | "operator" | "eof"; value: string };
type ExpressionValue = string | number | boolean | null | undefined;
type ExpressionNode =
  | { type: "literal"; value: ExpressionValue }
  | { type: "reference"; path: string[] }
  | { type: "unary"; operator: string; value: ExpressionNode }
  | { type: "binary"; operator: string; left: ExpressionNode; right: ExpressionNode }
  | { type: "call"; name: string; args: ExpressionNode[] };

const MAX_EXPRESSION_LENGTH = 2_000;
const MAX_TOKENS = 500;
const MAX_PARSE_DEPTH = 64;
const FORBIDDEN_PROPERTIES = new Set(["__proto__", "prototype", "constructor"]);
const PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  ">": 4,
  "<=": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
  "**": 7,
};

function tokenize(source: string): Token[] {
  if (source.length > MAX_EXPRESSION_LENGTH) throw new Error("Expression is too long.");
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(index));
    if (number) {
      tokens.push({ type: "number", value: number[0] });
      index += number[0].length;
    } else if (character === "'" || character === "\"") {
      const quote = character;
      let value = "";
      index += 1;
      let closed = false;
      while (index < source.length) {
        const current = source[index++];
        if (current === quote) {
          closed = true;
          break;
        }
        if (current === "\\") {
          if (index >= source.length) throw new Error("Unterminated string escape.");
          const escaped = source[index++];
          value += escaped === "n" ? "\n" : escaped === "r" ? "\r" : escaped === "t" ? "\t" : escaped;
        } else value += current;
      }
      if (!closed) throw new Error("Unterminated string literal.");
      tokens.push({ type: "string", value });
    } else {
      const identifier = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/.exec(source.slice(index));
      if (identifier) {
        tokens.push({ type: "identifier", value: identifier[0] });
        index += identifier[0].length;
      } else {
        const operator = ["**", "==", "!=", "<=", ">=", "&&", "||"].find((candidate) =>
          source.startsWith(candidate, index),
        );
        if (operator) {
          tokens.push({ type: "operator", value: operator });
          index += operator.length;
        } else if ("+-*/%<>!(),".includes(character)) {
          tokens.push({ type: "operator", value: character });
          index += 1;
        } else {
          throw new Error(`Unexpected character "${character}".`);
        }
      }
    }
    if (tokens.length > MAX_TOKENS) throw new Error("Expression contains too many tokens.");
  }
  tokens.push({ type: "eof", value: "" });
  return tokens;
}

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): ExpressionNode {
    const result = this.parseBinary(0);
    if (this.peek().type !== "eof") throw new Error(`Unexpected token "${this.peek().value}".`);
    return result;
  }

  private parseBinary(minimumPrecedence: number): ExpressionNode {
    this.enter();
    let left = this.parseUnary();
    while (true) {
      const token = this.peek();
      const precedence = PRECEDENCE[token.value];
      if (token.type !== "operator" || precedence === undefined || precedence < minimumPrecedence) break;
      this.index += 1;
      const right = this.parseBinary(precedence + (token.value === "**" ? 0 : 1));
      left = { type: "binary", operator: token.value, left, right };
    }
    this.depth -= 1;
    return left;
  }

  private parseUnary(): ExpressionNode {
    const token = this.peek();
    if (token.type === "operator" && ["!", "+", "-"].includes(token.value)) {
      this.index += 1;
      return { type: "unary", operator: token.value, value: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionNode {
    const token = this.peek();
    if (token.type === "number") {
      this.index += 1;
      return { type: "literal", value: Number(token.value) };
    }
    if (token.type === "string") {
      this.index += 1;
      return { type: "literal", value: token.value };
    }
    if (token.type === "identifier") {
      this.index += 1;
      if (token.value === "true") return { type: "literal", value: true };
      if (token.value === "false") return { type: "literal", value: false };
      if (token.value === "null") return { type: "literal", value: null };
      if (this.peek().value === "(") {
        this.index += 1;
        const args: ExpressionNode[] = [];
        if (this.peek().value !== ")") {
          do {
            args.push(this.parseBinary(0));
            if (this.peek().value !== ",") break;
            this.index += 1;
          } while (true);
        }
        this.expect(")");
        return { type: "call", name: token.value, args };
      }
      return { type: "reference", path: token.value.split(".") };
    }
    if (token.value === "(") {
      this.index += 1;
      const result = this.parseBinary(0);
      this.expect(")");
      return result;
    }
    throw new Error(token.type === "eof" ? "Expected an expression value." : `Unexpected token "${token.value}".`);
  }

  private enter(): void {
    this.depth += 1;
    if (this.depth > MAX_PARSE_DEPTH) throw new Error("Expression nesting is too deep.");
  }

  private expect(value: string): void {
    if (this.peek().value !== value) throw new Error(`Expected "${value}".`);
    this.index += 1;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }
}

function getProperty(value: unknown, property: string): unknown {
  if (FORBIDDEN_PROPERTIES.has(property) || value === null || value === undefined) return undefined;
  if (typeof value !== "object" && typeof value !== "string") return undefined;
  return (value as Record<string, unknown>)[property];
}

function resolveReference(path: string[], context: ExpressionContext): unknown {
  if (path.some((part) => FORBIDDEN_PROPERTIES.has(part))) {
    throw new Error("Access to that property is not allowed.");
  }
  const root = path[0];
  let value: unknown;
  let remaining = path.slice(1);
  if (root === "item") {
    value = context.item;
  } else if (root === "this") {
    value = context.thisWidget;
  } else {
    const variable = context.variables?.[root];
    if (variable !== undefined) {
      value = variable;
    } else {
      const widget = context.widgets?.find((candidate) =>
        candidate.name === root || candidate.props.name === root || candidate.props.label === root,
      );
      if (widget && remaining.length > 0) {
        value = widget;
      } else {
        value = context.variables?.[root];
      }
    }
  }
  for (const segment of remaining) value = getProperty(value, segment);
  return value;
}

function requireNumber(value: unknown, functionName: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${functionName} requires finite numeric arguments.`);
  return number;
}

function formatDate(value: unknown, format = "yyyy-MM-dd"): string {
  const date = value instanceof Date ? value : new Date(value === undefined ? Date.now() : value as string | number);
  if (!Number.isFinite(date.getTime())) throw new Error("formatDate received an invalid date.");
  const parts: Record<string, string> = {
    yyyy: String(date.getFullYear()),
    MM: String(date.getMonth() + 1).padStart(2, "0"),
    dd: String(date.getDate()).padStart(2, "0"),
    HH: String(date.getHours()).padStart(2, "0"),
    mm: String(date.getMinutes()).padStart(2, "0"),
    ss: String(date.getSeconds()).padStart(2, "0"),
  };
  return format.replace(/yyyy|MM|dd|HH|mm|ss/g, (token) => parts[token]);
}

function callFunction(name: string, args: unknown[], context: ExpressionContext): unknown {
  const first = args[0];
  switch (name) {
    case "abs": return Math.abs(requireNumber(first, name));
    case "ceil": return Math.ceil(requireNumber(first, name));
    case "floor": return Math.floor(requireNumber(first, name));
    case "round": return Math.round(requireNumber(first, name));
    case "min": return Math.min(...args.map((value) => requireNumber(value, name)));
    case "max": return Math.max(...args.map((value) => requireNumber(value, name)));
    case "random": return Math.random();
    case "concat": return args.map((value) => String(value ?? "")).join("");
    case "substring": return String(first ?? "").substring(
      requireNumber(args[1] ?? 0, name),
      args[2] === undefined ? undefined : requireNumber(args[2], name),
    );
    case "replace": return String(first ?? "").replace(String(args[1] ?? ""), String(args[2] ?? ""));
    case "toUpperCase": return String(first ?? "").toUpperCase();
    case "toLowerCase": return String(first ?? "").toLowerCase();
    case "trim": return String(first ?? "").trim();
    case "length": return typeof first === "string" || Array.isArray(first) ? first.length : 0;
    case "toString": return String(first ?? "");
    case "toNumber": {
      const number = Number(first);
      if (!Number.isFinite(number)) throw new Error("toNumber could not convert the value to a finite number.");
      return number;
    }
    case "toBoolean":
      if (typeof first === "string") return first.length > 0 && first.toLowerCase() !== "false";
      return Boolean(first);
    case "now": return (context.now ?? Date.now)();
    case "formatDate": return formatDate(first, args[1] === undefined ? undefined : String(args[1]));
    case "padStart": return String(first ?? "").padStart(
      requireNumber(args[1] ?? 0, name),
      args[2] === undefined ? " " : String(args[2]),
    );
    case "padEnd": return String(first ?? "").padEnd(
      requireNumber(args[1] ?? 0, name),
      args[2] === undefined ? " " : String(args[2]),
    );
    default: throw new Error(`Unknown expression function "${name}".`);
  }
}

function evaluateNode(node: ExpressionNode, context: ExpressionContext): unknown {
  switch (node.type) {
    case "literal": return node.value;
    case "reference": return resolveReference(node.path, context);
    case "unary": {
      const value = evaluateNode(node.value, context);
      if (node.operator === "!") return !value;
      if (node.operator === "+") return requireNumber(value, "Unary +");
      return -requireNumber(value, "Unary -");
    }
    case "call":
      return callFunction(node.name, node.args.map((argument) => evaluateNode(argument, context)), context);
    case "binary": {
      const left = evaluateNode(node.left, context);
      if (node.operator === "&&") return left && evaluateNode(node.right, context);
      if (node.operator === "||") return left || evaluateNode(node.right, context);
      const right = evaluateNode(node.right, context);
      switch (node.operator) {
        case "==": return left === right;
        case "!=": return left !== right;
        case "<": return (left as number | string) < (right as number | string);
        case ">": return (left as number | string) > (right as number | string);
        case "<=": return (left as number | string) <= (right as number | string);
        case ">=": return (left as number | string) >= (right as number | string);
        case "+": return typeof left === "string" || typeof right === "string"
          ? String(left ?? "") + String(right ?? "")
          : requireNumber(left, "+") + requireNumber(right, "+");
        case "-": return requireNumber(left, "-") - requireNumber(right, "-");
        case "*": return requireNumber(left, "*") * requireNumber(right, "*");
        case "/": return requireNumber(left, "/") / requireNumber(right, "/");
        case "%": return requireNumber(left, "%") % requireNumber(right, "%");
        case "**": return requireNumber(left, "**") ** requireNumber(right, "**");
        default: throw new Error(`Unsupported operator "${node.operator}".`);
      }
    }
  }
}

export function evaluateExpression(source: string, context: ExpressionContext = {}): unknown {
  const tokens = tokenize(source);
  const tree = new Parser(tokens).parse();
  const result = evaluateNode(tree, context);
  if (typeof result === "number" && !Number.isFinite(result)) {
    throw new Error("Expression result is not a finite number.");
  }
  return result;
}

export function interpolateExpressions(text: string, context: ExpressionContext = {}): string {
  return text.replace(/\[\[([\s\S]*?)\]\]/g, (whole, source: string) => {
    try {
      const result = evaluateExpression(source.trim(), context);
      return result === null || result === undefined ? "" : String(result);
    } catch {
      return whole;
    }
  });
}
