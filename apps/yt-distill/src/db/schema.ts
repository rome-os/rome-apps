import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * One row per distillation. A distillation is a single YouTube video that the
 * user asked to distill into some subset of {mindmap, summary, slides}. The
 * artifact columns are nullable — they are only filled in when that artifact
 * type was requested and generated successfully.
 */
export function createAppDbSchema(tablePrefix: string = "yt_distill") {
  const distillations = sqliteTable(`${tablePrefix}__distillations`, {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    videoId: text("video_id").notNull(),
    title: text("title"),
    channel: text("channel"),
    lang: text("lang"),
    transcript: text("transcript"),
    // Cached map-reduce outline for very long transcripts (the expensive LLM
    // step). Reused when generating more artifacts for the same video.
    condensedMd: text("condensed_md"),
    // pending | ready | error
    status: text("status").notNull(),
    errorMessage: text("error_message"),
    // Machine-readable reason for status=error (e.g. NOT_LOGGED_IN, NO_TRANSCRIPT,
    // BROWSER_UNAVAILABLE) so the UI can show targeted help + links.
    errorCode: text("error_code"),
    // JSON array of requested artifact types, e.g. ["mindmap","summary","slides"]
    requestedTypes: text("requested_types").notNull(),
    mindmapMd: text("mindmap_md"),
    summaryMd: text("summary_md"),
    slidesHtml: text("slides_html"),
    // When true, this record is a public "sample" the owner has chosen to show
    // to anonymous visitors on the public app URL.
    featured: integer("featured", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  });

  return { distillations };
}

const defaultSchema = createAppDbSchema();

export const distillations = defaultSchema.distillations;
