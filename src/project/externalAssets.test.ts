// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { resolveExternalAssets } from "./externalAssets";

describe("resolveExternalAssets", () => {
  it("fetches linked CSS, nested imports, script sources, and images", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://assets.example.test/css/main.css") {
        return new Response("@import './theme.css'; .hero { background-image: url('../img/hero.png'); }", {
          headers: { "content-type": "text/css" },
        });
      }
      if (url === "https://assets.example.test/css/theme.css") {
        return new Response("h1 { color: #123456; }", {
          headers: { "content-type": "text/css" },
        });
      }
      if (url === "https://assets.example.test/img/hero.png" ||
          url === "https://assets.example.test/img/photo.webp") {
        return new Response(Uint8Array.from([1, 2, 3]), {
          headers: { "content-type": url.endsWith(".webp") ? "image/webp" : "image/png" },
        });
      }
      if (url === "https://assets.example.test/js/app.js") {
        return new Response('document.querySelector("#save").addEventListener("click", () => {});', {
          headers: { "content-type": "text/javascript" },
        });
      }
      return new Response("Not found", { status: 404 });
    });

    const result = await resolveExternalAssets(
      '<!doctype html><html><head><link rel="stylesheet" href="/css/main.css"></head><body>' +
        '<button id="save">Save</button><script src="/js/app.js"></script>' +
        '<img src="/img/photo.webp" alt="Photo"></body></html>',
      "",
      "",
      { baseUrl: "https://assets.example.test/pages/demo.html", fetcher },
    );

    expect(result.html).toContain('src="data:image/webp;base64,AQID"');
    expect(result.html).toContain('querySelector("#save")');
    expect(result.html).not.toContain("<script src=");
    expect(result.html).not.toContain("<link");
    expect(result.css).toContain("color: #123456");
    expect(result.css).toContain("data:image/png;base64,AQID");
    expect(result.javascript).toBe("");
    expect(result.resolvedCount).toBe(5);
    expect(result.warnings).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ credentials: "omit", redirect: "error" }),
    );
  });

  it("preserves media qualifiers and ignores imports inside CSS comments", async () => {
    const fetcher = vi.fn(async () => new Response("h1 { color: red; }", {
      headers: { "content-type": "text/css" },
    }));
    const result = await resolveExternalAssets(
      "<p>Example</p>",
      "/* @import 'ignored.css'; */ @import 'small.css' screen and (max-width: 600px);",
      "",
      { baseUrl: "https://assets.example.test/design/index.html", fetcher },
    );

    expect(result.css).toContain("/* @import 'ignored.css'; */");
    expect(result.css).toContain("@media screen and (max-width: 600px)");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports CORS/network failures without discarding the original source", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const html = '<link rel="stylesheet" href="https://assets.example.test/site.css">' +
      '<script src="https://assets.example.test/app.js"></script>' +
      '<img src="https://assets.example.test/photo.png">';
    const result = await resolveExternalAssets(html, "", "", { fetcher });

    expect(result.html).toContain("site.css");
    expect(result.html).toContain("app.js");
    expect(result.html).toContain("photo.png");
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings.every((warning) => warning.includes("CORS"))).toBe(true);
    expect(result.resolvedCount).toBe(0);
  });

  it("rejects insecure, local, and credential-bearing asset URLs without fetching them", async () => {
    const fetcher = vi.fn();
    const result = await resolveExternalAssets(
      '<img src="http://assets.example.test/photo.png">' +
        '<script src="https://localhost/app.js"></script>' +
        '<link rel="stylesheet" href="https://user:pass@assets.example.test/site.css">',
      "",
      "",
      { fetcher },
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.warnings).toHaveLength(3);
    expect(result.html).toContain("photo.png");
  });

  it("warns when an image response is not a supported raster format", async () => {
    const fetcher = vi.fn(async () => new Response("<svg></svg>", {
      headers: { "content-type": "image/svg+xml" },
    }));
    const result = await resolveExternalAssets(
      '<img src="https://assets.example.test/photo.svg">',
      "",
      "",
      { fetcher },
    );

    expect(result.html).toContain("photo.svg");
    expect(result.warnings.join(" ")).toContain("Only PNG, JPEG, GIF, and WebP");
  });
});
