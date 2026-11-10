import { parse } from "acorn";
import { parseImportedHtmlDocument } from "./importedCode";
import type { InteractionRule } from "./interactionSchema";

export interface ImportedJsListenerSuggestion {
  id: string;
  nodeId: string;
  selector: string;
  eventName: string;
  protoFlowEvent: InteractionRule["event"];
  textValue?: string;
}

export interface ImportedJsListenerAnalysis {
  listeners: ImportedJsListenerSuggestion[];
  error?: string;
}

const EVENT_NAMES: Record<string, InteractionRule["event"]> = {
  click: "onClick",
  dblclick: "onDoubleClick",
  contextmenu: "onRightClick",
  mouseover: "onHover",
  mouseenter: "onHover",
  mouseleave: "onHover",
  mousedown: "onMouseDown",
  mouseup: "onMouseUp",
  change: "onChange",
  input: "onChange",
  load: "onLoad",
  focus: "onFocus",
  blur: "onBlur",
  keydown: "onKeyDown",
  touchstart: "onTouchStart",
  touchend: "onTouchEnd",
};

const MAX_JAVASCRIPT_LENGTH = 100_000;
const MAX_AST_NODES = 50_000;

type AstRecord = Record<string, unknown> & { type?: string };

function isAstRecord(value: unknown): value is AstRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string";
}

function visitAst(value: unknown, visit: (node: AstRecord) => void): boolean {
  const pending: unknown[] = [value];
  let nodeCount = 0;
  while (pending.length > 0 && nodeCount < MAX_AST_NODES) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        pending.push(current[index]);
      }
      continue;
    }
    if (!isAstRecord(current)) continue;
    nodeCount += 1;
    visit(current);
    const entries = Object.entries(current);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      if (key !== "loc" && key !== "start" && key !== "end") pending.push(child);
    }
  }
  return pending.length > 0;
}

function stringLiteral(value: unknown): string | undefined {
  if (!isAstRecord(value) || value.type !== "Literal" || typeof value.value !== "string") {
    return undefined;
  }
  return value.value;
}

function selectorForReceiver(value: unknown): string | undefined {
  if (!isAstRecord(value) || value.type !== "CallExpression" ||
    !isAstRecord(value.callee) || value.callee.type !== "MemberExpression") return undefined;
  const member = value.callee;
  if (!isAstRecord(member.object) || member.object.type !== "Identifier" ||
    member.object.name !== "document") return undefined;
  const method = isAstRecord(member.property) && member.property.type === "Identifier"
    ? member.property.name
    : undefined;
  const argument = Array.isArray(value.arguments) ? stringLiteral(value.arguments[0]) : undefined;
  if (!argument) return undefined;
  if (method === "querySelector" && argument.length <= 120) return argument;
  if (method === "getElementById" && /^[A-Za-z_][\w-]{0,119}$/.test(argument)) return `#${argument}`;
  return undefined;
}

function getTextAssignment(callback: unknown): string | undefined {
  let textValue: string | undefined;
  visitAst(callback, (node) => {
    if (textValue !== undefined || node.type !== "AssignmentExpression" ||
      !isAstRecord(node.left) || node.left.type !== "MemberExpression" ||
      !isAstRecord(node.left.property) || node.left.property.type !== "Identifier" ||
      !["textContent", "innerText"].includes(String(node.left.property.name))) return;
    const target = node.left.object;
    const isEventTarget = isAstRecord(target) && target.type === "MemberExpression" &&
      isAstRecord(target.property) && target.property.type === "Identifier" &&
      ["target", "currentTarget"].includes(String(target.property.name));
    if (!isEventTarget && (!isAstRecord(target) || target.type !== "ThisExpression")) return;
    textValue = stringLiteral(node.right);
  });
  return textValue;
}

function importedNodeIds(html: string): Map<Element, string> {
  const { body } = parseImportedHtmlDocument(html);
  const skippedTags = new Set(["HEAD", "SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "SVG"]);
  const nodes = new Map<Element, string>();
  const visit = (element: Element) => {
    if (nodes.size >= 2_000 || skippedTags.has(element.tagName) || element.hasAttribute("hidden")) return;
    nodes.set(element, `node-${nodes.size + 1}`);
    for (const child of Array.from(element.children)) visit(child);
  };
  for (const child of Array.from(body.children)) visit(child);
  return nodes;
}

export function analyzeImportedJsListeners(
  javascript: string,
  html: string,
): ImportedJsListenerAnalysis {
  if (javascript.length > MAX_JAVASCRIPT_LENGTH) {
    return { listeners: [], error: "JavaScript event scanning is limited to 100 KB." };
  }
  if (!javascript.trim()) return { listeners: [] };
  let ast: AstRecord;
  try {
    ast = parse(javascript, { ecmaVersion: "latest", sourceType: "script" }) as unknown as AstRecord;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const location = (error as SyntaxError & { loc?: { line: number; column: number } }).loc;
    return {
      listeners: [],
      error: location
        ? `JavaScript parse error at line ${location.line}, column ${location.column + 1}.`
        : "JavaScript could not be parsed.",
    };
  }

  const nodes = importedNodeIds(html);
  const listeners: ImportedJsListenerSuggestion[] = [];
  const truncated = visitAst(ast, (node) => {
    if (node.type !== "CallExpression" || !isAstRecord(node.callee) ||
      node.callee.type !== "MemberExpression" || !isAstRecord(node.callee.property) ||
      node.callee.property.type !== "Identifier" ||
      node.callee.property.name !== "addEventListener" ||
      !Array.isArray(node.arguments)) return;

    const eventName = stringLiteral(node.arguments[0])?.toLowerCase();
    const protoFlowEvent = eventName ? EVENT_NAMES[eventName] : undefined;
    const selector = selectorForReceiver(node.callee.object);
    if (!eventName || !protoFlowEvent || !selector) return;

    let element: Element | null = null;
    try {
      element = nodes.keys().next().value?.ownerDocument.querySelector(selector) ?? null;
    } catch {
      return;
    }
    if (!element) return;
    const nodeId = nodes.get(element);
    if (!nodeId) return;

    const textValue = getTextAssignment(node.arguments[1]);
    listeners.push({
      id: `${nodeId}:${eventName}:${listeners.length}`,
      nodeId,
      selector,
      eventName,
      protoFlowEvent,
      ...(textValue !== undefined ? { textValue } : {}),
    });
  });
  if (truncated) {
    return { listeners: [], error: "JavaScript event scanning stopped at 50,000 syntax nodes." };
  }
  return { listeners };
}
