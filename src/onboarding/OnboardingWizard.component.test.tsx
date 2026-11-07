import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/render";
import { trackEvent } from "../diagnostics/observability";
import { OnboardingWizard } from "./OnboardingWizard";

vi.mock("../diagnostics/observability", () => ({ trackEvent: vi.fn() }));

function renderWizard() {
  const props = {
    initialTheme: "dark" as const,
    initialDeviceTourCompleted: false,
    onThemeChange: vi.fn(),
    onSelectTemplate: vi.fn(),
    onDeviceTourCompleted: vi.fn(),
    onOpenExisting: vi.fn().mockResolvedValue(true),
    onComplete: vi.fn(),
    onTakeTutorial: vi.fn(),
    onSkip: vi.fn(),
  };
  function ControlledWizard() {
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
    return (
      <OnboardingWizard
        {...props}
        selectedTemplate={selectedTemplate}
        onSelectTemplate={(template) => {
          props.onSelectTemplate(template);
          setSelectedTemplate(template);
        }}
      />
    );
  }
  return { props, ...renderWithProviders(<ControlledWizard />) };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("OnboardingWizard", () => {
  it("chooses a theme and requires a starter template before continuing", async () => {
    const user = userEvent.setup();
    const { props } = renderWizard();

    expect(screen.getByRole("progressbar", { name: "Onboarding progress" }))
      .toHaveAttribute("aria-valuenow", "1");
    await user.click(screen.getByRole("radio", { name: /Light/ }));
    expect(props.onThemeChange).toHaveBeenCalledWith("light");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("heading", { name: "Pick a starting point" })).toBeInTheDocument();
    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect(continueButton).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Sign in/ }));
    expect(props.onSelectTemplate).toHaveBeenCalledWith("login");
    expect(continueButton).toBeEnabled();
    await user.click(continueButton);

    expect(screen.getByRole("heading", { name: /Design for desktop, tablet, and mobile/ }))
      .toBeInTheDocument();
  });

  it("completes the device tour, all canvas-tour stops, and the selected template", async () => {
    const user = userEvent.setup();
    const { props } = renderWizard();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Dashboard/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Got it" }));

    expect(props.onDeviceTourCompleted).toHaveBeenCalledOnce();
    expect(screen.getByText(/QUICK CANVAS TOUR · 1 OF 5/)).toBeInTheDocument();
    for (let stop = 0; stop < 5; stop += 1) {
      await user.click(screen.getByRole("button", { name: "Next" }));
    }

    expect(screen.getByRole("heading", { name: "You’ve got 50 credits." })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Finish/ }));
    expect(props.onComplete).toHaveBeenCalledWith("dashboard");
    const events = vi.mocked(trackEvent).mock.calls;
    expect(events.map(([event]) => event)).toEqual(expect.arrayContaining([
      "onboarding_started",
      "onboarding_step_1",
      "onboarding_step_2",
      "onboarding_step_3",
      "onboarding_step_4",
      "onboarding_step_5",
      "device_tour_viewed",
    ]));
    expect(events.every(([, properties]) => properties === undefined)).toBe(true);
  });

  it("preserves choices when moving backward and offers the tutorial at the end", async () => {
    const user = userEvent.setup();
    const { props } = renderWizard();

    await user.click(screen.getByRole("radio", { name: /Light/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Sign in/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: /Sign in/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("radio", { name: /Light/ })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Sign in/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Got it" }));
    await user.click(screen.getByRole("button", { name: "Skip tour" }));
    await user.click(screen.getByRole("button", { name: "Take the tour" }));

    expect(props.onThemeChange).toHaveBeenCalledWith("light");
    expect(props.onDeviceTourCompleted).toHaveBeenCalledOnce();
    expect(props.onTakeTutorial).toHaveBeenCalledOnce();
    expect(props.onComplete).not.toHaveBeenCalled();
  });

  it("opens an existing project and provides the tutorial action", async () => {
    const user = userEvent.setup();
    const { props } = renderWizard();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: /Open existing/ }));

    expect(props.onOpenExisting).toHaveBeenCalledOnce();
    expect(props.onComplete).toHaveBeenCalledWith("existing");
  });

  it("confirms before skipping onboarding", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { props } = renderWizard();
    fireEvent.click(screen.getByRole("button", { name: /Skip onboarding/ }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(props.onSkip).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });
});
