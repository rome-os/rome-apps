import { fetchAppApi } from "@rome-os/app-web-sdk";

export { SLIDE_STYLE_OPTIONS, parseVideoId } from "../../lib/shared";

export type ArtifactType = "mindmap" | "summary" | "slides";
export type DistillStatus = "pending" | "ready" | "error";

export interface HistoryItem {
  id: string;
  url: string;
  videoId: string;
  title: string | null;
  channel: string | null;
  status: DistillStatus;
  errorMessage: string | null;
  errorCode: string | null;
  requestedTypes: ArtifactType[];
  featured: boolean;
  artifacts: { mindmap: boolean; summary: boolean; slides: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface Distillation {
  id: string;
  url: string;
  videoId: string;
  title: string | null;
  channel: string | null;
  lang: string | null;
  transcript: string | null;
  status: DistillStatus;
  errorMessage: string | null;
  errorCode: string | null;
  requestedTypes: ArtifactType[];
  featured: boolean;
  mindmapMd: string | null;
  summaryMd: string | null;
  slidesHtml: string | null;
  createdAt: string;
  updatedAt: string;
}

async function unwrap<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok || (data && typeof data === "object" && "error" in data && (data as { error?: string }).error)) {
    throw new Error((data as { error?: string })?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export async function listHistory(): Promise<HistoryItem[]> {
  const res = await fetchAppApi("list");
  const data = await unwrap<{ items: HistoryItem[] }>(res);
  return data.items ?? [];
}

export async function getDistillation(id: string): Promise<Distillation> {
  const res = await fetchAppApi(`item/${encodeURIComponent(id)}`);
  return unwrap<Distillation>(res);
}

export interface DistillResponse {
  id: string;
  status: DistillStatus;
  generated?: ArtifactType[];
  failed?: ArtifactType[];
  errorMessage?: string;
  errorCode?: string;
  /** True when a previously stored transcript was reused (no YouTube scrape). */
  reused?: boolean;
}

export async function distill(
  url: string,
  types: ArtifactType[],
  style = "auto",
  opts: { reuseTranscript?: boolean } = {},
): Promise<DistillResponse> {
  const res = await fetchAppApi("distill", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, types, style, ...opts }),
  });
  return unwrap<DistillResponse>(res);
}

/** Generate more artifacts into an existing record, reusing its stored transcript. */
export async function generateInto(
  recordId: string,
  types: ArtifactType[],
  style = "auto",
): Promise<DistillResponse> {
  const res = await fetchAppApi("distill", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ recordId, types, style }),
  });
  return unwrap<DistillResponse>(res);
}

export async function removeDistillation(id: string): Promise<void> {
  const res = await fetchAppApi(`item/${encodeURIComponent(id)}`, { method: "DELETE" });
  await unwrap<{ removed: boolean }>(res);
}

export async function setFeatured(id: string, featured: boolean): Promise<boolean> {
  const res = await fetchAppApi("feature", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, featured }),
  });
  const data = await unwrap<{ featured: boolean }>(res);
  return data.featured;
}
