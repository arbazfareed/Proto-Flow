import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// B24: the main JavaScript file was 2.2 MB (709 KB compressed), so start-up was slow. Dialogs that open on
// demand, and libraries that only one feature needs, must load the first time they are used, not at start-up.
describe("start-up bundle (B24)", () => {
  const appShell = read("./AppShell.tsx");

  it.each([
    "WalletDialog",
    "CloudPreviewDialog",
    "ReactCodeExportDialog",
    "ImportCodeDialog",
    "HtmlExportDialog",
    "PluginManagerDialog",
    "CollaborationDialog",
  ])("loads %s only when it is opened", (name) => {
    // No static import of the component (a type-only import is fine) ...
    expect(appShell).not.toMatch(new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*"\\./layout/${name}"`));
    // ... and a lazy dynamic import instead.
    expect(appShell).toContain(`import("./layout/${name}")`);
  });

  it("loads zip, image capture and QR code libraries when an export or share is used", () => {
    expect(read("./preview/htmlExport.ts")).not.toMatch(/^import (?!type)[^\n]*from "(jszip|html-to-image)"/m);
    expect(read("./preview/PreviewWindow.tsx")).not.toMatch(/^import [^\n]*from "html-to-image"/m);
    expect(read("./plugins/storage.ts")).not.toMatch(/^import [^\n]*from "jszip"/m);
    expect(read("./layout/CloudPreviewDialog.tsx")).not.toMatch(/^import [^\n]*from "qrcode"/m);
  });
});
