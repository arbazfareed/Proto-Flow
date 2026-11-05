import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FilePlus2,
  FolderOpen,
  Monitor,
  Moon,
  Smartphone,
  Sun,
  X,
  Zap,
} from "lucide-react";
import { trackEvent } from "../diagnostics/observability";
import type { ThemePreference } from "./storage";
import { STARTER_TEMPLATE_IDS, type StarterTemplateId } from "./templates";
import "./OnboardingWizard.css";

interface OnboardingWizardProps {
  initialTheme: ThemePreference;
  selectedTemplate: string | null;
  initialDeviceTourCompleted: boolean;
  onThemeChange: (theme: ThemePreference) => void;
  onSelectTemplate: (template: StarterTemplateId) => void;
  onDeviceTourCompleted: () => void;
  onOpenExisting: () => Promise<boolean>;
  onComplete: (template: StarterTemplateId | "existing") => void;
  onTakeTutorial: () => void;
  onSkip: () => void;
}

const TOUR_STOPS = [
  {
    target: "sidebar",
    title: "Your project and screens",
    description: "Find your screens, reusable elements, and device presets in the left sidebar.",
  },
  {
    target: "canvas",
    title: "Design on the canvas",
    description: "Arrange widgets, try interactions, and right-click any shape to create dynamic panels, repeaters, or add annotations.",
  },
  {
    target: "inspector",
    title: "Fine-tune in the inspector",
    description: "Adjust position, styling, responsive behavior, and interactions for your selection.",
  },
  {
    target: "topbar",
    title: "Actions are close at hand",
    description: "Save, preview, export, and open the wallet from the top bar.",
  },
  {
    target: "canvas",
    title: "Build interactive prototypes",
    description: "Right-click any shape to create dynamic panels, repeaters, or add annotations.",
  },
] as const;

const TEMPLATE_LABELS: Record<StarterTemplateId, { title: string; detail: string; icon: string }> = {
  blank: { title: "Blank project", detail: "A clean canvas to start from scratch.", icon: "blank" },
  "mobile-app": { title: "Mobile app", detail: "iPhone 15 device frame", icon: "mobile" },
  dashboard: { title: "Dashboard", detail: "Desktop 1440 with metrics and activity", icon: "dashboard" },
  "landing-page": { title: "Landing page", detail: "Desktop 1920 hero layout", icon: "landing" },
  "form-flow": { title: "Form flow", detail: "A two-step dynamic panel", icon: "form" },
  "data-table": { title: "Data table", detail: "A repeater with sample rows", icon: "table" },
  "responsive-web": { title: "Responsive web", detail: "Mobile, tablet, and desktop breakpoints", icon: "responsive" },
  login: { title: "Sign in", detail: "A polished, ready-to-edit login screen", icon: "login" },
  storefront: { title: "Storefront", detail: "A product detail page with cart actions", icon: "storefront" },
};

const THEME_CHOICES: { id: ThemePreference; label: string; description: string }[] = [
  { id: "light", label: "Light", description: "A bright workspace" },
  { id: "dark", label: "Dark", description: "Easy on the eyes" },
  { id: "system", label: "System", description: "Follow your device" },
];

export function OnboardingWizard({
  initialTheme,
  selectedTemplate,
  initialDeviceTourCompleted,
  onThemeChange,
  onSelectTemplate,
  onDeviceTourCompleted,
  onOpenExisting,
  onComplete,
  onTakeTutorial,
  onSkip,
}: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [tourStop, setTourStop] = useState(0);
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [openingFile, setOpeningFile] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const [spotlights, setSpotlights] = useState<DOMRect[]>([]);
  const selected = selectedTemplate && STARTER_TEMPLATE_IDS.includes(selectedTemplate as StarterTemplateId)
    ? selectedTemplate as StarterTemplateId
    : null;

  useEffect(() => {
    trackEvent("onboarding_started");
  }, []);

  useEffect(() => {
    const stepEvents = [
      "onboarding_step_1",
      "onboarding_step_2",
      "onboarding_step_3",
      "onboarding_step_4",
      "onboarding_step_5",
    ] as const;
    trackEvent(stepEvents[step]);
    if (step === 2) trackEvent("device_tour_viewed");
  }, [step]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = panel.querySelector<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
    );
    (focusable ?? panel).focus();
  }, [step, tourStop]);

  useEffect(() => {
    if (step !== 2 && step !== 3) {
      setSpotlights([]);
      return;
    }
    const updateSpotlight = () => {
      const targets = step === 2
        ? ["device", "breakpoints"]
        : [TOUR_STOPS[tourStop].target];
      setSpotlights(targets.flatMap((name) => {
        const target = document.querySelector<HTMLElement>(`[data-onboarding-target="${name}"]`);
        return target ? [target.getBoundingClientRect()] : [];
      }));
    };
    updateSpotlight();
    window.addEventListener("resize", updateSpotlight);
    window.addEventListener("scroll", updateSpotlight, true);
    return () => {
      window.removeEventListener("resize", updateSpotlight);
      window.removeEventListener("scroll", updateSpotlight, true);
    };
  }, [step, tourStop]);

  useEffect(() => {
    const trapFocusAndHandleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (window.confirm("Skip onboarding and go straight to your workspace?")) onSkip();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      )].filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapFocusAndHandleEscape, true);
    return () => document.removeEventListener("keydown", trapFocusAndHandleEscape, true);
  }, [onSkip]);

  const chooseTheme = (nextTheme: ThemePreference) => {
    setTheme(nextTheme);
    onThemeChange(nextTheme);
  };

  const openExisting = async () => {
    setOpeningFile(true);
    try {
      if (await onOpenExisting()) onComplete("existing");
    } finally {
      setOpeningFile(false);
    }
  };

  const next = () => setStep((current) => Math.min(4, current + 1));
  const back = () => setStep((current) => Math.max(0, current - 1));
  const advanceTour = () => {
    if (tourStop < TOUR_STOPS.length - 1) setTourStop((current) => current + 1);
    else next();
  };

  const finish = () => onComplete(selected ?? "blank");

  return (
    <>
      {(step === 2 || step === 3) && (
        <div className={`onboarding-tour-layer${step === 2 ? " is-device-tour-layer" : ""}`} aria-hidden="true">
          {spotlights.map((spotlight, index) => (
            <div
              key={`${step}-${index}`}
              className="onboarding-spotlight"
              style={{
                top: Math.max(8, spotlight.top - 8),
                left: Math.max(8, spotlight.left - 8),
                width: Math.min(spotlight.width + 16, window.innerWidth - 16),
                height: Math.min(spotlight.height + 16, window.innerHeight - 16),
              }}
            />
          ))}
        </div>
      )}
      <div className={`onboarding-overlay${step === 3 ? " is-tour" : ""}${step === 2 ? " is-device-tour" : ""}`}>
        <section
          ref={panelRef}
          className={`onboarding-card${step === 3 ? " onboarding-tour-card" : ""}${step === 2 ? " onboarding-device-tour-card" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-title"
          tabIndex={-1}
        >
          <div className="onboarding-header">
            <div className="onboarding-brand">
              <span className="onboarding-brand-mark" aria-hidden="true">PF</span>
              <span>ProtoFlow</span>
            </div>
            <div
              className="onboarding-progress"
              role="progressbar"
              aria-label="Onboarding progress"
              aria-valuemin={1}
              aria-valuemax={5}
              aria-valuenow={step + 1}
            >
              {Array.from({ length: 5 }, (_, index) => (
                <span
                  key={index}
                  className={`onboarding-progress-dot${index === step ? " is-current" : ""}${index < step ? " is-complete" : ""}`}
                  aria-hidden="true"
                />
              ))}
            </div>
            <button
              className="onboarding-skip"
              type="button"
              onClick={() => {
                if (window.confirm("Skip onboarding and go straight to your workspace?")) onSkip();
              }}
            >
              Skip onboarding <X size={14} />
            </button>
          </div>

          {step === 0 && (
            <div className="onboarding-content">
              <span className="onboarding-eyebrow">WELCOME TO PROTOFLOW</span>
              <h1 id="onboarding-title">From first sketch to clickable prototype.</h1>
              <p className="onboarding-lead">Design screens, connect interactions, and explore every device size in one local-first workspace.</p>
              <p className="onboarding-free-callout">Free forever. No payments. No account required.</p>
              <div className="onboarding-theme-block">
                <h2>Choose your theme</h2>
                <div className="onboarding-theme-options" role="radiogroup" aria-label="Theme">
                  {THEME_CHOICES.map((choice) => {
                    const Icon = choice.id === "light" ? Sun : choice.id === "dark" ? Moon : Monitor;
                    return (
                      <button
                        key={choice.id}
                        type="button"
                        className={`onboarding-theme-choice${theme === choice.id ? " is-selected" : ""}`}
                        role="radio"
                        aria-checked={theme === choice.id}
                        onClick={() => chooseTheme(choice.id)}
                      >
                        <Icon size={17} />
                        <span><strong>{choice.label}</strong><small>{choice.description}</small></span>
                      </button>
                    );
                  })}
                </div>
                <div
                  className={`onboarding-theme-preview theme-preview-${theme === "system"
                    ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
                    : theme}`}
                  aria-hidden="true"
                >
                  <div className="theme-preview-bar"><i /><i /><i /></div>
                  <div className="theme-preview-body"><div /><span /><span /></div>
                  <div className="theme-preview-side" />
                </div>
              </div>
              <p className="onboarding-terms">
                By continuing, you agree to the <a href="/terms.html" target="_blank" rel="noreferrer">Terms</a> and <a href="/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>.
              </p>
            </div>
          )}

          {step === 1 && (
            <div className="onboarding-content onboarding-start-content">
              <span className="onboarding-eyebrow">A GOOD PLACE TO BEGIN</span>
              <h1 id="onboarding-title">Pick a starting point</h1>
              <p className="onboarding-lead">Choose a ready-to-edit example, start fresh, or continue with a project you already have.</p>
              <div className="onboarding-start-grid">
                {STARTER_TEMPLATE_IDS.map((template) => {
                  const item = TEMPLATE_LABELS[template];
                  const active = selected === template;
                  return (
                    <button
                      key={template}
                      type="button"
                      className={`onboarding-template-card${active ? " is-selected" : ""}`}
                      aria-pressed={active}
                      onClick={() => onSelectTemplate(template)}
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
                      {active && <Check className="template-selected-check" size={16} aria-hidden="true" />}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="onboarding-open-existing"
                  onClick={() => void openExisting()}
                  disabled={openingFile}
                >
                  {openingFile ? <FolderOpen size={19} /> : <FilePlus2 size={19} />}
                  <span><strong>{openingFile ? "Opening project…" : "Open existing"}</strong><small>Choose a .pflow file from disk</small></span>
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="onboarding-content onboarding-device-content">
              <span className="onboarding-eyebrow">ONE PROJECT, EVERY SCREEN</span>
              <h1 id="onboarding-title">Design for desktop, tablet, and mobile.</h1>
              <p className="onboarding-lead">ProtoFlow designs for desktop, tablet, and mobile — all in one project.</p>
              <div className="device-tour-demo" aria-label="Animated preview of device sizes">
                <div className="device-tour-frame device-tour-desktop"><div /><span /><span /></div>
                <div className="device-tour-frame device-tour-tablet"><div /><span /><span /></div>
                <div className="device-tour-frame device-tour-phone"><div /><span /><span /></div>
                <div className="device-tour-switch">
                  <span><Monitor size={14} /> Desktop</span>
                  <ArrowRight size={14} />
                  <span><Smartphone size={14} /> Mobile</span>
                </div>
              </div>
              <div className="device-tour-features">
                <span><Check size={15} /> Pick a device frame from the screen and device controls.</span>
                <span><Check size={15} /> Switch responsive breakpoints from the canvas toolbar.</span>
              </div>
              <p className="onboarding-device-note">You can define breakpoints and per-widget overrides for responsive prototypes.</p>
              {initialDeviceTourCompleted && <p className="onboarding-device-returning">You can revisit this tour from Settings.</p>}
            </div>
          )}

          {step === 3 && (
            <div className="onboarding-tour-content">
              <span className="onboarding-eyebrow">QUICK CANVAS TOUR · {tourStop + 1} OF {TOUR_STOPS.length}</span>
              <h1 id="onboarding-title">{TOUR_STOPS[tourStop].title}</h1>
              <p className="onboarding-lead">{TOUR_STOPS[tourStop].description}</p>
              <p className="onboarding-tour-position">{tourStop + 1} / {TOUR_STOPS.length}</p>
            </div>
          )}

          {step === 4 && (
            <div className="onboarding-content onboarding-wallet-content">
              <span className="onboarding-eyebrow">A QUICK NOTE ABOUT CLOUD FEATURES</span>
              <h1 id="onboarding-title">You’ve got 50 credits.</h1>
              <p className="onboarding-lead">Your starter grant is ready whenever you want to try an optional cloud feature.</p>
              <div className="onboarding-credit-pill"><Zap size={17} aria-hidden="true" /><strong>50</strong><small>Credits</small><span className="credit-pill-caption">Balance lives in the top bar</span></div>
              <p className="onboarding-wallet-promise">ProtoFlow is free. Credits only limit expensive cloud actions like AI and publishing — you get 20 fresh credits every day.</p>
              <p className="onboarding-wallet-free">Local editing, preview, and HTML export are always unlimited and free.</p>
            </div>
          )}

          <footer className="onboarding-footer">
            <div>
              {step > 0 && step !== 3 && (
                <button type="button" className="onboarding-back" onClick={back}>
                  <ArrowLeft size={15} /> Back
                </button>
              )}
              {step === 3 && (
                <button type="button" className="onboarding-back" onClick={() => setStep(2)}>
                  <ArrowLeft size={15} /> Back
                </button>
              )}
            </div>
            {step === 4 ? (
              <div className="onboarding-finish-actions">
                <button type="button" className="onboarding-skip-tour" onClick={onTakeTutorial}>
                  Take the tour
                </button>
                <button type="button" className="onboarding-primary" onClick={finish}>
                  Finish <Check size={15} />
                </button>
              </div>
            ) : step === 3 ? (
              <div className="onboarding-tour-actions">
                <button type="button" className="onboarding-skip-tour" onClick={next}>Skip tour</button>
                <button type="button" className="onboarding-primary" onClick={advanceTour}>
                  {tourStop === TOUR_STOPS.length - 1 ? "Next" : "Next"} <ArrowRight size={15} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="onboarding-primary"
                onClick={() => {
                  if (step === 2) onDeviceTourCompleted();
                  next();
                }}
                disabled={step === 1 && !selected}
              >
                {step === 2 ? "Got it" : "Continue"} <ArrowRight size={15} />
              </button>
            )}
          </footer>
        </section>
      </div>
    </>
  );
}
