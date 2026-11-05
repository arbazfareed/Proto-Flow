import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/render";
import { RichTextEditor } from "./RichTextEditor";

describe("RichTextEditor", () => {
  it("shows formatting controls and cancels editing on Escape", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    renderWithProviders(
      <RichTextEditor
        label="Widget text"
        text="Hello"
        runs={undefined}
        style={{}}
        contrastBackground="#ffffff"
        onCommit={onCommit}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("toolbar", { name: "Rich text formatting" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Widget text" })).toHaveTextContent("Hello");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Widget text" }), { key: "Escape" });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("opens the link editor and prevents unsafe link schemes", () => {
    renderWithProviders(
      <RichTextEditor
        label="Widget text"
        text="Hello"
        runs={undefined}
        style={{}}
        contrastBackground="#ffffff"
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Insert link" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Link URL" }), {
      target: { value: "javascript:alert(1)" },
    });
    expect(screen.getByRole("button", { name: "Apply link" })).toBeDisabled();
  });
});
