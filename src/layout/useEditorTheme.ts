import { useEffect, useState } from "react";

export type EditorTheme = "light" | "dark";

function readEditorTheme(): EditorTheme {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "light"
    ? "light"
    : "dark";
}

/** The resolved editor theme, kept in sync with <html data-theme>, for canvas drawing. */
export function useEditorTheme(): EditorTheme {
  const [theme, setTheme] = useState(readEditorTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readEditorTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    setTheme(readEditorTheme());
    return () => observer.disconnect();
  }, []);
  return theme;
}
