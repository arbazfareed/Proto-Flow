export const BETA_FEEDBACK_URL =
  "https://github.com/arbazfareed/Proto-Flow/issues/new?template=beta-feedback.yml";

export function createHelpFeedbackUrl(
  articleTitle: string,
  slug: string,
  comment: string,
): string {
  const url = new URL(BETA_FEEDBACK_URL);
  url.searchParams.set("title", `[Docs] ${articleTitle}`);
  url.searchParams.set(
    "body",
    [
      `Documentation article: ${articleTitle} (${slug})`,
      "",
      "Was this article helpful? No",
      "",
      "Feedback:",
      comment.trim() || "No additional comment provided.",
      "",
      "This draft was opened from ProtoFlow Help. Please review it before submitting.",
    ].join("\n"),
  );
  return url.toString();
}
