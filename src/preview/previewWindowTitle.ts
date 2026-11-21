// B69: the Preview window used the same page title as the editor ("ProtoFlow"), so the two were
// hard to tell apart in the taskbar or tab list. The title now always says "Preview".
export const PREVIEW_WINDOW_BASE_TITLE = "ProtoFlow Preview";

export function previewWindowTitle(projectName?: string | null): string {
  const name = projectName?.trim();
  return name ? `${name} · ${PREVIEW_WINDOW_BASE_TITLE}` : PREVIEW_WINDOW_BASE_TITLE;
}
