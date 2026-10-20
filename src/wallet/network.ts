export type NetworkStatus = "checking" | "online" | "offline";

const ONLINE_INTERVAL_MS = 30_000;
const FAILURE_BACKOFF_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000] as const;

export function startNetworkMonitor(
  check: () => Promise<boolean>,
  onStatus: (status: NetworkStatus) => void,
  onReconnect: () => void,
): () => void {
  let stopped = false;
  let running = false;
  let runImmediately = false;
  let failures = 0;
  let reachable: boolean | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = null;
      void poll();
    }, delay);
  };

  const poll = async () => {
    if (stopped || running) return;
    running = true;
    if (reachable === null) onStatus("checking");
    let isReachable = false;
    try {
      isReachable = await check();
    } catch (error) {
      console.error("Cloud health check failed unexpectedly.", error);
    }
    if (stopped) {
      running = false;
      return;
    }
    const wasReachable = reachable;
    reachable = isReachable;
    onStatus(isReachable ? "online" : "offline");
    if (isReachable) {
      failures = 0;
      if (wasReachable === false) onReconnect();
    } else {
      failures += 1;
    }
    running = false;

    if (runImmediately) {
      runImmediately = false;
      schedule(0);
    } else {
      schedule(
        isReachable
          ? ONLINE_INTERVAL_MS
          : FAILURE_BACKOFF_MS[Math.min(failures - 1, FAILURE_BACKOFF_MS.length - 1)],
      );
    }
  };

  const refreshNow = () => {
    if (running) {
      runImmediately = true;
      return;
    }
    if (timer !== null) clearTimeout(timer);
    schedule(0);
  };

  window.addEventListener("online", refreshNow);
  window.addEventListener("offline", refreshNow);
  void poll();

  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    window.removeEventListener("online", refreshNow);
    window.removeEventListener("offline", refreshNow);
  };
}
