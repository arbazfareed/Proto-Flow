import { describe, expect, it } from "vitest";
import {
  buildSandboxedPreviewDocument,
  generatePreviewId,
  isPreviewBundle,
  MAX_PREVIEW_BUNDLE_BYTES,
} from "../src/previews";

describe("cloud preview helpers", () => {
  it("creates short URL-safe IDs", () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect(generatePreviewId()).toMatch(/^[A-Za-z0-9]{8}$/);
    }
  });

  it("accepts standalone HTML within 10 MiB and rejects malformed or oversized bundles", () => {
    expect(isPreviewBundle("<!doctype html><html><body>ok</body></html>")).toBe(true);
    expect(isPreviewBundle("<html><body>missing doctype</body></html>")).toBe(false);
    expect(isPreviewBundle(`<!doctype html><html>${"x".repeat(MAX_PREVIEW_BUNDLE_BYTES)}</html>`)).toBe(false);
    expect(isPreviewBundle(null)).toBe(false);
  });

  it("isolates published HTML in a script-only sandbox and denies network access", () => {
    const document = buildSandboxedPreviewDocument(
      '<!doctype html><html><script>document.body.textContent="safe"</script></html>',
    );

    expect(document).toContain('sandbox="allow-scripts"');
    expect(document).toContain("&lt;!doctype html&gt;");
    expect(document).not.toContain('sandbox="allow-scripts allow-same-origin"');
  });
});
