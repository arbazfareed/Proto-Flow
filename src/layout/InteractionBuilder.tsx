import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Play, Trash2 } from "lucide-react";
import type {
  InteractionAction,
  InteractionCondition,
  InteractionRule,
  Project,
  Screen,
  VariableDefinition,
  Widget,
} from "../project/schema";
import { parseProject } from "../project/schema";
import {
  createInteractionRule,
  testInteractionRule,
  validateInteractionRules,
} from "../project/interactions";
import { useStore } from "../store";

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
    case "show":
    case "hide":
      return { type, target: screen.widgets[0]?.id ?? "" };
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
      : screen.widgets.filter((item) =>
          action.type === "setPanelState"
            ? ["panel", "dynamic-panel", "dynamicPanel"].includes(item.type)
            : action.type === "setRepeaterData"
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

  return (
    <section className="interaction-builder" aria-label="Interaction rules">
      <div className="interaction-builder-heading">
        <div>
          <strong>TRIGGERS</strong>
          <p>Rules for {widget.name ?? widget.type}</p>
        </div>
        <button type="button" className="interaction-add-button" onClick={addRule}>
          <Plus size={13} /> Add rule
        </button>
      </div>
      {relevantRules.length === 0 ? (
        <p className="interaction-empty">No interactions yet.</p>
      ) : relevantRules.map((rule, index) => (
        <article
          className="interaction-rule-card"
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
                      ? { ...entry, target }
                      : entry),
                  }))
                } />
                {action.type === "setVariable" && variable && (
                  variable.type === "boolean" ? (
                    <select aria-label="Action value" value={String(action.value ?? variable.initial)} onChange={(event) => {
                      const value = event.currentTarget.value === "true";
                      updateRule(rule.id, (item) => ({
                        ...item,
                        actions: item.actions.map((entry, index) => index === actionIndex
                          ? { ...entry, value }
                          : entry),
                      }));
                    }}><option value="true">true</option><option value="false">false</option></select>
                  ) : (
                    <input aria-label="Action value" type={variable.type === "number" ? "number" : "text"}
                      value={String(action.value ?? variable.initial)}
                      onChange={(event) => {
                        const value = actionValue(variable, event.currentTarget.value);
                        updateRule(rule.id, (item) => ({
                          ...item,
                          actions: item.actions.map((entry, index) => index === actionIndex
                            ? { ...entry, value }
                            : entry),
                        }));
                      }} />
                  )
                )}
                {(action.type === "setPanelState" || action.type === "setRepeaterData") && (
                  <input aria-label="Action value" type="text"
                    placeholder={action.type === "setPanelState" ? "State name" : "Dataset JSON"}
                    value={String(action.value ?? "")}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
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
      <button type="button" className="interaction-save-button" disabled={!unsaved || hasBlockingErrors} onClick={save}>
        {unsaved ? "Save interactions" : "Saved"}
      </button>
    </section>
  );
}
