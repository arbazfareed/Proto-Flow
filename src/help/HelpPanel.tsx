import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, Search, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { createHelpFeedbackUrl } from "../beta/feedback";
import {
  createHelpDeepLink,
  getHelpArticle,
  getHelpToc,
  HELP_ARTICLES,
  HELP_CATEGORIES,
  searchHelpArticles,
} from "./docs";
import { HELP_NAVIGATION_EVENT, requestHelp } from "./navigation";
import "./HelpPanel.css";

interface HelpNavigationDetail {
  slug?: string;
}

interface HelpPanelProps {
  initialSlug?: string;
  onClose: () => void;
  onOpenTutorial: () => void;
  onNotify: (message: string, isError?: boolean) => void;
}

function inlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenPattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let start = 0;
  for (const match of text.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > start) nodes.push(text.slice(start, index));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(<strong key={`${index}-strong`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={`${index}-code`}>{token.slice(1, -1)}</code>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        if (link[2].startsWith("help:") && getHelpArticle(link[2].slice("help:".length))) {
          nodes.push(
            <button
              key={`${index}-help-link`}
              type="button"
              className="help-inline-doc-link"
              onClick={() => requestHelp(link[2].slice("help:".length))}
            >{link[1]}</button>,
          );
          start = index + token.length;
          continue;
        }
        let safeHref: string | null = null;
        try {
          const parsed = new URL(link[2], window.location.href);
          if (["https:", "http:", "mailto:"].includes(parsed.protocol)) safeHref = link[2];
        } catch {
          safeHref = null;
        }
        nodes.push(safeHref
          ? <a key={`${index}-link`} href={safeHref} target="_blank" rel="noreferrer">{link[1]}</a>
          : link[1]);
      }
    }
    start = index + token.length;
  }
  if (start < text.length) nodes.push(text.slice(start));
  return nodes;
}

function markdownTableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isMarkdownTableDivider(line: string): boolean {
  const cells = markdownTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function MarkdownArticle({ markdown, onCopyCode }: {
  markdown: string;
  onCopyCode: (code: string) => void;
}) {
  const lines = markdown.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      const code = codeLines.join("\n");
      blocks.push(
        <div className="help-code-block" key={`code-${index}`}>
          <pre><code>{code}</code></pre>
          <button type="button" className="help-copy-code" onClick={() => onCopyCode(code)}>
            <Copy size={12} /> Copy
          </button>
        </div>,
      );
      index += 1;
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && isMarkdownTableDivider(lines[index + 1])) {
      const headers = markdownTableCells(line);
      const alignments = markdownTableCells(lines[index + 1]).map((cell) =>
        cell.startsWith(":") && cell.endsWith(":")
          ? "center" as const
          : cell.endsWith(":")
            ? "right" as const
            : "left" as const,
      );
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(markdownTableCells(lines[index]));
        index += 1;
      }
      blocks.push(
        <div className="help-table-scroll" key={`table-${index}`}>
          <table className="help-table">
            <thead>
              <tr>
                {headers.map((header, column) => (
                  <th key={`header-${column}`} scope="col" style={{ textAlign: alignments[column] }}>
                    {inlineMarkdown(header)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {headers.map((_, column) => (
                    <td key={`cell-${column}`} style={{ textAlign: alignments[column] }}>
                      {inlineMarkdown(row[column] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const content = heading[2];
      const id = content.toLowerCase().trim().replace(/[`*_]/g, "")
        .replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-");
      const Heading = `h${level}` as "h1" | "h2" | "h3";
      blocks.push(<Heading id={id} key={`heading-${index}`}>{inlineMarkdown(content)}</Heading>);
      index += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(<li key={`list-${index}`}>{inlineMarkdown(lines[index].replace(/^\s*[-*]\s+/, ""))}</li>);
        index += 1;
      }
      blocks.push(<ul key={`ul-${index}`}>{items}</ul>);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(<li key={`ordered-${index}`}>{inlineMarkdown(lines[index].replace(/^\s*\d+\.\s+/, ""))}</li>);
        index += 1;
      }
      blocks.push(<ol key={`ol-${index}`}>{items}</ol>);
      continue;
    }
    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() &&
      !/^(#{1,3}\s|```|\s*[-*]\s+|\s*\d+\.\s+)/.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{inlineMarkdown(paragraph.join(" "))}</p>);
  }
  return <div className="help-article-body">{blocks}</div>;
}

function readFeedback(): Record<string, "yes" | "no"> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem("protoflow:help-feedback") ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, "yes" | "no"] =>
        entry[1] === "yes" || entry[1] === "no",
      ),
    );
  } catch (error) {
    console.error("Could not read help feedback.", error);
    return {};
  }
}

function saveFeedback(slug: string, rating: "yes" | "no"): void {
  const feedback = readFeedback();
  feedback[slug] = rating;
  localStorage.setItem("protoflow:help-feedback", JSON.stringify(feedback));
}

export function HelpPanel({ initialSlug, onClose, onOpenTutorial, onNotify }: HelpPanelProps) {
  const [selectedSlug, setSelectedSlug] = useState(initialSlug ?? HELP_ARTICLES[0]?.slug ?? "");
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState(readFeedback);
  const [comment, setComment] = useState("");
  const [commentSubmitted, setCommentSubmitted] = useState(false);
  const [recentSlugs, setRecentSlugs] = useState<string[]>([]);
  const panelRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const article = getHelpArticle(selectedSlug) ?? HELP_ARTICLES[0];
  const results = useMemo(() => searchHelpArticles(query, recentSlugs), [query, recentSlugs]);
  const toc = useMemo(() => getHelpToc(article?.markdown ?? ""), [article]);
  const selectedIndex = HELP_ARTICLES.findIndex((item) => item.slug === article?.slug);
  const categories = useMemo(
    () => HELP_CATEGORIES.map((category) => ({
      category,
      articles: HELP_ARTICLES.filter((item) => item.category === category),
    })),
    [],
  );

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    searchRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      )].filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panelRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey &&
        (document.activeElement === last || !panelRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose]);

  useEffect(() => {
    const openFromContext = (event: Event) => {
      const slug = (event as CustomEvent<HelpNavigationDetail>).detail?.slug;
      if (slug && getHelpArticle(slug)) {
        selectArticle(slug);
        setQuery("");
      }
    };
    window.addEventListener(HELP_NAVIGATION_EVENT, openFromContext);
    return () => window.removeEventListener(HELP_NAVIGATION_EVENT, openFromContext);
  }, []);

  useEffect(() => {
    if (!article) return;
    setComment("");
    setCommentSubmitted(false);
  }, [article?.slug]);

  useEffect(() => {
    if (initialSlug && getHelpArticle(initialSlug)) {
      setSelectedSlug(initialSlug);
      setQuery("");
    }
  }, [initialSlug]);

  const selectArticle = (slug: string) => {
    setSelectedSlug(slug);
    setRecentSlugs((current) => [slug, ...current.filter((item) => item !== slug)].slice(0, 10));
  };

  const copyText = async (value: string, success: string) => {
    try {
      await navigator.clipboard.writeText(value);
      onNotify(success);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not copy to clipboard.", true);
    }
  };

  const rateArticle = (rating: "yes" | "no") => {
    try {
      saveFeedback(article.slug, rating);
      setFeedback((current) => ({ ...current, [article.slug]: rating }));
      setCommentSubmitted(rating === "yes");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not save your feedback.", true);
    }
  };

  const submitComment = () => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem("protoflow:help-feedback-comments") ?? "{}");
      const saved = value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
          Object.entries(value).filter((entry): entry is [string, string] =>
            typeof entry[1] === "string",
          ),
        )
        : {};
      saved[article.slug] = comment.trim();
      localStorage.setItem("protoflow:help-feedback-comments", JSON.stringify(saved));
      setCommentSubmitted(true);
      onNotify("Thanks for helping improve this article.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not save your feedback.", true);
    }
  };

  const openFeedbackDraft = async () => {
    const url = createHelpFeedbackUrl(article.title, article.slug, comment);
    try {
      if (isTauri()) {
        await openExternal(url);
      } else if (!window.open(url, "_blank", "noopener,noreferrer")) {
        throw new Error("Could not open the GitHub feedback draft.");
      }
      onNotify("GitHub issue draft opened. Review it before submitting.");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not open the GitHub feedback draft.", true);
    }
  };

  if (!article) return null;

  const articleLink = isTauri()
    ? createHelpDeepLink(article.slug)
    : `${window.location.origin}${window.location.pathname}#docs/${encodeURIComponent(article.slug)}`;

  return (
    <div className="help-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={panelRef}
        className="help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        tabIndex={-1}
      >
        <header className="help-header">
          <div>
            <span className="inspector-overline">OFFLINE HELP</span>
            <h2 id="help-title">Help &amp; documentation</h2>
          </div>
          <div className="help-header-actions">
            <button type="button" className="help-copy-link" onClick={() =>
              void copyText(articleLink, "Deep link copied.")
            }><Copy size={13} /> Copy link</button>
            <button type="button" className="icon-button small-icon" aria-label="Close help" onClick={onClose}>
              <X size={15} />
            </button>
          </div>
        </header>
        <div className="help-search">
          <Search size={15} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            aria-label="Search help articles"
            placeholder="Search guides, features, and questions…"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <kbd>F1</kbd>
        </div>
        <div className="help-layout">
          <nav className="help-sidebar" aria-label="Help articles">
            {query ? (
              <div className="help-search-results" role="list">
                <span className="help-nav-label">{results.length} RESULTS</span>
                {results.map((result) => (
                  <button
                    type="button"
                    role="listitem"
                    key={result.slug}
                    className={`help-nav-article${result.slug === article.slug ? " is-active" : ""}`}
                    onClick={() => selectArticle(result.slug)}
                  >
                    <strong>{result.title}</strong><span>{result.category}</span>
                  </button>
                ))}
                {results.length === 0 && <p className="help-empty">No articles match. Try another term.</p>}
              </div>
            ) : categories.map(({ category, articles }) => (
              <section className="help-nav-category" key={category}>
                <span className="help-nav-label">{category}</span>
                {articles.map((item) => (
                  <button
                    type="button"
                    className={`help-nav-article${item.slug === article.slug ? " is-active" : ""}`}
                    key={item.slug}
                    onClick={() => selectArticle(item.slug)}
                  >
                    <strong>{item.title}</strong>
                  </button>
                ))}
              </section>
            ))}
          </nav>
          <main className="help-content" key={article.slug}>
            <div className="help-breadcrumb">{article.category} <span>/</span> {article.title}</div>
            <div className="help-article-toolbar">
              <div className="help-article-title">
                <h1>{article.title}</h1>
                <span>Bundled with this app · available offline</span>
              </div>
              {toc.length > 0 && (
                <details className="help-toc">
                  <summary>On this page</summary>
                  <nav aria-label="Table of contents">
                    {toc.map((heading) => (
                      <a
                        key={heading.id}
                        className={heading.level === 3 ? "is-nested" : ""}
                        href={`#${heading.id}`}
                      >{heading.text}</a>
                    ))}
                  </nav>
                </details>
              )}
            </div>
            <MarkdownArticle
              markdown={article.markdown.replace(/^#\s+.+\r?\n?/, "")}
              onCopyCode={(code) => void copyText(code, "Code copied.")}
            />
            <section className="help-feedback" aria-label="Article feedback">
              <div>
                <strong>Was this article helpful?</strong>
                <span>Your response stays on this device unless you choose to open a public issue draft.</span>
              </div>
              <div className="help-feedback-actions">
                <button
                  type="button"
                  className={feedback[article.slug] === "yes" ? "is-selected" : ""}
                  aria-pressed={feedback[article.slug] === "yes"}
                  onClick={() => rateArticle("yes")}
                ><ThumbsUp size={14} /> Yes</button>
                <button
                  type="button"
                  className={feedback[article.slug] === "no" ? "is-selected" : ""}
                  aria-pressed={feedback[article.slug] === "no"}
                  onClick={() => rateArticle("no")}
                ><ThumbsDown size={14} /> No</button>
              </div>
              {feedback[article.slug] === "no" && !commentSubmitted && (
                <div className="help-feedback-comment">
                  <label htmlFor="help-feedback-comment">What could be clearer? (optional)</label>
                  <textarea
                    id="help-feedback-comment"
                    rows={3}
                    maxLength={1000}
                    value={comment}
                    onChange={(event) => setComment(event.currentTarget.value)}
                  />
                  <button type="button" className="button button-secondary" onClick={submitComment}>
                    Save feedback on this device
                  </button>
                  <button type="button" className="button button-quiet" onClick={() => void openFeedbackDraft()}>
                    Open GitHub issue draft
                  </button>
                </div>
              )}
              {feedback[article.slug] === "no" && commentSubmitted && (
                <button type="button" className="button button-quiet" onClick={() => void openFeedbackDraft()}>
                  Open GitHub issue draft
                </button>
              )}
              {commentSubmitted && (
                <p className="help-feedback-thanks"><Check size={13} /> Thanks for your feedback.</p>
              )}
            </section>
            <footer className="help-pagination">
              <button
                type="button"
                disabled={selectedIndex <= 0}
                onClick={() => selectArticle(HELP_ARTICLES[selectedIndex - 1].slug)}
              ><ChevronLeft size={14} /> Previous</button>
              <button
                type="button"
                disabled={selectedIndex >= HELP_ARTICLES.length - 1}
                onClick={() => selectArticle(HELP_ARTICLES[selectedIndex + 1].slug)}
              >Next <ChevronRight size={14} /></button>
            </footer>
          </main>
        </div>
        <footer className="help-panel-footer">
          <span>{HELP_ARTICLES.length} guides · Search and read offline</span>
          <div className="help-panel-footer-actions">
            <button type="button" onClick={() => {
              onClose();
              onOpenTutorial();
            }}>
              Start interactive tutorial
            </button>
            <button type="button" onClick={() => void copyText(articleLink, "Deep link copied.")}>
              <Copy size={12} /> Copy deep link
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
