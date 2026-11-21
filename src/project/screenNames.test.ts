import { describe, expect, it } from "vitest";
import { nextScreenName } from "./screenNames";

const named = (...names: string[]) => names.map((name) => ({ name }));

describe("nextScreenName (B60)", () => {
  it("numbers new screens after the existing ones", () => {
    expect(nextScreenName(named("Screen 1"))).toBe("Screen 2");
    expect(nextScreenName(named("Screen 1", "Screen 2"))).toBe("Screen 3");
  });

  it("skips a name that is already used, ignoring case and spaces", () => {
    // Two screens exist, so the next candidate is "Screen 3", which is taken, so it moves on to "Screen 4".
    expect(nextScreenName(named("Screen 1", " screen 3 "))).toBe("Screen 4");
  });

  it("works when screens were renamed or deleted", () => {
    expect(nextScreenName(named("Home", "Checkout"))).toBe("Screen 3");
    expect(nextScreenName(named("Home", "Screen 3"))).toBe("Screen 4");
    expect(nextScreenName([])).toBe("Screen 1");
  });
});
