export interface VirtualRowRange {
  startIndex: number;
  endIndex: number;
  offset: number;
  totalExtent: number;
}

export function getVirtualRowRange(
  rowCount: number,
  rowStride: number,
  scrollOffset: number,
  viewportExtent: number,
  overscan = 2,
): VirtualRowRange {
  if (
    !Number.isInteger(rowCount) ||
    rowCount < 0 ||
    !Number.isFinite(rowStride) ||
    rowStride <= 0 ||
    !Number.isFinite(scrollOffset) ||
    !Number.isFinite(viewportExtent) ||
    viewportExtent < 0 ||
    !Number.isInteger(overscan) ||
    overscan < 0
  ) {
    throw new RangeError("Virtual row dimensions must be finite and non-negative.");
  }
  const firstVisible = Math.floor(Math.max(0, scrollOffset) / rowStride);
  const lastVisible = Math.ceil((Math.max(0, scrollOffset) + viewportExtent) / rowStride);
  const startIndex = Math.min(rowCount, Math.max(0, firstVisible - overscan));
  const endIndex = Math.min(rowCount, lastVisible + overscan);
  return {
    startIndex,
    endIndex,
    offset: startIndex * rowStride,
    totalExtent: rowCount * rowStride,
  };
}
