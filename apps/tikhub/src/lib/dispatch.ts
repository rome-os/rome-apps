/** A denied admission returns a delay without reserving a future send slot. */
export interface DispatchClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}
export const systemDispatchClock: DispatchClock = {
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
};
export const MAX_QUEUE_MS = 30_000;
export class DispatchQueueError extends Error {}

/** Recheck after every wake-up. Invoke send synchronously after admission, with
 * no awaited lease/setup work in between. This governs application dispatch,
 * not provider arrival time under arbitrary OS or network scheduling. */
export async function dispatchWhenReady<T>(
  tryAcquire: () => number,
  send: () => Promise<T>,
  clock: DispatchClock = systemDispatchClock,
): Promise<T> {
  const deadline = clock.now() + MAX_QUEUE_MS;
  for (let waits = 0; waits <= 512; waits++) {
    if (clock.now() > deadline) throw new DispatchQueueError("request queue full");
    const delay = tryAcquire();
    // SQLite lock acquisition can itself outlive the queue deadline.
    if (clock.now() > deadline) throw new DispatchQueueError("request queue full");
    if (!Number.isFinite(delay) || delay < 0) throw new DispatchQueueError("invalid rate state");
    if (delay === 0) return send();
    if (clock.now() + delay > deadline) throw new DispatchQueueError("request queue full");
    await clock.sleep(delay);
  }
  throw new DispatchQueueError("request queue full");
}
