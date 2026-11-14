import { useEffect, useMemo, useState } from "react";
import { navigateToApp } from "@rome-os/app-web-sdk";
import { Search, ShieldAlert } from "lucide-react";
import { Badge } from "@rome-os/ui/badge";
import { Button } from "@rome-os/ui/button";
import { Input } from "@rome-os/ui/input";
import { List, ListRow, ListRowContent, ListRowDescription, ListRowTitle } from "@rome-os/ui/list-row";
import { Skeleton } from "@rome-os/ui/skeleton";
import { api, endpointRoute, formatUsd, type CatalogInfo } from "../api";
import { useI18n } from "../i18n";
import { ErrorAlert, MethodBadge } from "./common";
import { useEndpointSearch } from "../hooks/useEndpointSearch";
import { PlatformPicker } from "./PlatformPicker";

export const DEFAULT_PLATFORM = "douyin";

/**
 * Endpoint browser. The platform comes from the route (`explorer/<platform>`),
 * defaulting to Douyin — there is deliberately no "all platforms" view.
 * Switching platforms navigates, so every list is deep-linkable.
 */
export function Explorer({ platform: routePlatform }: { platform?: string }) {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<CatalogInfo | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<CatalogInfo>("catalog").then(value => { if (!cancelled) setCatalog(value); }, (e: Error) => { if (!cancelled) setCatalogError(e.message); });
    return () => { cancelled = true; };
  }, []);

  const platforms = useMemo(() => catalog?.platforms.filter((p) => p.operations > 0) ?? [], [catalog]);
  // Unknown ids in the URL (typos, removed platforms) fall back to the default.
  const platform =
    routePlatform && (!catalog || platforms.some((p) => p.id === routePlatform)) ? routePlatform : DEFAULT_PLATFORM;
  const current = platforms.find((p) => p.id === platform);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { result: shown, loading, error: searchError, hasMore, loadMore } = useEndpointSearch(platform, debounced);
  const error = searchError ?? catalogError;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <PlatformPicker platforms={platforms} value={platform} onChange={(id) => navigateToApp(`explorer/${id}`)} />
        <Input
          className="w-full"
          icon={<Search />}
          placeholder={t("explorer.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={t("explorer.searchLabel")}
          type="search"
        />
      </div>
      {current?.note ? <p className="text-ui text-muted-foreground">{current.note}</p> : null}
      {error ? <ErrorAlert title={t("explorer.searchError")} error={error} /> : null}

      {shown ? (
        <>
          <div className="text-aux text-muted-foreground">
            {t("explorer.count", { count: shown.total })}
            {shown.schemaVersion ? ` · OpenAPI ${shown.schemaVersion}` : ""}
            {loading ? t("explorer.updating") : ""}
          </div>
          {shown.items.length === 0 ? (
            <p className="text-ui text-muted-foreground">{t("explorer.noMatch")}</p>
          ) : (
            <List asChild className="rounded-12 border border-border">
              <ul>
                {shown.items.map((op) => (
                  <ListRow key={`${op.method} ${op.path}`} asChild interactive>
                    <li>
                      <button
                        type="button"
                        className="flex w-full min-w-0 items-start gap-3 text-left"
                        onClick={() => navigateToApp(endpointRoute(op.method, op.path))}
                      >
                        <MethodBadge method={op.method} />
                        <ListRowContent className="min-w-0">
                          <ListRowTitle className="font-mono text-aux break-all" title={op.path}>
                            {op.path.replace(/^\/api\/v1\//, "")}
                          </ListRowTitle>
                          <ListRowDescription className="line-clamp-2">
                            {op.summary || op.brief}
                            <span className="text-subtle-foreground"> · {op.tag}</span>
                          </ListRowDescription>
                        </ListRowContent>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Badge variant="outline">{formatUsd(op.costUsd)}</Badge>
                          {op.guarded ? (
                            <Badge variant="warning" title={t("explorer.guardedTitle")}>
                              <ShieldAlert />
                              {t("explorer.guarded")}
                            </Badge>
                          ) : null}
                        </div>
                      </button>
                    </li>
                  </ListRow>
                ))}
              </ul>
            </List>
          )}
          {hasMore ? (
            <Button variant="outline" onClick={loadMore} disabled={loading} className="self-center">
              {t("explorer.loadMore", { n: shown.total - shown.items.length })}
            </Button>
          ) : null}
        </>
      ) : !error ? (
        <ListSkeleton />
      ) : null}
    </div>
  );
}

/** Quiet placeholder with the same row geometry as the real list — no layout jump. */
function ListSkeleton() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label={t("explorer.loadingList")}>
      <Skeleton className="h-4 w-40" />
      <div className="flex flex-col divide-y divide-border rounded-12 border border-border">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-start gap-3 p-3">
            <Skeleton className="h-5 w-11" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-4/5" />
            </div>
            <Skeleton className="h-5 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
