import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { SymbolDefinition, Widget } from "../project/schema";
import {
  createSymbolInstanceAtCenter,
  detachSymbolInstances,
} from "../project/symbols";
import { useStore } from "../store";

function getTextProperty(widget: Widget): "text" | "label" | null {
  if (widget.type === "text") return "text";
  if (["button", "checkbox", "radio", "toggle"].includes(widget.type)) return "label";
  return null;
}

function updateSymbol(
  symbolId: string,
  update: (symbol: SymbolDefinition) => SymbolDefinition,
): void {
  const current = useStore.getState();
  const previousSymbol = current.project.symbols.find((symbol) => symbol.id === symbolId);
  if (!previousSymbol) return;
  const updatedSymbol = update(previousSymbol);
  current.setProject({
    ...current.project,
    updatedAt: new Date().toISOString(),
    symbols: current.project.symbols.map((symbol) =>
      symbol.id === symbolId ? updatedSymbol : symbol,
    ),
    screens: current.project.screens.map((screen) => ({
      ...screen,
      widgets: screen.widgets.map((widget) =>
        widget.type === "symbol-instance" &&
        widget.symbolId === symbolId &&
        widget.name !== updatedSymbol.name
          ? {
              ...widget,
              name: updatedSymbol.name,
              props: { ...widget.props, label: updatedSymbol.name },
            }
          : widget,
      ),
    })),
  });
}

function SymbolPreview({ symbol }: { symbol: SymbolDefinition }) {
  const scale = Math.min(72 / symbol.width, 38 / symbol.height, 1);
  return (
    <div
      className="symbol-preview"
      aria-hidden="true"
      style={{ width: Math.max(36, symbol.width * scale), height: Math.max(20, symbol.height * scale) }}
    >
      {symbol.widgets.map((widget) => (
        <span
          key={widget.id}
          className={widget.type === "ellipse" ? "is-ellipse" : ""}
          style={{
            left: widget.x * scale,
            top: widget.y * scale,
            width: Math.max(2, widget.width * scale),
            height: Math.max(2, widget.height * scale),
            background: widget.style.fill ?? "#414047",
            borderColor: widget.style.stroke ?? "#a78bfa",
          }}
        />
      ))}
    </div>
  );
}

export function SymbolLibrary() {
  const project = useStore((state) => state.project);
  const [editingSymbol, setEditingSymbol] = useState<SymbolDefinition | null>(null);
  const [deletingSymbol, setDeletingSymbol] = useState<SymbolDefinition | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const placeSymbol = (symbol: SymbolDefinition) => {
    const current = useStore.getState();
    const screenId = current.getActiveScreenId();
    const screen = current.project.screens.find((item) => item.id === screenId);
    if (!screen) return;
    const width = screen.device?.width ?? 1440;
    const height = screen.device?.height ?? 900;
    const instance = createSymbolInstanceAtCenter(symbol, screen.widgets, width, height);
    current.setProject({
      ...current.project,
      updatedAt: new Date().toISOString(),
      screens: current.project.screens.map((item) =>
        item.id === screenId
          ? { ...item, widgets: [...item.widgets, instance] }
          : item,
      ),
    });
    useStore.getState().select([instance.id]);
  };

  const deleteSymbol = (symbol: SymbolDefinition) => {
    const current = useStore.getState();
    current.setProject({
      ...current.project,
      updatedAt: new Date().toISOString(),
      symbols: current.project.symbols.filter((item) => item.id !== symbol.id),
      screens: current.project.screens.map((screen) => ({
        ...screen,
        widgets: detachSymbolInstances(screen.widgets, [symbol]),
      })),
    });
    if (editingSymbol?.id === symbol.id) setEditingSymbol(null);
    setDeletingSymbol(null);
  };

  const saveMaster = () => {
    if (!editingSymbol) return;
    updateSymbol(editingSymbol.id, () => editingSymbol);
    setEditingSymbol(null);
  };

  return (
    <>
      <section className="symbol-library" aria-label="Symbols">
        <div className="section-label">
          <span>SYMBOLS</span>
          <span className="symbol-count">{project.symbols.length}</span>
        </div>
        {project.symbols.length === 0 ? (
          <p className="symbol-library-empty">Right-click selected layers and choose Create Symbol.</p>
        ) : (
          <div className="symbol-library-list">
            {project.symbols.map((symbol) => (
              <div className="symbol-library-item" key={symbol.id}>
                <button
                  type="button"
                  className="symbol-library-place"
                  title={`Add ${symbol.name} to the active screen`}
                  onClick={() => placeSymbol(symbol)}
                >
                  <SymbolPreview symbol={symbol} />
                  {renamingId === symbol.id ? (
                    <input
                      aria-label="Rename symbol"
                      autoFocus
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.currentTarget.value)}
                      onBlur={() => {
                        const name = renameDraft.trim().slice(0, 120);
                        if (name && name !== symbol.name) {
                          updateSymbol(symbol.id, (current) => ({ ...current, name }));
                        }
                        setRenamingId(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") {
                          setRenameDraft(symbol.name);
                          setRenamingId(null);
                        }
                      }}
                      onClick={(event) => event.stopPropagation()}
                    />
                  ) : (
                    <span
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setRenameDraft(symbol.name);
                        setRenamingId(symbol.id);
                      }}
                    >
                      {symbol.name}
                    </span>
                  )}
                  <small>{symbol.widgets.length} layers</small>
                </button>
                <div className="symbol-library-actions">
                  <button
                    type="button"
                    aria-label={`Edit ${symbol.name}`}
                    title="Edit master"
                    onClick={() => setEditingSymbol(structuredClone(symbol))}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${symbol.name}`}
                    title="Delete and detach instances"
                    onClick={() => setDeletingSymbol(symbol)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      {editingSymbol && (
        <div className="symbol-editor-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setEditingSymbol(null);
        }}>
          <section
            className="symbol-editor"
            role="dialog"
            aria-modal="true"
            aria-label={`Edit ${editingSymbol.name} master`}
          >
            <header>
              <div>
                <span>MASTER COMPONENT</span>
                <h2>Edit {editingSymbol.name}</h2>
              </div>
              <button type="button" aria-label="Close symbol editor" onClick={() => setEditingSymbol(null)}>×</button>
            </header>
            <label>
              Symbol name
              <input
                value={editingSymbol.name}
                maxLength={120}
                onChange={(event) => setEditingSymbol({
                  ...editingSymbol,
                  name: event.currentTarget.value,
                })}
              />
            </label>
            <div className="symbol-editor-widgets">
              {editingSymbol.widgets.map((widget) => {
                const textProperty = getTextProperty(widget);
                const textValue = textProperty && typeof widget.props[textProperty] === "string"
                  ? widget.props[textProperty] as string
                  : "";
                return (
                  <fieldset key={widget.id}>
                    <legend>{widget.name ?? widget.type}</legend>
                    {textProperty && (
                      <label>
                        Text
                        <input
                          value={textValue}
                          onChange={(event) => setEditingSymbol({
                            ...editingSymbol,
                            widgets: editingSymbol.widgets.map((item) =>
                              item.id === widget.id
                                ? { ...item, props: { ...item.props, [textProperty]: event.currentTarget.value } }
                                : item,
                            ),
                          })}
                        />
                      </label>
                    )}
                    <label>
                      Fill
                      <input
                        type="color"
                        value={typeof widget.style.fill === "string" ? widget.style.fill : "#414047"}
                        onChange={(event) => setEditingSymbol({
                          ...editingSymbol,
                          widgets: editingSymbol.widgets.map((item) =>
                            item.id === widget.id
                              ? { ...item, style: { ...item.style, fill: event.currentTarget.value } }
                              : item,
                          ),
                        })}
                      />
                    </label>
                  </fieldset>
                );
              })}
            </div>
            <footer>
              <button type="button" onClick={() => setEditingSymbol(null)}>Cancel</button>
              <button type="button" className="button-primary" disabled={!editingSymbol.name.trim()} onClick={saveMaster}>Save master</button>
            </footer>
          </section>
        </div>
      )}
      {deletingSymbol && (
        <div className="symbol-name-dialog-backdrop" role="presentation">
          <section
            className="symbol-name-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="symbol-delete-dialog-title"
            aria-describedby="symbol-delete-dialog-description"
          >
            <div className="symbol-name-dialog-icon" aria-hidden="true">!</div>
            <span className="symbol-name-dialog-eyebrow">COMPONENT LIBRARY</span>
            <h2 id="symbol-delete-dialog-title">Delete {deletingSymbol.name}?</h2>
            <p id="symbol-delete-dialog-description">
              All instances will be detached and converted to regular layers.
            </p>
            <div className="symbol-name-dialog-actions">
              <button type="button" onClick={() => setDeletingSymbol(null)}>Cancel</button>
              <button type="button" onClick={() => deleteSymbol(deletingSymbol)}>Delete symbol</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
