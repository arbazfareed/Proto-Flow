import { useMemo, useState } from "react";
import { Braces, Plus, Trash2 } from "lucide-react";
import { useStore } from "../store";
import {
  isValidVariableName,
  parseProject,
  type VariableDefinition,
} from "../project/schema";
import {
  getVariableReferenceCount,
  renameVariableReferences,
  validateVariableReferences,
} from "../project/variables";

type VariableType = VariableDefinition["type"];
type VariableScope = VariableDefinition["scope"];

function initialForType(type: VariableType): string {
  return type === "string" ? "" : type === "number" ? "0" : "false";
}

function typedInitial(type: VariableType, value: string): string | number | boolean | null {
  if (type === "string") return value;
  if (type === "number") {
    if (!value.trim()) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return value === "true";
}

export function VariablesPanel() {
  const project = useStore((state) => state.project);
  const activeScreenId = useStore((state) => state.getActiveScreenId());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<VariableType>("string");
  const [initial, setInitial] = useState("");
  const [scope, setScope] = useState<VariableScope>("project");
  const [screenId, setScreenId] = useState(activeScreenId);
  const [error, setError] = useState("");
  const selected = project.variables.find((variable) => variable.id === selectedId);
  const validationIssues = useMemo(() => validateVariableReferences(project), [project]);
  const visibleVariables = project.variables.filter(
    (variable) => variable.scope === "project" ||
      (variable.scope === "screen" && variable.screenId === activeScreenId),
  );
  const references = selected ? getVariableReferenceCount(project, selected.id) : 0;

  const selectVariable = (variable: VariableDefinition) => {
    setSelectedId(variable.id);
    setName(variable.name);
    setType(variable.type);
    setInitial(String(variable.initial));
    setScope(variable.scope);
    setScreenId(variable.screenId ?? activeScreenId);
    setError("");
  };

  const startNewVariable = () => {
    setSelectedId(null);
    setName("");
    setType("string");
    setInitial("");
    setScope("project");
    setScreenId(activeScreenId);
    setError("");
  };

  const saveVariable = () => {
    const normalizedName = name.trim();
    if (!isValidVariableName(normalizedName)) {
      setError("Use a valid identifier, such as customerName.");
      return;
    }
    const targetScreenId = scope === "screen" ? screenId : undefined;
    if (scope === "screen" && !project.screens.some((screen) => screen.id === targetScreenId)) {
      setError("Choose a screen for this variable.");
      return;
    }
    if (project.variables.some((variable) =>
      variable.id !== selectedId &&
      variable.name === normalizedName &&
      variable.scope === scope &&
      (scope === "project" || variable.screenId === targetScreenId),
    )) {
      setError("A variable with this name already exists in that scope.");
      return;
    }
    const typedValue = typedInitial(type, initial);
    if (typedValue === null) {
      setError("Enter a valid finite number.");
      return;
    }
    if (selected && selected.type !== type &&
      !window.confirm(`Changing "${selected.name}" from ${selected.type} to ${type} resets its initial value and may affect interactions. Continue?`)) {
      return;
    }

    const baseProject = selected && selected.name !== normalizedName
      ? renameVariableReferences(project, selected, normalizedName)
      : project;
    const variable = {
      id: selectedId ?? crypto.randomUUID(),
      name: normalizedName,
      type,
      initial: typedValue,
      scope,
      ...(targetScreenId ? { screenId: targetScreenId } : {}),
    };
    const nextProject = {
      ...baseProject,
      updatedAt: new Date().toISOString(),
      variables: selectedId
        ? baseProject.variables.map((item) =>
            item.id === selectedId ? variable : item,
          )
        : [...baseProject.variables, variable],
    };
    try {
      useStore.getState().setProject(parseProject(nextProject));
      setSelectedId(variable.id);
      setName(variable.name);
      setType(variable.type);
      setInitial(String(variable.initial));
      setError("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save variable.");
    }
  };

  const deleteVariable = () => {
    if (!selected || !window.confirm(`Delete "${selected.name}"? Existing references will be flagged as unknown.`)) return;
    const current = useStore.getState().project;
    useStore.getState().setProject(parseProject({
      ...current,
      updatedAt: new Date().toISOString(),
      variables: current.variables.filter((variable) => variable.id !== selected.id),
    }));
    startNewVariable();
  };

  return (
    <section className="variables-panel" aria-label="Variables">
      <header className="variables-panel-heading">
        <div>
          <h2>Variables</h2>
          <p>Reusable prototype data</p>
        </div>
        <button className="icon-button small-icon" type="button" aria-label="Add variable" onClick={startNewVariable}>
          <Plus size={15} />
        </button>
      </header>
      <div className="variable-list" aria-label="Project and screen variables">
        <h3>PROJECT</h3>
        {visibleVariables.filter((variable) => variable.scope === "project").map((variable) => (
          <button
            className={`variable-list-item${selectedId === variable.id ? " is-active" : ""}`}
            key={variable.id}
            type="button"
            onClick={() => selectVariable(variable)}
          >
            <Braces size={13} />
            <span>{variable.name}</span>
            <small>{variable.type}</small>
          </button>
        ))}
        <h3>{project.screens.find((screen) => screen.id === activeScreenId)?.name ?? "SCREEN"}</h3>
        {visibleVariables.filter((variable) => variable.scope === "screen").map((variable) => (
          <button
            className={`variable-list-item${selectedId === variable.id ? " is-active" : ""}`}
            key={variable.id}
            type="button"
            onClick={() => selectVariable(variable)}
          >
            <Braces size={13} />
            <span>{variable.name}</span>
            <small>{variable.type}</small>
          </button>
        ))}
        {visibleVariables.length === 0 && <p className="variable-empty">No variables yet. Add one to start.</p>}
      </div>
      <div className="variable-editor">
        <h3>{selected ? "EDIT VARIABLE" : "NEW VARIABLE"}</h3>
        <label className="style-control">
          <span>Name</span>
          <input className="text-field" aria-label="Variable name" value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="customerName" />
        </label>
        <label className="style-control">
          <span>Type</span>
          <select aria-label="Variable type" value={type} onChange={(event) => {
            const nextType = event.currentTarget.value as VariableType;
            setType(nextType);
            setInitial(initialForType(nextType));
          }}>
            <option value="string">String</option>
            <option value="number">Number</option>
            <option value="boolean">Boolean</option>
          </select>
        </label>
        <label className="style-control">
          <span>Initial value</span>
          {type === "boolean" ? (
            <select aria-label="Variable initial value" value={initial} onChange={(event) => setInitial(event.currentTarget.value)}>
              <option value="false">false</option>
              <option value="true">true</option>
            </select>
          ) : (
            <input className="text-field" aria-label="Variable initial value" type={type === "number" ? "number" : "text"} value={initial} onChange={(event) => setInitial(event.currentTarget.value)} />
          )}
        </label>
        <label className="style-control">
          <span>Scope</span>
          <select aria-label="Variable scope" value={scope} onChange={(event) => setScope(event.currentTarget.value as VariableScope)}>
            <option value="project">Project</option>
            <option value="screen">Screen</option>
          </select>
        </label>
        {scope === "screen" && (
          <label className="style-control">
            <span>Screen</span>
            <select aria-label="Variable screen" value={screenId} onChange={(event) => setScreenId(event.currentTarget.value)}>
              {project.screens.map((screen) => <option key={screen.id} value={screen.id}>{screen.name}</option>)}
            </select>
          </label>
        )}
        {selected && (
          <div className="variable-token-preview">
            <span>Text reference</span>
            <code className="variable-token-chip">{`{{${selected.name}}}`}</code>
            <small>{references} text-field reference{references === 1 ? "" : "s"}</small>
          </div>
        )}
        {error && <p className="variable-error" role="alert">{error}</p>}
        <div className="variable-editor-actions">
          <button className="button button-primary" type="button" onClick={saveVariable}>
            {selected ? "Save variable" : "Add variable"}
          </button>
          {selected && <button className="icon-button small-icon" type="button" aria-label="Delete variable" onClick={deleteVariable}><Trash2 size={14} /></button>}
        </div>
      </div>
      {validationIssues.length > 0 && (
        <div className="variable-validation" aria-label="Variable validation">
          <h3>VALIDATION</h3>
          {validationIssues.slice(0, 8).map((issue, index) => (
            <p className={`variable-issue is-${issue.severity}`} key={`${issue.code}:${issue.path}:${index}`}>
              <span>{issue.severity === "error" ? "Error" : "Warning"}</span>
              {issue.message}
            </p>
          ))}
          {validationIssues.length > 8 && <p className="variable-issue">+{validationIssues.length - 8} more issues</p>}
        </div>
      )}
    </section>
  );
}
