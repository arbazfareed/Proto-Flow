import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { DEVICE_PRESETS } from "./catalog";
import { DevicePicker } from "./DevicePicker";

const firstPhone = DEVICE_PRESETS.find((device) => device.category === "phone")!;
const firstTablet = DEVICE_PRESETS.find((device) => device.category === "tablet")!;

function renderPicker(
  overrides: Partial<ComponentProps<typeof DevicePicker>> = {},
) {
  const props: ComponentProps<typeof DevicePicker> = {
    mode: "create",
    open: true,
    onClose: vi.fn(),
    onCreate: vi.fn(),
    onChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<DevicePicker {...props} />), props };
}

describe("DevicePicker", () => {
  it("filters devices by search and category", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.type(screen.getByRole("textbox", { name: "Search devices" }), firstPhone.name);

    expect(screen.getByRole("button", { name: new RegExp(firstPhone.name) })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: new RegExp(firstTablet.name) })).not.toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "Search devices" }));
    await user.click(screen.getByRole("button", { name: "Phones" }));

    expect(screen.getByRole("button", { name: new RegExp(firstPhone.name) })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: new RegExp(firstTablet.name) })).not.toBeInTheDocument();
  });

  it("creates a selected preset and remembers it for the next visit", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker();
    await user.click(screen.getByRole("button", { name: new RegExp(firstPhone.name) }));

    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({
      presetId: firstPhone.id,
      width: firstPhone.viewport.width,
      height: firstPhone.viewport.height,
    }));
    expect(localStorage.getItem("protoflow:recent-device-presets")).toContain(firstPhone.id);
  });

  it("validates custom safe areas before creating the device", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker();
    await user.click(screen.getByRole("button", { name: /Custom size/ }));
    await user.clear(screen.getByRole("spinbutton", { name: "Width" }));
    await user.type(screen.getByRole("spinbutton", { name: "Width" }), "10");
    await user.clear(screen.getByRole("spinbutton", { name: "Safe left" }));
    await user.type(screen.getByRole("spinbutton", { name: "Safe left" }), "10");

    expect(screen.getByRole("alert")).toHaveTextContent("Safe-area insets must fit");
    expect(screen.getByRole("button", { name: "Use custom size" })).toBeDisabled();
    await user.clear(screen.getByRole("spinbutton", { name: "Safe left" }));
    await user.type(screen.getByRole("spinbutton", { name: "Safe left" }), "1");
    await user.click(screen.getByRole("button", { name: "Use custom size" }));

    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({
      presetId: "custom",
      width: 10,
      insets: expect.objectContaining({ left: 1 }),
    }));
  });

  it("asks how to handle existing widgets before applying a device change", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker({ mode: "change" });
    await user.click(screen.getByRole("button", { name: new RegExp(firstPhone.name) }));

    const confirmation = screen.getByRole("alertdialog", { name: "Change screen device?" });
    await user.click(within(confirmation).getByRole("button", { name: /Keep absolute positions/ }));
    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ presetId: firstPhone.id }),
      false,
    );
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { props } = renderPicker();
    await user.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
