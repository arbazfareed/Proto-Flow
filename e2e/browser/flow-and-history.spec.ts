import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("flow view renders the project screen and version history saves a checkpoint", async ({
  page,
}) => {
  await startWorkspace(page, "Responsive web");

  await page.getByRole("button", { name: "Flow", exact: true }).click();
  await expect(page.getByRole("region", { name: "Screen flow diagram" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Responsive web screen" })).toBeVisible();
  const svgDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "SVG", exact: true }).click();
  expect((await svgDownload).suggestedFilename()).toBe("flow-diagram.svg");
  const pngDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "PNG", exact: true }).click();
  expect((await pngDownload).suggestedFilename()).toBe("flow-diagram.png");
  await page.getByRole("button", { name: "Design", exact: true }).click();

  await page.getByRole("button", { name: "Quick actions" }).click();
  await page.getByRole("combobox", { name: "Filter commands" }).fill("Version History");
  await page.getByRole("option", { name: "Version History" }).press("Enter");

  const history = page.getByRole("dialog", { name: "Version history" });
  await expect(history).toBeVisible();
  await history.getByRole("textbox", { name: "Named checkpoint" }).fill("Before review");
  await history.getByRole("button", { name: "Create" }).click();
  await expect(history.getByRole("button", { name: /Before review/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(history.getByText("Stored locally on this device")).toBeVisible();
});
