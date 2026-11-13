import { useEffect, useRef, useState } from "react";
import { fetchAppApi } from "@rome-os/app-web-sdk";
import type { ChatState } from "../shared/prefs";
import type { Selection } from "../lib/selectionStore";
import { SelectionGate } from "../shared/selectionGate";
/** App-owned synchronization. No private host state, React bridge or storage mutation by agents. */
export function useConversationSelection(
  chatId: string | null,
  ready: boolean,
  apply: (state: ChatState) => void,
) {
  const activeChat = useRef(chatId);
  activeChat.current = chatId;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const current = useRef<{
    chat: string;
    gate: SelectionGate;
    alive: boolean;
    unsynced: boolean;
    queue: Promise<void>;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!chatId || !ready) return;
    const session = {
      chat: chatId,
      gate: new SelectionGate(),
      alive: true,
      unsynced: false,
      queue: Promise.resolve(),
    };
    current.current = session;
    setError("");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const intent = session.gate.intent;
      try {
        const res = await fetchAppApi(
          `selection/${encodeURIComponent(chatId)}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error("selection_sync_failed");
        const value = (await res.json()) as Selection;
        if (
          session.alive &&
          activeChat.current === session.chat &&
          !session.unsynced &&
          session.gate.accept(value.revision, intent) &&
          value.state
        )
          applyRef.current(value.state);
        if (
          session.alive &&
          activeChat.current === session.chat &&
          !session.unsynced
        )
          setError("");
      } catch (e) {
        if (session.alive && activeChat.current === session.chat)
          setError(e instanceof Error ? e.message : "selection_sync_failed");
      } finally {
        if (session.alive && activeChat.current === session.chat)
          timer = setTimeout(poll, 1200);
      }
    };
    void poll();
    return () => {
      session.alive = false;
      controller.abort();
      clearTimeout(timer);
      if (current.current === session) current.current = null;
    };
  }, [chatId, ready]);
  return {
    error,
    choose(state: ChatState) {
      const session = current.current;
      if (!session || session.chat !== chatId) return;
      session.gate.beginManual();
      session.queue = session.queue.then(async () => {
        let revision: number | undefined;
        try {
          const res = await fetchAppApi(
            `selection/${encodeURIComponent(session.chat)}`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(state),
            },
          );
          if (!res.ok) throw new Error("selection_sync_failed");
          revision = ((await res.json()) as Selection).revision;
          session.unsynced = false;
          if (session.alive && activeChat.current === session.chat)
            setError("");
        } catch (e) {
          session.unsynced = true;
          if (session.alive && activeChat.current === session.chat)
            setError(e instanceof Error ? e.message : "selection_sync_failed");
        } finally {
          session.gate.finishManual(revision);
        }
      });
    },
  };
}
