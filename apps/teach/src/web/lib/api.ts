import { fetchAppApi } from "@rome-os/app-web-sdk";

export interface MissionView {
  id: string;
  title: string;
  motivation: string;
  targetLevel: string;
  notes: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  lessonCount: number;
  publishedCount: number;
  completedCount: number;
  draftCount: number;
  plannedCount: number;
  cardCount: number;
  dueCount: number;
}

export interface ModuleView {
  id: string;
  missionId: string;
  seq: number;
  title: string;
  objective: string;
  createdAt: number;
}

export interface DashboardData {
  missions: MissionView[];
  totals: { missions: number; due: number; lessons: number; reviews: number };
  streak: number;
  settings: { defaultNotifyChannel: string; dailyReviewTime: string; timezone: string };
  reviewRoutine: { exists: boolean; enabled: boolean };
  now: number;
}

export interface LessonSummary {
  id: string;
  missionId: string;
  moduleId: string | null;
  seq: number;
  title: string;
  objective: string;
  summary: string;
  status: string;
  errorNote: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface Lesson extends LessonSummary {
  html: string;
}

export interface DueCard {
  id: string;
  missionId: string;
  lessonId: string | null;
  front: string;
  quizType: "mcq" | "qa";
  /** Shuffled options for mcq cards (correct answer + distractors); null for qa. */
  options: string[] | null;
  intervalDays: number;
  reps: number;
  dueAt: number;
  createdAt: number;
}

export interface GradeResult {
  reviewId: string;
  verdict: "correct" | "partial" | "wrong";
  feedback: string;
  grade: number;
  gradeLabel: string;
  correctAnswer: string;
  canBumpEasy?: boolean;
  nextDueAt: number;
  intervalDays: number;
  ease: number;
  reps: number;
}

export interface DueMissionGroup {
  missionId: string;
  title: string;
  dueCount: number;
  cards: DueCard[];
}

export interface DueReviews {
  now: number;
  totalDue: number;
  missions: DueMissionGroup[];
}

export interface ResourceItem {
  id: string;
  missionId: string | null;
  title: string;
  url: string;
  note: string;
  createdAt: number;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchAppApi(path, init);
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error((body.error as string) ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export const api = {
  dashboard: () => call<DashboardData>("dashboard"),

  createMission: (input: {
    title: string;
    motivation?: string;
    target_level?: string;
    notes?: string;
  }) => call<{ mission: MissionView }>("missions", { method: "POST", body: JSON.stringify(input) }),

  updateSettings: (input: {
    notify_channel?: string;
    daily_review_time?: string;
    timezone?: string;
    review_enabled?: boolean;
  }) =>
    call<{
      settings: { defaultNotifyChannel: string; dailyReviewTime: string; timezone: string };
      reviewRoutine?: { enabled: boolean };
    }>("settings", { method: "PUT", body: JSON.stringify(input) }),

  lessons: (missionId: string) =>
    call<{ modules: ModuleView[]; lessons: LessonSummary[] }>(`missions/${missionId}/lessons`),

  generateOutline: (missionId: string, regen?: boolean) =>
    call<{ planned: boolean; modules: ModuleView[]; lessons: LessonSummary[]; error?: string }>(
      `missions/${missionId}/outline`,
      { method: "POST", body: JSON.stringify({ regen: regen ?? false }) },
    ),

  generateLesson: (missionId: string, opts: { topic?: string; lessonId?: string } = {}) =>
    call<{ lesson: Lesson; generated: boolean; cardCount?: number; error?: string }>(
      `missions/${missionId}/lessons`,
      { method: "POST", body: JSON.stringify({ topic: opts.topic, lesson_id: opts.lessonId }) },
    ),

  lesson: (lessonId: string) => call<{ lesson: Lesson }>(`lessons/${lessonId}`),

  completeLesson: (lessonId: string, learning_note?: string) =>
    call<{ lesson: Lesson }>(`lessons/${lessonId}/complete`, {
      method: "POST",
      body: JSON.stringify({ learning_note }),
    }),

  dueReviews: (missionId?: string) =>
    call<DueReviews>(missionId ? `reviews/due?mission_id=${encodeURIComponent(missionId)}` : "reviews/due"),

  gradeReview: (input: {
    card_id: string;
    selected_option?: string;
    text?: string;
    override_easy?: boolean;
    replace_review_id?: string;
  }) =>
    call<GradeResult>("reviews/grade", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  resources: (missionId?: string) =>
    call<{ resources: ResourceItem[] }>(
      missionId ? `resources?mission_id=${encodeURIComponent(missionId)}` : "resources",
    ),
};
