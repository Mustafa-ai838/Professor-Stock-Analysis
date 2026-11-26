import { useEffect } from "react";

const pollIntervalSeconds = Number(import.meta.env.VITE_FRONTEND_POLL_INTERVAL ?? "15");
if (!Number.isFinite(pollIntervalSeconds) || pollIntervalSeconds < 1) {
  throw new Error("VITE_FRONTEND_POLL_INTERVAL must be a number of at least one second.");
}

export function usePolling(callback: () => Promise<void>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let inFlight = false;

    async function refresh(force = false) {
      if (!active || (!force && document.hidden) || inFlight) return;
      inFlight = true;
      try {
        await callback();
      } catch (error) {
        console.error("Market data refresh failed.", error);
      } finally {
        inFlight = false;
      }
    }

    const onVisibilityChange = () => {
      if (!document.hidden) void refresh(true);
    };

    void refresh(true);
    const timer = window.setInterval(() => void refresh(), pollIntervalSeconds * 1000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [callback, enabled]);
}
