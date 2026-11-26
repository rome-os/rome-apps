export const LOCAL_CONNECTION_ID = "local-cli";

export interface ManagedConnection {
  id: string;
  label: string;
  appId: string | null;
  grant: "authorized" | "unauthorized" | "degraded" | "unknown";
  talk: string;
  act: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const states = new Set([
  "unlocked",
  "needs-auth",
  "unsupported",
  "disconnected",
  "connecting",
]);
function capability(value: unknown): string {
  const state = record(value)?.state;
  return typeof state === "string" && states.has(state) ? state : "unknown";
}

// Only the public connection projection is retained. Grant material is never requested.
export function projectManagedConnections(value: unknown): ManagedConnection[] {
  const rows = record(value)?.connections;
  if (!Array.isArray(rows) || rows.length > 1000)
    throw new Error("invalid_connections_response");
  const seen = new Set<string>();
  return rows.flatMap((raw) => {
    const row = record(raw);
    if (!row || row.service !== "feishu" || row.id === null) return [];
    if (
      typeof row.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,160}$/.test(row.id) ||
      row.id === LOCAL_CONNECTION_ID ||
      seen.has(row.id)
    )
      throw new Error("invalid_connections_response");
    seen.add(row.id);
    const grants = record(row.grants);
    const display = record(record(row.display)?.app);
    const capabilities = record(row.capabilities);
    const grant = grants?.app;
    return [
      {
        id: row.id,
        label:
          typeof row.label === "string" && row.label !== "feishu"
            ? row.label.slice(0, 200)
            : typeof display?.displayName === "string"
              ? display.displayName.slice(0, 200)
              : row.id,
        appId:
          typeof display?.handle === "string" &&
          /^cli_[a-zA-Z0-9]+$/.test(display.handle)
            ? display.handle
            : null,
        grant:
          grant === "authorized" ||
          grant === "unauthorized" ||
          grant === "degraded"
            ? grant
            : "unknown",
        talk: capability(capabilities?.talk),
        act: capability(capabilities?.act),
      },
    ];
  });
}

export function permissionConsole(
  appId: string | null,
  brand: "feishu" | "lark",
): string {
  const origin =
    brand === "feishu"
      ? "https://open.feishu.cn"
      : "https://open.larksuite.com";
  return appId && /^cli_[a-zA-Z0-9]+$/.test(appId)
    ? `${origin}/app/${encodeURIComponent(appId)}/auth`
    : `${origin}/app`;
}

export function projectGrantedConnections(value: unknown): ManagedConnection[] {
  const rows = record(value)?.connections;
  if (!Array.isArray(rows) || rows.length > 50)
    throw new Error("invalid_connections_response");
  const seen = new Set<string>();
  return rows.flatMap((raw) => {
    const row = record(raw);
    if (!row || row.connectionKind !== "feishu" || row.identity !== "app")
      return [];
    if (
      typeof row.connectionId !== "string" ||
      !/^[a-zA-Z0-9_-]{1,160}$/.test(row.connectionId) ||
      row.connectionId === LOCAL_CONNECTION_ID ||
      seen.has(row.connectionId)
    )
      throw new Error("invalid_connections_response");
    seen.add(row.connectionId);
    return [
      {
        id: row.connectionId,
        label:
          typeof row.label === "string"
            ? row.label.slice(0, 200)
            : row.connectionId,
        appId: null,
        grant:
          row.health === "working"
            ? ("authorized" as const)
            : ("unknown" as const),
        talk: "unknown",
        act: "unknown",
      },
    ];
  });
}
