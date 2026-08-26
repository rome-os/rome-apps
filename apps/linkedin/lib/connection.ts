export type ConnectionState =
  | "already_connected"
  | "pending"
  | "incoming_request"
  | "connectable"
  | "follow_only"
  | "unavailable";

const ACTION_AREA_END = /^(?:About|Highlights|Featured|Activity|Experience|Education)\n/m;

export const STATE_BUTTON_MAP: Record<ConnectionState, string | undefined> = {
  already_connected: undefined,
  pending: undefined,
  incoming_request: "Accept",
  connectable: "Connect",
  follow_only: undefined,
  unavailable: undefined,
};

function extractActionArea(profileText: string): string {
  const match = ACTION_AREA_END.exec(profileText);
  if (!match) {
    return profileText.slice(0, 500);
  }
  return profileText.slice(0, match.index);
}

export function detectConnectionState(profileText: string): ConnectionState {
  if (profileText.slice(0, 300).includes("· 1st")) {
    return "already_connected";
  }

  const actionArea = extractActionArea(profileText);

  if (actionArea.includes("\nPending\n") || actionArea.endsWith("\nPending")) {
    return "pending";
  }
  if (actionArea.includes("\nAccept\n") && actionArea.includes("\nIgnore\n")) {
    return "incoming_request";
  }
  if (actionArea.includes("\nConnect\n") || actionArea.endsWith("\nConnect")) {
    return "connectable";
  }
  if (actionArea.includes("\nFollow\n") || actionArea.endsWith("\nFollow")) {
    return "follow_only";
  }

  return "unavailable";
}
