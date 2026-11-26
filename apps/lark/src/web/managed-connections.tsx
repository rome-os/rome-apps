import { useState } from "react";
import { ConnectionInspector } from "./connection-inspector.js";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@rome-os/ui/button";
import { Badge } from "@rome-os/ui/badge";
import { Alert, AlertDescription } from "@rome-os/ui/alert";
import { Spinner } from "@rome-os/ui/spinner";
import { navigateRome } from "@rome-os/app-web-sdk";
import {
  projectGrantedConnections,
} from "../shared/managed-connections.js";
import { useI18n, type MessageKey } from "./i18n.js";

export function useManagedConnections() {
  const query = useInfiniteQuery({
    queryKey: ["managed-connections"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const response = await fetch(
        `/api/apps/lark/connections${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        {
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(12000),
        },
      );
      if (!response.ok) throw new Error(`connections_http_${response.status}`);
      const result = await response.json();
      return {
        items: projectGrantedConnections(result),
        nextCursor:
          typeof result.nextCursor === "string" ? result.nextCursor : undefined,
      };
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  return { ...query, data: query.data?.pages.flatMap((page) => page.items) };
}

export function ManagedConnections() {
  const { t } = useI18n();
  const query = useManagedConnections();
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{t("managedConnections")}</h2>
        <Button
          size="sm"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t("refreshConnections")}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t("managedNote")}</p>

      {query.isPending ? <Spinner /> : null}
      {query.error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(query.data ? "stale" : "connectionsUnavailable")}
        </p>
      ) : null}
      {query.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("noManagedConnections")}
        </p>
      ) : null}
      <Button
        variant="outline"
        className="self-start"
        onClick={() => navigateRome({ path: "settings" })}
      >
        {t("manageAppAccess")}
      </Button>
      {query.hasNextPage ? (
        <Button
          variant="outline"
          className="self-start"
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          {t("moreConnections")}
        </Button>
      ) : null}
      <div className="divide-y divide-border">
        {query.data?.map((connection) => (
          <div key={connection.id} className="flex min-w-0 flex-col gap-3 py-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="break-words text-sm font-medium">
                  {connection.label}
                </h3>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {connection.id}
                </p>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {connection.appId ?? t("appIdUnavailable")}
                </p>
              </div>
              <Badge variant="outline">
                {t(`grant_${connection.grant}` as MessageKey)}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("imCapability")}: {t(`cap_${connection.talk}` as MessageKey)} ·{" "}
              {t("coreActCapability")}:{" "}
              {t(`cap_${connection.act}` as MessageKey)}
            </p>
            <Button
              className="self-start"
              size="sm"
              variant="outline"
              onClick={() =>
                setSelected(selected === connection.id ? null : connection.id)
              }
            >
              {t("inspectConnection")}
            </Button>
            {selected === connection.id ? (
              <ConnectionInspector
                key={connection.id}
                connectionId={connection.id}
              />
            ) : null}
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="font-medium">{t("tenantScopes")}</dt>
                <dd className="mt-1 text-muted-foreground">
                  {t("clickInspect")}
                </dd>
              </div>
              <div>
                <dt className="font-medium">{t("userScopes")}</dt>
                <dd className="mt-1 text-muted-foreground">
                  {t("unsupportedUser")}
                </dd>
              </div>
              <div>
                <dt className="font-medium">{t("resourceAcl")}</dt>
                <dd className="mt-1 text-muted-foreground">
                  {t("perResource")}
                </dd>
              </div>
            </dl>

          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("permissionGuidance")}</p>
      <Button
        className="self-start"
        variant="outline"
        size="sm"
        onClick={() => navigateRome({ path: "settings" })}
      >
        {t("settings")}
      </Button>
    </section>
  );
}
