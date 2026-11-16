import { describe, expect, it } from "vitest";
import { avatarInitials } from "./avatarInitials";

describe("avatar initials (B73)", () => {
  it("follow the person's name", () => {
    expect(avatarInitials({ label: "Sara Khan" })).toBe("SK");
    expect(avatarInitials({ label: "omar" })).toBe("O");
    expect(avatarInitials({ label: "" })).toBe("U");
  });
  it("use the initials the user typed", () => {
    expect(avatarInitials({ label: "Sara Khan", initials: "ZA" })).toBe("ZA");
    expect(avatarInitials({ label: "Sara Khan", initials: "  " })).toBe("SK");
  });
});
