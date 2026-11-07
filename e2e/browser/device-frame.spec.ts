import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("toggles device frame and safe area, then rotates the active device", async ({ page }) => {
  await startWorkspace(page, "Responsive web");
  await page.getByRole("button", { name: "Canvas view options" }).click();

  const viewOptions = page.getByRole("dialog", { name: "Canvas view options" });
  const frameToggle = viewOptions.getByRole("button", { name: "Show device frame" });
  const safeAreaToggle = viewOptions.getByRole("button", { name: "Show safe area" });
  const orientationToggle = viewOptions.getByRole("button", {
    name: "Rotate device orientation",
  });
  const initialFrameState = await frameToggle.getAttribute("aria-pressed");
  const initialSafeAreaState = await safeAreaToggle.getAttribute("aria-pressed");
  const initialOrientationLabel = await orientationToggle.innerText();

  await frameToggle.click();
  await expect(frameToggle).toHaveAttribute(
    "aria-pressed",
    initialFrameState === "true" ? "false" : "true",
  );
  await frameToggle.click();
  await expect(frameToggle).toHaveAttribute("aria-pressed", initialFrameState ?? "false");

  await safeAreaToggle.click();
  await expect(safeAreaToggle).toHaveAttribute(
    "aria-pressed",
    initialSafeAreaState === "true" ? "false" : "true",
  );
  await safeAreaToggle.click();
  await expect(safeAreaToggle).toHaveAttribute("aria-pressed", initialSafeAreaState ?? "false");

  await orientationToggle.click();
  const overflowChoices = viewOptions.getByRole("group", {
    name: "Orientation overflow choices",
  });
  if (await overflowChoices.count()) {
    await overflowChoices.getByRole("button", { name: "Rotate widgets too" }).click();
  }
  await expect(orientationToggle).not.toContainText(initialOrientationLabel);

  await orientationToggle.click();
  if (await overflowChoices.count()) {
    await overflowChoices.getByRole("button", { name: "Keep widgets as-is" }).click();
  }
  await expect(orientationToggle).toContainText(initialOrientationLabel);
});
