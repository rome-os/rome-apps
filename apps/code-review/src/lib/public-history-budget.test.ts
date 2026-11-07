import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicHistoryBudget } from "./public-history-budget.js";

afterEach(() => vi.useRealTimers());

describe("public visibility lookup budget", () => {
  it("caps concurrent lookups and releases slots idempotently", () => {
    const acquire = createPublicHistoryBudget();
    const a = acquire()!;
    const b = acquire()!;
    expect(acquire()).toBeNull();
    a(); a();
    const c = acquire()!;
    expect(c).toBeTypeOf("function");
    expect(acquire()).toBeNull();
    b(); c();
    expect(acquire()).toBeTypeOf("function");
  });

  it("caps total lookups at 30 per minute, without retaining request identities", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T00:00:00Z"));
    const acquire = createPublicHistoryBudget();
    for (let i = 0; i < 30; i++) acquire()!();
    expect(acquire()).toBeNull();
    vi.advanceTimersByTime(59_999);
    expect(acquire()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(acquire()).toBeTypeOf("function");
  });

  it("does not reset active concurrency when the minute rolls over", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T00:00:00Z"));
    const acquire = createPublicHistoryBudget();
    acquire(); acquire();
    vi.advanceTimersByTime(60_000);
    expect(acquire()).toBeNull();
  });
});
