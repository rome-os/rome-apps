import { createAppLogger } from "@rome-os/app-runtime";
import type {
  Action,
  ActionConfig,
  ActionResult,
  AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import {
  createDistillationsRepository,
  type ArtifactType,
  type DistillationPatch,
} from "../../db/repositories/distillations.js";
import {
  buildPrompt,
  normalizeTypes,
  stripCodeFences,
  truncateTranscript,
  TRANSCRIPT_LIMIT,
} from "../../lib/artifacts.js";
import { assembleSlidesHtml, normalizeSlideStyle } from "../../lib/slides.js";
import { fetchTranscript, fetchVideoMetadata, parseVideoId } from "../../lib/youtube.js";

const log = createAppLogger("yt-distill:distill");

const TRANSCRIPT_ERROR_MESSAGE =
  "Couldn't fetch this video's transcript — it may have no captions, or you may need to log in to YouTube in the browser first.";

interface DistillInput {
  url?: unknown;
  types?: unknown;
  style?: unknown;
  /** Add the requested artifacts to this existing record instead of creating a new one. */
  recordId?: unknown;
  /** Set false to force a fresh scrape even if a transcript is already stored. */
  reuseTranscript?: unknown;
}

/** Stored transcripts are timestamped paragraphs ("[12:34] text…"); the model gets plain text. */
function transcriptToPlain(formatted: string): string {
  return formatted
    .split(/\n{2,}/)
    .map((p) => p.replace(/^\[[^\]]*\]\s*/, "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function readSummonResult(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const result = (data as { result?: unknown }).result;
  return typeof result === "string" ? result : null;
}

type RunAction = (
  name: string,
  input: Record<string, unknown>,
) => Promise<{ status: string; data?: unknown; error?: string }>;

/**
 * Condense a very long transcript into an ordered outline that covers the WHOLE
 * video. Splits into chunks, summons a faithful outline per chunk (in the
 * transcript's language), and concatenates them — so a 3-hour talk yields a
 * compact, full-arc source instead of just its opening being fed to the model.
 */
async function condenseTranscript(text: string, runAction: RunAction, id: string): Promise<string> {
  const CHUNK = 28_000;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK) chunks.push(text.slice(i, i + CHUNK));
  const outlines: string[] = [];
  for (let idx = 0; idx < chunks.length; idx++) {
    try {
      const summon = await runAction("system:summon", {
        agentName: "assistant:assistant",
        prompt:
          `You are condensing part ${idx + 1} of ${chunks.length} of a long video transcript into a faithful, detailed outline.\n` +
          "Extract the key points of THIS part as concise nested bullet points. Preserve section/stage " +
          "names, technical terms, named entities, numbers, and the order of ideas. Do NOT invent anything " +
          "not present. Write in the transcript's own language. Output ONLY bullets — no preamble.\n\n-----\n" +
          chunks[idx] +
          "\n-----",
      });
      if (summon.status === "ok") {
        const t = readSummonResult(summon.data);
        if (t && t.trim()) outlines.push(`## Part ${idx + 1} of ${chunks.length}\n${t.trim()}`);
      }
    } catch (err) {
      log.warn("condense chunk failed", { id, idx, error: (err as Error).message });
    }
  }
  return outlines.join("\n\n");
}

type DistillDeps = AppActionRuntimeDeps;

export function createAction(config: ActionConfig, deps: DistillDeps): Action {
  const { appContext } = deps;

  return {
    config,
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "YouTube video URL (or video id)" },
        types: {
          type: "array",
          items: { type: "string", enum: ["mindmap", "summary", "slides"] },
          description: "Which artifacts to generate; defaults to all three",
        },
        style: {
          type: "string",
          description:
            "Slide visual style: 'auto' (random preset each run) or a preset id (bold-signal, electric-studio, dark-botanical, ink-editorial, indigo-porcelain, neon-cyber, swiss-grid). Defaults to auto.",
        },
        recordId: {
          type: "string",
          description:
            "Existing distillation id: generate the requested artifacts into that record (reusing its stored transcript) instead of creating a new one.",
        },
        reuseTranscript: {
          type: "boolean",
          description:
            "When true (default), reuse the transcript already stored for this video from a previous run instead of scraping YouTube again.",
        },
      },
      required: [],
      additionalProperties: false,
    },

    execute: async (input: Record<string, unknown>): Promise<ActionResult> => {
      const { url, types, style, recordId, reuseTranscript } = input as DistillInput;
      const slideStyle = normalizeSlideStyle(style);
      const repo = createDistillationsRepository(appContext.db);

      let requestedTypes: ArtifactType[] = normalizeTypes(types);
      if (requestedTypes.length === 0) {
        // Default: all three artifacts.
        requestedTypes = ["mindmap", "summary", "slides"];
      }

      // ---- Resolve the target record + transcript source -------------------
      // Three paths:
      //   1. recordId given → add artifacts to that record, using its transcript.
      //   2. url given and a previous run of the same video stored a transcript
      //      (and reuseTranscript !== false) → new record, transcript copied over.
      //   3. otherwise → new record, scrape YouTube.
      let row: ReturnType<typeof repo.byId>;
      let source: { transcript: string; condensedMd: string | null } | null = null;
      let title: string | null = null;
      let channel: string | null = null;
      let reused = false;

      if (typeof recordId === "string" && recordId) {
        const existing = repo.byId(recordId);
        if (!existing) return { status: "error", error: "Distillation not found." };
        if (!existing.transcript || !existing.transcript.trim()) {
          return { status: "error", error: "That record has no stored transcript to reuse." };
        }
        row = existing;
        source = { transcript: existing.transcript, condensedMd: existing.condensedMd };
        title = existing.title;
        channel = existing.channel;
        reused = true;
        const union = Array.from(new Set([...existing.requestedTypes, ...requestedTypes]));
        repo.patch(row.id, { requestedTypes: union, errorMessage: null, errorCode: null });
        log.info("adding artifacts to existing record", { id: row.id, requestedTypes });
      } else {
        if (typeof url !== "string" || !url.trim()) {
          return { status: "error", error: "A YouTube URL is required." };
        }
        const videoId = parseVideoId(url);
        if (!videoId) {
          return { status: "error", error: "That does not look like a YouTube video link." };
        }
        row = repo.create({ url: url.trim(), videoId, requestedTypes });
        log.info("distillation created", { id: row.id, videoId, requestedTypes });

        const previous = reuseTranscript === false ? null : repo.latestWithTranscript(videoId);
        if (previous) {
          source = { transcript: previous.transcript!, condensedMd: previous.condensedMd };
          title = previous.title;
          channel = previous.channel;
          reused = true;
          repo.patch(row.id, {
            title,
            channel,
            lang: previous.lang,
            transcript: previous.transcript,
            condensedMd: previous.condensedMd,
          });
          log.info("reusing stored transcript", { id: row.id, from: previous.id, videoId });
        } else {
          // Fetch metadata (best-effort) and transcript (required) in parallel.
          const [metadata, transcript] = await Promise.all([
            fetchVideoMetadata(url).catch(() => ({ title: null, channel: null, videoId: null })),
            fetchTranscript(url).catch(() => ({
              ok: false as const,
              text: "",
              formatted: "",
              error: { code: "PAGE_ERROR", message: "transcript fetch crashed" },
            })),
          ]);
          title = metadata.title;
          channel = metadata.channel;

          if (!transcript.ok || !transcript.text.trim()) {
            log.warn("transcript fetch failed", { id: row.id, error: transcript.error });
            const errorCode = transcript.error?.code ?? "PAGE_ERROR";
            const detail = transcript.error?.message?.trim();
            const errorMessage = detail
              ? `${TRANSCRIPT_ERROR_MESSAGE} (${detail})`
              : TRANSCRIPT_ERROR_MESSAGE;
            repo.patch(row.id, {
              title,
              channel,
              status: "error",
              errorMessage,
              errorCode,
            });
            return {
              status: "ok",
              data: { id: row.id, status: "error", errorMessage, errorCode },
            };
          }

          // Store the readable, timestamped transcript for display; the plain
          // text is only used transiently for the LLM prompt.
          const stored = transcript.formatted || transcript.text;
          repo.patch(row.id, { title, channel, transcript: stored });
          source = { transcript: stored, condensedMd: null };
        }
      }

      const plainText = transcriptToPlain(source.transcript);

      // Short/medium videos go to the model whole. Very long ones are condensed
      // via chunked map-reduce first, so the WHOLE video is covered — not just
      // the opening (which would make a 3-hour talk yield a "Stage 1 only" map).
      let promptSource = plainText;
      let condensed = false;
      if (plainText.length > TRANSCRIPT_LIMIT) {
        let outline = source.condensedMd?.trim() ?? "";
        if (outline) {
          log.info("reusing cached condensed outline", { id: row.id, chars: outline.length });
        } else {
          outline = await condenseTranscript(
            plainText,
            appContext.runAction as RunAction,
            row.id,
          ).catch(() => "");
          if (outline && outline.length > 300) {
            // Cache the expensive step so later runs on this video skip it.
            repo.patch(row.id, { condensedMd: outline });
            log.info("condensed long transcript", {
              id: row.id,
              fromChars: plainText.length,
              toChars: outline.length,
            });
          }
        }
        if (outline && outline.length > 300) {
          promptSource = outline;
          condensed = true;
        }
      }
      const { text: promptText, truncated } = truncateTranscript(promptSource);

      const artifactPatch: DistillationPatch = {};
      const generated: ArtifactType[] = [];
      const failed: ArtifactType[] = [];

      for (const type of requestedTypes) {
        try {
          const summon = await appContext.runAction("system:summon", {
            agentName: "assistant:assistant",
            prompt: buildPrompt(type, {
              title,
              transcript: promptText,
              truncated,
              condensed,
              slideStyle,
            }),
          });
          if (summon.status !== "ok") {
            const reason = summon.status === "error" ? summon.error : `summon returned ${summon.status}`;
            throw new Error(reason);
          }
          const raw = readSummonResult(summon.data);
          if (!raw || !raw.trim()) throw new Error("agent returned empty content");
          if (type === "mindmap") artifactPatch.mindmapMd = stripCodeFences(raw);
          else if (type === "summary") artifactPatch.summaryMd = stripCodeFences(raw);
          else artifactPatch.slidesHtml = assembleSlidesHtml(raw, title);
          generated.push(type);
        } catch (err) {
          failed.push(type);
          log.error("artifact generation failed", { id: row.id, type, error: (err as Error).message });
        }
      }

      if (generated.length === 0) {
        const message = "Generation failed — no content could be produced. Please try again.";
        // Adding to an existing record that already has content: keep it
        // usable and just surface the error message.
        const keepReady =
          typeof recordId === "string" && !!(row.mindmapMd || row.summaryMd || row.slidesHtml);
        repo.patch(row.id, {
          ...artifactPatch,
          status: keepReady ? "ready" : "error",
          errorMessage: message,
          errorCode: keepReady ? null : "GENERATION_FAILED",
        });
        return {
          status: "ok",
          data: { id: row.id, status: keepReady ? "ready" : "error", errorMessage: message, reused },
        };
      }

      const errorMessage =
        failed.length > 0
          ? `Some content failed to generate: ${failed.join(", ")}`
          : null;
      repo.patch(row.id, { ...artifactPatch, status: "ready", errorMessage, errorCode: null });
      log.info("distillation ready", { id: row.id, generated, failed });

      return {
        status: "ok",
        data: { id: row.id, status: "ready", generated, failed, reused },
      };
    },
  };
}
