import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { expect, test, type Page, type TestInfo } from "playwright/test";
import { startWorkspace } from "./workspace";

const WORKFLOW_LIMIT_MS = 5 * 60 * 1000;
test.describe.configure({ timeout: WORKFLOW_LIMIT_MS });

async function captureMilestone(
  page: Page,
  testInfo: TestInfo,
  name: string,
  fullPage = true,
) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage }),
    contentType: "image/png",
  });
}

async function downloadHtmlExport(page: Page, mode: "responsive" | "device-variants") {
  await page.getByRole("button", { name: "Export HTML bundle" }).click();
  const dialog = page.getByRole("dialog", { name: "Export HTML bundle" });
  await expect(dialog.getByText(/0 credits · no upload · local export/)).toBeVisible();
  await dialog.getByLabel("Export format").selectOption(mode);
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", {
    name: mode === "responsive" ? /Download HTML bundle/ : /Download device variants/,
  }).click();
  const download = await downloadPromise;
  const archivePath = await download.path();
  expect(archivePath).not.toBeNull();
  const archive = await JSZip.loadAsync(await readFile(archivePath!));
  await dialog.getByRole("button", { name: "Close HTML export dialog" }).click();
  return archive;
}

function expectWithinWorkflowLimit(startedAt: number) {
  expect(Date.now() - startedAt).toBeLessThan(WORKFLOW_LIMIT_MS);
}

test("PF-T716 W1 — dashboard design, live preview, multi-device view, and HTML export", async ({
  page,
}, testInfo) => {
  const startedAt = Date.now();
  await startWorkspace(page, "Dashboard");
  await expect(page.locator(".document-name")).toHaveText("Dashboard");
  await expect(page.getByText("Overview", { exact: true }).first()).toBeVisible();
  await captureMilestone(page, testInfo, "W1-dashboard-editor");

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  const dashboardScreen = preview.locator(".preview-screen");
  await expect(dashboardScreen).toBeVisible();
  await expect(dashboardScreen.locator('[data-widget-type="metric-card"]')).toHaveCount(2);
  await expect(dashboardScreen.locator(".preview-chart")).toHaveCount(1);
  await expect(dashboardScreen.locator('[data-widget-type="table"]')).toHaveCount(1);
  await expect(dashboardScreen.getByText("Overview")).toBeVisible();
  await preview.getByLabel("Preview layout").selectOption("columns");
  await expect(preview.locator("article.preview-frame-card")).toHaveCount(3);
  await captureMilestone(preview, testInfo, "W1-dashboard-preview");
  await preview.close();

  const archive = await downloadHtmlExport(page, "responsive");
  await expect.poll(async () => await archive.file("index.html")?.async("text"))
    .toContain("Dashboard");
  expect(await archive.file("runtime.js")?.async("text")).toBeTruthy();
  await captureMilestone(page, testInfo, "W1-dashboard-export");
  expectWithinWorkflowLimit(startedAt);
});

test("PF-T716 W2 — mobile screens, touch-mode preview, and responsive HTML export", async ({
  page,
}, testInfo) => {
  const startedAt = Date.now();
  await startWorkspace(page, "Mobile app");
  await expect(page.locator(".document-name")).toHaveText("Mobile app");

  for (let screen = 1; screen < 5; screen += 1) {
    await page.getByRole("button", { name: "Add screen" }).click();
    const picker = page.getByRole("dialog", { name: "Choose a device" });
    await picker.getByRole("textbox", { name: "Search devices" }).fill("iPhone 15");
    await picker.getByRole("button", { name: /^iPhone 15 393/ }).click();
  }
  await captureMilestone(page, testInfo, "W2-mobile-five-screens");

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  await expect(preview.getByLabel("Preview screen").locator("option")).toHaveCount(5);
  await expect(preview.locator('.preview-screen[data-input-mode="touch"]')).toBeVisible();
  await expect(preview.getByLabel("Device preset")).toHaveValue("iphone-15");
  const screenPicker = preview.getByLabel("Preview screen", { exact: true });
  const firstScreenId = await screenPicker.inputValue();
  await expect(screenPicker.locator("option")).toHaveCount(5);
  await screenPicker.selectOption({ index: 1 });
  await expect(screenPicker).not.toHaveValue(firstScreenId);
  await captureMilestone(preview, testInfo, "W2-mobile-preview");
  await preview.close();

  const archive = await downloadHtmlExport(page, "responsive");
  expect(await archive.file("index.html")?.async("text")).toContain("Mobile app");
  expect(await archive.file("runtime.js")?.async("text")).toBeTruthy();
  await captureMilestone(page, testInfo, "W2-mobile-export");
  expectWithinWorkflowLimit(startedAt);
});

test("PF-T716 W3 — marketing layout, breakpoints, flow, history, and device variants", async ({
  page,
}, testInfo) => {
  const startedAt = Date.now();
  await startWorkspace(page, "Landing page");
  await expect(page.locator(".document-name")).toHaveText("Landing page");
  await expect(page.getByLabel("Active breakpoint").locator("option", { hasText: "Desktop" }))
    .toHaveCount(1);

  const breakpoint = page.getByLabel("Active breakpoint");
  for (const name of ["Tablet", "Mobile", "Desktop"]) {
    const option = breakpoint.locator("option", { hasText: name });
    await expect(option).toHaveCount(1);
    await breakpoint.selectOption(await option.getAttribute("value") ?? "");
    await expect(breakpoint.locator("option:checked")).toContainText(name);
  }
  await captureMilestone(page, testInfo, "W3-responsive-breakpoints");

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  await preview.getByLabel("Preview layout").selectOption("columns");
  await expect(preview.locator("article.preview-frame-card")).toHaveCount(3);
  await captureMilestone(preview, testInfo, "W3-multi-device-preview");
  await preview.close();

  await page.getByRole("button", { name: "Flow", exact: true }).click();
  await expect(page.getByRole("region", { name: "Screen flow diagram" })).toBeVisible();
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.getByRole("button", { name: "Quick actions" }).click();
  await page.getByRole("combobox", { name: "Filter commands" }).fill("Version History");
  await page.getByRole("option", { name: "Version History" }).press("Enter");
  const history = page.getByRole("dialog", { name: "Version history" });
  await history.getByRole("textbox", { name: "Named checkpoint" }).fill("PF-T716 W3 milestone");
  await history.getByRole("button", { name: "Create" }).click();
  await expect(history.getByRole("button", { name: /PF-T716 W3 milestone/ }))
    .toHaveAttribute("aria-pressed", "true");
  await history.getByRole("button", { name: "Close version history" }).click();

  const archive = await downloadHtmlExport(page, "device-variants");
  for (const file of ["index.html", "index-desktop.html", "index-tablet.html", "index-mobile.html"]) {
    expect(await archive.file(file)?.async("text")).toContain("Landing page");
  }
  expect(await archive.file("runtime.js")?.async("text")).toBeTruthy();
  await captureMilestone(page, testInfo, "W3-responsive-export");
  expectWithinWorkflowLimit(startedAt);
});

test("PF-T716 W4 — admin data table import, 50-row repeater preview, and CSV export", async ({
  page,
}, testInfo) => {
  const startedAt = Date.now();
  await startWorkspace(page, "Data table");
  await page.getByRole("searchbox", { name: "Search layers" }).fill("Team members");
  const repeaterRow = page.locator(".layer-row").filter({
    has: page.locator(".layer-name", { hasText: /^Team members$/ }),
  });
  await repeaterRow.locator(".layer-select").click();

  const repeater = page.getByRole("region", { name: "Repeater data" });
  await expect(repeater.getByText("DATASET (3/1,000)")).toBeVisible();
  const records = [
    { name: "Alex Morgan", role: "Product designer", status: "Active" },
    { name: "Sam Rivera", role: "Frontend engineer", status: "Active" },
    { name: "Taylor Kim", role: "Product manager", status: "Invited" },
    ...Array.from({ length: 47 }, (_, index) => ({
      name: `Team member ${index + 4}`,
      role: "Operations",
      status: "Active",
    })),
  ];
  await repeater.locator('input[type="file"]').setInputFiles({
    name: "team-members.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([
      "name,role,status",
      ...records.map(({ name, role, status }) => `${name},${role},${status}`),
    ].join("\n")),
  });
  await expect(repeater.getByText("DATASET (50/1,000)")).toBeVisible();
  await captureMilestone(page, testInfo, "W4-admin-repeater-data", false);

  const csvPromise = page.waitForEvent("download");
  await repeater.getByRole("button", { name: "Export CSV" }).click();
  const csvDownload = await csvPromise;
  const csvPath = await csvDownload.path();
  expect(csvPath).not.toBeNull();
  const csv = await readFile(csvPath!, "utf8");
  expect(csv).toContain("Alex Morgan");
  expect(csv).toContain("Team member 50");
  expect(csv.split(/\r?\n/)).toHaveLength(51);

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  const renderedRepeater = preview.locator('.preview-repeater[data-repeater-row-count="50"]');
  await expect(renderedRepeater).toBeVisible();
  await expect(renderedRepeater.locator(".preview-repeater-row").first()).toBeVisible();
  await expect(preview.getByText("Sam Rivera")).toBeVisible();
  await captureMilestone(preview, testInfo, "W4-admin-preview", false);
  await preview.close();

  expectWithinWorkflowLimit(startedAt);
});
