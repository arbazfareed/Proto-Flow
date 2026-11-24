import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { LINK_RUNTIME_SOURCE, safeLinkUrl } from "./links";

describe("safeLinkUrl (B49)", () => {
  it("accepts web, mail and phone addresses", () => {
    expect(safeLinkUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeLinkUrl("http://example.com")).toBe("http://example.com/");
    expect(safeLinkUrl("mailto:hi@example.com")).toBe("mailto:hi@example.com");
    expect(safeLinkUrl("tel:+15551234")).toBe("tel:+15551234");
    expect(safeLinkUrl("  www.example.com  ")).toBe("https://www.example.com/");
  });

  it("refuses anything that could run code or is not an address", () => {
    expect(safeLinkUrl("javascript:alert(1)")).toBeNull();
    expect(safeLinkUrl("JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeLinkUrl("data:text/html,<script>1</script>")).toBeNull();
    expect(safeLinkUrl("file:///etc/passwd")).toBeNull();
    expect(safeLinkUrl("")).toBeNull();
    expect(safeLinkUrl("   ")).toBeNull();
    expect(safeLinkUrl(42)).toBeNull();
    expect(safeLinkUrl(undefined)).toBeNull();
  });

  it("the text copy used by published prototypes gives the same answers", () => {
    // A real browser always has URL; a bare sandbox does not, so hand it over.
    const copy = runInNewContext(`${LINK_RUNTIME_SOURCE}\nsafeLinkUrl`, { URL }) as typeof safeLinkUrl;
    const samples: unknown[] = ["https://example.com", "www.example.com", "mailto:a@b.c", "tel:123", "javascript:alert(1)",
      "data:text/plain,hi", "file:///x", "", "  ", "not a url at all", "http://", 7, null, undefined, "ftp://x.test"];
    for (const sample of samples) expect(copy(sample), String(sample)).toBe(safeLinkUrl(sample));
  });
});
