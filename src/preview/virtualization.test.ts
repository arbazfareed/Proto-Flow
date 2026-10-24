import { describe, expect, it } from "vitest";
import { getVirtualRowRange } from "./virtualization";

describe("preview row virtualization", () => {
  it("keeps only visible rows plus overscan mounted for a large repeater", () => {
    const range = getVirtualRowRange(500, 52, 10_400, 520);

    expect(range).toEqual({
      startIndex: 198,
      endIndex: 212,
      offset: 10_296,
      totalExtent: 26_000,
    });
  });

  it("clips the overscan range at the start and end of a dataset", () => {
    expect(getVirtualRowRange(500, 52, 0, 104)).toMatchObject({
      startIndex: 0,
      endIndex: 4,
      offset: 0,
    });
    expect(getVirtualRowRange(500, 52, 25_948, 520)).toMatchObject({
      startIndex: 497,
      endIndex: 500,
    });
  });

  it("rejects invalid geometry rather than returning an invalid range", () => {
    expect(() => getVirtualRowRange(5, 0, 0, 100)).toThrow(RangeError);
  });
});
