import { z } from "@rome-os/app-runtime";
import { commandSchema, coreCommand, findCommand } from "../shared/catalog.js";
import { coreOutputs } from "./core-commands.js";

export function commandDetails(command: string) {
  const spec = findCommand(command);
  const common = {
    ...spec,
    inputSchema: commandSchema(spec),
    requiresApproval: spec.risk === "write",
    executionAction: spec.risk === "write" ? "lark:write" : "lark:read",
  };
  if (!spec.coreOperation)
    return {
      ...common,
      identityNote:
        "User identity only. Select local-cli explicitly until Core supports User OAuth.",
    };
  const core = coreCommand(spec);
  const receipt = z.object({
    connectionId: z.string(),
    identity: z.literal("bot"),
    requestId: z.string(),
    executionId: z.string(),
    retryAllowed: z.literal(false),
  });
  const output = coreOutputs[spec.id]!;
  return {
    ...common,
    coreInputSchema: commandSchema(core),
    coreOutputSchema: z.toJSONSchema(output, { unrepresentable: "any" }),
    coreExample: core.example,
    coreAction: spec.risk === "write" ? "lark:core_write" : "lark:read",
    ...(spec.risk === "write" && {
      coreReceiptSchema: z.toJSONSchema(
        z.union([
          z.object({
            ok: z.literal(true),
            status: z.literal("ok"),
            requestId: z.string(),
            executionId: z.string(),
            data: output,
          }),
          receipt.extend({
            status: z.literal("pending_approval"),
            approvalId: z.string(),
            approval: z.looseObject({
              approvalId: z.string(),
              actionName: z.string(),
              description: z.string(),
            }),
          }),
          receipt.extend({
            status: z.literal("duplicate"),
            outcome: z.enum(["succeeded", "failed"]),
            error: z.string().optional(),
          }),
          receipt.extend({
            status: z.enum(["outcome_unknown", "request_in_progress"]),
            executionId: z.string().optional(),
          }),
        ]),
        { unrepresentable: "any" },
      ),
    }),
    pagination: "Continue explicitly with pageToken when hasMore is true.",
  };
}
