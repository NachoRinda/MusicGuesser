import { useEffect, useState } from "react";

/**
 * Seconds left, counted locally from the `remainingMs` of the last state. `stamp` changes with every
 * new state (so a new stage restarts the count) — the server clock is never compared to ours.
 */
export function useCountdown(remainingMs: number, stamp: unknown): number {
  const [left, setLeft] = useState(Math.ceil(remainingMs / 1000));
  useEffect(() => {
    const endsAt = performance.now() + remainingMs;
    const tick = () => setLeft(Math.max(0, Math.ceil((endsAt - performance.now()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [remainingMs, stamp]);
  return left;
}
