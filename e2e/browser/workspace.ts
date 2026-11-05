import { expect, type Page } from "playwright/test";

export async function goOffline(page: Page): Promise<void> {
  await page.route("http://127.0.0.1:8790/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "E2E offline mode" }),
    }),
  );
}

export async function startWorkspace(
  page: Page,
  templateName: string,
): Promise<void> {
  await goOffline(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      "protoflow.privacy.v1",
      JSON.stringify({ crashReports: false, anonymousTelemetry: false }),
    );
  });
  await page.goto("/");
  await expect(page.getByRole("heading", {
    name: "From first sketch to clickable prototype.",
  })).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: new RegExp(templateName) }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Got it" }).click();
  await page.getByRole("button", { name: "Skip tour" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("button", { name: "Quick actions" })).toBeVisible();
  await expect(page.locator(".document-name")).toHaveText(
    templateName === "Blank project" ? "Untitled project" : templateName,
  );
}

export async function finishFirstLaunch(page: Page): Promise<void> {
  await expect(page.getByRole("dialog", { name: "Choose what you share" })).toBeVisible();
  await page.getByRole("button", { name: "Continue with both off" }).click();
  await expect(page.getByRole("heading", {
    name: "From first sketch to clickable prototype.",
  })).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Responsive web" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", {
    name: "Design for desktop, tablet, and mobile.",
  })).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();

  for (const title of [
    "Your project and screens",
    "Design on the canvas",
    "Fine-tune in the inspector",
    "Actions are close at hand",
    "Build interactive prototypes",
  ]) {
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }

  await expect(page.getByRole("heading", { name: "You’ve got 50 credits." })).toBeVisible();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.locator(".document-name")).toHaveText("Responsive web");
}
