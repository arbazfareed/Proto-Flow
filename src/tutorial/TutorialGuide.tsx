import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useStore } from "../store";
import { trackEvent } from "../diagnostics/observability";
import { TUTORIAL_STEPS, TUTORIAL_UI_STRINGS } from "./content";
import { listenForTutorialActions } from "./events";
import "./TutorialGuide.css";

interface TutorialGuideProps {
  onClose: () => void;
}

const HOME_SCREEN_ID = "60000000-0000-4000-8000-000000000201";
const BLUE_RECTANGLE_ID = "60000000-0000-4000-8000-000000000302";
const COUNT_EXPRESSION_ID = "60000000-0000-4000-8000-000000000303";
const PANEL_ID = "60000000-0000-4000-8000-000000000308";
const REPEATER_ID = "60000000-0000-4000-8000-000000000309";
const MOBILE_DEVICE_ID = "iphone-15";
const STEP_EVENTS = [
  "tutorial_step_1_completed",
  "tutorial_step_2_completed",
  "tutorial_step_3_completed",
  "tutorial_step_4_completed",
  "tutorial_step_5_completed",
  "tutorial_step_6_completed",
  "tutorial_step_7_completed",
  "tutorial_step_8_completed",
  "tutorial_step_9_completed",
  "tutorial_step_10_completed",
  "tutorial_step_11_completed",
  "tutorial_step_12_completed",
  "tutorial_step_13_completed",
  "tutorial_step_14_completed",
  "tutorial_step_15_completed",
] as const;

function findHome(project: ReturnType<typeof useStore.getState>["project"]) {
  return project.screens.find((screen) => screen.id === HOME_SCREEN_ID);
}

export function TutorialGuide({ onClose }: TutorialGuideProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [exported, setExported] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const completedSteps = useRef(new Set<number>());
  const sawOtherDevice = useRef(false);
  const visitedPanelStates = useRef(new Set<string>());
  const initialProject = useRef(useStore.getState().project).current;
  const step = TUTORIAL_STEPS[stepIndex];
  const initialPanelState = findHome(initialProject)?.widgets.find(
    (widget) => widget.id === PANEL_ID,
  )?.props.activeStateId;
  if (typeof initialPanelState === "string") visitedPanelStates.current.add(initialPanelState);

  const completeStep = (index: number) => {
    if (completedSteps.current.has(index)) return;
    completedSteps.current.add(index);
    trackEvent(STEP_EVENTS[index]);
  };

  const advance = () => {
    completeStep(stepIndex);
    if (stepIndex < TUTORIAL_STEPS.length - 1) {
      setStepIndex((current) => current + 1);
    }
  };

  const finish = () => {
    completeStep(stepIndex);
    trackEvent("tutorial_completed");
    onClose();
  };

  useEffect(() => {
    const target = step.target === "flow"
      ? document.querySelector<HTMLElement>(".workspace-view-toggle")
      : document.querySelector<HTMLElement>(`[data-onboarding-target="${step.target}"]`);
    target?.classList.add("tutorial-highlighted");
    target?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    return () => target?.classList.remove("tutorial-highlighted");
  }, [step.target]);

  useEffect(() => {
    const panel = panelRef.current;
    const firstButton = panel?.querySelector<HTMLElement>("button:not([disabled])");
    firstButton?.focus();
  }, [stepIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && window.confirm(TUTORIAL_UI_STRINGS.closeConfirmation)) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => listenForTutorialActions((action) => {
    if (stepIndex === 5 && action === "preview-opened") advance();
    if (stepIndex === 13 && action === "flow-opened") advance();
    if (stepIndex === 14 && action === "html-exported") setExported(true);
  }), [stepIndex]);

  useEffect(() => {
    const unsubscribe = useStore.subscribe((state) => {
      const home = findHome(state.project);
      if (!home) return;
      const selected = state.selectedIds;
      const blue = home.widgets.find((widget) => widget.id === BLUE_RECTANGLE_ID);
      const originalHome = initialProject.screens.find((screen) => screen.id === HOME_SCREEN_ID);
      const originalBlue = originalHome?.widgets.find((widget) => widget.id === BLUE_RECTANGLE_ID);

      switch (stepIndex) {
        case 0:
          if (state.activeScreenId === HOME_SCREEN_ID && selected.includes(BLUE_RECTANGLE_ID)) advance();
          break;
        case 1:
          if (blue && originalBlue &&
            (blue.x !== originalBlue.x || blue.y !== originalBlue.y ||
              blue.width !== originalBlue.width || blue.height !== originalBlue.height)) advance();
          break;
        case 2:
          if (blue && originalBlue && blue.style.fill !== originalBlue.style.fill) advance();
          break;
        case 3: {
          const originalButtonIds = new Set(
            originalHome?.widgets.filter((widget) => widget.type === "button").map((widget) => widget.id),
          );
          if (home.widgets.some((widget) => widget.type === "button" && !originalButtonIds.has(widget.id))) advance();
          break;
        }
        case 4: {
          const originalRuleIds = new Set(originalHome?.interactionRules.map((rule) => rule.id));
          if (home.interactionRules.some((rule) =>
            !originalRuleIds.has(rule.id) && rule.actions.some((action) => action.type === "navigate"),
          )) advance();
          break;
        }
        case 7:
          if (home.device?.presetId !== MOBILE_DEVICE_ID) sawOtherDevice.current = true;
          else if (sawOtherDevice.current && state.activeBreakpointId === "mobile") advance();
          break;
        case 8: {
          const header = home.widgets.find((widget) => widget.id === "60000000-0000-4000-8000-000000000301");
          const mobileBreakpoint = home.breakpoints?.some((breakpoint) => breakpoint.id === "mobile");
          if (mobileBreakpoint && header?.overrides?.mobile) advance();
          break;
        }
        case 9: {
          const panelWidget = home.widgets.find((widget) => widget.id === PANEL_ID);
          const originalPanel = originalHome?.widgets.find((widget) => widget.id === PANEL_ID);
          const activeStateId = panelWidget?.props.activeStateId;
          if (typeof activeStateId === "string") visitedPanelStates.current.add(activeStateId);
          if (visitedPanelStates.current.size >= 3 &&
              panelWidget?.props.activeStateId !== originalPanel?.props.activeStateId) advance();
          break;
        }
        case 10: {
          const repeater = home.widgets.find((widget) => widget.id === REPEATER_ID);
          const rows = Array.isArray(repeater?.props.dataset) ? repeater.props.dataset.length : 0;
          if (state.activeRepeaterEdit === REPEATER_ID && rows > 5) advance();
          break;
        }
        case 11: {
          const expression = home.widgets.find((widget) => widget.id === COUNT_EXPRESSION_ID);
          if (expression?.props.text === "[[count + 1]]") advance();
          break;
        }
      }
    });
    return unsubscribe;
  }, [stepIndex]);

  return (
    <div className="tutorial-guide-layer">
      <section
        ref={panelRef}
        className="tutorial-guide"
        role="region"
        aria-label={TUTORIAL_UI_STRINGS.regionLabel}
        aria-describedby="tutorial-instruction"
        data-testid="tutorial-guide"
      >
        <header className="tutorial-guide-header">
          <div className="tutorial-guide-brand">
            <span className="tutorial-guide-mark" aria-hidden="true">PF</span>
            <span>{TUTORIAL_UI_STRINGS.brand}</span>
          </div>
          <button type="button" className="tutorial-guide-close" aria-label={TUTORIAL_UI_STRINGS.close} onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="tutorial-guide-progress" aria-label={TUTORIAL_UI_STRINGS.progressLabel
          .replace("{current}", String(stepIndex + 1))
          .replace("{total}", String(TUTORIAL_STEPS.length))}>
          <span>{TUTORIAL_UI_STRINGS.stepCount
            .replace("{current}", String(stepIndex + 1))
            .replace("{total}", String(TUTORIAL_STEPS.length))}</span>
          <div className="tutorial-guide-progress-track" aria-hidden="true">
            <span style={{ width: `${((stepIndex + 1) / TUTORIAL_STEPS.length) * 100}%` }} />
          </div>
        </div>
        <div className="tutorial-guide-content" aria-live="polite">
          <h2>{step.title}</h2>
          <p id="tutorial-instruction">{step.instruction}</p>
          <details className="tutorial-axure-tip">
            <summary>{TUTORIAL_UI_STRINGS.axureDisclosure}</summary>
            <p>{step.axure}</p>
          </details>
          {stepIndex === 14 && exported && (
            <p className="tutorial-export-status" role="status">
              <Check size={14} /> {TUTORIAL_UI_STRINGS.exportComplete}
            </p>
          )}
        </div>
        <footer className="tutorial-guide-footer">
          <button
            type="button"
            className="tutorial-guide-back"
            disabled={stepIndex === 0}
            onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
          >
            <ArrowLeft size={14} /> {TUTORIAL_UI_STRINGS.back}
          </button>
          {stepIndex === TUTORIAL_STEPS.length - 1 ? (
            <button type="button" className="tutorial-guide-next" onClick={finish}>
              {TUTORIAL_UI_STRINGS.finish} <Check size={14} />
            </button>
          ) : (
            <button type="button" className="tutorial-guide-next" onClick={advance}>
              {TUTORIAL_UI_STRINGS.next} <ArrowRight size={14} />
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
