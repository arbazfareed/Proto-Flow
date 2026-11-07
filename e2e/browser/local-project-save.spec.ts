import { readFile } from "node:fs/promises";
import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("downloads a portable local project without contacting cloud services", async ({ page }) => {
  const meteredRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/action/run") {
      meteredRequests.push(request.url());
    }
  });
  await startWorkspace(page, "Responsive web");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .pflow project" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("Responsive web.pflow");
  const path = await download.path();
  expect(path).not.toBeNull();
  const project = JSON.parse(await readFile(path!, "utf8")) as {
    name: string;
    screens: Array<{ widgets: unknown[] }>;
  };
  expect(project.name).toBe("Responsive web");
  expect(project.screens).toHaveLength(1);
  expect(project.screens[0].widgets).toHaveLength(4);
  expect(meteredRequests).toEqual([]);
});
