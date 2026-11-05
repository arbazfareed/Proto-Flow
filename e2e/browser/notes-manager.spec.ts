import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("opens the widget annotations manager and shows an actionable empty state", async ({
  page,
}) => {
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Open widget notes manager" }).click();

  const notes = page.getByRole("dialog", { name: "Widget notes" });
  await expect(notes).toBeVisible();
  await expect(notes.getByText("No widget notes yet")).toBeVisible();
  await expect(notes.getByRole("button", { name: "CSV" })).toBeDisabled();
  await notes.getByRole("button", { name: "Close widget notes" }).click();
  await expect(notes).not.toBeVisible();
});
