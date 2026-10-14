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
  if (!Number.isFinite(totalCount) || totalCount <= 0 || !Number.isFinite(rowHeight) || rowHeight <= 0) {
    return { start: 0, end: 0, topSpacerHeight: 0, bottomSpacerHeight: 0 };
  }
  const itemCount = Math.floor(totalCount);
  const safeViewportHeight = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  const safeScrollTop = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const safeOverscan = Number.isFinite(overscan) ? Math.max(0, Math.floor(overscan)) : 0;
  const maxScrollTop = Math.max(0, itemCount * rowHeight - safeViewportHeight);
  const normalizedScrollTop = Math.min(safeScrollTop, maxScrollTop);
  const start = Math.min(itemCount, Math.max(0, Math.floor(normalizedScrollTop / rowHeight) - safeOverscan));
  const visibleCount = Math.ceil(safeViewportHeight / rowHeight) + safeOverscan * 2;
  const end = Math.min(itemCount, start + visibleCount);
  return {
    start,
    end,
    topSpacerHeight: start * rowHeight,
    bottomSpacerHeight: (itemCount - end) * rowHeight,
  };
}
