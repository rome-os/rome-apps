import { sql } from "drizzle-orm";
import type { AppDbContext } from "@rome-os/app-runtime";
import type { ChatState } from "../shared/prefs.js";
import { GitError } from "./git.js";
import type { ReviewCard } from "./agentView.js";
export interface Selection {
  revision: number;
  state: ChatState | null;
}
export function validChatId(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new GitError("invalid_chat");
  return id;
}
/** Every writer, including a different action worker, uses the same SQLite CAS. */
export function selectionStore(ctx: AppDbContext) {
  const db = ctx.connection;
  const selections = sql.identifier(ctx.tableName("selections"));
  const cards = sql.identifier(ctx.tableName("cards"));
  function read(chat: string): Selection {
    validChatId(chat);
    const row = db.get<{ revision: number; state: string | null }>(
      sql`SELECT revision,state FROM ${selections} WHERE chat_id=${chat}`,
    );
    return {
      revision: row?.revision ?? 0,
      state: row?.state ? JSON.parse(row.state) : null,
    };
  }
  function write(chat: string, state: ChatState, expected?: number): Selection {
    validChatId(chat);
    db.run(
      sql`INSERT OR IGNORE INTO ${selections} (chat_id,revision) VALUES (${chat},0)`,
    );
    const result = db.get<{ revision: number; state: string }>(
      expected === undefined
        ? sql`UPDATE ${selections} SET state=${JSON.stringify(state)}, revision=revision+1 WHERE chat_id=${chat} RETURNING revision,state`
        : sql`UPDATE ${selections} SET state=${JSON.stringify(state)}, revision=revision+1 WHERE chat_id=${chat} AND revision=${expected} RETURNING revision,state`,
    );
    if (!result) throw new GitError("selection_superseded");
    return { revision: result.revision, state: JSON.parse(result.state) };
  }
  return {
    read,
    write,
    putCard(id: string, chat: string | null, payload: ReviewCard) {
      db.run(
        sql`INSERT INTO ${cards} (id,chat_id,payload) VALUES (${id},${chat},${JSON.stringify(payload)})`,
      );
    },
    card(id: string) {
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new GitError("invalid_card");
      const row = db.get<{ chat_id: string | null; payload: string }>(
        sql`SELECT chat_id,payload FROM ${cards} WHERE id=${id}`,
      );
      if (!row) throw new GitError("card_not_found");
      return {
        chatId: row.chat_id,
        ...(JSON.parse(row.payload) as ReviewCard),
      };
    },
  };
}
