import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../project/schema";
import { renderWithProviders } from "../test/render";
import { ExpressionField } from "./ExpressionField";

describe("ExpressionField", () => {
  it("previews expressions and reports invalid expressions accessibly", async () => {
    const project = createEmptyProject();
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <ExpressionField
        label="Label"
        value="Total: [[1 + 2]]"
        onChange={onChange}
        project={project}
        screenId={project.screens[0].id}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Preview: Total: 3");

    rerender(
      <ExpressionField
        label="Label"
        value="[[1 +]]"
        onChange={onChange}
        project={project}
        screenId={project.screens[0].id}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Expression error:");
  });

  it("warns when the expression result does not match the expected type", () => {
    const project = createEmptyProject();
    renderWithProviders(
      <ExpressionField
        label="Numeric value"
        value="[[ 'hello' ]]"
        onChange={vi.fn()}
        project={project}
        screenId={project.screens[0].id}
        expectedType="number"
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Expected number");
  });

  it("inserts an expression at the current cursor and offers variable suggestions", async () => {
    const user = userEvent.setup();
    const project = createEmptyProject();
    project.variables.push({
      id: crypto.randomUUID(),
      name: "accountName",
      scope: "project",
      type: "string",
      initial: "Ada",
    });
    const onChange = vi.fn();
    function ControlledField() {
      const [value, setValue] = useState("Hello");
      return (
        <ExpressionField
          label="Label"
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
          project={project}
          screenId={project.screens[0].id}
        />
      );
    }
    renderWithProviders(<ControlledField />);

    const input = screen.getByLabelText("Label") as HTMLInputElement;
    input.setSelectionRange(2, 4);
    await user.click(screen.getByRole("button", { name: "Insert [[ ]]" }));
    expect(onChange).toHaveBeenLastCalledWith("He[[ ]]o");

    await user.click(screen.getByText("Variables & functions"));
    await user.click(screen.getByRole("option", { name: "accountName" }));
    expect(onChange).toHaveBeenLastCalledWith("He[[ accountName]]o");
  });

  it("passes edited values through and supports multiline input", () => {
    const project = createEmptyProject();
    const onChange = vi.fn();
    renderWithProviders(
      <ExpressionField
        label="Formula"
        value=""
        onChange={onChange}
        project={project}
        screenId={project.screens[0].id}
        multiline
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Formula" }), {
      target: { value: "[[2 * 4]]" },
    });
    expect(onChange).toHaveBeenCalledWith("[[2 * 4]]");
  });
});
