/** One bounded, process-wide budget; public reads cannot drain review capacity. */
export function createPublicHistoryBudget() {
  let windowStart = 0;
  let requests = 0;
  let active = 0;
  return (): (() => void) | null => {
    const now = Date.now();
    if (now - windowStart >= 60_000) {
      windowStart = now;
      requests = 0;
    }
    if (requests >= 30 || active >= 2) return null;
    requests += 1;
    active += 1;
    let released = false;
    return () => {
      if (!released) active -= 1;
      released = true;
    };
  };
}
