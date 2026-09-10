// Shared read-model builders for the Teach app.
//
// These functions take an already-constructed repository (running in whatever
// process called them) and produce the exact JSON-safe shapes the web layer
// expects. Both the app's HTTP API handler AND the agent-facing actions call
// these helpers, so the two paths can never drift.
//
// Why this exists: routing read-only HTTP endpoints through `ctx.runAction`
// forks a fresh action-worker subprocess per request (~6s of fixed boot
// overhead: app discovery + action registration + migration checks). The API
// handler instead calls these helpers directly against the in-process DB
// connection — the same pattern the lessons endpoint already uses (~ms).
import type { CardRow, TeachRepository } from "../db/repositories/teach.js";
import { computeStreak } from "./streak.js";
import { buildMcqOptions } from "./review.js";
import { serializeMission, serializeResource, serializeReviewCard } from "./wire.js";

const REVIEW_ROUTINE_NAME = "teach-daily-review";

type RoutineLister = () => Promise<Array<{ name: string; enabled?: boolean }>>;

/** Aggregated dashboard payload (missions + totals + streak + settings). */
export async function buildDashboardData(
  repo: TeachRepository,
  listRoutines?: RoutineLister,
  now: Date = new Date(),
) {
  const settings = repo.getSettings();

  const missions = repo.listMissions();
  const dueByMission = repo.countDueByMission(now);

  const missionViews = missions.map((m) => {
    const lessons = repo.listLessonsByMission(m.id);
    const cards = repo.listCardsByMission(m.id);
    return {
      ...serializeMission(m),
      lessonCount: lessons.length,
      publishedCount: lessons.filter((l) => l.status === "published").length,
      completedCount: lessons.filter((l) => l.status === "completed").length,
      draftCount: lessons.filter((l) => l.status === "draft").length,
      plannedCount: lessons.filter((l) => l.status === "planned").length,
      cardCount: cards.length,
      dueCount: dueByMission.get(m.id) ?? 0,
    };
  });

  const reviews = repo.listReviews();
  const streak = computeStreak(
    reviews.map((r) => r.reviewedAt.getTime()),
    settings.timezone,
    now.getTime(),
  );

  let routine: { exists: boolean; enabled: boolean } = { exists: false, enabled: false };
  if (listRoutines) {
    try {
      const routines = await listRoutines();
      const found = routines.find((r) => r.name === REVIEW_ROUTINE_NAME);
      if (found) {
        routine = { exists: true, enabled: found.enabled !== false };
      }
    } catch {
      // Routine listing is best-effort; the dashboard still renders without it.
    }
  }

  const totalDue = [...dueByMission.values()].reduce((a, b) => a + b, 0);

  return {
    missions: missionViews,
    totals: {
      missions: missions.length,
      due: totalDue,
      lessons: missionViews.reduce((a, m) => a + m.lessonCount, 0),
      reviews: reviews.length,
    },
    streak,
    settings: {
      defaultNotifyChannel: settings.defaultNotifyChannel,
      dailyReviewTime: settings.dailyReviewTime,
      timezone: settings.timezone,
    },
    reviewRoutine: routine,
    now: now.getTime(),
  };
}

/** Resources, optionally filtered to a mission. */
export function buildResourcesData(repo: TeachRepository, missionId?: string | null) {
  return { resources: repo.listResources(missionId ?? null).map(serializeResource) };
}

/** Due review cards grouped by mission (answers withheld). */
export function buildDueReviewsData(
  repo: TeachRepository,
  opts: { missionId?: string; limit?: number; now?: Date } = {},
) {
  const now = opts.now ?? new Date();

  let due: CardRow[] = repo.listDueCards(now);
  if (opts.missionId) due = due.filter((c) => c.missionId === opts.missionId);
  if (opts.limit) due = due.slice(0, opts.limit);

  // Group by mission, preserving due-order (earliest first) within a group.
  const byMission = new Map<string, CardRow[]>();
  for (const c of due) {
    const arr = byMission.get(c.missionId) ?? [];
    arr.push(c);
    byMission.set(c.missionId, arr);
  }

  const missions = [...byMission.entries()].map(([missionId, cards]) => {
    const m = repo.getMission(missionId);
    return {
      missionId,
      title: m?.title ?? "(unknown mission)",
      dueCount: cards.length,
      cards: cards.map((c) => {
        // For mcq, shuffle the correct answer in with its distractors and
        // withhold `back`. Legacy/qa cards present no options.
        const options = c.quizType === "mcq" ? buildMcqOptions(c.back, c.options) : null;
        return serializeReviewCard(c, options);
      }),
    };
  });

  return { now: now.getTime(), totalDue: due.length, missions };
}
