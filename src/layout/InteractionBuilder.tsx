import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Play, Sparkles, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import type {
  InteractionAction,
  InteractionCondition,
  InteractionRule,
  Project,
  Screen,
  VariableDefinition,
  Widget,
} from "../project/schema";
import { InteractionRuleSchema, parseProject } from "../project/schema";
import {
  createInteractionRule,
  testInteractionRule,
  validateInteractionRules,
} from "../project/interactions";
import { useStore } from "../store";
import { submitInteractionFeedback } from "../wallet/api";
import { useMeteredAction } from "../wallet/meteredActions";
import { useWalletStore } from "../wallet/store";
import { collectWidgetsDeep, getPanelStates, PANEL_TRANSITIONS } from "../project/dynamicPanels";
import { ExpressionField } from "./ExpressionField";

const EVENTS = [
  ["onClick", "Click"],
  ["onHover", "Hover"],
  ["onChange", "Change"],
  ["onLoad", "Load"],
  ["onTap", "Tap"],
  ["onTouchStart", "Touch start"],
  ["onTouchEnd", "Touch end"],
] as const;

const OPERATORS = [
  ["equals", "=="],
  ["notEquals", "!="],
  ["greaterThan", ">"],
  ["greaterThanOrEqual", ">="],
  ["lessThan", "<"],
  ["lessThanOrEqual", "<="],
  ["contains", "contains"],
] as const;

const ACTIONS = [
  ["navigate", "Navigate"],
  ["show", "Show"],
  ["hide", "Hide"],
  ["setVariable", "Set variable"],
  ["setPanelState", "Set panel state"],
  ["setRepeaterData", "Set repeater data"],
  ["addRepeaterRow", "Add repeater row"],
  ["removeRepeaterRow", "Remove repeater row"],
  ["sortRepeater", "Sort repeater"],
  ["filterRepeater", "Filter repeater"],
] as const;

function getVariable(project: Project, screenId: string, name: string) {
  return project.variables.find(
    (item) => item.scope === "screen" && item.screenId === screenId && item.name === name,
  ) ?? project.variables.find((item) => item.scope === "project" && item.name === name);
}

function initialAction(type: string, screen: Screen): InteractionAction {
  switch (type) {
    case "navigate":
      return { type, target: "" };
    case "setVariable":
      return { type, target: "", value: "" };
    case "setPanelState":
    case "setRepeaterData":
    case "addRepeaterRow":
    case "removeRepeaterRow":
    case "sortRepeater":
    case "filterRepeater":
    case "show":
    case "hide":
      return {
        type,
        target: (type === "setPanelState"
          ? collectWidgetsDeep(screen.widgets).find((item) => item.type === "dynamic-panel")
          : type === "setRepeaterData" || type === "addRepeaterRow" ||
              type === "removeRepeaterRow" || type === "sortRepeater" || type === "filterRepeater"
            ? collectWidgetsDeep(screen.widgets).find((item) => item.type === "repeater")
          : collectWidgetsDeep(screen.widgets)[0])?.id ?? "",
        ...(["setRepeaterData", "addRepeaterRow", "removeRepeaterRow", "sortRepeater", "filterRepeater"]
          .includes(type) ? {
            value: type === "setRepeaterData" ? "[]" :
              type === "addRepeaterRow" ? "{}" :
                type === "removeRepeaterRow" ? "0" :
                  type === "sortRepeater" ? '{"field":"name","direction":"asc"}' :
                    '{"field":"name","operator":"equals","value":""}',
          } : {}),
      };
    default:
      return { type, target: "" };
  }
}

function conditionValue(variable: VariableDefinition | undefined, value: string) {
  if (variable?.type === "number") return value === "" ? "" : Number(value);
  if (variable?.type === "boolean") return value === "true";
  return value;
}

function actionValue(variable: VariableDefinition | undefined, value: string) {
  if (variable?.type === "number") return value === "" ? "" : Number(value);
  if (variable?.type === "boolean") return value === "true";
  return value;
}

function moveEntry<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) {
    return items;
  }
  const reordered = [...items];
  const [entry] = reordered.splice(from, 1);
  reordered.splice(to, 0, entry);
  return reordered;
}

function ActionTarget({
  project,
  screen,
  action,
  onChange,
}: {
  project: Project;
  screen: Screen;
  action: InteractionAction;
  onChange: (target: string) => void;
}) {
  const targets = action.type === "navigate" || action.type === "navigateTo"
    ? project.screens.map((item) => ({ id: item.id, label: item.name }))
    : action.type === "setVariable"
      ? project.variables
          .filter((item) =>
            item.scope === "project" || item.screenId === screen.id,
          )
          .map((item) => ({ id: item.name, label: item.name }))
      : collectWidgetsDeep(screen.widgets).filter((item) =>
          action.type === "setPanelState"
            ? ["panel", "dynamic-panel", "dynamicPanel"].includes(item.type)
            : ["setRepeaterData", "addRepeaterRow", "removeRepeaterRow", "sortRepeater", "filterRepeater"]
                .includes(action.type)
              ? item.type === "repeater"
              : true,
        ).map((item) => ({
            id: item.id,
            label: item.name ?? item.type,
          }));
  return (
    <select aria-label="Action target" value={action.target} onChange={(event) => onChange(event.currentTarget.value)}>
      <option value="">Choose target</option>
      {targets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
  );
}

export function InteractionBuilder({
  project,
  screen,
  widget,
}: {
  project: Project;
  screen: Screen;
  widget: Widget;
}) {
  const setProject = useStore((state) => state.setProject);
  const [rules, setRules] = useState<InteractionRule[]>([]);
  const [savedRules, setSavedRules] = useState<InteractionRule[]>([]);
  const [testMessage, setTestMessage] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiContextScope, setAiContextScope] = useState<"widget" | "screen">("screen");
  const [generatedRuleId, setGeneratedRuleId] = useState<string | null>(null);
  const [feedbackStatus, setFeedbackStatus] = useState("");
  const aiPayload = useMemo(() => ({
    prompt: aiPrompt,
    widgetContext: {
      id: widget.id,
      name: widget.name ?? widget.type,
      type: widget.type,
      screenId: screen.id,
      screenName: screen.name,
      text: [widget.props.text, widget.props.label, widget.props.title]
        .find((value): value is string => typeof value === "string") ?? "",
    },
    variables: project.variables
      .filter((variable) => variable.scope === "project" || variable.screenId === screen.id)
      .map(({ name, type, scope, initial }) => ({ name, type, scope, initial })),
    screens: project.screens.map(({ id, name }) => ({ id, name })),
    widgets: (aiContextScope === "screen" ? screen.widgets : [widget]).map((item) => ({
      id: item.id,
      name: item.name ?? item.type,
      type: item.type,
      screenId: screen.id,
    })),
  }), [aiContextScope, aiPrompt, project.screens, project.variables, screen.id, screen.name, screen.widgets, widget]);
  const aiGenerator = useMeteredAction<InteractionRule>("ai_interaction_generator", aiPayload);

  const relevantRules = useMemo(
    () => rules.filter((rule) => rule.widgetId === widget.id || !rule.widgetId),
    [rules, widget.id],
  );
  const issues = useMemo(
    () => validateInteractionRules({ ...project, screens: project.screens.map((item) =>
      item.id === screen.id ? { ...item, interactionRules: rules } : item,
    ) }, { ...screen, interactionRules: rules }),
    [project, rules, screen],
  );
  const unsaved = JSON.stringify(rules) !== JSON.stringify(savedRules);
  const hasBlockingErrors = issues.some((issue) => issue.severity === "error");

  useEffect(() => {
    const screenRules = structuredClone(screen.interactionRules);
    setRules(screenRules);
    setSavedRules(screenRules);
    setTestMessage("");
  }, [screen.id, screen.interactionRules]);

  const updateRule = (id: string, update: (rule: InteractionRule) => InteractionRule) => {
    setRules((current) => current.map((rule) => rule.id === id ? update(rule) : rule));
    setTestMessage("");
  };

  const save = () => {
    const nextProject = {
      ...project,
      screens: project.screens.map((item) =>
        item.id === screen.id ? { ...item, interactionRules: rules } : item,
      ),
      updatedAt: new Date().toISOString(),
    };
    setProject(parseProject(nextProject));
    setSavedRules(structuredClone(rules));
  };

  const addRule = () => {
    setRules((current) => [...current, createInteractionRule(widget)]);
  };

  const addTemplate = (template: string) => {
    const rule = createInteractionRule(widget);
    if (template === "navigate" && project.screens.length > 1) {
      const destination = project.screens.find((item) => item.id !== screen.id);
      if (destination) {
        rule.actions[0] = { type: "navigate", target: destination.id };
      }
    } else if (template === "setVariable" && project.variables.length > 0) {
      const variable = project.variables.find((item) =>
        item.scope === "project" || item.screenId === screen.id,
      );
      if (variable) {
        rule.actions[0] = { type: "setVariable", target: variable.name, value: variable.initial };
      }
    }
    setRules((current) => [...current, rule]);
  };

  const reorder = (index: number, direction: -1 | 1) => {
    const currentRule = relevantRules[index];
    const nextRule = relevantRules[index + direction];
    if (!currentRule || !nextRule) return;
    setRules((current) => {
      const from = current.findIndex((rule) => rule.id === currentRule.id);
      const to = current.findIndex((rule) => rule.id === nextRule.id);
      const result = [...current];
      [result[from], result[to]] = [result[to], result[from]];
      return result;
    });
  };

  const runTest = (rule: InteractionRule) => {
    const result = testInteractionRule(project, screen, rule);
    setTestMessage(result.matched
      ? `Matched. ${result.actions.join("; ") || "No actions to run."}`
      : "Conditions did not match the variables' initial values.");
  };

  const generateRule = async () => {
    setFeedbackStatus("");
    const result = await aiGenerator.run();
    if (!result) return;
    const parsedRule = InteractionRuleSchema.safeParse(result);
    if (!parsedRule.success || parsedRule.data.widgetId !== widget.id) {
      setFeedbackStatus("The AI returned an invalid rule. No changes were saved.");
      return;
    }
    setRules((current) => [...current, parsedRule.data]);
    setGeneratedRuleId(parsedRule.data.id);
    setFeedbackStatus("AI rule added for review. Save interactions when you're ready.");
  };

  const sendFeedback = async (ruleId: string, feedback: "positive" | "negative") => {
    const token = useWalletStore.getState().jwt;
    if (!token) {
      setFeedbackStatus("Your wallet session expired. Refresh it before sending feedback.");
      return;
    }
    try {
      await submitInteractionFeedback(token, ruleId, feedback);
      setFeedbackStatus("Thanks for your feedback.");
    } catch (error) {
      setFeedbackStatus(error instanceof Error ? error.message : "Could not send AI feedback.");
    }
  };

  return (
    <section className="interaction-builder" aria-label="Interaction rules">
      <div className="interaction-builder-heading">
        <div>
          <strong>TRIGGERS</strong>
          <p>Rules for {widget.name ?? widget.type}</p>
        </div>
        <div className="interaction-builder-actions">
          <button type="button" className="interaction-add-button" onClick={() => setAiOpen((open) => !open)}>
            <Sparkles size={13} /> Generate with AI
          </button>
          <button type="button" className="interaction-add-button" onClick={addRule}>
            <Plus size={13} /> Add rule
          </button>
        </div>
      </div>
      {aiOpen && (
        <div className="interaction-ai-generator" aria-label="AI interaction generator">
          <label htmlFor="interaction-ai-prompt">Describe the interaction</label>
          <textarea
            id="interaction-ai-prompt"
            aria-label="Describe the interaction"
            maxLength={2000}
            placeholder="For example: When clicked, set isOpen to true."
            value={aiPrompt}
            onChange={(event) => setAiPrompt(event.currentTarget.value)}
          />
          <div className="interaction-ai-options">
            <label>Context
              <select aria-label="AI context" value={aiContextScope} onChange={(event) =>
                setAiContextScope(event.currentTarget.value as "widget" | "screen")
              }>
                <option value="screen">Current screen</option>
                <option value="widget">Selected widget only</option>
              </select>
            </label>
            <label>Example
              <select aria-label="Prompt examples" value="" onChange={(event) => {
                if (event.currentTarget.value) setAiPrompt(event.currentTarget.value);
                event.currentTarget.value = "";
              }}>
                <option value="">Choose an example</option>
                <option value="When clicked, navigate to the next screen.">Click to navigate</option>
                <option value="When clicked, set the selected boolean variable to true.">Click to set a variable</option>
                <option value="When the input changes, update its bound variable.">Input changes a variable</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            className="interaction-ai-submit"
            disabled={aiGenerator.isRunning || aiPrompt.trim().length === 0}
            onClick={() => void generateRule()}
          >
            <Sparkles size={12} /> {aiGenerator.isRunning ? "Generating…" : "Generate (1 credit)"}
          </button>
          {aiGenerator.error && <p className="interaction-issue is-error" role="alert">{aiGenerator.error}</p>}
        </div>
      )}
      {relevantRules.length === 0 ? (
        <p className="interaction-empty">No interactions yet.</p>
      ) : relevantRules.map((rule, index) => (
        <article
          className={`interaction-rule-card${generatedRuleId === rule.id ? " is-ai-generated" : ""}`}
          key={rule.id}
          draggable
          onDragStart={(event) => event.dataTransfer.setData("text/plain", rule.id)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const movingId = event.dataTransfer.getData("text/plain");
            const from = rules.findIndex((item) => item.id === movingId);
            const to = rules.findIndex((item) => item.id === rule.id);
            if (from < 0 || to < 0 || from === to) return;
            setRules((current) => {
              const next = [...current];
              const [moving] = next.splice(from, 1);
              next.splice(to, 0, moving);
              return next;
            });
          }}
        >
          <div className="interaction-rule-title">
            <span>RULE {index + 1}</span>
            <div>
              <button type="button" aria-label={`Move rule ${index + 1} up`} disabled={index === 0} onClick={() => reorder(index, -1)}><ArrowUp size={12} /></button>
              <button type="button" aria-label={`Move rule ${index + 1} down`} disabled={index === relevantRules.length - 1} onClick={() => reorder(index, 1)}><ArrowDown size={12} /></button>
              <button type="button" aria-label={`Delete rule ${index + 1}`} onClick={() => {
                if (window.confirm("Delete this interaction rule?")) {
                  setRules((current) => current.filter((item) => item.id !== rule.id));
                  setTestMessage("");
                }
              }}><Trash2 size={12} /></button>
            </div>
          </div>
          <label>When
            <select
              aria-label="Trigger event"
              value={rule.event}
              onChange={(event) => {
                const eventName = event.currentTarget.value as InteractionRule["event"];
                updateRule(rule.id, (item) => ({ ...item, event: eventName }));
              }}
            >
              {EVENTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <div className="interaction-subheading">
            <span>Conditions</span>
            <button type="button" onClick={() => updateRule(rule.id, (item) => ({
              ...item,
              conditions: [...item.conditions, {
                variable: project.variables.find((variable) =>
                  variable.scope === "project" || variable.screenId === screen.id,
                )?.name ?? "",
                operator: "equals",
                value: "",
              }],
            }))}><Plus size={11} /> Add</button>
          </div>
          {rule.conditions.map((condition, conditionIndex) => {
            const variable = getVariable(project, screen.id, condition.variable);
            const expressionMode = /^\[\[[\s\S]*\]\]$/.test(condition.variable);
            return (
              <div className="interaction-condition" key={`${rule.id}-condition-${conditionIndex}`}
                draggable
                onDragStart={(event) => event.dataTransfer.setData("text/plain", `condition:${rule.id}:${conditionIndex}`)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const [kind, ruleId, rawIndex] = event.dataTransfer.getData("text/plain").split(":");
                  if (kind !== "condition" || ruleId !== rule.id) return;
                  const from = Number(rawIndex);
                  updateRule(rule.id, (item) => ({
                    ...item,
                    conditions: moveEntry(item.conditions, from, conditionIndex),
                  }));
                }}
              >
                {conditionIndex === 0 && rule.conditions.length > 1 ? (
                  <select
                    aria-label="Condition matching mode"
                    value={rule.conditionMode ?? "all"}
                    onChange={(event) => {
                      const mode = event.currentTarget.value as "all" | "any";
                      updateRule(rule.id, (item) => ({ ...item, conditionMode: mode }));
                    }}
                  ><option value="all">All</option><option value="any">Any</option></select>
                ) : <span className="interaction-condition-and">{conditionIndex ? (rule.conditionMode === "any" ? "OR" : "AND") : "IF"}</span>}
                {!expressionMode && (
                  <>
                <select
                  aria-label="Condition variable"
                  value={condition.variable}
                  onChange={(event) => {
                    const name = event.currentTarget.value;
                    const selected = getVariable(project, screen.id, name);
                    updateRule(rule.id, (item) => ({
                      ...item,
                      conditions: item.conditions.map((entry, index) => index === conditionIndex
                        ? { ...entry, variable: name, value: selected?.initial ?? "" }
                        : entry),
                    }));
                  }}
                >
                  <option value="">Variable</option>
                  {project.variables.filter((item) => item.scope === "project" || item.screenId === screen.id)
                    .map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                </select>
                <select
                  aria-label="Condition operator"
                  value={condition.operator}
                  onChange={(event) => {
                    const operator = event.currentTarget.value as InteractionCondition["operator"];
                    updateRule(rule.id, (item) => ({
                      ...item,
                      conditions: item.conditions.map((entry, index) => index === conditionIndex
                        ? { ...entry, operator }
                        : entry),
                    }));
                  }}
                >{OPERATORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                {variable?.type === "boolean" ? (
                  <select aria-label="Condition value" value={String(condition.value)} onChange={(event) => {
                    const value = event.currentTarget.value === "true";
                    updateRule(rule.id, (item) => ({
                      ...item,
                      conditions: item.conditions.map((entry, index) => index === conditionIndex
                        ? { ...entry, value }
                        : entry),
                    }));
                  }}><option value="true">true</option><option value="false">false</option></select>
                ) : (
                  <input
                    aria-label="Condition value"
                    type={variable?.type === "number" ? "number" : "text"}
                    value={String(condition.value ?? "")}
                    onChange={(event) => {
                      const value = conditionValue(variable, event.currentTarget.value);
                      updateRule(rule.id, (item) => ({
                        ...item,
                        conditions: item.conditions.map((entry, index) => index === conditionIndex
                          ? { ...entry, value }
                          : entry),
                      }));
                    }}
                  />
                )}
                  </>
                )}
                {expressionMode ? (
                  <>
                    <ExpressionField
                      label={`Condition ${conditionIndex + 1} expression`}
                      value={condition.variable}
                      project={project}
                      screenId={screen.id}
                      expectedType="boolean"
                      context={{
                        variables: Object.fromEntries(project.variables.map((entry) => [entry.name, entry.initial])),
                        widgets: collectWidgetsDeep(screen.widgets),
                        thisWidget: widget,
                      }}
                      onChange={(value) => updateRule(rule.id, (item) => ({
                        ...item,
                        conditions: item.conditions.map((entry, index) => index === conditionIndex
                          ? { ...entry, variable: value }
                          : entry),
                      }))}
                    />
                    <button type="button" onClick={() => updateRule(rule.id, (item) => ({
                      ...item,
                      conditions: item.conditions.map((entry, index) => index === conditionIndex
                        ? { ...entry, variable: "" }
                        : entry),
                    }))}>Use variable</button>
                  </>
                ) : (
                  <button type="button" aria-label={`Use expression for condition ${conditionIndex + 1}`} onClick={() => updateRule(rule.id, (item) => ({
                    ...item,
                    conditions: item.conditions.map((entry, index) => index === conditionIndex
                      ? { ...entry, variable: "[[ ]]"}
                      : entry),
                  }))}>[[ ]]</button>
                )}
                <div className="interaction-row-controls">
                  <button type="button" aria-label={`Move condition ${conditionIndex + 1} up`} disabled={conditionIndex === 0}
                    onClick={() => updateRule(rule.id, (item) => ({ ...item, conditions: moveEntry(item.conditions, conditionIndex, conditionIndex - 1) }))}><ArrowUp size={10} /></button>
                  <button type="button" aria-label={`Move condition ${conditionIndex + 1} down`} disabled={conditionIndex === rule.conditions.length - 1}
                    onClick={() => updateRule(rule.id, (item) => ({ ...item, conditions: moveEntry(item.conditions, conditionIndex, conditionIndex + 1) }))}><ArrowDown size={10} /></button>
                  <button type="button" aria-label={`Remove condition ${conditionIndex + 1}`} onClick={() => updateRule(rule.id, (item) => ({
                    ...item,
                    conditions: item.conditions.filter((_, index) => index !== conditionIndex),
                  }))}><Trash2 size={10} /></button>
                </div>
              </div>
            );
          })}
          <div className="interaction-subheading">
            <span>Actions</span>
            <button type="button" onClick={() => updateRule(rule.id, (item) => ({
              ...item,
              actions: [...item.actions, initialAction("navigate", screen)],
            }))}><Plus size={11} /> Add</button>
          </div>
          {rule.actions.map((action, actionIndex) => {
            const variable = action.type === "setVariable"
              ? getVariable(project, screen.id, action.target)
              : undefined;
            return (
              <div className="interaction-action" key={`${rule.id}-action-${actionIndex}`}
                draggable
                onDragStart={(event) => event.dataTransfer.setData("text/plain", `action:${rule.id}:${actionIndex}`)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const [kind, ruleId, rawIndex] = event.dataTransfer.getData("text/plain").split(":");
                  if (kind !== "action" || ruleId !== rule.id) return;
                  const from = Number(rawIndex);
                  updateRule(rule.id, (item) => ({
                    ...item,
                    actions: moveEntry(item.actions, from, actionIndex),
                  }));
                }}
              >
                <select aria-label="Action type" value={action.type} onChange={(event) => {
                  const type = event.currentTarget.value;
                  updateRule(rule.id, (item) => ({
                    ...item,
                    actions: item.actions.map((entry, index) => index === actionIndex
                      ? initialAction(type, screen)
                      : entry),
                  }));
                }}>
                  {ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  {!ACTIONS.some(([value]) => value === action.type) && <option value={action.type}>{action.type}</option>}
                </select>
                <ActionTarget project={project} screen={screen} action={action} onChange={(target) =>
                  updateRule(rule.id, (item) => ({
                    ...item,
                    actions: item.actions.map((entry, index) => index === actionIndex
                      ? action.type === "setPanelState"
                        ? { ...entry, target, stateId: undefined, value: undefined }
                        : { ...entry, target }
                      : entry),
                  }))
                } />
                {action.type === "setVariable" && variable && (
                  <ExpressionField
                    label="Action value"
                    value={String(action.value ?? variable.initial)}
                    project={project}
                    screenId={screen.id}
                    expectedType={variable.type}
                    context={{
                      variables: Object.fromEntries(project.variables.map((entry) => [entry.name, entry.initial])),
                      widgets: collectWidgetsDeep(screen.widgets),
                      thisWidget: widget,
                    }}
                    onChange={(raw) => {
                      const value = raw.includes("[[")
                        ? raw
                        : variable.type === "boolean"
                          ? raw === "true"
                          : actionValue(variable, raw);
                      updateRule(rule.id, (item) => ({
                        ...item,
                        actions: item.actions.map((entry, index) => index === actionIndex
                          ? { ...entry, value }
                          : entry),
                      }));
                    }}
                  />
                )}
                {action.type === "setPanelState" && (() => {
                  const panel = collectWidgetsDeep(screen.widgets).find((item) => item.id === action.target);
                  const states = panel ? getPanelStates(panel) : [];
                  return (
                    <>
                      {states.length > 0 ? (
                        <select aria-label="Panel state" value={action.stateId ?? String(action.value ?? "")} onChange={(event) => {
                          const stateId = event.currentTarget.value;
                          updateRule(rule.id, (item) => ({
                            ...item,
                            actions: item.actions.map((entry, index) => index === actionIndex
                              ? { ...entry, stateId, value: undefined }
                              : entry),
                          }));
                        }}>
                          <option value="">Choose state</option>
                          {states.map((state) => <option key={state.id} value={state.id}>{state.name}</option>)}
                        </select>
                      ) : (
                        <input aria-label="Panel state" type="text" placeholder="State name"
                          value={String(action.value ?? "")}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            updateRule(rule.id, (item) => ({
                              ...item,
                              actions: item.actions.map((entry, index) => index === actionIndex
                                ? { ...entry, value, stateId: undefined }
                                : entry),
                            }));
                          }} />
                      )}
                      <select aria-label="Panel transition" value={action.transition ?? "none"} onChange={(event) => {
                        const transition = event.currentTarget.value as (typeof PANEL_TRANSITIONS)[number];
                        updateRule(rule.id, (item) => ({
                          ...item,
                          actions: item.actions.map((entry, index) => index === actionIndex
                            ? { ...entry, transition }
                            : entry),
                        }));
                      }}>
                        {PANEL_TRANSITIONS.map((transition) => <option key={transition} value={transition}>{transition}</option>)}
                      </select>
                      <input aria-label="Transition duration (ms)" type="number" min="0" max="10000" step="50"
                        value={action.duration ?? 0}
                        onChange={(event) => {
                          const duration = Number(event.currentTarget.value);
                          updateRule(rule.id, (item) => ({
                            ...item,
                            actions: item.actions.map((entry, index) => index === actionIndex
                              ? { ...entry, duration }
                              : entry),
                          }));
                        }} />
                    </>
                  );
                })()}
                {["setRepeaterData", "addRepeaterRow", "removeRepeaterRow", "sortRepeater", "filterRepeater"].includes(action.type) && (
                  <ExpressionField
                    label="Action value"
                    value={String(action.value ?? "")}
                    project={project}
                    screenId={screen.id}
                    multiline={action.type === "setRepeaterData"}
                    context={{
                      variables: Object.fromEntries(project.variables.map((entry) => [entry.name, entry.initial])),
                      widgets: collectWidgetsDeep(screen.widgets),
                      thisWidget: widget,
                    }}
                    onChange={(value) => {
                      updateRule(rule.id, (item) => ({
                        ...item,
                        actions: item.actions.map((entry, index) => index === actionIndex
                          ? { ...entry, value }
                          : entry),
                      }));
                    }} />
                )}
                <div className="interaction-row-controls">
                  <button type="button" aria-label={`Move action ${actionIndex + 1} up`} disabled={actionIndex === 0}
                    onClick={() => updateRule(rule.id, (item) => ({ ...item, actions: moveEntry(item.actions, actionIndex, actionIndex - 1) }))}><ArrowUp size={10} /></button>
                  <button type="button" aria-label={`Move action ${actionIndex + 1} down`} disabled={actionIndex === rule.actions.length - 1}
                    onClick={() => updateRule(rule.id, (item) => ({ ...item, actions: moveEntry(item.actions, actionIndex, actionIndex + 1) }))}><ArrowDown size={10} /></button>
                  <button type="button" aria-label={`Remove action ${actionIndex + 1}`} disabled={rule.actions.length <= 1} onClick={() => updateRule(rule.id, (item) => ({
                    ...item,
                    actions: item.actions.filter((_, index) => index !== actionIndex),
                  }))}><Trash2 size={10} /></button>
                </div>
              </div>
            );
          })}
          {issues.filter((issue) => issue.ruleId === rule.id).map((issue, issueIndex) => (
            <p className={`interaction-issue is-${issue.severity}`} key={`${issue.code}-${issueIndex}`}>{issue.message}</p>
          ))}
          <button type="button" className="interaction-test-button" onClick={() => runTest(rule)}><Play size={11} /> Test rule</button>
          {generatedRuleId === rule.id && (
            <div className="interaction-ai-feedback" aria-label="AI generation feedback">
              <span>AI-generated · review before saving</span>
              <button type="button" aria-label="AI result was helpful" onClick={() => void sendFeedback(rule.id, "positive")}><ThumbsUp size={12} /></button>
              <button type="button" aria-label="AI result was not helpful" onClick={() => void sendFeedback(rule.id, "negative")}><ThumbsDown size={12} /></button>
            </div>
          )}
        </article>
      ))}
      {unsaved && hasBlockingErrors && (
        <p className="interaction-issue is-error" role="alert">Resolve target and variable errors before saving.</p>
      )}
      <label className="interaction-template">Add template
        <select value="" onChange={(event) => {
          if (event.currentTarget.value) addTemplate(event.currentTarget.value);
          event.currentTarget.value = "";
        }}>
          <option value="">Choose a rule template</option>
          <option value="navigate">Click to navigate</option>
          <option value="setVariable">Click to set a variable</option>
        </select>
      </label>
      {testMessage && <p className="interaction-test-result" role="status">{testMessage}</p>}
      {feedbackStatus && <p className="interaction-test-result" role="status">{feedbackStatus}</p>}
      <button type="button" className="interaction-save-button" disabled={!unsaved || hasBlockingErrors} onClick={save}>
        {unsaved ? "Save interactions" : "Saved"}
      </button>
    </section>
  );
}
