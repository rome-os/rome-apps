import { useState, type FormEvent } from "react";
import { Button } from "@rome-os/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@rome-os/ui/field";
import { Input } from "@rome-os/ui/input";
import { Switch } from "@rome-os/ui/switch";
import { Textarea } from "@rome-os/ui/textarea";
import { TIERS, formatFavors, usdFor, type RequestView, type Tier } from "../../shared/model";
import { cn } from "../lib/utils";

export interface RequestDraft {
  item: string;
  details: string;
  recipientName: string;
  recipientEmail: string;
  amount: Tier;
  dueDate: string;
}

export function draftFrom(r?: RequestView | null): RequestDraft {
  return {
    item: r?.item ?? "",
    details: r?.details ?? "",
    recipientName: r?.recipientName ?? "",
    recipientEmail: r?.recipientEmail ?? "",
    amount: ((r?.amount as Tier | undefined) ?? 1000) as Tier,
    dueDate: r?.dueDate ?? "",
  };
}

export function TierPicker({ value, onChange, disabled }: { value: Tier; onChange: (t: Tier) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Favor amount" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {TIERS.map((t) => {
        const active = t === value;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(t)}
            className={cn(
              "flex flex-col items-start rounded-8 border px-2.5 py-2 text-left transition-colors disabled:opacity-50",
              active ? "border-primary bg-accent text-foreground" : "border-border hover:bg-surface-hover",
            )}
          >
            <span className="text-ui font-medium tabular-nums">{formatFavors(t)}</span>
            <span className="text-aux text-muted-foreground tabular-nums">{usdFor(t)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function RequestForm({
  initial,
  submitLabel,
  busy,
  error,
  amountLocked,
  showCopyOption,
  onSubmit,
  onCancel,
}: {
  initial: RequestDraft;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  amountLocked?: boolean;
  showCopyOption?: boolean;
  onSubmit: (draft: RequestDraft, options: { copyLink: boolean }) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<RequestDraft>(initial);
  const [copyLink, setCopyLink] = useState(true);
  const set = <K extends keyof RequestDraft>(k: K, v: RequestDraft[K]) => setD((prev) => ({ ...prev, [k]: v }));

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(d, { copyLink });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="st-item">What was the work?</FieldLabel>
          <Input
            id="st-item"
            autoFocus
            required
            maxLength={140}
            placeholder="e.g. Pitch deck review and investor intros"
            value={d.item}
            onChange={(e) => set("item", e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="st-details">Details</FieldLabel>
          <Textarea
            id="st-details"
            rows={3}
            maxLength={2000}
            placeholder="A short note on what you did. The payer sees this."
            value={d.details}
            onChange={(e) => set("details", e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="st-name">Who it was for</FieldLabel>
            <Input id="st-name" maxLength={120} placeholder="Name or company" value={d.recipientName} onChange={(e) => set("recipientName", e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="st-email">Their email</FieldLabel>
            <Input
              id="st-email"
              type="email"
              maxLength={254}
              placeholder="Optional — for your records"
              value={d.recipientEmail}
              onChange={(e) => set("recipientEmail", e.target.value)}
            />
          </Field>
        </div>
        <Field>
          <FieldLabel>Favors requested</FieldLabel>
          <TierPicker value={d.amount} onChange={(t) => set("amount", t)} disabled={amountLocked} />
          <FieldDescription>
            {amountLocked ? "This request is paid, so the amount is final." : "Rome Cloud prices favors at 250 per dollar."}
          </FieldDescription>
        </Field>
        <Field className="sm:max-w-56">
          <FieldLabel htmlFor="st-due">Due date</FieldLabel>
          <Input id="st-due" type="date" value={d.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
        </Field>
        {showCopyOption ? (
          <label className="flex items-center justify-between gap-4 rounded-8 border border-border px-3.5 py-3">
            <span>
              <span className="block text-ui font-medium">Generate and copy the pay link</span>
              <span className="block text-aux text-muted-foreground">The link is copied to your clipboard as soon as the request is saved.</span>
            </span>
            <Switch checked={copyLink} onCheckedChange={setCopyLink} />
          </label>
        ) : null}
      </FieldGroup>
      {error ? <p className="text-ui text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !d.item.trim()}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
