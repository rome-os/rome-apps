import {
  defineAction,
  z,
  type Action,
  type ActionConfig,
  type AppActionRuntimeDeps,
} from "@rome-os/app-runtime";
import { localWriteSchema } from "../input.js";
import { prepareInvocation, actionErrorMessage } from "../../lib/policy.js";
import { LOCAL_CONNECTION_ID } from "../../shared/managed-connections.js";

export const LOCAL_WRITE_APPROVAL = "lark:approve_local_write";

export function createAction(
  config: ActionConfig,
  deps: AppActionRuntimeDeps,
): Action {
  const action = defineAction({
    config,
    schema: localWriteSchema,
    execute: async (input) => {
      try {
        prepareInvocation(
          input.command,
          input.identity,
          input.parameters,
          "write",
        );
        return await deps.appContext.runAction(LOCAL_WRITE_APPROVAL, input);
      } catch (e) {
        return { status: "error", error: actionErrorMessage(e) };
      }
    },
  });
  // Action supports async previews; defineAction's convenience preview is synchronous.
  action.preview = (raw) => previewLocalWrite(raw, deps);
  return action;
}

export async function previewLocalWrite(
  raw: Record<string, unknown>,
  deps: AppActionRuntimeDeps,
) {
  const parsed = localWriteSchema.safeParse(raw);
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  const input = parsed.data;
  const call = prepareInvocation(
    input.command,
    input.identity,
    input.parameters,
    "write",
  );
  const language =
    await deps.appContext.repositories.settings.get<string>("guardianLanguage");
  const zh = language?.startsWith("zh") ?? true;
  return {
    kind: "generic" as const,
    title: `Lark · ${call.spec.title[zh ? 0 : 1]}`,
    summary: zh
      ? `以${input.identity === "user" ? "本人" : "机器人"}身份执行。批准后才会向飞书发送请求；不确定结果不会自动重试。`
      : "Execute with the shown identity only after approval. Uncertain writes are not automatically retried.",
    fields: [
      {
        label: zh ? "执行连接" : "Execution connection",
        value: LOCAL_CONNECTION_ID,
      },
      { label: zh ? "操作" : "Operation", value: input.command },
      { label: zh ? "身份" : "Identity", value: input.identity },
      {
        label: zh ? "连接版本" : "Connection revision",
        value: String(input.connectionRevision),
      },
      { label: zh ? "请求 ID" : "Request ID", value: input.requestId },
      {
        label: zh ? "完整参数" : "Complete parameters",
        value: JSON.stringify(call.parameters, null, 2),
      },
    ],
  };
}
