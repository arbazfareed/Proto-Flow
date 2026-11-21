import { describe, expect, it } from "vitest";
import { matchesElementQuery } from "./elementSearch";

describe("matchesElementQuery (B14)", () => {
  it("matches everything while the search is empty", () => {
    expect(matchesElementQuery("Desktop screen", "")).toBe(true);
    expect(matchesElementQuery("Desktop screen", "   ")).toBe(true);
  });

  it("ignores case and surrounding spaces", () => {
    expect(matchesElementQuery("Mobile screen", " MOBILE ")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(matchesElementQuery("desktop Desktop screen", "text")).toBe(false);
    expect(matchesElementQuery("import image url link", "text")).toBe(false);
  });

  it("still finds screens by words people use", () => {
    expect(matchesElementQuery("phone Mobile screen", "phone")).toBe(true);
    expect(matchesElementQuery("tablet Tablet screen", "screen")).toBe(true);
  });
});
