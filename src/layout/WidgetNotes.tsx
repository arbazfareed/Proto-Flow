import { useEffect, useMemo, useRef, useState } from "react";
import { Bold, Download, Italic, List, Plus, Search, StickyNote, X } from "lucide-react";
import { useStore } from "../store";
import type { Project, Widget, WidgetNotes as Notes } from "../project/schema";
import {
  exportWidgetNotesCsv,
  exportWidgetNotesMarkdown,
  filterWidgetNotes,
  getWidgetNoteRecords,
  updateWidgetNotes,
} from "../project/widgetNotes";

const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const STATUSES = ["draft", "in review", "approved", "blocked"] as const;

function saveFile(contents: string, type: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function commitNotes(widgetId: string, update: (notes: Notes) => Notes): void {
  const state = useStore.getState();
  state.setProject(updateWidgetNotes(state.project, widgetId, update));
}

function applyMarkdown(
  textarea: HTMLTextAreaElement | null,
  value: string,
  setValue: (next: string) => void,
  prefix: string,
  suffix = prefix,
): void {
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selection = value.slice(start, end) || "text";
  const next = `${value.slice(0, start)}${prefix}${selection}${suffix}${value.slice(end)}`;
  setValue(next);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(start + prefix.length, start + prefix.length + selection.length);
  });
}

export function WidgetNotesPanel({ widget }: { widget: Widget }) {
  const notes = widget.notes ?? {
    description: "",
    requirementId: "",
    priority: "low" as const,
    status: "draft" as const,
    tags: [],
    custom: {},
  };
  const [tagsInput, setTagsInput] = useState(notes.tags.join(", "));
  const savedTags = notes.tags.join(", ");
  const [tagError, setTagError] = useState("");
  const [customKey, setCustomKey] = useState("");
  const [customValue, setCustomValue] = useState("");
  const [customError, setCustomError] = useState("");
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setTagsInput(savedTags);
  }, [widget.id, savedTags]);
  const update = (patch: Partial<Notes>) =>
    commitNotes(widget.id, (current) => ({ ...current, ...patch }));

  return (
    <section className="widget-notes-editor" aria-label="Widget notes">
      <label className="field-label" htmlFor="widget-notes-description">Description</label>
      <div className="notes-markdown-toolbar" role="group" aria-label="Description formatting">
        <button type="button" aria-label="Bold" title="Bold" onClick={() =>
          applyMarkdown(descriptionRef.current, notes.description, (description) => update({ description }), "**")
        }><Bold size={14} /></button>
        <button type="button" aria-label="Italic" title="Italic" onClick={() =>
          applyMarkdown(descriptionRef.current, notes.description, (description) => update({ description }), "_")
        }><Italic size={14} /></button>
        <button type="button" aria-label="Bulleted list" title="Bulleted list" onClick={() =>
          applyMarkdown(descriptionRef.current, notes.description, (description) => update({ description }), "- ", "")
        }><List size={14} /></button>
      </div>
      <textarea
        ref={descriptionRef}
        id="widget-notes-description"
        className="text-field notes-description"
        value={notes.description}
        maxLength={20_000}
        placeholder="Document the intent or behavior of this widget…"
        onChange={(event) => update({ description: event.currentTarget.value })}
      />
      <p className="field-hint">Markdown formatting is supported. {notes.description.length}/20000</p>

      <label className="field-label" htmlFor="widget-notes-requirement">Requirement ID</label>
      <input
        id="widget-notes-requirement"
        className="text-field"
        value={notes.requirementId}
        maxLength={120}
        placeholder="e.g. REQ-104"
        onChange={(event) => update({ requirementId: event.currentTarget.value })}
      />
      <div className="notes-field-row">
        <label className="field-label" htmlFor="widget-notes-priority">Priority</label>
        <select
          id="widget-notes-priority"
          className="text-field"
          value={notes.priority}
          onChange={(event) => update({ priority: event.currentTarget.value as Notes["priority"] })}
        >
          {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
        </select>
      </div>
      <div className="notes-field-row">
        <label className="field-label" htmlFor="widget-notes-status">Status</label>
        <select
          id="widget-notes-status"
          className="text-field"
          value={notes.status}
          onChange={(event) => update({ status: event.currentTarget.value as Notes["status"] })}
        >
          {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </div>
      <label className="field-label" htmlFor="widget-notes-tags">Tags</label>
      <input
        id="widget-notes-tags"
        className="text-field"
        value={tagsInput}
        maxLength={3_000}
        placeholder="checkout, accessibility"
        onChange={(event) => {
          setTagsInput(event.currentTarget.value);
          setTagError("");
        }}
        onBlur={() => {
          const tags = [...new Set(tagsInput.split(",").map((tag) => tag.trim()).filter(Boolean))];
          if (tags.some((tag) => tag.length > 60)) {
            setTagError("Each tag must be 60 characters or fewer.");
            return;
          }
          if (tags.length > 50) {
            setTagError("A widget can have at most 50 tags.");
            return;
          }
          update({ tags });
          setTagError("");
        }}
      />
      {tagError && <p className="field-error" role="alert">{tagError}</p>}
      <div className="notes-custom-fields">
        <div className="section-label"><span>Custom fields</span></div>
        {Object.entries(notes.custom).map(([key, value]) => (
          <div className="notes-custom-row" key={key}>
            <span title={key}>{key}</span>
            <input
              className="text-field"
              aria-label={`${key} custom field value`}
              value={value}
              maxLength={1_000}
              onChange={(event) => update({
                custom: { ...notes.custom, [key]: event.currentTarget.value },
              })}
            />
            <button
              type="button"
              className="icon-button small-icon"
              aria-label={`Remove ${key} custom field`}
              onClick={() => {
                const custom = { ...notes.custom };
                delete custom[key];
                update({ custom });
              }}
            ><X size={13} /></button>
          </div>
        ))}
        <div className="notes-custom-add">
          <input
            className="text-field"
            aria-label="Custom field name"
            maxLength={80}
            value={customKey}
            placeholder="Field"
            onChange={(event) => setCustomKey(event.currentTarget.value)}
          />
          <input
            className="text-field"
            aria-label="Custom field value"
            maxLength={1_000}
            value={customValue}
            placeholder="Value"
            onChange={(event) => setCustomValue(event.currentTarget.value)}
          />
          <button
            type="button"
            className="icon-button small-icon"
            aria-label="Add custom field"
            onClick={() => {
              const key = customKey.trim();
              if (!key || key in notes.custom) {
                setCustomError(key ? "That custom field already exists." : "Enter a field name.");
                return;
              }
              update({ custom: { ...notes.custom, [key]: customValue } });
              setCustomKey("");
              setCustomValue("");
              setCustomError("");
            }}
          ><Plus size={14} /></button>
        </div>
        {customError && <p className="field-error" role="alert">{customError}</p>}
      </div>
    </section>
  );
}

export function WidgetNotesManager({
  onClose,
}: {
  onClose: () => void;
}) {
  const project = useStore((state) => state.project);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkTag, setBulkTag] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkPriority, setBulkPriority] = useState("");
  const allRecords = useMemo(() => getWidgetNoteRecords(project), [project]);
  const records = useMemo(
    () => filterWidgetNotes(allRecords, { query, status, priority }),
    [allRecords, query, status, priority],
  );

  const applyBulkEdit = () => {
    const selected = new Set(selectedIds);
    let next: Project = useStore.getState().project;
    for (const widgetId of selected) {
      next = updateWidgetNotes(next, widgetId, (notes) => ({
        ...notes,
        ...(bulkPriority ? { priority: bulkPriority as Notes["priority"] } : {}),
        ...(bulkStatus ? { status: bulkStatus as Notes["status"] } : {}),
        ...(bulkTag.trim() ? {
          tags: [...new Set([...notes.tags, bulkTag.trim()])].slice(0, 50),
        } : {}),
      }));
    }
    useStore.getState().setProject(next);
    setSelectedIds([]);
    setBulkTag("");
    setBulkStatus("");
    setBulkPriority("");
  };

  const openRecord = (screenId: string, widgetId: string) => {
    const state = useStore.getState();
    state.setActiveScreen(screenId);
    state.select([widgetId]);
    state.setInspectorTab("notes");
    onClose();
  };

  const toggleSelected = (widgetId: string) => {
    setSelectedIds((current) =>
      current.includes(widgetId)
        ? current.filter((id) => id !== widgetId)
        : [...current, widgetId],
    );
  };

  return (
    <div className="notes-manager-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="notes-manager" role="dialog" aria-modal="true" aria-labelledby="notes-manager-title">
        <header className="notes-manager-header">
          <div>
            <span className="eyebrow">ANNOTATIONS</span>
            <h2 id="notes-manager-title">Widget notes</h2>
            <p>{allRecords.length} annotated widget{allRecords.length === 1 ? "" : "s"}</p>
          </div>
          <button className="icon-button" aria-label="Close widget notes" onClick={onClose}><X size={17} /></button>
        </header>
        <div className="notes-manager-tools">
          <label className="notes-search">
            <Search size={15} />
            <input
              aria-label="Search notes"
              value={query}
              placeholder="Search text, tag, requirement ID…"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <select aria-label="Filter notes by status" value={status} onChange={(event) => setStatus(event.currentTarget.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Filter notes by priority" value={priority} onChange={(event) => setPriority(event.currentTarget.value)}>
            <option value="">All priorities</option>
            {PRIORITIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <button
            className="button button-secondary"
            disabled={!allRecords.length}
            onClick={() => saveFile(exportWidgetNotesCsv(allRecords), "text/csv;charset=utf-8", "widget-notes.csv")}
          ><Download size={14} /> CSV</button>
          <button
            className="button button-secondary"
            disabled={!allRecords.length}
            onClick={() => saveFile(exportWidgetNotesMarkdown(allRecords), "text/markdown;charset=utf-8", "widget-notes.md")}
          ><Download size={14} /> Markdown</button>
        </div>
        <div className="notes-bulk-edit">
          <strong>{selectedIds.length} selected</strong>
          <input className="text-field" aria-label="Bulk add tag" value={bulkTag} maxLength={60} placeholder="Add tag to selected" onChange={(event) => setBulkTag(event.currentTarget.value)} />
          <select aria-label="Bulk set priority" value={bulkPriority} onChange={(event) => setBulkPriority(event.currentTarget.value)}>
            <option value="">Priority unchanged</option>
            {PRIORITIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select aria-label="Bulk set status" value={bulkStatus} onChange={(event) => setBulkStatus(event.currentTarget.value)}>
            <option value="">Status unchanged</option>
            {STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <button
            className="button button-primary"
            disabled={!selectedIds.length || (!bulkTag.trim() && !bulkPriority && !bulkStatus)}
            onClick={applyBulkEdit}
          >Apply</button>
        </div>
        <div className="notes-manager-list">
          {records.length ? records.map(({ screenId, screenName, widget }) => {
            const notes = widget.notes;
            if (!notes) return null;
            return (
              <div className="notes-manager-row" key={widget.id}>
                <input
                  type="checkbox"
                  aria-label={`Select ${widget.name ?? widget.type}`}
                  checked={selectedIds.includes(widget.id)}
                  onChange={() => toggleSelected(widget.id)}
                />
                <span className={`notes-priority-dot priority-${notes.priority}`} title={`${notes.priority} priority`} />
                <button className="notes-manager-open" onClick={() => openRecord(screenId, widget.id)}>
                  <strong>{widget.name ?? widget.type}</strong>
                  <span>{screenName} · {notes.requirementId || "No requirement ID"} · {notes.status}</span>
                  <small>{notes.description.slice(0, 140) || notes.tags.join(", ") || "No description"}</small>
                </button>
              </div>
            );
          }) : (
            <div className="notes-manager-empty">
              <StickyNote size={22} />
              <strong>{allRecords.length ? "No notes match these filters" : "No widget notes yet"}</strong>
              <span>Select a widget and add notes in the inspector to get started.</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
