export interface HelpHeading {
  id: string;
  level: number;
  text: string;
}

export interface HelpArticle {
  slug: string;
  title: string;
  category: string;
  categoryOrder: number;
  markdown: string;
  headings: HelpHeading[];
  searchText: string;
}

const markdownFiles = import.meta.glob<string>("../../docs/help/**/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

function headingId(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[`*_]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

function displayCategory(directory: string): string {
  return directory.replace(/^\d+-/, "").replaceAll("-", " ");
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseArticle(path: string, markdown: string): HelpArticle {
  const match = path.match(/\/docs\/help\/([^/]+)\/([^/]+)\.md$/);
  if (!match) throw new Error(`Help article has an invalid path: ${path}`);

  const headings = [...markdown.matchAll(/^(#{1,3})\s+(.+)$/gm)].map((heading) => ({
    id: headingId(heading[2]),
    level: heading[1].length,
    text: heading[2].trim(),
  }));
  const title = headings[0]?.text;
  if (!title) throw new Error(`Help article is missing a title: ${path}`);

  return {
    slug: match[2],
    title,
    category: titleCase(displayCategory(match[1])),
    categoryOrder: Number.parseInt(match[1], 10) || Number.MAX_SAFE_INTEGER,
    markdown,
    headings: headings.slice(1),
    searchText: `${title} ${headings.map((heading) => heading.text).join(" ")} ${markdown}`
      .toLowerCase(),
  };
}

export const HELP_ARTICLES = Object.entries(markdownFiles)
  .map(([path, markdown]) => parseArticle(path, markdown))
  .sort((left, right) =>
    left.categoryOrder - right.categoryOrder || left.title.localeCompare(right.title),
  );

export const HELP_CATEGORIES = [...new Set(HELP_ARTICLES.map((article) => article.category))];

export function getHelpArticle(slug: string | null | undefined): HelpArticle | undefined {
  return slug ? HELP_ARTICLES.find((article) => article.slug === slug) : undefined;
}

export function searchHelpArticles(
  query: string,
  recentSlugs: readonly string[] = [],
): HelpArticle[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return HELP_ARTICLES;

  return HELP_ARTICLES
    .map((article) => {
      const title = article.title.toLowerCase();
      const headings = article.headings.map((heading) => heading.text.toLowerCase()).join(" ");
      const relevance = terms.reduce((total, term) => {
        if (title === term) return total + 12;
        if (title.includes(term)) return total + 7;
        if (headings.includes(term)) return total + 4;
        if (article.searchText.includes(term)) return total + 1;
        return total;
      }, 0);
      const recentIndex = recentSlugs.indexOf(article.slug);
      const recency = recentIndex < 0 ? 0 : Math.max(0, 3 - recentIndex);
      return { article, score: relevance + recency };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) =>
      right.score - left.score || left.article.title.localeCompare(right.article.title),
    )
    .map(({ article }) => article);
}

export function parseHelpDeepLink(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol === "protoflow:" && url.hostname === "docs") {
      const slug = url.pathname.split("/").filter(Boolean)[0];
      return slug ? decodeURIComponent(slug) : null;
    }
    if (url.hash.startsWith("#docs/")) {
      return decodeURIComponent(url.hash.slice("#docs/".length)) || null;
    }
  } catch {
    return null;
  }
  return null;
}

export function createHelpDeepLink(slug: string): string {
  return `protoflow://docs/${encodeURIComponent(slug)}`;
}

export function getHelpToc(markdown: string): HelpHeading[] {
  return [...markdown.matchAll(/^(#{2,3})\s+(.+)$/gm)].map((heading) => ({
    id: headingId(heading[2]),
    level: heading[1].length,
    text: heading[2].trim(),
  }));
}
