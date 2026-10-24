import { describe, expect, it } from "vitest";
import { BETA_FEEDBACK_URL } from "./feedback";

describe("beta feedback link", () => {
  it("opens the dedicated GitHub beta feedback form without adding project data", () => {
    const url = new URL(BETA_FEEDBACK_URL);

    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/arbazfareed/Proto-Flow/issues/new");
    expect(url.searchParams.get("template")).toBe("beta-feedback.yml");
    expect(url.searchParams.size).toBe(1);
  });
});
