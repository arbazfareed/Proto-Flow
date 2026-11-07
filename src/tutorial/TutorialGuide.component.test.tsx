import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store";
import { createTutorialProjectCopy } from "./project";
import { emitTutorialAction } from "./events";
import { TUTORIAL_STEPS } from "./content";
import { TutorialGuide } from "./TutorialGuide";
import { trackEvent } from "../diagnostics/observability";

vi.mock("../diagnostics/observability", () => ({ trackEvent: vi.fn() }));

const TUTORIAL_STEP_EVENTS = Array.from({ length: 15 }, (_, index) =>
  `tutorial_step_${index + 1}_completed`,
);

function renderTutorial(onClose = vi.fn()) {
  const project = createTutorialProjectCopy();
  useStore.getState().loadProject(project, null);
  useStore.getState().setActiveScreen(project.startScreenId);
  const view = render(
    <>
      {["canvas", "inspector", "sidebar", "topbar", "screens", "breakpoints"].map((target) => (
        <div key={target} data-onboarding-target={target} />
      ))}
      <div className="workspace-view-toggle" />
      <TutorialGuide onClose={onClose} />
    </>,
  );
  return { onClose, ...view };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("interactive tutorial guide", () => {
  it("renders and advances through all 15 steps, highlights each target, and reports completion", async () => {
    const user = userEvent.setup();
    const { onClose } = renderTutorial();
    const guide = screen.getByRole("region", { name: "Interactive ProtoFlow tutorial" });
    const axureTip = within(guide).getByText("If you’re coming from Axure…");
    await user.click(axureTip);
    expect(within(guide).getByText(TUTORIAL_STEPS[0].axure)).toBeVisible();

    for (const [index, step] of TUTORIAL_STEPS.entries()) {
      expect(within(guide).getByRole("heading", { name: step.title })).toBeVisible();
      expect(within(guide).getByText(step.instruction)).toBeVisible();
      const target = step.target === "flow"
        ? document.querySelector(".workspace-view-toggle")
        : document.querySelector(`[data-onboarding-target="${step.target}"]`);
      expect(target).toHaveClass("tutorial-highlighted");

      if (index < TUTORIAL_STEPS.length - 1) {
        fireEvent.click(within(guide).getByRole("button", { name: "Next" }));
      } else {
        fireEvent.click(within(guide).getByRole("button", { name: "Finish" }));
      }
    }

    expect(onClose).toHaveBeenCalledOnce();
    expect(trackEvent).toHaveBeenCalledWith("tutorial_completed");
    expect(vi.mocked(trackEvent).mock.calls.map(([event]) => event)).toEqual([
      ...TUTORIAL_STEP_EVENTS,
      "tutorial_completed",
    ]);
  }, 15_000);

  it("auto-advances on project actions and shows responsive-export completion", async () => {
    const user = userEvent.setup();
    renderTutorial();
    const guide = screen.getByRole("region", { name: "Interactive ProtoFlow tutorial" });

    act(() => useStore.getState().select(["60000000-0000-4000-8000-000000000302"]));
    expect(within(guide).getByText("STEP 2 OF 15")).toBeInTheDocument();

    for (let step = 0; step < 4; step += 1) {
      await user.click(within(guide).getByRole("button", { name: "Next" }));
    }
    expect(within(guide).getByText("STEP 6 OF 15")).toBeInTheDocument();
    act(() => emitTutorialAction("preview-opened"));
    expect(within(guide).getByText("STEP 7 OF 15")).toBeInTheDocument();

    for (let step = 0; step < 7; step += 1) {
      await user.click(within(guide).getByRole("button", { name: "Next" }));
    }
    expect(within(guide).getByText("STEP 14 OF 15")).toBeInTheDocument();
    act(() => emitTutorialAction("flow-opened"));
    expect(within(guide).getByText("STEP 15 OF 15")).toBeInTheDocument();
    act(() => emitTutorialAction("html-exported"));
    expect(within(guide).getByRole("status"))
      .toHaveTextContent("Responsive HTML export complete.");
  });
});
