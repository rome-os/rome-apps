/** Display labels only. Provider admission is independently enforced server-side. */
export function baseUrlLabelKey(value: string): "settings.baseUrl.china" | "settings.baseUrl.global" | null {
  if (value === "https://api.tikhub.dev") return "settings.baseUrl.china";
  if (value === "https://api.tikhub.io") return "settings.baseUrl.global";
  return null;
}
