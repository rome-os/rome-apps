import type { RomeAppContext, RomeAppApiRequest } from "@rome-os/app-runtime";
import { allowedRepo, GitError } from "../lib/git.js";
import { selectionStore, validChatId } from "../lib/selectionStore.js";
import { pickChatState, type ChatState } from "../shared/prefs.js";
export async function handleAgentApi(
  ctx: RomeAppContext,
  req: RomeAppApiRequest,
): Promise<Response | null> {
  const [route, id, verb] = req.path;
  if (!["selection", "cards"].includes(route)) return null;
  if (req.caller.kind !== "guardian")
    return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    const store = selectionStore(ctx.db);
    if (route === "selection" && req.path.length === 2) {
      validChatId(id);
      if (req.method === "GET") return Response.json(store.read(id));
      if (req.method === "POST") {
        if (!req.body || req.body.byteLength > 16384)
          throw new GitError("invalid_input");
        const raw = JSON.parse(new TextDecoder().decode(req.body));
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
          throw new GitError("invalid_input");
        const state = pickChatState(raw);
        if (
          Object.keys(raw).length !== Object.keys(state).length ||
          Object.values(state).some(
            (v) => typeof v !== "string" || v.length > 4096 || v.includes("\0"),
          )
        )
          throw new GitError("invalid_input");
        state.repo = await allowedRepo(state.repo || "");
        if (state.toRef && (state.mode !== "ref" || state.target !== "head"))
          throw new GitError("invalid_mode");
        return Response.json(store.write(id, state));
      }
    }
    if (route === "cards" && req.path.length >= 2 && req.path.length <= 3) {
      const card = store.card(id);
      if (!verb && req.method === "GET") return Response.json(card);
      if (verb === "open" && req.method === "POST") {
        // Identity/target come only from the server-owned card, never the POST body.
        await allowedRepo(card.repo);
        if (card.chatId) store.write(card.chatId, card.state);
        return Response.json({ chatId: card.chatId, state: card.state });
      }
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  } catch (e) {
    const error =
      e instanceof GitError
        ? e.code
        : e instanceof SyntaxError
          ? "invalid_input"
          : "internal";
    return Response.json(
      { error },
      {
        status:
          error === "forbidden_path" ? 403 : error === "internal" ? 500 : 400,
      },
    );
  }
}
