import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CallerBadge, isPreview, useVisitorSignIn } from "@rome-os/app-web-sdk";
import { ArrowRight, ArrowUpRight, Check, LockKeyhole, ShieldCheck } from "lucide-react";
import { Button } from "@rome-os/ui/button";
import { Skeleton } from "@rome-os/ui/skeleton";
import { favorWord, formatFavors, payeeName, usdFor, type Profile, type PublicRequestView } from "../../shared/model";
import { CopyButton, Notice, PayeeAvatar } from "../components/common";
import { ApiError, api } from "../lib/api";
import { favors, longDate } from "../lib/format";
import { clearQuery, go, queryParam } from "../lib/route";
import { cn } from "../lib/utils";

type Tone = "success" | "warning" | "error" | "info";

export function PayPage({ id }: { id: string }) {
  const [data, setData] = useState<PublicRequestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: Tone; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [justPaid, setJustPaid] = useState(false);
  const counted = useRef(false);
  const handled = useRef(false);
  const { signIn, signingIn, errorMessage: signInError } = useVisitorSignIn();

  const load = useCallback(async () => {
    try {
      const view = !counted.current;
      counted.current = true;
      const next = await api<PublicRequestView>(`p/${id}${view ? "?view=1" : ""}`);
      setData(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this request.");
      return null;
    }
  }, [id]);

  const pay = useCallback(async () => {
    if (!data) return;
    setNotice(null);
    if (data.viewer.kind === "guardian") {
      setNotice({ tone: "info", text: "This is your own request — share the link so the other person can pay." });
      return;
    }
    if (data.viewer.kind === "anonymous") {
      if (isPreview()) {
        setNotice({ tone: "info", text: "Sign-in isn't available in this preview." });
        return;
      }
      await signIn(`${window.location.pathname}?pay=1`);
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ status: string; paymentId?: string; authorizationUrl?: string | null }>(`p/${id}/pay`, {
        body: {},
      });
      if (res.status === "pending_consent" && res.authorizationUrl) {
        window.location.href = res.authorizationUrl;
        return;
      }
      if (res.status === "paid") {
        setJustPaid(true);
        await load();
      } else if (res.status === "processing") {
        setNotice({ tone: "info", text: "Payment received — confirming with Rome Cloud. This takes a few seconds." });
        await load();
      } else if (res.status === "declined") {
        setNotice({ tone: "warning", text: "The payment was declined, so nothing was charged." });
      } else {
        setNotice({ tone: "error", text: "We couldn't start the payment. Please try again." });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "visitor_auth_required") {
        await signIn(`${window.location.pathname}?pay=1`);
        return;
      }
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }, [data, id, load, signIn]);

  useEffect(() => {
    void load();
  }, [load]);

  // Returning from Rome Cloud (after paying) or from sign-in (to continue paying).
  useEffect(() => {
    if (!data || handled.current) return;
    const paymentId = queryParam("payment");
    const favor = queryParam("favor");
    const resume = queryParam("pay") === "1";
    if (!paymentId && !resume) return;
    handled.current = true;
    clearQuery();
    if (paymentId) {
      (async () => {
        try {
          const res = await api<{ status: string }>(`p/${id}/sync`, { body: { paymentId } });
          if (res.status === "paid") setJustPaid(true);
          else if (res.status === "declined" || favor === "declined") setNotice({ tone: "warning", text: "The payment was declined, so nothing was charged. You can pay anytime." });
          else if (res.status === "processing" || res.status === "awaiting") setNotice({ tone: "info", text: "Payment received — confirming with Rome Cloud. This takes a few seconds." });
          await load();
        } catch (err) {
          setNotice({ tone: "warning", text: err instanceof Error ? err.message : "We couldn't confirm the payment yet. Refresh in a moment." });
        }
      })();
    } else if (resume && data.status === "open" && data.viewer.kind === "visitor") {
      void pay();
    }
  }, [data, id, load, pay]);

  // While a payment is settling, check back until it lands.
  const settling = !!data && data.status === "open" && !!data.viewer.pendingPaymentId && notice?.tone === "info";
  useEffect(() => {
    if (!settling) return;
    const started = Date.now();
    const t = setInterval(async () => {
      const next = await load();
      if (next?.status === "paid") {
        setJustPaid(true);
        setNotice(null);
      }
      if (Date.now() - started > 90_000) clearInterval(t);
    }, 3000);
    return () => clearInterval(t);
  }, [settling, load]);

  return (
    <div className="min-h-full bg-[var(--app-canvas)] text-foreground antialiased">
      <header className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-5 sm:px-8">
        <span className="font-display text-xl tracking-tight text-foreground">
          Settle<span className="text-[var(--st-accent)]">.</span>
        </span>
        <CallerBadge signedOutHint="Sign in with Rome Cloud to pay with favors." guardianHint="You sent this request." />
      </header>

      <main className="mx-auto w-full max-w-5xl px-5 pb-20 pt-6 sm:px-8 lg:pt-14">
        {error && !data ? (
          <Missing message={error} />
        ) : !data ? (
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
            <Skeleton className="h-72" />
            <Skeleton className="h-[28rem]" />
          </div>
        ) : (
          <>
            {data.viewer.kind === "guardian" ? <OwnerBar id={data.id} /> : null}
            <div className="st-motion grid items-start gap-10 lg:grid-cols-[1fr_1.12fr] lg:gap-16" style={{ animation: "st-rise 500ms ease-out both" }}>
              <PayeeColumn profile={data.profile} data={data} />
              <Invoice
                data={data}
                justPaid={justPaid}
                busy={busy || signingIn}
                notice={notice ?? (signInError ? { tone: "error", text: signInError } : null)}
                onDismiss={() => setNotice(null)}
                onPay={() => void pay()}
              />
            </div>
          </>
        )}
      </main>

      <footer className="mx-auto w-full max-w-5xl px-5 pb-10 text-aux text-muted-foreground sm:px-8">
        Favor requests by Settle · Payments handled by Rome Cloud
      </footer>
    </div>
  );
}

function OwnerBar({ id }: { id: string }) {
  return (
    <div className="mb-8 flex flex-col gap-3 rounded-12 border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-ui text-muted-foreground">
        <span className="font-medium text-foreground">Preview.</span> This is what the person you helped sees.
      </p>
      <div className="flex gap-2">
        <CopyButton value={window.location.href.split("?")[0]!} />
        <Button size="sm" variant="ghost" onClick={() => go(`r/${id}`)}>
          Track progress
        </Button>
      </div>
    </div>
  );
}

export function PayeeIdentity({ profile, size = "lg" }: { profile: Profile; size?: "lg" | "md" }) {
  const role = [profile.title, profile.company].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-4">
      <PayeeAvatar profile={profile} className={size === "lg" ? "size-16 text-2xl" : "size-12 text-lg"} />
      <div className="min-w-0">
        <div className={cn("font-display leading-tight text-foreground", size === "lg" ? "text-3xl" : "text-2xl")}>{payeeName(profile)}</div>
        {role ? <div className="mt-0.5 text-ui text-muted-foreground">{role}</div> : null}
      </div>
    </div>
  );
}

function PayeeColumn({ profile, data }: { profile: Profile; data: PublicRequestView }) {
  const host = profile.website ? profile.website.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";
  return (
    <section className="flex flex-col gap-8 lg:sticky lg:top-10">
      <div className="flex flex-col gap-5">
        <Eyebrow>Favor request from</Eyebrow>
        <PayeeIdentity profile={profile} />
        {profile.bio ? <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">{profile.bio}</p> : null}
        {host ? (
          <a href={profile.website} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-ui text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
            {host} <ArrowUpRight className="size-3.5" />
          </a>
        ) : null}
      </div>

      <div className="hidden border-t border-border pt-6 lg:block">
        <div className="text-aux uppercase tracking-[0.14em] text-muted-foreground">{data.status === "paid" ? "Paid" : "Amount requested"}</div>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="font-display text-7xl leading-none tabular-nums text-foreground">{formatFavors(data.amount)}</span>
          <span className="font-display text-2xl italic text-muted-foreground">{favorWord(data.amount)}</span>
        </div>
        <div className="mt-2 text-ui text-muted-foreground">About {usdFor(data.amount)} at Rome Cloud's favor rate</div>
      </div>

      <ul className="hidden flex-col gap-2.5 text-ui text-muted-foreground lg:flex">
        <li className="flex items-center gap-2.5">
          <ShieldCheck className="size-4 text-[var(--st-accent)]" /> You confirm the exact amount on Rome Cloud first
        </li>
        <li className="flex items-center gap-2.5">
          <LockKeyhole className="size-4 text-[var(--st-accent)]" /> Nothing is charged until you approve
        </li>
      </ul>
    </section>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="text-aux font-medium uppercase tracking-[0.16em] text-[var(--st-accent)]">{children}</div>;
}

function Invoice({
  data,
  justPaid,
  busy,
  notice,
  onDismiss,
  onPay,
}: {
  data: PublicRequestView;
  justPaid: boolean;
  busy: boolean;
  notice: { tone: Tone; text: string } | null;
  onDismiss: () => void;
  onPay: () => void;
}) {
  const paid = data.status === "paid";
  const withdrawn = data.status === "void";
  const meta = [
    { label: "Billed to", value: data.recipientName || "—" },
    { label: "Issued", value: longDate(data.createdAt) },
    { label: paid ? "Paid" : "Due", value: paid ? longDate(data.paidAt) : data.dueDate ? longDate(data.dueDate) : "On receipt" },
  ];

  return (
    <article className="relative overflow-hidden rounded-16 border border-border bg-card shadow-4">
      <div aria-hidden className="h-1 w-full bg-[var(--st-accent)]" />
      <div className="px-6 pb-6 pt-7 sm:px-9 sm:pt-9">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>Favor request</Eyebrow>
          <span className="font-mono text-aux text-muted-foreground">No. {data.id.slice(0, 6).toUpperCase()}</span>
        </div>
        <h1 className="mt-4 font-display text-4xl leading-[1.08] text-foreground sm:text-[2.75rem]">{data.item}</h1>
        {data.details ? <p className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-muted-foreground">{data.details}</p> : null}

        <dl className="mt-7 grid grid-cols-3 gap-4 border-t border-border pt-5">
          {meta.map((m) => (
            <div key={m.label} className="min-w-0">
              <dt className="text-aux text-muted-foreground">{m.label}</dt>
              <dd className="mt-1 truncate text-ui font-medium text-foreground">{m.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <Perforation />

      <div className="relative px-6 pb-7 pt-6 sm:px-9 sm:pb-9">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-aux text-muted-foreground">{paid ? "Total paid" : withdrawn ? "Total" : "Total due"}</div>
            <div className="mt-1 text-aux text-muted-foreground">{usdFor(data.amount)} equivalent</div>
          </div>
          <div className={cn("font-display text-4xl tabular-nums text-foreground", withdrawn && "text-muted-foreground line-through")}>{favors(data.amount)}</div>
        </div>

        {paid ? <PaidStamp date={data.paidAt} animate={justPaid} /> : null}

        <div className="mt-6 flex flex-col gap-3">
          {notice ? (
            <Notice tone={notice.tone} onDismiss={onDismiss}>
              {notice.text}
            </Notice>
          ) : null}

          {paid ? (
            <div className="rounded-12 bg-[var(--st-paid-soft)] px-4 py-3.5 text-ui">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <Check className="size-4 text-[var(--st-paid)]" />
                {data.viewer.isPayer || justPaid ? "Thank you — your payment is complete." : "This request has been settled."}
              </div>
              <p className="mt-1 text-muted-foreground">
                {data.viewer.isPayer || justPaid
                  ? `${data.profile.name.trim() ? `${data.profile.name.trim().split(" ")[0]} has` : "They've"} been notified. You can keep this page as your receipt.`
                  : "Nothing more is owed."}
              </p>
            </div>
          ) : withdrawn ? (
            <div className="rounded-12 bg-muted px-4 py-3.5 text-ui text-muted-foreground">This request was withdrawn, so there's nothing to pay.</div>
          ) : (
            <>
              <Button size="md" className="h-12 w-full text-[15px]" onClick={onPay} disabled={busy || data.viewer.kind === "guardian"}>
                {busy ? (
                  "Opening Rome Cloud…"
                ) : data.viewer.kind === "anonymous" ? (
                  <>
                    Sign in to pay {favors(data.amount)} <ArrowRight />
                  </>
                ) : (
                  <>
                    Pay {favors(data.amount)} <ArrowRight />
                  </>
                )}
              </Button>
              <p className="flex items-start justify-center gap-1.5 text-center text-aux text-muted-foreground">
                <LockKeyhole className="mt-px size-3.5 shrink-0" />
                {data.viewer.kind === "guardian"
                  ? "You sent this request, so you can't pay it yourself."
                  : data.viewer.kind === "visitor"
                    ? `Signed in as ${data.viewer.email}. You'll confirm on Rome Cloud before anything is charged.`
                    : "Secure checkout with Rome Cloud favors. You'll confirm before anything is charged."}
              </p>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

/** A tear line with notches cut into both edges of the card. */
function Perforation() {
  return (
    <div aria-hidden className="relative h-6">
      <span className="absolute -left-3 top-0 size-6 rounded-full border border-border bg-[var(--app-canvas)]" />
      <span className="absolute left-5 right-5 top-1/2 border-t-2 border-dashed border-border" />
      <span className="absolute -right-3 top-0 size-6 rounded-full border border-border bg-[var(--app-canvas)]" />
    </div>
  );
}

function PaidStamp({ date, animate }: { date: string | null; animate: boolean }) {
  return (
    <div
      aria-label="Paid"
      className={cn("st-motion pointer-events-none absolute right-7 top-[-46px] sm:right-10")}
      style={{ transform: "rotate(-12deg)", animation: animate ? "st-stamp 700ms cubic-bezier(.2,.8,.2,1) both" : undefined }}
    >
      <div className="rounded-8 border-2 border-[var(--st-paid)] px-3 py-1 text-center text-[var(--st-paid)]">
        <div className="font-display text-3xl uppercase leading-none tracking-[0.12em]">Paid</div>
        {date ? <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em]">{longDate(date)}</div> : null}
      </div>
    </div>
  );
}

function Missing({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <h1 className="font-display text-4xl text-foreground">Request not found</h1>
      <p className="mt-3 text-ui text-muted-foreground">{message} Check the link you were sent, or ask the sender for a new one.</p>
    </div>
  );
}
