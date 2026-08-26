export const REVIEWS_PAGE_SIZE = 20;
export const ACTIVITY_PAGE_SIZE = 20;
export const TRIGGER_SETTINGS_ROUTE = "trigger-settings";

/** Filter tabs for the unified activity feed. */
export const ACTIVITY_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "review", label: "Reviews" },
  { value: "question", label: "Questions" },
  { value: "memory", label: "Memory" },
  { value: "code-task", label: "Code tasks" },
];
