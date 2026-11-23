import { useEffect } from "react";
import { X } from "lucide-react";
import { TEMPLATE_LABELS } from "../onboarding/templateLabels";
import { STARTER_TEMPLATE_IDS, type StarterTemplateId } from "../onboarding/templates";

// B61: "New project" used to give a blank project at once, and templates only appeared in the one-time
// welcome wizard. It now opens this gallery: Blank is first, then the same starters as the wizard.
export function NewProjectDialog({
  onSelect,
  onClose,
}: {
  onSelect: (template: StarterTemplateId) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog-card new-project-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
        <button className="icon-button dialog-close" aria-label="Close new project" onClick={onClose}><X size={17} /></button>
        <span className="eyebrow">NEW PROJECT</span>
        <h2 id="new-project-title">Pick a starting point</h2>
        <p>Start from a blank canvas, or from a ready-to-edit example.</p>
        <div className="onboarding-start-grid new-project-grid">
          {STARTER_TEMPLATE_IDS.map((template) => {
            const item = TEMPLATE_LABELS[template];
            return (
              <button
                key={template}
                type="button"
                className="onboarding-template-card"
                aria-label={`Start from ${item.title}`}
                onClick={() => onSelect(template)}
              >
                <span className={`template-thumbnail thumbnail-${item.icon}`} aria-hidden="true">
                  <span className="thumbnail-window"><i /><i /><i /></span>
                  <span className="thumbnail-content"><i /><i /><i /></span>
                  <span className="thumbnail-accent" />
                </span>
                <span className="template-copy">
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
              </button>
            );
          })}
        </div>
        <div className="dialog-actions">
          <button className="button button-quiet" onClick={onClose}>Cancel</button>
        </div>
      </section>
    </div>
  );
}
