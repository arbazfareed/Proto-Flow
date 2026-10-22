import { useId, useRef } from "react";
import type { ExpressionContext } from "../project/expressions";
import { evaluateExpression, EXPRESSION_FUNCTIONS } from "../project/expressions";
import type { Project } from "../project/schema";

export function ExpressionField({
  label,
  value,
  onChange,
  project,
  screenId,
  context,
  multiline = false,
  expectedType,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  project: Project;
  screenId: string;
  context?: ExpressionContext;
  multiline?: boolean;
  expectedType?: "string" | "number" | "boolean";
}) {
  const listId = useId();
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const variableNames = project.variables
    .filter((variable) => variable.scope === "project" || variable.screenId === screenId)
    .map((variable) => variable.name)
    .concat(Object.keys(context?.variables ?? {}));
  const widgetNames = project.screens
    .find((screen) => screen.id === screenId)?.widgets
    .flatMap((widget) => [widget.name, typeof widget.props.name === "string" ? widget.props.name : ""])
    .filter((name): name is string => Boolean(name)) ?? [];
  const suggestions = [...new Set([
    ...variableNames,
    ...widgetNames,
    "item.field",
    "this.x",
    ...EXPRESSION_FUNCTIONS.map((name) => `${name}(`),
  ])];
  const expressionMatches = [...value.matchAll(/\[\[([\s\S]*?)\]\]/g)];
  let preview = value;
  let error = "";
  let resultType: string | undefined;
  if (expressionMatches.length > 0) {
    preview = value.replace(/\[\[([\s\S]*?)\]\]/g, (whole, source: string) => {
      try {
        const result = evaluateExpression(source.trim(), context);
        resultType = result === null ? "null" : typeof result;
        return result === null || result === undefined ? "" : String(result);
      } catch (cause) {
        error ||= cause instanceof Error ? cause.message : "Invalid expression.";
        return whole;
      }
    });
  }
  const typeWarning = expectedType && /^\[\[[\s\S]*\]\]$/.test(value) &&
    resultType !== undefined && resultType !== expectedType
    ? `Expected ${expectedType}, expression returns ${resultType}.`
    : "";

  const insertExpression = () => {
    const input = inputRef.current;
    if (!input) return;
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? start;
    const next = `${value.slice(0, start)}[[ ]]${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + 3, start + 3);
    });
  };
  const insertSuggestion = (suggestion: string) => {
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    const next = `${value.slice(0, start)}${suggestion}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + suggestion.length, start + suggestion.length);
    });
  };

  return (
    <div className="expression-field">
      <label className="field-label" htmlFor={`${listId}-input`}>{label}</label>
      {multiline ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          id={`${listId}-input`}
          className="text-field expression-field-input"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          id={`${listId}-input`}
          className="text-field"
          list={listId}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      )}
      <datalist id={listId}>
        {suggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
      </datalist>
      <div className="expression-field-toolbar">
        <span>Use <code>[[ expression ]]</code></span>
        <button type="button" className="style-none-button" onClick={insertExpression}>Insert [[ ]]</button>
      </div>
      <details className="expression-autocomplete">
        <summary>Variables &amp; functions</summary>
        <div role="listbox" aria-label="Expression autocomplete suggestions">
          {suggestions.map((suggestion) => (
            <button key={suggestion} type="button" role="option" onClick={() => insertSuggestion(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
      </details>
      {expressionMatches.length > 0 && (
        <p className={`expression-field-preview${error ? " is-error" : typeWarning ? " is-warning" : ""}`} role={error ? "alert" : "status"}>
          {error ? `Expression error: ${error}` : typeWarning || `Preview: ${preview}`}
        </p>
      )}
    </div>
  );
}
