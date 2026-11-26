import { z } from "@rome-os/app-runtime";
import { LOCAL_CONNECTION_ID } from "../shared/managed-connections.js";
export const invocationSchema = z
  .object({
    connectionId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,160}$/)
      .optional()
      .describe(
        "Execution connection. Use local-cli for the independent CLI, or an explicit Rome connection ID. Never fall back. Omission preserves the legacy independent CLI path.",
      ),
    command: z
      .string()
      .min(1)
      .max(80)
      .describe("Reviewed command ID from lark:search_commands"),
    identity: z
      .enum(["user", "bot"])
      .describe("Explicit identity; never auto-selected"),
    parameters: z
      .record(z.string(), z.unknown())
      .default({})
      .describe(
        "Exact parameters from lark:inspect_command. No file inputs or arbitrary flags.",
      ),
  })
  .strict();
export const requestIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(200)
  .describe(
    "Caller-provided stable request ID, 8–200 characters after trimming. Reuse only for the same intent; never regenerate automatically after an unknown outcome.",
  );

export const writeSchema = invocationSchema.extend({
  requestId: requestIdSchema,
  connectionRevision: z
    .number()
    .int()
    .min(0)
    .describe(
      "Current preferences.revision from lark:status; binds approval to this configured connection.",
    ),
});

export const localWriteSchema = writeSchema.extend({
  connectionId: z
    .literal(LOCAL_CONNECTION_ID, {
      error: "core_write_required: Use lark:core_write for managed Core connections.",
    })
    .optional(),
});
