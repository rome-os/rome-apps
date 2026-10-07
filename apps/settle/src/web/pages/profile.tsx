import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ImageUp, Trash2 } from "lucide-react";
import { Button } from "@rome-os/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@rome-os/ui/field";
import { Input } from "@rome-os/ui/input";
import { Measure, Page, PageDescription, PageHeader, PageHeading, PageTitle } from "@rome-os/ui/page";
import { Textarea } from "@rome-os/ui/textarea";
import type { Profile } from "../../shared/model";
import { Notice } from "../components/common";
import { api } from "../lib/api";
import { go } from "../lib/route";
import { PayeeIdentity } from "./pay";

type Draft = Pick<Profile, "name" | "title" | "company" | "bio" | "website">;

export function ProfilePage({ profile, onChange }: { profile: Profile | null; onChange: () => Promise<void> }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [avatar, setAvatar] = useState<Profile | null>(profile);
  const [busy, setBusy] = useState<null | "save" | "avatar">(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile && !draft) {
      setDraft({ name: profile.name, title: profile.title, company: profile.company, bio: profile.bio, website: profile.website });
      setAvatar(profile);
    }
  }, [profile, draft]);

  if (!draft || !avatar) return <Page className="min-h-full bg-[var(--app-canvas)]" />;
  const preview: Profile = { ...avatar, ...draft };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy("save");
    setNotice(null);
    try {
      const next = await api<Profile>("profile", { method: "PUT", body: draft });
      setDraft({ name: next.name, title: next.title, company: next.company, bio: next.bio, website: next.website });
      setAvatar(next);
      await onChange();
      setNotice({ tone: "success", text: "Saved. Every pay page now shows this." });
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Could not save." });
    } finally {
      setBusy(null);
    }
  }

  async function upload(f: File | undefined) {
    if (!f) return;
    setBusy("avatar");
    setNotice(null);
    try {
      const next = await api<Profile>("profile/avatar", { raw: f });
      setAvatar(next);
      await onChange();
    } catch (err) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Could not upload." });
    } finally {
      setBusy(null);
      if (file.current) file.current.value = "";
    }
  }

  async function removePhoto() {
    setBusy("avatar");
    try {
      setAvatar(await api<Profile>("profile/avatar", { method: "DELETE" }));
      await onChange();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Page className="min-h-full bg-[var(--app-canvas)]">
      <PageHeader>
        <PageHeading>
          <button type="button" onClick={() => go("")} className="mb-2 inline-flex items-center gap-1.5 text-aux text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> All requests
          </button>
          <PageTitle>Your profile</PageTitle>
          <PageDescription>How you appear at the top of every pay page.</PageDescription>
        </PageHeading>
      </PageHeader>
      <Measure className="grid max-w-5xl gap-10 pb-16 lg:grid-cols-[minmax(0,1fr)_340px]">
        <form onSubmit={save} className="flex flex-col gap-6">
          <div className="flex items-center gap-4">
            <PayeeIdentity profile={preview} size="md" />
            <div className="ml-auto flex gap-2">
              <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
              <Button type="button" variant="outline" size="sm" onClick={() => file.current?.click()} disabled={busy === "avatar"}>
                <ImageUp /> {avatar.hasAvatar ? "Change photo" : "Add photo"}
              </Button>
              {avatar.hasAvatar ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => void removePhoto()} disabled={busy === "avatar"}>
                  <Trash2 /> Remove
                </Button>
              ) : null}
            </div>
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="pf-name">Name</FieldLabel>
              <Input id="pf-name" required maxLength={80} value={draft.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="pf-title">Title</FieldLabel>
                <Input id="pf-title" maxLength={80} value={draft.title} onChange={(e) => set("title", e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="pf-company">Company</FieldLabel>
                <Input id="pf-company" maxLength={80} value={draft.company} onChange={(e) => set("company", e.target.value)} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="pf-bio">Short bio</FieldLabel>
              <Textarea id="pf-bio" rows={3} maxLength={280} value={draft.bio} onChange={(e) => set("bio", e.target.value)} />
              <FieldDescription>{draft.bio.length}/280</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="pf-web">Website</FieldLabel>
              <Input id="pf-web" maxLength={300} placeholder="https://" value={draft.website} onChange={(e) => set("website", e.target.value)} />
            </Field>
          </FieldGroup>
          {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
          <div>
            <Button type="submit" disabled={busy === "save" || !draft.name.trim()}>
              {busy === "save" ? "Saving…" : "Save profile"}
            </Button>
          </div>
        </form>

        <aside className="flex flex-col gap-3">
          <div className="text-aux text-muted-foreground">Preview</div>
          <div className="rounded-16 border border-border bg-card p-6">
            <div className="text-aux font-medium uppercase tracking-[0.16em] text-[var(--st-accent)]">Favor request from</div>
            <div className="mt-4">
              <PayeeIdentity profile={preview} />
            </div>
            {preview.bio ? <p className="mt-4 text-ui leading-relaxed text-muted-foreground">{preview.bio}</p> : null}
          </div>
        </aside>
      </Measure>
    </Page>
  );
}
