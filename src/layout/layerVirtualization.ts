export interface VirtualizedRange {
  start: number;
  end: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
}

export function getVirtualizedRange(
  totalCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 2,
): VirtualizedRange {
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(totalCount, start + visibleCount);
  return {
    start,
    end,
    topSpacerHeight: start * rowHeight,
    bottomSpacerHeight: (totalCount - end) * rowHeight,
  };
}
