import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpPanel } from "./HelpPanel";

const notify = vi.fn();
const openTutorial = vi.fn();
let restoreFocusableRects: (() => void) | undefined;

function renderHelp(initialSlug = "workspace-tour", onClose = vi.fn()) {
  return render(
    <HelpPanel
      initialSlug={initialSlug}
      onClose={onClose}
      onOpenTutorial={openTutorial}
      onNotify={notify}
    />,
  );
}

afterEach(() => {
  restoreFocusableRects?.();
  restoreFocusableRects = undefined;
  document.querySelector("[data-help-focus-test]")?.remove();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("HelpPanel", () => {
  it("searches the bundled offline articles and follows contextual article links", async () => {
    const user = userEvent.setup();
    renderHelp("responsive-html-export");
    const help = screen.getByRole("dialog", { name: "Help & documentation" });

    expect(within(help).getByText("56 guides · Search and read offline")).toBeInTheDocument();
    await user.click(within(help).getByRole("button", {
      name: "choosing between responsive and per-device export",
    }));
    const comparison = within(help).getByRole("heading", {
      name: "Choosing between responsive and per-device export",
    });
    expect(comparison).toBeInTheDocument();
    const table = within(help).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent))
      .toEqual(["Export", "Best for", "Output", "Credits"]);
    expect(within(table).getByRole("row", { name: /Responsive HTML/ })).toBeInTheDocument();

    const search = within(help).getByRole("searchbox", { name: "Search help articles" });
    await user.clear(search);
    await user.type(search, "device frames");
    const result = within(help).getByText("Device frames overview", { exact: true });
    expect(result).toBeInTheDocument();
    await user.click(result);
    expect(within(help).getByRole("heading", { name: "Device frames overview" })).toBeInTheDocument();
    expect(within(help).getByText(/available offline/)).toBeInTheDocument();
  });

  it("stores article feedback locally and exposes the tutorial launch from documentation", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderHelp("workspace-tour", onClose);
    const help = screen.getByRole("dialog", { name: "Help & documentation" });

    await user.click(within(help).getByRole("button", { name: "No" }));
    await user.type(
      within(help).getByLabelText("What could be clearer? (optional)"),
      "Clarify this guide",
    );
    await user.click(within(help).getByRole("button", { name: "Save feedback on this device" }));
    expect(JSON.parse(localStorage.getItem("protoflow:help-feedback-comments") ?? "{}"))
      .toEqual({ "workspace-tour": "Clarify this guide" });

    await user.click(within(help).getByRole("button", { name: "Start interactive tutorial" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(openTutorial).toHaveBeenCalledOnce();
  });

  it("keeps keyboard focus inside the modal and restores focus when it closes", async () => {
    const user = userEvent.setup();
    const trigger = document.createElement("button");
    trigger.dataset.helpFocusTest = "true";
    trigger.textContent = "Open help";
    document.body.append(trigger);
    trigger.focus();
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getClientRects")
      .mockImplementation(() => [new DOMRect()] as unknown as DOMRectList);
    restoreFocusableRects = () => rectSpy.mockRestore();

    function Harness() {
      const [open, setOpen] = useState(true);
      return open
        ? <HelpPanel
          initialSlug="workspace-tour"
          onClose={() => setOpen(false)}
          onOpenTutorial={openTutorial}
          onNotify={notify}
        />
        : null;
    }

    const { container } = render(<Harness />);
    const help = screen.getByRole("dialog", { name: "Help & documentation" });
    expect(screen.getByRole("searchbox", { name: "Search help articles" })).toHaveFocus();

    const focusable = [...help.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
    )];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();

    await user.click(within(help).getByRole("button", { name: "Close help" }));
    expect(container).toBeEmptyDOMElement();
    expect(trigger).toHaveFocus();
  });
});
