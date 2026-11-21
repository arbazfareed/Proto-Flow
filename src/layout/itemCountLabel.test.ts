import { describe, expect, it } from "vitest";
import { itemCountLabel } from "./itemCountLabel";

describe("itemCountLabel (B55)", () => {
  it("uses the singular for exactly one item", () => {
    expect(itemCountLabel(1)).toBe("1 item");
  });
  it("uses the plural for zero and many", () => {
    expect(itemCountLabel(0)).toBe("0 items");
    expect(itemCountLabel(2)).toBe("2 items");
    expect(itemCountLabel(120)).toBe("120 items");
  });
});
