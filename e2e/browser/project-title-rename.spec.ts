import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("project title rename supports first name, replace, cancel, blur, and empty drafts", async ({ page }) => {
  await startWorkspace(page, "Blank project");

  await page.getByRole("button", { name: "Rename project: Untitled project" }).click();
  const input = page.getByRole("textbox", { name: "Project name" });
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("");
  await expect(input).toHaveAttribute("placeholder", "Untitled project");

  // The first typed title replaces the default placeholder.
  await input.pressSequentially("First Project");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "Rename project: First Project" })).toBeVisible();

  // Existing custom titles are selected on focus, so typing replaces rather than appends.
  await page.getByRole("button", { name: "Rename project: First Project" }).click();
  await expect(input).toHaveValue("First Project");
  await expect.poll(() => input.evaluate((element) => {
    const field = element as HTMLInputElement;
    return [field.selectionStart, field.selectionEnd];
  })).toEqual([0, "First Project".length]);
  await input.pressSequentially("Second Project");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "Rename project: Second Project" })).toBeVisible();

  // Escape cancels an in-progress rename.
  await page.getByRole("button", { name: "Rename project: Second Project" }).click();
  await input.fill("Cancelled name");
  await input.press("Escape");
  await expect(page.getByRole("button", { name: "Rename project: Second Project" })).toBeVisible();

  // Leaving the field commits a valid draft.
  await page.getByRole("button", { name: "Rename project: Second Project" }).click();
  await input.fill("Blur saved name");
  await input.press("Tab");
  await expect(page.getByRole("button", { name: "Rename project: Blur saved name" })).toBeVisible();

  // Empty or whitespace-only drafts do not erase a valid project title.
  await page.getByRole("button", { name: "Rename project: Blur saved name" }).click();
  await input.fill("   ");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "Rename project: Blur saved name" })).toBeVisible();
});

test("project title rename enforces the 120-character limit", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Rename project: Untitled project" }).click();

  const input = page.getByRole("textbox", { name: "Project name" });
  await expect(input).toHaveAttribute("maxlength", "120");
  await input.pressSequentially("x".repeat(130));
  await expect.poll(() => input.evaluate((element) => (element as HTMLInputElement).value.length))
    .toBe(120);
  await input.press("Enter");
  await expect(page.getByRole("button", { name: `Rename project: ${"x".repeat(120)}` })).toBeVisible();
});
