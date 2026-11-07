import { expect, test } from "playwright/test";
import { goOffline, startWorkspace } from "./workspace";

test("the tutorial opens from onboarding, completes, and restores the user's project", async ({ page }) => {
  await goOffline(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with both off" }).click();
  await page.getByRole("radio", { name: /Light/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Blank project" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Got it" }).click();
  await page.getByRole("button", { name: "Skip tour" }).click();
  await page.getByRole("button", { name: "Take the tour" }).click();

  const tutorial = page.getByRole("region", { name: "Interactive ProtoFlow tutorial" });
  await expect(tutorial.getByRole("heading", { name: "Select a shape" })).toBeVisible();
  await expect(page.locator(".document-name")).toHaveText("Interactive Tutorial");
  await tutorial.getByRole("button", { name: "Close tutorial" }).click();

  await expect(page.locator(".document-name")).toHaveText("Untitled project");
  await expect(page.getByRole("heading", {
    name: "From first sketch to clickable prototype.",
  })).toHaveCount(0);
});

test("the offline docs launch and verify the tutorial, contextual links, search, feedback, and deep links", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  page.on("dialog", (dialog) => dialog.accept());

  await page.getByRole("button", { name: "Help: workspace tour" }).first().click();
  const help = page.getByRole("dialog", { name: "Help & documentation" });
  await expect(help.getByText("56 guides · Search and read offline")).toBeVisible();
  await expect(help.getByRole("heading", { name: "Workspace tour" })).toBeVisible();
  await help.getByRole("button", { name: "Start interactive tutorial" }).click();

  const tutorial = page.getByRole("region", { name: "Interactive ProtoFlow tutorial" });
  await expect(tutorial.getByRole("heading", { name: "Select a shape" })).toBeVisible();
  await tutorial.getByText("If you’re coming from Axure…").click();
  await expect(tutorial.getByText(/In Axure, you select widgets/)).toBeVisible();

  for (let step = 0; step < 5; step += 1) {
    await tutorial.getByRole("button", { name: "Next" }).click();
  }
  await expect(tutorial.getByText("STEP 6 OF 15")).toBeVisible();
  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  await expect(preview.locator(".preview-screen")).toBeVisible();
  await expect(tutorial.getByText("STEP 7 OF 15")).toBeVisible();
  await preview.close();

  for (let step = 0; step < 7; step += 1) {
    await tutorial.getByRole("button", { name: "Next" }).click();
  }
  await expect(tutorial.getByText("STEP 14 OF 15")).toBeVisible();
  await page.getByRole("button", { name: "Canvas view options" }).click();
  await page.getByRole("button", { name: "Flow", exact: true }).click();
  await expect(page.getByRole("region", { name: "Screen flow diagram" })).toBeVisible();
  await expect(tutorial.getByText("STEP 15 OF 15")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export HTML bundle" }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export HTML bundle" });
  await exportDialog.getByRole("button", { name: "Download HTML bundle" }).click();
  await downloadPromise;
  await expect(tutorial.getByRole("status"))
    .toHaveText("Responsive HTML export complete.");
  await exportDialog.getByRole("button", { name: "Close HTML export dialog" }).click();
  await tutorial.getByRole("button", { name: "Finish" }).click();
  await expect(page.locator(".document-name")).toHaveText("Untitled project");

  await page.keyboard.press("F1");
  const reopenedHelp = page.getByRole("dialog", { name: "Help & documentation" });
  await reopenedHelp.getByRole("searchbox", { name: "Search help articles" }).fill("device frames");
  await reopenedHelp.getByText("Device frames overview", { exact: true }).click();
  await expect(reopenedHelp.getByRole("heading", { name: "Device frames overview" })).toBeVisible();
  await reopenedHelp.getByRole("button", { name: "Yes" }).click();
  const savedFeedback = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("protoflow:help-feedback") ?? "{}"),
  );
  expect(savedFeedback["device-frames"]).toBe("yes");
  await reopenedHelp.getByRole("button", { name: "Close help" }).click();
  await page.keyboard.press("F1");
  const reopenedAgain = page.getByRole("dialog", { name: "Help & documentation" });
  await reopenedAgain.getByRole("searchbox", { name: "Search help articles" }).fill("device frames");
  await reopenedAgain.getByText("Device frames overview", { exact: true }).click();
  await expect(reopenedAgain.getByRole("button", { name: "Yes" }))
    .toHaveAttribute("aria-pressed", "true");

  await page.goto("/#docs/device-frames");
  await expect(page.getByRole("dialog", { name: "Help & documentation" })
    .getByRole("heading", { name: "Device frames overview" })).toBeVisible();
});

test("the tutorial can also be restarted from the Help sidebar", async ({ page }) => {
  await startWorkspace(page, "Blank project");
  page.on("dialog", (dialog) => dialog.accept());

  await page.getByRole("button", { name: "Open tutorial project" }).click();
  let tutorial = page.getByRole("region", { name: "Interactive ProtoFlow tutorial" });
  await expect(tutorial.getByRole("heading", { name: "Select a shape" })).toBeVisible();
  await tutorial.getByRole("button", { name: "Next" }).click();
  await expect(tutorial.getByRole("heading", { name: "Move it on the canvas" })).toBeVisible();

  await page.getByRole("button", { name: "Open tutorial project" }).click();
  tutorial = page.getByRole("region", { name: "Interactive ProtoFlow tutorial" });
  await expect(tutorial.getByRole("heading", { name: "Select a shape" })).toBeVisible();
});
