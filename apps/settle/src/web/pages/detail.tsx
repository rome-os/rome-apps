import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, Ban, Check, CircleDollarSign, Eye, ExternalLink, Pencil, RotateCcw, Send, Trash2, Wallet } from "lucide-react";
import { Button } from "@rome-os/ui/button";
import { Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@rome-os/ui/dialog";
import { Input } from "@rome-os/ui/input";
import { Measure, Page, PageActions, PageHeader, PageHeading, PageTitle } from "@rome-os/ui/page";
import { Skeleton } from "@rome-os/ui/skeleton";
import { usdFor, type ActivityView, type RequestView } from "../../shared/model";
import { CopyButton, Notice, StatusBadge } from "../components/common";
import { RequestForm, draftFrom, type RequestDraft } from "../components/request-form";
import { api } from "../lib/api";
import { dateTime, favors, isOverdue, longDate, payLink } from "../lib/format";
import { go } from "../lib/route";
import { cn } from "../lib/utils";

export function RequestDetail({ id, onChange }: { id: string; onChange: () => Promise<void> }) {
  const [r, setR] = useState<RequestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<null | "delete" | "void" | "mark-paid">(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ request: RequestView }>(`requests/${id}`);
      setR(res.request);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this request.");
    }
  }, [id]);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 10_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  async function act(kind: "void" | "reopen" | "mark-paid" | "delete", payload?: Record<string, unknown>) {
    setBusy(kind);
    setActionError(null);
    try {
      if (kind === "delete") {
        await api(`requests/${id}`, { method: "DELETE" });
        await onChange();
        go("");
        return;
      }
      const res = await api<{ request: RequestView }>(`requests/${id}/${kind}`, { body: payload ?? {} });
      setR(res.request);
      setConfirm(null);
      await onChange();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  async function save(d: RequestDraft) {
    setBusy("edit");
    setActionError(null);
    try {
      const res = await api<{ request: RequestView }>(`requests/${id}`, { method: "PATCH", body: { ...d, dueDate: d.dueDate || null } });
      setR(res.request);
      setEditing(false);
      await onChange();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  }

  const back = (
    <button type="button" onClick={() => go("")} className="mb-2 inline-flex items-center gap-1.5 text-aux text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-3.5" /> All requests
    </button>
  );

  if (!r) {
    return (
      <Page className="min-h-full bg-[var(--app-canvas)]">
        <Measure className="flex flex-col gap-4 pt-8">
          {back}
          {error ? <Notice tone="error">{error}</Notice> : <Skeleton className="h-40 w-full" />}
        </Measure>
      </Page>
    );
  }

  const link = payLink(r);

  return (
    <Page className="min-h-full bg-[var(--app-canvas)]">
      <PageHeader>
        <PageHeading>
          {back}
          <div className="flex flex-wrap items-center gap-2.5">
            <PageTitle>{r.item}</PageTitle>
            <StatusBadge request={r} />
          </div>
        </PageHeading>
        <PageActions>
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil /> Edit
          </Button>
        </PageActions>
      </PageHeader>

      <Measure className="grid max-w-5xl gap-8 pb-16 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-8">
          {actionError ? (
            <Notice tone="error" onDismiss={() => setActionError(null)}>
              {actionError}
            </Notice>
          ) : null}

          {r.status === "open" ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-ui font-medium text-foreground">Pay link</h2>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-aux" />
                <div className="flex gap-2">
                  <CopyButton value={link} label="Copy" variant="default" size="default" />
                  <Button variant="outline" asChild>
                    <a href={link} target="_blank" rel="noreferrer">
                      <ExternalLink /> Preview
                    </a>
                  </Button>
                </div>
              </div>
              <p className="text-aux text-muted-foreground">Anyone with this link can view the request and pay it with favors after signing in to Rome Cloud.</p>
            </section>
          ) : null}

          <section className="flex flex-col gap-3">
            <h2 className="text-ui font-medium text-foreground">Progress</h2>
            <Progress r={r} />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-ui font-medium text-foreground">Activity</h2>
            <Timeline items={r.activity ?? []} />
          </section>
        </div>

        <aside className="flex flex-col gap-6">
          <div className="rounded-12 border border-border bg-card p-5">
            <div className="text-aux text-muted-foreground">Requested</div>
            <div className="mt-1 font-display text-4xl leading-none tabular-nums text-foreground">{r.amount.toLocaleString("en-US")}</div>
            <div className="mt-1 text-ui text-muted-foreground">
              {r.amount === 1 ? "favor" : "favors"} · {usdFor(r.amount)}
            </div>
            <dl className="mt-5 flex flex-col gap-3 border-t border-border pt-4 text-ui">
              <Meta label="For">{r.recipientName || <span className="text-muted-foreground">Not set</span>}</Meta>
              {r.recipientEmail ? <Meta label="Email">{r.recipientEmail}</Meta> : null}
              <Meta label="Created">{longDate(r.createdAt)}</Meta>
              {r.dueDate ? (
                <Meta label="Due">
                  <span className={isOverdue(r) ? "text-destructive" : undefined}>{longDate(r.dueDate)}</span>
                </Meta>
              ) : null}
              {r.status === "paid" ? <Meta label="Paid">{`${longDate(r.paidAt)}${r.payerEmail ? ` · ${r.payerEmail}` : r.paidVia === "manual" ? " · by hand" : ""}`}</Meta> : null}
              <Meta label="Reference">
                <span className="font-mono text-aux">{r.id}</span>
              </Meta>
            </dl>
            {r.details ? <p className="mt-4 whitespace-pre-wrap border-t border-border pt-4 text-ui text-muted-foreground">{r.details}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            {r.status === "open" ? (
              <>
                <Button variant="outline" onClick={() => setConfirm("mark-paid")}>
                  <Check /> Mark paid by hand
                </Button>
                <Button variant="outline" onClick={() => setConfirm("void")}>
                  <Ban /> Withdraw request
                </Button>
              </>
            ) : null}
            {r.status === "void" || (r.status === "paid" && r.paidVia === "manual") ? (
              <Button variant="outline" onClick={() => void act("reopen")} disabled={busy === "reopen"}>
                <RotateCcw /> Reopen
              </Button>
            ) : null}
            {r.status !== "paid" || r.paidVia === "manual" ? (
              <Button variant="ghost" className="text-destructive" onClick={() => setConfirm("delete")}>
                <Trash2 /> Delete
              </Button>
            ) : null}
          </div>
        </aside>
      </Measure>

      <Dialog open={editing} onClose={() => setEditing(false)} size="lg" ariaLabel="Edit request">
        <DialogHeader onClose={() => setEditing(false)}>
          <DialogTitle>Edit request</DialogTitle>
          <DialogDescription>Changes show up on the pay page right away; the link stays the same.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {editing ? (
            <RequestForm
              initial={draftFrom(r)}
              submitLabel="Save changes"
              busy={busy === "edit"}
              error={actionError}
              amountLocked={r.status === "paid"}
              onSubmit={(d) => void save(d)}
              onCancel={() => setEditing(false)}
            />
          ) : null}
        </DialogBody>
      </Dialog>

      <ConfirmDialog
        kind={confirm}
        busy={!!busy}
        item={r.item}
        onClose={() => setConfirm(null)}
        onConfirm={(note) => {
          if (confirm === "mark-paid") void act("mark-paid", { note });
          else if (confirm) void act(confirm);
        }}
      />
    </Page>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-foreground">{children}</dd>
    </div>
  );
}

function Progress({ r }: { r: RequestView }) {
  const startedAt = r.activity?.find((a) => a.kind === "payment_started")?.at ?? null;
  const steps = [
    { label: "Created", done: true, at: r.createdAt, icon: Send },
    { label: "Opened", done: r.viewCount > 0, at: r.firstViewedAt, icon: Eye, note: r.viewCount > 1 ? `${r.viewCount} views` : undefined },
    { label: "Paying", done: !!startedAt || r.status === "paid", at: startedAt, icon: Wallet, note: r.pendingPayment ? "Awaiting Rome Cloud" : undefined },
    { label: "Paid", done: r.status === "paid", at: r.paidAt, icon: CircleDollarSign, note: r.paidVia === "manual" ? "By hand" : undefined },
  ];
  if (r.status === "paid" && r.paidVia === "manual") steps[2] = { ...steps[2], done: !!startedAt };
  const current = steps.findIndex((s) => !s.done);
  return (
    <div className={cn("rounded-12 border border-border bg-card p-5", r.status === "void" && "opacity-60")}>
      <ol className="grid grid-cols-4 gap-2">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const active = i === current && r.status === "open";
          return (
            <li key={s.label} className="relative flex flex-col items-start gap-2">
              {i < steps.length - 1 ? (
                <span aria-hidden className={cn("absolute left-8 right-0 top-4 h-px", steps[i + 1]!.done ? "bg-[var(--st-paid)]" : "bg-border")} />
              ) : null}
              <span
                className={cn(
                  "relative z-10 inline-flex size-8 items-center justify-center rounded-full border",
                  s.done
                    ? "border-transparent bg-[var(--st-paid)] text-[var(--app-canvas)]"
                    : active
                      ? "border-[var(--st-accent)] bg-[var(--st-accent-soft)] text-[var(--st-accent)]"
                      : "border-border bg-card text-muted-foreground",
                )}
              >
                {s.done ? <Check className="size-4" /> : <Icon className="size-4" />}
              </span>
              <span>
                <span className={cn("block text-ui", s.done || active ? "font-medium text-foreground" : "text-muted-foreground")}>{s.label}</span>
                <span className="block text-aux text-muted-foreground">{s.done && s.at ? dateTime(s.at) : active ? "Waiting" : "—"}</span>
                {s.note ? <span className="block text-aux text-muted-foreground">{s.note}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      {r.status === "void" ? <p className="mt-4 text-aux text-muted-foreground">Withdrawn {longDate(r.voidedAt)} — the pay page no longer accepts payment.</p> : null}
    </div>
  );
}

const ACTIVITY_LABEL: Record<ActivityView["kind"], string> = {
  created: "Request created",
  edited: "Edited",
  viewed: "First opened",
  payment_started: "Payment started",
  paid: "Paid with favors",
  declined: "Payment declined",
  marked_paid: "Marked paid by hand",
  voided: "Withdrawn",
  reopened: "Reopened",
  duplicate_payment: "Extra payment received",
};

function Timeline({ items }: { items: ActivityView[] }) {
  if (!items.length) return <p className="text-ui text-muted-foreground">No activity yet.</p>;
  return (
    <ol className="flex flex-col">
      {[...items].reverse().map((a, i) => (
        <li key={`${a.at}-${i}`} className="flex gap-3 border-l border-border pb-4 pl-4 last:pb-0">
          <span
            aria-hidden
            className={cn(
              "-ml-[21px] mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-[var(--app-canvas)]",
              a.kind === "paid" || a.kind === "marked_paid" ? "bg-[var(--st-paid)]" : a.kind === "duplicate_payment" || a.kind === "declined" ? "bg-destructive" : "bg-muted-foreground",
            )}
          />
          <div className="min-w-0">
            <div className="text-ui text-foreground">{ACTIVITY_LABEL[a.kind] ?? a.kind}</div>
            <div className="text-aux text-muted-foreground">
              {dateTime(a.at)}
              {a.detail ? ` · ${a.detail}` : ""}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ConfirmDialog({
  kind,
  busy,
  item,
  onClose,
  onConfirm,
}: {
  kind: null | "delete" | "void" | "mark-paid";
  busy: boolean;
  item: string;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  useEffect(() => setNote(""), [kind]);
  const copy = {
    delete: { title: "Delete this request?", body: `“${item}” and its history will be removed. The link stops working.`, cta: "Delete" },
    void: { title: "Withdraw this request?", body: "The link keeps working but shows that nothing is owed. You can reopen it later.", cta: "Withdraw" },
    "mark-paid": { title: "Mark as paid by hand?", body: "Use this when you were paid some other way. The pay page will show it as settled.", cta: "Mark paid" },
  } as const;
  const c = kind ? copy[kind] : null;
  return (
    <Dialog open={!!kind} onClose={onClose} size="sm" ariaLabel={c?.title ?? "Confirm"}>
      {c ? (
        <>
          <DialogHeader onClose={onClose}>
            <DialogTitle>{c.title}</DialogTitle>
            <DialogDescription>{c.body}</DialogDescription>
          </DialogHeader>
          {kind === "mark-paid" ? (
            <DialogBody>
              <Input placeholder="Note (optional), e.g. Paid over coffee" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            </DialogBody>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant={kind === "delete" ? "destructive" : "default"} onClick={() => onConfirm(note)} disabled={busy}>
              {busy ? "Working…" : c.cta}
            </Button>
          </DialogFooter>
        </>
      ) : null}
    </Dialog>
  );
}
