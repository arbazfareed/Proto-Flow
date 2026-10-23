export interface PreviewMonitor {
  scaleFactor: number;
  workArea: {
    size: {
      width: number;
      height: number;
    };
  };
}

export interface PreviewViewport {
  width: number;
  height: number;
}

const WINDOW_CHROME_MARGIN = 48;

export function fitWindowSizeToMonitor(
  viewport: PreviewViewport,
  monitor: PreviewMonitor | null,
): PreviewViewport {
  if (!monitor || !Number.isFinite(monitor.scaleFactor) || monitor.scaleFactor <= 0) {
    return viewport;
  }

  return {
    width: Math.min(viewport.width, Math.floor(monitor.workArea.size.width / monitor.scaleFactor)),
    height: Math.min(viewport.height, Math.floor(monitor.workArea.size.height / monitor.scaleFactor)),
  };
}

export function getPreviewWindowSize(
  viewport: PreviewViewport,
  monitor: PreviewMonitor | null,
) {
  const desiredWidth = viewport.width + 36;
  const desiredHeight = viewport.height + 108;
  if (!monitor || !Number.isFinite(monitor.scaleFactor) || monitor.scaleFactor <= 0) {
    return { width: desiredWidth, height: desiredHeight };
  }

  const availableWidth = Math.max(
    1,
    monitor.workArea.size.width / monitor.scaleFactor - WINDOW_CHROME_MARGIN,
  );
  const availableHeight = Math.max(
    1,
    monitor.workArea.size.height / monitor.scaleFactor - WINDOW_CHROME_MARGIN,
  );
  return {
    width: Math.min(Math.max(360, desiredWidth), availableWidth),
    height: Math.min(Math.max(320, desiredHeight), availableHeight),
  };
}
