export const TRIGGER_ACCESS_MODES = ["allowlist", "blocklist"] as const;

export type TriggerAccessMode = (typeof TRIGGER_ACCESS_MODES)[number];

export const DEFAULT_TRIGGER_ACCESS_MODE: TriggerAccessMode = "allowlist";

export function isTriggerAccessMode(value: unknown): value is TriggerAccessMode {
  return typeof value === "string"
    && (TRIGGER_ACCESS_MODES as readonly string[]).includes(value);
}

export function normalizeTriggerAccessMode(value: unknown): TriggerAccessMode {
  return isTriggerAccessMode(value) ? value : DEFAULT_TRIGGER_ACCESS_MODE;
}
