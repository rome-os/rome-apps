import { useEffect, useRef, useState } from "react";
import { api, type SearchResponse } from "../api";

const PAGE = 50;
interface SearchState {
  key: string;
  result: SearchResponse | null;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
}
interface SearchOwner {
  key: string;
  inFlight: boolean;
  nextOffset: number;
  hasMore: boolean;
}

/** Fixed-size catalog pages, owned by one query/platform lifetime. No data calls. */
export function useEndpointSearch(platform: string, query: string) {
  const key = JSON.stringify([platform, query]);
  const current = useRef<SearchOwner | null>(null);
  const [state, setState] = useState<SearchState | null>(null);

  async function request(owner: SearchOwner, offset: number) {
    if (current.current !== owner || owner.inFlight) return;
    owner.inFlight = true;
    setState(previous => current.current !== owner ? previous : {
      key, result: previous?.key === key ? previous.result : null,
      loading: true, error: null, hasMore: owner.hasMore,
    });
    try {
      const params = new URLSearchParams({ platform, q: query, limit: String(PAGE), offset: String(offset) });
      const page = await api<SearchResponse>(`endpoints?${params}`);
      if (current.current !== owner) return;
      owner.nextOffset = offset + page.items.length;
      owner.hasMore = page.items.length > 0 && owner.nextOffset < page.total;
      setState(previous => {
        if (current.current !== owner) return previous;
        const old = offset > 0 && previous?.key === key ? previous.result?.items ?? [] : [];
        const seen = new Set<string>();
        const items = [...old, ...page.items].filter(item => {
          const id = `${item.method} ${item.path}`;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        return { key, result: { ...page, items }, loading: false, error: null, hasMore: owner.hasMore };
      });
    } catch (error) {
      if (current.current === owner) setState(previous => current.current !== owner ? previous : {
        key, result: previous?.key === key ? previous.result : null,
        loading: false, error: (error as Error).message, hasMore: owner.hasMore,
      });
    } finally {
      owner.inFlight = false;
    }
  }

  useEffect(() => {
    const owner: SearchOwner = { key, inFlight: false, nextOffset: 0, hasMore: false };
    current.current = owner;
    void request(owner, 0);
    return () => { if (current.current === owner) current.current = null; };
  }, [key]);

  function loadMore() {
    const owner = current.current;
    if (owner?.key === key && owner.hasMore) void request(owner, owner.nextOffset);
  }

  const visible = state?.key === key ? state : null;
  return { result: visible?.result ?? null, loading: visible?.loading ?? true, error: visible?.error ?? null, hasMore: visible?.hasMore ?? false, loadMore };
}
