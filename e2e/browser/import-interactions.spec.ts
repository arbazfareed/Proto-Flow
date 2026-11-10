import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("PF-T807 inspects an imported DOM node, binds navigation, and fires it in preview", async ({
  page,
}) => {
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Add screen" }).click();
  const devicePicker = page.getByRole("dialog", { name: "Choose a device" });
  await devicePicker.getByRole("textbox", { name: "Search devices" }).fill("iPhone 15");
  await devicePicker.getByRole("button", { name: /^iPhone 15 393/ }).click();
  await page.getByRole("button", { name: "Previous screen" }).click();
  await expect(page.getByLabel("Screen input mode")).toHaveValue("mouse");

  await page.getByRole("button", { name: "Import Code" }).click();
  const dialog = page.getByRole("dialog", { name: "Import code" });
  const htmlEditor = page.getByRole("textbox", { name: "HTML code" });
  await htmlEditor.fill('<button id="navigate">Go to destination</button>');
  const frame = page.frameLocator('iframe[title="Sandboxed code preview"]');
  await expect(frame.getByRole("button", { name: "Go to destination" })).toBeVisible();
  await page.getByRole("button", { name: "Inspect elements" }).click();
  await frame.getByRole("button", { name: "Go to destination" }).click();
  const domInspector = page.getByRole("region", { name: "DOM inspector" });
  await expect(domInspector).toContainText("node-1");
  await expect(domInspector).toContainText("#navigate");
  const destination = domInspector.getByLabel("Interaction destination");
  const destinationId = await destination.inputValue();
  const destinationName = await destination.locator("option:checked").innerText();
  await expect(destinationId).not.toBe("");
  await domInspector.getByRole("button", { name: "Bind onClick navigation" }).click();
  await expect(domInspector).toContainText(`onClick navigates to ${destinationName}`);
  await page.getByRole("button", { name: "Render on Canvas" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".toast")).toContainText("Bound node-1 onClick");

  await page.getByRole("tab", { name: "Interactions" }).click();
  const interactionRules = page.getByRole("region", { name: "Interaction rules" });
  await expect(interactionRules).toContainText("Linked DOM node: node-1");
  await expect(interactionRules.getByRole("combobox", {
    name: "Trigger event",
  })).toHaveValue("onClick");
  await expect(interactionRules.getByRole("combobox", {
    name: "Action target",
  })).toHaveValue(destinationId);

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  const previewScreen = preview.getByLabel("Preview screen", { exact: true });
  await expect(previewScreen.locator("option")).toHaveCount(2);
  const sourceScreenId = await previewScreen.locator("option").nth(0).getAttribute("value");
  expect(sourceScreenId).not.toBe(destinationId);
  await previewScreen.selectOption(sourceScreenId ?? "");
  await expect(previewScreen).toHaveValue(sourceScreenId ?? "");
  await preview.getByRole("button", { name: "Go to destination" }).click();
  await expect(previewScreen).toHaveValue(destinationId);
  await preview.close();
});
