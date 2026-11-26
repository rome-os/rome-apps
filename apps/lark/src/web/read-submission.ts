import { ApiResponseError } from "./api.js";

type ReadSubmission = {
  result: Record<string, unknown> | null;
  error: Error | null;
};

export const emptyReadSubmission: ReadSubmission = { result: null, error: null };

type ReadSubmissionEvent =
  | { type: "start" }
  | { type: "revoke" }
  | { type: "success"; result: Record<string, unknown>; operation?: string }
  | { type: "failure"; error: Error };

export function readSubmission(
  state: ReadSubmission,
  event: ReadSubmissionEvent,
): ReadSubmission {
  switch (event.type) {
    case "start":
      return emptyReadSubmission;
    case "revoke":
      return state.result ? { ...state, result: null } : state;
    case "success":
      if (event.result.status === "error") {
        return {
          result: null,
          error: new ApiResponseError(
            String(event.result.error),
            200,
            event.operation,
          ),
        };
      }
      return { result: event.result, error: null };
    case "failure":
      return {
        result: null,
        error: event.error instanceof ApiResponseError
          ? event.error
          : new Error("request_failed"),
      };
  }
}
