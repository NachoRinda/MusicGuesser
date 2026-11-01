import { useEffect, useState } from "react";

/**
 * Milliseconds left, counted locally from the `remainingMs` of the last state. `stamp` changes with
 * every new state (so a new stage restarts the count) — the server clock is never compared to ours.
 */
export function useCountdown(remainingMs: number, stamp: unknown): number {
  const [left, setLeft] = useState(remainingMs);
  useEffect(() => {
    const endsAt = performance.now() + remainingMs;
    const tick = () => setLeft(Math.max(0, endsAt - performance.now()));
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [remainingMs, stamp]);
  return left;
}
