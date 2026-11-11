import { expect, test } from "playwright/test";
import { PNG } from "pngjs";
import { startWorkspace } from "./workspace";

test("PF-T809 resolves external CSS, JavaScript, and images before canvas import", async ({
  page,
}) => {
  const image = PNG.sync.write(Object.assign(new PNG({ width: 1, height: 1 }), {
    data: Buffer.from([255, 0, 0, 255]),
  }));
  await page.route("https://cdn.pf809.test/**", async (route) => {
    const url = new URL(route.request().url());
    const headers = { "access-control-allow-origin": "*" };
    if (url.pathname === "/styles/main.css") {
      await route.fulfill({
        status: 200,
        headers: { ...headers, "content-type": "text/css" },
        body: '@import "./theme.css"; .hero { background-image: url("../images/bg.png"); }',
      });
    } else if (url.pathname === "/styles/theme.css") {
      await route.fulfill({
        status: 200,
        headers: { ...headers, "content-type": "text/css" },
        body: "h1 { color: rgb(18, 52, 86); }",
      });
    } else if (url.pathname === "/images/bg.png" || url.pathname === "/images/photo.png") {
      await route.fulfill({
        status: 200,
        headers: { ...headers, "content-type": "image/png" },
        body: image,
      });
    } else if (url.pathname === "/scripts/app.js") {
      await route.fulfill({
        status: 200,
        headers: { ...headers, "content-type": "text/javascript" },
        body: `document.querySelector("#save").addEventListener("click", (event) => {
          event.currentTarget.textContent = "Saved externally";
        });`,
      });
    } else {
      await route.fulfill({ status: 404, headers });
    }
  });

  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Import Code" }).click();
  const dialog = page.getByRole("dialog", { name: "Import code" });
  const htmlEditor = page.getByRole("textbox", { name: "HTML code" });
  await htmlEditor.fill(
    '<link rel="stylesheet" href="/styles/main.css"><main class="hero">' +
      '<h1>External assets</h1><button id="save">Save</button>' +
      '<img id="photo" src="/images/photo.png" alt="Photo"></main>' +
      '<script src="/scripts/app.js"></script>',
  );
  await page.getByRole("textbox", { name: "Asset base URL" }).fill(
    "https://cdn.pf809.test/pages/index.html",
  );
  await page.getByRole("button", { name: "Resolve external assets" }).click();
  await expect(page.getByLabel("External asset warnings")).toContainText(
    "Resolved 5 external assets",
  );
  await expect(htmlEditor).toHaveValue(/src="data:image\/png;base64,/);
  await expect(htmlEditor).toHaveValue(/Saved externally/);
  await expect(page.getByRole("tab", { name: "CSS" })).toBeVisible();
  await page.getByRole("tab", { name: "CSS" }).click();
  await expect(page.getByRole("textbox", { name: "CSS code" }))
    .toHaveValue(/color: rgb\(18, 52, 86\)/);
  await expect(page.getByRole("textbox", { name: "CSS code" }))
    .toHaveValue(/data:image\/png;base64,/);
  await expect(page.getByRole("button", {
    name: "Convert click listener on #save to ProtoFlow rule",
  })).toBeEnabled();
  await page.getByRole("button", {
    name: "Convert click listener on #save to ProtoFlow rule",
  }).click();

  await page.getByRole("button", { name: "Render on Canvas" }).click();
  await expect(dialog).not.toBeVisible();
  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  await expect(preview.getByRole("button", { name: "Save" })).toBeVisible();
  await preview.getByRole("button", { name: "Save" }).click();
  await expect(preview.getByRole("button", { name: "Saved externally" })).toBeVisible();
  await preview.close();
});
