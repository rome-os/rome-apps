import { useMemo, useState } from "react";
import { ExternalLink, HandCoins, Plus, UserRound } from "lucide-react";
import { Button } from "@rome-os/ui/button";
import { Dialog, DialogBody, DialogDescription, DialogHeader, DialogTitle } from "@rome-os/ui/dialog";
import { EmptyState, EmptyStateAction, EmptyStateDescription, EmptyStateIcon, EmptyStateTitle } from "@rome-os/ui/empty-state";
import { Input } from "@rome-os/ui/input";
import { Measure, Page, PageActions, PageDescription, PageHeader, PageHeading, PageTitle } from "@rome-os/ui/page";
import { SegmentedControl } from "@rome-os/ui/segmented-control";
import { Skeleton } from "@rome-os/ui/skeleton";
import { usdFor, type DashboardView, type RequestView } from "../../shared/model";
import { CopyButton, Notice, StatusBadge, displayStatus } from "../components/common";
import { RequestForm, draftFrom, type RequestDraft } from "../components/request-form";
import { api } from "../lib/api";
import { copyText, favors, payLink, shortDate } from "../lib/format";
import { go } from "../lib/route";

type Filter = "all" | "open" | "paid" | "void";

export function Dashboard({ data, error, onChange }: { data: DashboardView | null; error: string | null; onChange: () => Promise<void> }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    const all = data?.requests ?? [];
    return filter === "all" ? all : all.filter((r) => r.status === filter);
  }, [data, filter]);

  return (
    <Page className="min-h-full bg-[var(--app-canvas)]">
      <PageHeader>
        <PageHeading>
          <PageTitle>Settle</PageTitle>
          <PageDescription>Favor requests for work you've already done.</PageDescription>
        </PageHeading>
        <PageActions>
          <Button variant="outline" onClick={() => go("profile")}>
            <UserRound /> Your profile
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus /> New request
          </Button>
        </PageActions>
      </PageHeader>

      <Measure className="flex max-w-4xl flex-col gap-6 pb-16">
        {error && data ? <Notice tone="warning">Updates are failing — showing the last loaded data. {error}</Notice> : null}
        {error && !data ? <Notice tone="error">{error}</Notice> : null}
        {data && !data.profile.name.trim() ? (
          <Notice tone="info">
            Add your name and photo in{" "}
            <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={() => go("profile")}>
              Your profile
            </button>{" "}
            — the person you helped sees them on every pay page.
          </Notice>
        ) : null}

        {!data && !error ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : null}

        {data ? (
          <>
            <Totals data={data} />
            {data.requests.length === 0 ? (
              <EmptyState className="rounded-12 border border-dashed border-border py-14">
                <EmptyStateIcon>
                  <HandCoins />
                </EmptyStateIcon>
                <EmptyStateTitle>No requests yet</EmptyStateTitle>
                <EmptyStateDescription>Create a request for something you did, then share its link to get paid in favors.</EmptyStateDescription>
                <EmptyStateAction>
                  <Button onClick={() => setCreating(true)}>
                    <Plus /> New request
                  </Button>
                </EmptyStateAction>
              </EmptyState>
            ) : (
              <section className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <SegmentedControl<Filter>
                    aria-label="Filter requests"
                    size="sm"
                    value={filter}
                    onValueChange={setFilter}
                    options={[
                      { value: "all", label: `All · ${data.requests.length}` },
                      { value: "open", label: `Open · ${data.totals.openCount}` },
                      { value: "paid", label: `Paid · ${data.totals.paidCount}` },
                      { value: "void", label: "Withdrawn" },
                    ]}
                  />
                </div>
                {rows.length === 0 ? (
                  <p className="py-10 text-center text-ui text-muted-foreground">Nothing in this view.</p>
                ) : (
                  <ul className="divide-y divide-border overflow-hidden rounded-12 border border-border bg-card">
                    {rows.map((r) => (
                      <RequestRow key={r.id} r={r} />
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        ) : null}
      </Measure>

      <NewRequestDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async () => {
          await onChange();
        }}
      />
    </Page>
  );
}

function Totals({ data }: { data: DashboardView }) {
  const items = [
    { label: "Collected", value: data.totals.collected, note: `${data.totals.paidCount} paid` },
    { label: "Outstanding", value: data.totals.outstanding, note: `${data.totals.openCount} open` },
  ];
  return (
    <div className="grid overflow-hidden rounded-12 border border-border bg-card sm:grid-cols-2">
      {items.map((it, i) => (
        <div key={it.label} className={i ? "border-t border-border p-5 sm:border-l sm:border-t-0" : "p-5"}>
          <div className="text-aux text-muted-foreground">{it.label}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-4xl leading-none tabular-nums text-foreground">{it.value.toLocaleString("en-US")}</span>
            <span className="text-ui text-muted-foreground">favors · {usdFor(it.value)}</span>
          </div>
          <div className="mt-1.5 text-aux text-muted-foreground">{it.note}</div>
        </div>
      ))}
    </div>
  );
}

function RequestRow({ r }: { r: RequestView }) {
  const status = displayStatus(r);
  const meta = [
    r.recipientName ? `For ${r.recipientName}` : null,
    `Created ${shortDate(r.createdAt)}`,
    status === "paid" && r.paidAt ? `Paid ${shortDate(r.paidAt)}` : null,
    status !== "paid" && status !== "void" && r.viewCount ? `Opened ${r.viewCount}×` : null,
    status !== "paid" && status !== "void" && r.dueDate ? `Due ${shortDate(r.dueDate)}` : null,
  ].filter(Boolean);
  return (
    <li>
      <div
        role="link"
        tabIndex={0}
        onClick={() => go(`r/${r.id}`)}
        onKeyDown={(e) => {
          if (e.key === "Enter") go(`r/${r.id}`);
        }}
        className="flex cursor-pointer items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-ui font-medium text-foreground">{r.item}</span>
            <StatusBadge request={r} className="shrink-0" />
          </div>
          <div className="mt-0.5 truncate text-aux text-muted-foreground">{meta.join(" · ")}</div>
        </div>
        <div className="hidden text-right sm:block">
          <div className="text-ui font-medium tabular-nums text-foreground">{favors(r.amount)}</div>
          <div className="text-aux tabular-nums text-muted-foreground">{usdFor(r.amount)}</div>
        </div>
        {r.status === "open" ? <CopyButton value={payLink(r)} label="Copy" variant="ghost" /> : <span className="w-[74px]" />}
      </div>
    </li>
  );
}

function NewRequestDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ request: RequestView; copied: boolean } | null>(null);
  const [formKey, setFormKey] = useState(0);

  function close() {
    onClose();
    setTimeout(() => {
      setCreated(null);
      setError(null);
      setFormKey((k) => k + 1);
    }, 200);
  }

  async function submit(d: RequestDraft, options: { copyLink: boolean }) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ request: RequestView }>("requests", { body: { ...d, dueDate: d.dueDate || null } });
      const copied = options.copyLink ? await copyText(payLink(res.request)) : false;
      setCreated({ request: res.request, copied });
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} size="lg" ariaLabel="New favor request">
      <DialogHeader onClose={close}>
        <DialogTitle>{created ? "Your pay link is ready" : "New favor request"}</DialogTitle>
        <DialogDescription>
          {created
            ? created.copied
              ? "Copied to your clipboard. Send it to the person you helped."
              : "Send this link to the person you helped."
            : "Describe the work, choose the favors, and Settle generates a link to share."}
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        {created ? (
          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              <Input readOnly value={payLink(created.request)} onFocus={(e) => e.currentTarget.select()} className="font-mono text-aux" />
              <CopyButton value={payLink(created.request)} label="Copy" variant="default" size="default" />
            </div>
            <div className="rounded-8 border border-border bg-muted/50 px-3.5 py-3 text-ui">
              <div className="font-medium text-foreground">{created.request.item}</div>
              <div className="text-muted-foreground">
                {favors(created.request.amount)} · {usdFor(created.request.amount)}
                {created.request.recipientName ? ` · for ${created.request.recipientName}` : ""}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" asChild>
                <a href={payLink(created.request)} target="_blank" rel="noreferrer">
                  <ExternalLink /> Preview pay page
                </a>
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const id = created.request.id;
                  close();
                  go(`r/${id}`);
                }}
              >
                Track this request
              </Button>
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <RequestForm
            key={formKey}
            initial={draftFrom(null)}
            submitLabel="Create request"
            busy={busy}
            error={error}
            showCopyOption
            onSubmit={submit}
            onCancel={close}
          />
        )}
      </DialogBody>
    </Dialog>
  );
}
