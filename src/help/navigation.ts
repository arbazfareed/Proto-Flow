export const HELP_NAVIGATION_EVENT = "protoflow:open-help";

export function requestHelp(articleSlug?: string): void {
  window.dispatchEvent(new CustomEvent(HELP_NAVIGATION_EVENT, {
    detail: { slug: articleSlug },
  }));
}
