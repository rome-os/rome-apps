import type { Identity } from "../shared/catalog.js";
import type { LarkService } from "./service.js";

export async function checkDocumentAccess(
  service: LarkService,
  input: { connectionId: string; identity: Identity; doc: string },
) {
  const result = await service.invoke(
    {
      connectionId: input.connectionId,
      identity: input.identity,
      command: "docs.fetch",
      parameters: { doc: input.doc, scope: "full" },
    },
    "read",
  );
  const error = "error" in result ? result.error : undefined;
  return {
    connectionId: input.connectionId,
    identity: input.identity,
    resource: input.doc,
    checkedAt: new Date().toISOString(),
    access: result.ok
      ? "confirmed"
      : error &&
          /(?:permission_denied|access_denied|resource_denied|forbidden)/i.test(
            error,
          )
        ? "denied"
        : "unknown",
    error,
    // Content is deliberately discarded. This proves effective read access to
    // one document, not a global ACL inventory or write permission.
  };
}
