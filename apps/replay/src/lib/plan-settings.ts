/**
 * Playback settings stored on a replay plan. The ranges here are the API
 * contract: the create-plan endpoint clamps into them, so the repository and
 * the turn-middleware can trust every persisted value.
 */

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 10;
export const DEFAULT_SPEED = 1;

export const TURN_BUDGET_MIN_MS = 1_000;
// Must stay well under the web driver's 180s per-turn ceiling (App.tsx
// MAX_WAIT_MS) so a max-budget turn still finishes before the driver gives up.
export const TURN_BUDGET_MAX_MS = 30_000;
export const DEFAULT_TURN_BUDGET_MS = 30_000;

export function clampSpeed(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SPEED;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, value));
}

export function clampTurnBudgetMs(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TURN_BUDGET_MS;
  return Math.round(Math.min(TURN_BUDGET_MAX_MS, Math.max(TURN_BUDGET_MIN_MS, value)));
}
