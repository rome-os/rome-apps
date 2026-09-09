import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { AppDbContext, DrizzleDb } from "@rome-os/app-runtime";
import { createAppDbSchema } from "../schema.js";

export type DistillStatus = "pending" | "ready" | "error";
export type ArtifactType = "mindmap" | "summary" | "slides";

export interface DistillationRow {
  id: string;
  url: string;
  videoId: string;
  title: string | null;
  channel: string | null;
  lang: string | null;
  transcript: string | null;
  condensedMd: string | null;
  status: DistillStatus;
  errorMessage: string | null;
  errorCode: string | null;
  requestedTypes: ArtifactType[];
  mindmapMd: string | null;
  summaryMd: string | null;
  slidesHtml: string | null;
  featured: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDistillationInput {
  url: string;
  videoId: string;
  requestedTypes: ArtifactType[];
}

export interface DistillationPatch {
  title?: string | null;
  channel?: string | null;
  lang?: string | null;
  transcript?: string | null;
  condensedMd?: string | null;
  status?: DistillStatus;
  requestedTypes?: ArtifactType[];
  errorMessage?: string | null;
  errorCode?: string | null;
  mindmapMd?: string | null;
  summaryMd?: string | null;
  slidesHtml?: string | null;
  featured?: boolean;
}

type SchemaRow = ReturnType<typeof createAppDbSchema>["distillations"]["$inferSelect"];

function toRow(row: SchemaRow): DistillationRow {
  let requestedTypes: ArtifactType[] = [];
  try {
    const parsed = JSON.parse(row.requestedTypes) as unknown;
    if (Array.isArray(parsed)) {
      requestedTypes = parsed.filter(
        (t): t is ArtifactType => t === "mindmap" || t === "summary" || t === "slides",
      );
    }
  } catch {
    requestedTypes = [];
  }
  return {
    id: row.id,
    url: row.url,
    videoId: row.videoId,
    title: row.title,
    channel: row.channel,
    lang: row.lang,
    transcript: row.transcript,
    condensedMd: row.condensedMd,
    status: row.status as DistillStatus,
    errorMessage: row.errorMessage,
    errorCode: row.errorCode,
    requestedTypes,
    mindmapMd: row.mindmapMd,
    summaryMd: row.summaryMd,
    slidesHtml: row.slidesHtml,
    featured: !!row.featured,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DistillationsRepository {
  private readonly tables;

  constructor(
    private readonly db: DrizzleDb,
    tablePrefix: string,
  ) {
    this.tables = createAppDbSchema(tablePrefix);
  }

  create(input: CreateDistillationInput): DistillationRow {
    const now = new Date();
    const id = crypto.randomUUID();
    this.db
      .insert(this.tables.distillations)
      .values({
        id,
        url: input.url,
        videoId: input.videoId,
        title: null,
        channel: null,
        lang: null,
        transcript: null,
        condensedMd: null,
        status: "pending",
        errorMessage: null,
        requestedTypes: JSON.stringify(input.requestedTypes),
        mindmapMd: null,
        summaryMd: null,
        slidesHtml: null,
        featured: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return this.byId(id)!;
  }

  patch(id: string, patch: DistillationPatch): DistillationRow | null {
    const { requestedTypes, ...rest } = patch;
    this.db
      .update(this.tables.distillations)
      .set({
        ...rest,
        ...(requestedTypes ? { requestedTypes: JSON.stringify(requestedTypes) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(this.tables.distillations.id, id))
      .run();
    return this.byId(id);
  }

  byId(id: string): DistillationRow | null {
    const row = this.db
      .select()
      .from(this.tables.distillations)
      .where(eq(this.tables.distillations.id, id))
      .get();
    return row ? toRow(row) : null;
  }

  /**
   * Most recent record for this video that already holds a transcript — lets a
   * new run skip scraping YouTube (and reuse the cached condensed outline).
   */
  latestWithTranscript(videoId: string): DistillationRow | null {
    const t = this.tables.distillations;
    const row = this.db
      .select()
      .from(t)
      .where(and(eq(t.videoId, videoId), isNotNull(t.transcript)))
      .orderBy(desc(t.updatedAt))
      .limit(1)
      .get();
    return row && row.transcript && row.transcript.trim() ? toRow(row) : null;
  }

  list(limit = 100, featuredOnly = false): DistillationRow[] {
    const base = this.db.select().from(this.tables.distillations);
    const rows = featuredOnly
      ? base.where(eq(this.tables.distillations.featured, true))
      : base;
    return rows
      .orderBy(desc(this.tables.distillations.createdAt))
      .limit(limit)
      .all()
      .map(toRow);
  }

  setFeatured(id: string, featured: boolean): DistillationRow | null {
    return this.patch(id, { featured });
  }

  remove(id: string): boolean {
    const existing = this.byId(id);
    if (!existing) return false;
    this.db
      .delete(this.tables.distillations)
      .where(eq(this.tables.distillations.id, id))
      .run();
    return true;
  }
}

export function createDistillationsRepository(ctx: AppDbContext): DistillationsRepository {
  return new DistillationsRepository(ctx.connection, ctx.tablePrefix);
}
