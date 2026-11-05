import { describe, expect, it } from "vitest";
import {
  createHelpDeepLink,
  getHelpArticle,
  getHelpToc,
  HELP_ARTICLES,
  HELP_CATEGORIES,
  parseHelpDeepLink,
  searchHelpArticles,
} from "./docs";

describe("offline help library", () => {
  it("bundles 55 titled Markdown articles across categories", () => {
    expect(HELP_ARTICLES).toHaveLength(55);
    expect(new Set(HELP_ARTICLES.map((article) => article.slug)).size).toBe(55);
    expect(HELP_CATEGORIES).toContain("Canvas Devices");
    expect(HELP_CATEGORIES).toContain("Advanced Features");
    expect(HELP_ARTICLES.every((article) => article.title && article.markdown.trim())).toBe(true);
  });

  it("ranks matching title and heading terms ahead of body-only matches", () => {
    expect(searchHelpArticles("safe areas")[0]?.slug).toBe("safe-areas-snapping");
    expect(searchHelpArticles("local variables")[0]?.slug).toBe("local-variables");
    expect(searchHelpArticles("export", ["react-tailwind-export"])[0]?.slug)
      .toBe("react-tailwind-export");
    expect(searchHelpArticles("not-a-real-article")).toEqual([]);
  });

  it("creates and parses desktop and browser deep links", () => {
    const link = createHelpDeepLink("device-frames");
    expect(link).toBe("protoflow://docs/device-frames");
    expect(parseHelpDeepLink(link)).toBe("device-frames");
    expect(parseHelpDeepLink("https://example.test/#docs/device-frames")).toBe("device-frames");
    expect(parseHelpDeepLink("protoflow://auth/verify")).toBeNull();
    expect(parseHelpDeepLink("not a url")).toBeNull();
  });

  it("extracts a table of contents from headings and resolves article slugs", () => {
    const article = getHelpArticle("faq");
    expect(article).toBeDefined();
    expect(getHelpToc(article!.markdown).map((heading) => heading.text)).toContain("Is ProtoFlow free?");
    expect(getHelpArticle("missing-article")).toBeUndefined();
  });
});
