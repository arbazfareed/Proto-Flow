import { expect, test } from "playwright/test";
import { startWorkspace } from "./workspace";

test("PF-T808 converts JavaScript events and keeps imported code and canvas in sync", async ({
  page,
}) => {
  await startWorkspace(page, "Blank project");
  await page.getByRole("button", { name: "Import Code" }).click();
  const dialog = page.getByRole("dialog", { name: "Import code" });
  const htmlEditor = page.getByRole("textbox", { name: "HTML code" });
  await htmlEditor.fill('<button id="save">Save</button>');
  await page.getByRole("tab", { name: "JS" }).click();
  await page.getByRole("textbox", { name: "JS code" }).fill(
    `document.querySelector("#save").addEventListener("click", (event) => {
      event.currentTarget.textContent = "Saved";
    });`,
  );
  const convertListener = page.getByRole("button", {
    name: "Convert click listener on #save to ProtoFlow rule",
  });
  await expect(convertListener).toBeEnabled();
  await convertListener.click();
  await page.getByRole("button", { name: "Render on Canvas" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".toast")).toContainText("Converted 1 JavaScript event listener");

  const xPosition = page.getByLabel("X", { exact: true });
  await expect(xPosition).toBeEnabled();
  await xPosition.fill("130");
  await xPosition.press("Enter");
  await page.getByRole("button", { name: "Import Code" }).click();
  await expect(htmlEditor).toHaveValue(/left: 130px !important/);

  await htmlEditor.fill(
    '<button id="save" style="position:absolute;left:180px;top:200px;width:210px;height:55px">Edited by HTML</button>',
  );
  await page.getByRole("tab", { name: "JS" }).click();
  await page.getByRole("button", {
    name: "Convert click listener on #save to ProtoFlow rule",
  }).click();
  await page.getByRole("button", { name: "Render on Canvas" }).click();
  await expect(dialog).not.toBeVisible();

  const previewPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open preview" }).click();
  const preview = await previewPromise;
  const importedButton = preview.getByRole("button", { name: "Edited by HTML" });
  await expect(importedButton).toBeVisible();
  await expect(importedButton).toHaveAttribute("style", /left:\s*180px/);
  await importedButton.click();
  await expect(preview.getByRole("button", { name: "Saved" })).toBeVisible();
  await preview.close();
});
