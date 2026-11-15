import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("warns before leaving with unsaved changes and keeps them recoverable", async ({ page }) => {
  await startWorkspace(page, "Blank project");

  const name = page.locator("#project-name");
  await name.fill("Unsaved draft");
  await name.press("Enter");
  await expect(page.getByText("Unsaved changes")).toBeVisible();

  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.type());
    void dialog.accept();
  });
  await page.reload();
  expect(dialogs).toContain("beforeunload");

  // The leave handler wrote a recovery copy right away, without waiting for the 30-second autosave.
  const recovery = page.getByRole("dialog", { name: "Pick up where you left off?" });
  await expect(recovery).toBeVisible();
  await recovery.getByRole("button", { name: /Restore project/ }).click();
  await expect(page.locator(".document-name")).toHaveText("Unsaved draft");
});

test("does not warn when there is nothing unsaved", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  await expect(page.getByText("All changes saved")).toBeVisible();

  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.type());
    void dialog.accept();
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Quick actions" })).toBeVisible();
  expect(dialogs).toEqual([]);
});
