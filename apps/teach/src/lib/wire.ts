// Wire serializers: convert DB rows (with Date objects) into plain JSON-safe
// objects with epoch-ms timestamps, so action results and API responses are
// stable across the runAction JSON boundary and easy for the web layer to read.
import type {
  CardRow,
  LessonRow,
  MissionRow,
  ModuleRow,
  ResourceRow,
  ReviewRow,
} from "../db/repositories/teach.js";

export interface WireMission {
  id: string;
  title: string;
  motivation: string;
  targetLevel: string;
  notes: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface WireLesson {
  id: string;
  missionId: string;
  moduleId: string | null;
  seq: number;
  title: string;
  objective: string;
  html: string;
  summary: string;
  status: string;
  errorNote: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface WireModule {
  id: string;
  missionId: string;
  seq: number;
  title: string;
  objective: string;
  createdAt: number;
}

export interface WireCard {
  id: string;
  missionId: string;
  lessonId: string | null;
  front: string;
  back: string;
  quizType: "mcq" | "qa" | null;
  options: string[] | null;
  ease: number;
  intervalDays: number;
  reps: number;
  dueAt: number;
  createdAt: number;
}

/**
 * A card as presented to the learner during review — deliberately WITHOUT the
 * answer (`back`). For mcq the caller supplies the shuffled option list (which
 * includes the correct answer among distractors); for qa there are no options.
 */
export interface WireReviewCard {
  id: string;
  missionId: string;
  lessonId: string | null;
  front: string;
  quizType: "mcq" | "qa";
  options: string[] | null;
  intervalDays: number;
  reps: number;
  dueAt: number;
  createdAt: number;
}

export interface WireResource {
  id: string;
  missionId: string | null;
  title: string;
  url: string;
  note: string;
  createdAt: number;
}

export interface WireReview {
  id: string;
  cardId: string;
  grade: number;
  prevInterval: number;
  newInterval: number;
  quizType: "mcq" | "qa" | null;
  verdict: "correct" | "partial" | "wrong" | null;
  reviewedAt: number;
}

export function serializeMission(m: MissionRow): WireMission {
  return {
    id: m.id,
    title: m.title,
    motivation: m.motivation,
    targetLevel: m.targetLevel,
    notes: m.notes,
    status: m.status,
    createdAt: m.createdAt.getTime(),
    updatedAt: m.updatedAt.getTime(),
  };
}

export function serializeModule(m: ModuleRow): WireModule {
  return {
    id: m.id,
    missionId: m.missionId,
    seq: m.seq,
    title: m.title,
    objective: m.objective,
    createdAt: m.createdAt.getTime(),
  };
}

export function serializeLesson(l: LessonRow): WireLesson {
  return {
    id: l.id,
    missionId: l.missionId,
    moduleId: l.moduleId,
    seq: l.seq,
    title: l.title,
    objective: l.objective,
    html: l.html,
    summary: l.summary,
    status: l.status,
    errorNote: l.errorNote,
    createdAt: l.createdAt.getTime(),
    completedAt: l.completedAt ? l.completedAt.getTime() : null,
  };
}

/** Lesson without the (potentially large) html body — for list views. */
export function serializeLessonSummary(l: LessonRow): Omit<WireLesson, "html"> {
  const { html: _html, ...rest } = serializeLesson(l);
  return rest;
}

export function serializeCard(c: CardRow): WireCard {
  return {
    id: c.id,
    missionId: c.missionId,
    lessonId: c.lessonId,
    front: c.front,
    back: c.back,
    quizType: c.quizType,
    options: c.options,
    ease: c.ease,
    intervalDays: c.intervalDays,
    reps: c.reps,
    dueAt: c.dueAt.getTime(),
    createdAt: c.createdAt.getTime(),
  };
}

/**
 * Serialize a card for the review queue. mcq cards expose `presentedOptions`
 * (correct answer + distractors, shuffled); the answer key (`back`) is withheld
 * so the client can't trivially reveal it. Legacy cards with no quiz_type are
 * treated as qa.
 */
export function serializeReviewCard(
  c: CardRow,
  presentedOptions: string[] | null,
): WireReviewCard {
  const quizType: "mcq" | "qa" = c.quizType === "mcq" ? "mcq" : "qa";
  return {
    id: c.id,
    missionId: c.missionId,
    lessonId: c.lessonId,
    front: c.front,
    quizType,
    options: quizType === "mcq" ? presentedOptions : null,
    intervalDays: c.intervalDays,
    reps: c.reps,
    dueAt: c.dueAt.getTime(),
    createdAt: c.createdAt.getTime(),
  };
}

export function serializeResource(r: ResourceRow): WireResource {
  return {
    id: r.id,
    missionId: r.missionId,
    title: r.title,
    url: r.url,
    note: r.note,
    createdAt: r.createdAt.getTime(),
  };
}

export function serializeReview(r: ReviewRow): WireReview {
  return {
    id: r.id,
    cardId: r.cardId,
    grade: r.grade,
    prevInterval: r.prevInterval,
    newInterval: r.newInterval,
    quizType: r.quizType,
    verdict: r.verdict,
    reviewedAt: r.reviewedAt.getTime(),
  };
}
