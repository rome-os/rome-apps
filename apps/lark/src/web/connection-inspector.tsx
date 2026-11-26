import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@rome-os/ui/button";
import { Input } from "@rome-os/ui/input";
import { navigateRome } from "@rome-os/app-web-sdk";
import { api } from "./api.js";
import { SCOPE_OPERATION } from "../shared/catalog.js";
import type { ScopeSnapshot, CoreConnection } from "../lib/core-broker.js";
import { useI18n } from "./i18n.js";
export function useCoreConnection(connectionId: string) {
  return useQuery({
    queryKey: ["core-connection", connectionId],
    queryFn: () =>
      api<CoreConnection>(`connections/${encodeURIComponent(connectionId)}`),
    enabled: connectionId !== "local-cli",
    retry: false,
    refetchInterval: 10000,
  });
}
export function ConnectionInspector({
  connectionId,
}: {
  connectionId: string;
}) {
  const { t, error } = useI18n();
  const core = useCoreConnection(connectionId);
  const canUse = (op: string) =>
    !core.error &&
    core.data?.act.state === "available" &&
    core.data.grantedOperations.includes(op);
  const scopes = useQuery({
    queryKey: ["scopes", connectionId],
    queryFn: () =>
      api<ScopeSnapshot>(
        `connections/${encodeURIComponent(connectionId)}/permissions`,
      ),
    enabled: !!canUse(SCOPE_OPERATION),
    retry: false,
    refetchInterval: 30000,
  });
  const [doc, setDoc] = useState("");
  const access = useMutation({
    mutationFn: () =>
      api<{
        status: string;
        error?: string;
        data?: { access: string; error?: string };
      }>("check-access", {
        method: "POST",
        body: JSON.stringify({ connectionId, identity: "bot", doc }),
      }),
  });
  return (
    <div className="flex min-w-0 flex-col gap-3 border-t border-border pt-3">
      <p className="text-sm">{t("phaseOneScope")}</p>
      {canUse(SCOPE_OPERATION) ? (
        scopes.error ? (
          <p role="alert">
            {t("scopeFailed")} {error(scopes.error.message)}
          </p>
        ) : scopes.data?.status === "checked" ? (
          <div>
            <p>
              {t("scopeSnapshotNote")} <time>{scopes.data.checkedAt}</time>
            </p>
            <ul>
              {scopes.data.scopes.map((scope, i) => (
                <li key={i}>
                  <code>{scope.scopeName}</code> ·{" "}
                  {scope.grantStatus === 1
                    ? t("scopeGranted")
                    : scope.grantStatus === 2
                      ? t("scopeMissing")
                      : t("cap_unknown")}
                </li>
              ))}
            </ul>
            {!scopes.data.scopes.length && <p>{t("emptyScopes")}</p>}
          </div>
        ) : scopes.data ? (
          <p role="alert">
            {t(
              scopes.data.status === "unauthorized"
                ? "scopeUnauthorized"
                : "scopeFailed",
            )}{" "}
            {error(scopes.data.error)}
          </p>
        ) : (
          <p>{t("loading")}</p>
        )
      ) : core.data &&
        !core.error &&
        !core.data.grantedOperations.includes(SCOPE_OPERATION) ? (
        <p>
          {t("coreGrant")} <code>{SCOPE_OPERATION}</code>
        </p>
      ) : null}
      <Button
        variant="outline"
        className="self-start"
        onClick={() => navigateRome({ path: "settings" })}
      >
        {t("manageAppAccess")}
      </Button>
      {core.error ? <p role="alert">{error(core.error.message)}</p> : null}
      <Input
        value={doc}
        aria-label={t("documentUrl")}
        onChange={(event) => {
          setDoc(event.target.value);
          access.reset();
        }}
        placeholder="https://example.feishu.cn/docx/…"
      />
      <Button
        variant="outline"
        className="self-start"
        disabled={
          !doc ||
          !canUse("feishu.document.read") ||
          !!core.error ||
          core.isFetching ||
          access.isPending
        }
        onClick={() => access.mutate()}
      >
        {t("checkDocumentAccess")}
      </Button>
      {access.error ? <p role="alert">{error(access.error.message)}</p> : null}
      {access.data && canUse("feishu.document.read") ? (
        <p role="status">
          {access.data.status === "error"
            ? error(access.data.error ?? "unknown")
            : access.data.data?.access === "confirmed"
              ? t("accessConfirmed")
              : error(access.data.data?.error ?? t("accessUnknown"))}
        </p>
      ) : null}
    </div>
  );
}
