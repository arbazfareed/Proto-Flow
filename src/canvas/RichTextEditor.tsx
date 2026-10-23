import { useEffect, useRef, useState } from "react";
import {
  Bold,
  Code2,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Strikethrough,
  Underline,
  Unlink,
} from "lucide-react";
import type { CSSProperties } from "react";
import type { RichTextRun } from "../project/schema";
import {
  normalizeRichTextRuns,
  parseRichTextMarkdown,
  richTextHtmlToRuns,
  richTextRunsToHtml,
  richTextRunsToPlainText,
  richTextContrastRatio,
  sanitizeRichTextHref,
} from "../project/richText";
import { MAX_WIDGET_TEXT_LENGTH } from "./textMeasurement";

type RichTextEditorProps = {
  label: string;
  text: string;
  runs: unknown;
  style: CSSProperties;
  contrastBackground: string;
  onCommit: (runs: RichTextRun[]) => void;
  onCancel: () => void;
};

const INLINE_COMMANDS = [
  { command: "bold", label: "Bold", shortcut: "Ctrl+B", icon: Bold },
  { command: "italic", label: "Italic", shortcut: "Ctrl+I", icon: Italic },
  { command: "underline", label: "Underline", shortcut: "Ctrl+U", icon: Underline },
  { command: "strikeThrough", label: "Strikethrough", shortcut: "Ctrl+Shift+X", icon: Strikethrough },
] as const;

function insertMark(tagName: string, styleName?: string, styleValue?: string): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const wrapper = document.createElement(tagName);
  if (styleName && styleValue) wrapper.style.setProperty(styleName, styleValue);
  wrapper.append(range.extractContents());
  range.insertNode(wrapper);
  range.selectNodeContents(wrapper);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function RichTextEditor({
  label,
  text,
  runs,
  style,
  contrastBackground,
  onCommit,
  onCancel,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [contrastWarning, setContrastWarning] = useState("");
  const initialRuns = normalizeRichTextRuns(runs, text);
  const [contentRuns, setContentRuns] = useState<RichTextRun[]>(() =>
    Array.isArray(runs) ? initialRuns : parseRichTextMarkdown(text),
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (editor) editor.innerHTML = richTextRunsToHtml(contentRuns);
  }, []);

  const rememberSelection = () => {
    const selection = window.getSelection();
    if (!selection || !editorRef.current?.contains(selection.anchorNode)) return;
    selectionRef.current = selection.getRangeAt(0).cloneRange();
  };
  const restoreSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection) return false;
    editor.focus();
    if (selectionRef.current) {
      selection.removeAllRanges();
      selection.addRange(selectionRef.current);
    }
    return true;
  };
  const runCommand = (command: string, value?: string) => {
    if (!restoreSelection()) return;
    document.execCommand(command, false, value);
    rememberSelection();
    if (editorRef.current) setContentRuns(richTextHtmlToRuns(editorRef.current.innerHTML));
  };
  const wrapSelection = (tagName: string, styleName?: string, styleValue?: string) => {
    if (!restoreSelection()) return;
    insertMark(tagName, styleName, styleValue);
    if (editorRef.current) setContentRuns(richTextHtmlToRuns(editorRef.current.innerHTML));
  };

  return (
    <div
      className="rich-text-editor-overlay"
      style={style}
      onMouseDown={(event) => {
        event.stopPropagation();
        if ((event.target as HTMLElement).closest("button, input, select")) {
          rememberSelection();
        }
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        onCommit(contentRuns);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
          return;
        }
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey) {
          const command = event.key.toLowerCase();
          if (command === "b" || command === "i" || command === "u") {
            event.preventDefault();
            runCommand(command === "b" ? "bold" : command === "i" ? "italic" : "underline");
          } else if (command === "k") {
            event.preventDefault();
            rememberSelection();
            setLinkOpen((open) => !open);
          }
        }
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "x") {
          event.preventDefault();
          runCommand("strikeThrough");
        }
      }}
    >
      <div className="rich-text-floating-toolbar" role="toolbar" aria-label="Rich text formatting">
        {INLINE_COMMANDS.map(({ command, label: commandLabel, shortcut, icon: Icon }) => (
          <button
            key={command}
            type="button"
            aria-label={commandLabel}
            title={`${commandLabel} (${shortcut})`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runCommand(command)}
          ><Icon size={13} /></button>
        ))}
        <button type="button" aria-label="Inline code" title="Inline code" onMouseDown={(event) => event.preventDefault()} onClick={() => wrapSelection("code")}>
          <Code2 size={13} />
        </button>
        <button type="button" aria-label="Highlight" title="Highlight" onMouseDown={(event) => event.preventDefault()} onClick={() => wrapSelection("mark", "background-color", "#fff2a8")}>
          <Highlighter size={13} />
        </button>
        <button type="button" aria-label="Bullet list" title="Bullet list" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("insertUnorderedList")}>
          <List size={13} />
        </button>
        <button type="button" aria-label="Numbered list" title="Numbered list" onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("insertOrderedList")}>
          <ListOrdered size={13} />
        </button>
        <button
          type="button"
          aria-label={linkOpen ? "Close link editor" : "Insert link"}
          title="Insert link (Ctrl+K)"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            rememberSelection();
            setLinkOpen((open) => !open);
          }}
        ><Link2 size={13} /></button>
        <label className="rich-text-color" title="Text color">
          <span className="sr-only">Text color</span>
          <input type="color" aria-label="Text color" defaultValue="#24212b" onChange={(event) => {
            const color = event.currentTarget.value;
            wrapSelection("span", "color", color);
            const ratio = richTextContrastRatio(color, contrastBackground);
            setContrastWarning(ratio !== null && ratio < 4.5
              ? `Low contrast: ${ratio.toFixed(1)}:1; use at least 4.5:1 for normal text.`
              : "");
          }} />
        </label>
        <label className="rich-text-size" title="Run font size">
          <span className="sr-only">Run font size</span>
          <select aria-label="Run font size" defaultValue="" onChange={(event) => {
            if (event.currentTarget.value && restoreSelection()) {
              wrapSelection("span", "font-size", `${event.currentTarget.value}px`);
            }
            event.currentTarget.value = "";
          }}>
            <option value="">Size</option>
            {[12, 14, 16, 18, 24, 32, 48].map((size) => <option key={size} value={size}>{size}px</option>)}
          </select>
        </label>
      </div>
      {contrastWarning && <output className="rich-text-contrast-warning" role="status">{contrastWarning}</output>}
      {linkOpen && (
        <form className="rich-text-link-editor" onSubmit={(event) => {
          event.preventDefault();
          const href = sanitizeRichTextHref(linkValue);
          if (!href) return;
          runCommand("createLink", href);
          setLinkOpen(false);
          setLinkValue("");
        }}>
          <input
            aria-label="Link URL"
            autoFocus
            placeholder="https:// or mailto:"
            value={linkValue}
            onChange={(event) => setLinkValue(event.currentTarget.value)}
          />
          <button type="submit" aria-label="Apply link" disabled={!sanitizeRichTextHref(linkValue)}>Apply</button>
          <button type="button" aria-label="Remove link" onMouseDown={(event) => event.preventDefault()} onClick={() => {
            runCommand("unlink");
            setLinkOpen(false);
          }}><Unlink size={12} /></button>
        </form>
      )}
      <div
        ref={editorRef}
        className="canvas-inline-editor rich-text-canvas-editor"
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        contentEditable
        autoFocus
        suppressContentEditableWarning
        spellCheck
        onInput={(event) => {
          const editor = event.currentTarget;
          const markdown = editor.textContent ?? "";
          const hasMarkup = Boolean(editor.querySelector("strong, em, u, s, code, a, mark, ul, ol, span[style]"));
          if (!hasMarkup && /(?:\*\*[^*\n]+\*\*|\*[^*\n]+\*|__[^_\n]+__|~~[^~\n]+~~|==[^=\n]+==|`[^`\n]+`|\[[^\]\n]+\]\([^)]+\))/.test(markdown)) {
            const parsedMarkdown = parseRichTextMarkdown(markdown);
            if (parsedMarkdown.some((run) => Object.keys(run.marks).length > 0)) {
              editor.innerHTML = richTextRunsToHtml(parsedMarkdown);
              const range = document.createRange();
              range.selectNodeContents(editor);
              range.collapse(false);
              const selection = window.getSelection();
              selection?.removeAllRanges();
              selection?.addRange(range);
              selectionRef.current = range.cloneRange();
              setContentRuns(parsedMarkdown);
              return;
            }
          }
          const next = richTextHtmlToRuns(editor.innerHTML);
          const bounded = normalizeRichTextRuns(next);
          if (richTextRunsToPlainText(bounded).length <= MAX_WIDGET_TEXT_LENGTH) {
            setContentRuns(bounded);
            return;
          }
          editor.innerHTML = richTextRunsToHtml(bounded);
          setContentRuns(bounded);
        }}
        onKeyUp={rememberSelection}
        onMouseUp={rememberSelection}
        onBlur={rememberSelection}
      />
    </div>
  );
}
