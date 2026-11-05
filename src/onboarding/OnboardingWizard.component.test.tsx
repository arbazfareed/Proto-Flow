import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/render";
import { OnboardingWizard } from "./OnboardingWizard";

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
