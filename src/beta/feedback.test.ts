import { describe, expect, it } from "vitest";
import { BETA_FEEDBACK_URL, createHelpFeedbackUrl } from "./feedback";

describe("beta feedback link", () => {
  it("opens the dedicated GitHub beta feedback form without adding project data", () => {
    const url = new URL(BETA_FEEDBACK_URL);

    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/arbazfareed/Proto-Flow/issues/new");
    expect(url.searchParams.get("template")).toBe("beta-feedback.yml");
    expect(url.searchParams.size).toBe(1);
  });

  it("creates an editable documentation-feedback issue draft", () => {
    const url = new URL(createHelpFeedbackUrl(
      "Device frames",
      "device-frames",
      "Please explain custom safe-area values.",
    ));

    expect(url.searchParams.get("template")).toBe("beta-feedback.yml");
    expect(url.searchParams.get("title")).toBe("[Docs] Device frames");
    expect(url.searchParams.get("body")).toContain("device-frames");
    expect(url.searchParams.get("body")).toContain("Please explain custom safe-area values.");
    expect(new URL(createHelpFeedbackUrl("FAQ", "faq", "  ")).searchParams.get("body"))
      .toContain("No additional comment provided.");
  });
});
