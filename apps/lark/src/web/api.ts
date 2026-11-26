import { fetchAppApi } from "@rome-os/app-web-sdk";
import type { Preferences } from "../db/repositories/lark.js";
export interface SetupJob {
  id: string;
  kind: string;
  state: string;
  errorCode?: string;
  verificationUrl?: string;
}
export interface Status {
  appId: string;
  version: string;
  cliVersion: string;
  configured: boolean;
  brand?: "feishu" | "lark";
  preferences: Preferences;
  identities: {
    user: { available: boolean; status: string };
    bot: { available: boolean; status: string };
  };
  job: SetupJob | null;
  scopeGroups: Record<string, string[]>;
}
export interface ActivityItem {
  connectionId: string;
  authorizationRevision: string | null;
  id: string;
  command: string;
  identity: "user" | "bot";
  risk: "read" | "write";
  state: "running" | "completed" | "failed" | "unknown";
  errorCode: string | null;
  createdAt: string;
  finishedAt: string | null;
}
export class ApiResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly operation?: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchAppApi(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-lark-ui": "1",
      ...init?.headers,
    },
  });
  const value = await response.json();
  if (!response.ok)
    throw new ApiResponseError(
      value.error ?? `http_${response.status}`,
      response.status,
      typeof value.detail === "string" && /^feishu\.[a-z.]+$/.test(value.detail)
        ? value.detail
        : undefined,
    );
  return value as T;
}
