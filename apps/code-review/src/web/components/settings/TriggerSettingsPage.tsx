import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bot, ShieldCheck, Lightbulb, FileText, ArrowLeft, ExternalLink, Github, GitPullRequest, Loader2, Plug, Plus, Settings, Wrench, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { GithubUserAvatar } from "@/components/github/GithubUserAvatar";
import { RepoVisibilityBadge } from "@/components/github/RepoVisibilityBadge";
import { defaultAgentSettings, phraseValidationError, type AgentSettings } from "../../../lib/agent-settings.js";
import { ProjectMemoryCard } from "@/components/settings/ProjectMemoryCard";
import type { DashboardData, GhAuthStatus, GithubUserProfile, PRReviewSettingsData, RepositoryData, TriggerAccessMode, TriggerSettingsPayload } from "@/types";
import { fetchGithubUserProfile, getTriggerSettingsRepoParam, normalizeGithubLoginInput, normalizeGithubLogins } from "@/lib/helpers";

function AddAccessUserDialog({
  open,
  mode,
  guardianLogin,
  existingLogins,
  onClose,
  onConfirm,
}: {
  open: boolean;
  mode: TriggerAccessMode;
  guardianLogin: string | null;
  existingLogins: string[];
  onClose: () => void;
  onConfirm: (profile: GithubUserProfile) => void;
}) {
  const [loginInput, setLoginInput] = useState("");
  const [profile, setProfile] = useState<GithubUserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setLoginInput("");
      setProfile(null);
      setLoading(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const lookup = async () => {
    const login = normalizeGithubLoginInput(loginInput);
    if (!login) {
      setError("Enter a GitHub login.");
      return;
    }
    if (mode === "blocklist" && guardianLogin && login === guardianLogin) {
      setError("Your connected GitHub account is always allowed and cannot be blocked.");
      return;
    }
    if (existingLogins.includes(login)) {
      setError(`@${login} is already ${mode === "blocklist" ? "blocked" : "allowed"}.`);
      return;
    }
    setLoading(true);
    setError(null);
    setProfile(null);
    try {
      setProfile(await fetchGithubUserProfile(login, { forceRefresh: true }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (profile) {
      onConfirm(profile);
      onClose();
    } else {
      void lookup();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border bg-background p-5 shadow-lg">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">
              {mode === "blocklist" ? "Block GitHub user" : "Allow GitHub user"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Look up a GitHub ID, verify the avatar and name, then confirm.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={loginInput}
              onChange={(event) => {
                setLoginInput(event.target.value);
                setProfile(null);
                setError(null);
              }}
              placeholder="github-login"
              autoFocus
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="button" variant="outline" onClick={() => void lookup()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lookup"}
            </Button>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {profile && (
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center gap-3">
                <GithubUserAvatar login={profile.login} profile={profile} className="h-12 w-12" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {profile.name || profile.login}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">@{profile.login}</p>
                </div>
                {profile.htmlUrl && (
                  <a
                    href={profile.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    GitHub
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!profile || loading}>
              {mode === "blocklist" ? "Block user" : "Allow user"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TriggerUserListEditor({
  mode,
  guardianGithubLogin,
  value,
  disabled,
  onChange,
}: {
  mode: TriggerAccessMode;
  guardianGithubLogin: string | null;
  value: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const [profiles, setProfiles] = useState<Record<string, GithubUserProfile>>({});
  const [loadingProfiles, setLoadingProfiles] = useState<Record<string, boolean>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const guardianLogin = guardianGithubLogin ? normalizeGithubLoginInput(guardianGithubLogin) : null;
  const visibleLogins = useMemo(
    () => [
      ...(mode === "allowlist" && guardianLogin ? [guardianLogin] : []),
      ...value.filter((login) => login !== guardianLogin),
    ],
    [guardianLogin, mode, value],
  );

  useEffect(() => {
    const missing = visibleLogins.filter((login) => login && !profiles[login]);
    if (!missing.length) return;
    let canceled = false;

    setLoadingProfiles((current) => {
      const next = { ...current };
      for (const login of missing) next[login] = true;
      return next;
    });

    void Promise.all(
      missing.map(async (login) => {
        try {
          return { login, profile: await fetchGithubUserProfile(login) };
        } catch {
          // Keep the fallback initials avatar; add dialog handles explicit lookup errors.
          return null;
        }
      }),
    ).then((results) => {
      if (canceled) return;
      if (!results.some(Boolean)) return;
      setProfiles((current) => {
        const next = { ...current };
        for (const result of results) {
          if (!result) continue;
          next[result.login] = result.profile;
          next[result.profile.login] = result.profile;
        }
        return next;
      });
    }).finally(() => {
      if (canceled) return;
      setLoadingProfiles((current) => {
        const next = { ...current };
        for (const login of missing) next[login] = false;
        return next;
      });
    });

    return () => {
      canceled = true;
    };
  }, [visibleLogins, profiles]);

  const removeLogin = (login: string) => {
    onChange(value.filter((item) => item !== login));
  };

  const addProfile = (profile: GithubUserProfile) => {
    const login = normalizeGithubLoginInput(profile.login);
    setProfiles((current) => ({ ...current, [login]: profile }));
    if (!login || login === guardianLogin || value.includes(login)) return;
    onChange([...value, login]);
  };

  return (
    <div className="space-y-2.5">
      <p className="text-xs font-medium text-foreground">
        {mode === "blocklist" ? "Blocked people" : "Allowed people"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {mode === "allowlist" && guardianLogin ? (
          <div className="group relative">
            <GithubUserAvatar
              login={guardianLogin}
              profile={profiles[guardianLogin]}
              className="h-10 w-10 ring-2 ring-primary/40"
            />
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-medium text-primary-foreground">
              You
            </span>
          </div>
        ) : mode === "allowlist" ? (
          <span className="rounded-full border border-dashed px-3 py-1.5 text-xs text-muted-foreground">
            GitHub account not connected
          </span>
        ) : null}
        {value.map((login) => (
          <div key={login} className="group relative">
            <GithubUserAvatar login={login} profile={profiles[login]} className="h-10 w-10" />
            <button
              type="button"
              onClick={() => removeLogin(login)}
              disabled={disabled}
              className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={`Remove @${login}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          disabled={disabled}
          className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed bg-background text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={mode === "blocklist" ? "Add GitHub user to blocklist" : "Add GitHub user to allowlist"}
          title={mode === "blocklist" ? "Block GitHub user" : "Allow GitHub user"}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {mode === "blocklist"
          ? value.length > 0
            ? "These accounts are ignored. Everyone else can trigger reviews, summaries, and @mention tasks."
            : "No one is blocked. Any GitHub user can trigger reviews, summaries, and @mention tasks."
          : "Only you and these accounts can trigger reviews, summaries, and @mention tasks."}
      </p>
      <AddAccessUserDialog
        open={dialogOpen}
        mode={mode}
        guardianLogin={guardianLogin}
        existingLogins={mode === "allowlist" && guardianLogin ? [guardianLogin, ...value] : value}
        onClose={() => setDialogOpen(false)}
        onConfirm={addProfile}
      />
    </div>
  );
}

// Project policies are shared. Agent tabs own only their own behavior.
const AGENT_TABS = [
  { id: "assistant", name: "Assistant", icon: Bot, description: "Answers questions about a PR or issue and posts a reply in the comment thread." },
  { id: "review", name: "Code Review", icon: GitPullRequest, description: "Reviews the PR diff for correctness and posts a GitHub review with inline findings." },
  { id: "security", name: "Security", icon: ShieldCheck, description: "Checks for exploitable vulnerabilities and posts a separate GitHub review with concrete attack paths." },
  { id: "designAlternatives", name: "Design & Alternatives", icon: Lightbulb, description: "Evaluates the approach against feasible alternatives and posts a separate GitHub review." },
  { id: "summary", name: "Summary", icon: FileText, description: "Recaps PR reviews and discussion and posts a comment prioritizing fixes by effort and value." },
] as const;
type Tab = "project" | typeof AGENT_TABS[number]["id"];

function SettingRow({ title, description, checked, onChange, disabled }: {
  title: string; description?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return <label className="flex cursor-pointer items-center justify-between gap-6 py-3">
    <span><span className="block text-sm font-medium">{title}</span>
      {description && <span className="mt-1 block text-sm text-muted-foreground">{description}</span>}</span>
    <Switch aria-label={title} checked={checked} onCheckedChange={onChange} disabled={disabled} />
  </label>;
}
function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="space-y-3 border-t pt-5">
    <div><h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div>
    {children}
  </section>;
}
function initialDraft(s: PRReviewSettingsData | null): TriggerSettingsPayload {
  const legacy = {
    autoReviewEnabled: s?.autoReviewEnabled ?? false, triggerOnCreate: s?.triggerOnCreate ?? true,
    triggerOnPush: s?.triggerOnPush ?? true, triggerOnRequest: s?.triggerOnRequest ?? true,
    triggerOnReviewRequest: s?.triggerOnReviewRequest ?? true, triggerOnMention: s?.triggerOnMention ?? true,
  };
  return {
    autoReview: legacy.autoReviewEnabled, triggerOnCreate: legacy.triggerOnCreate,
    triggerOnPush: legacy.triggerOnPush, manualTriggerEnabled: legacy.triggerOnRequest,
    triggerOnReviewRequest: legacy.triggerOnReviewRequest, triggerOnMention: legacy.triggerOnMention,
    mentionTriggerPhrase: s?.mentionTriggerPhrase ?? "PTAL", summaryTriggerPhrase: s?.summaryTriggerPhrase ?? "summary",
    triggerAccessMode: s?.triggerAccessMode ?? "blocklist", triggerAllowlist: s?.triggerAllowlist ?? [],
    triggerBlocklist: s?.triggerBlocklist ?? [], customRules: s?.customRules ?? "",
    agentSettings: s?.agentSettings ?? defaultAgentSettings(legacy),
    reviewerEnabled: { security: s?.reviewers?.find(l => l.id === "security")?.enabled ?? false,
      "design-alternatives": s?.reviewers?.find(l => l.id === "design-alternatives")?.enabled ?? false },
  };
}

function TriggerSettingsForm({ repo, settings, guardianLogin, onSave, onRepair, onRemove, onBack }: {
  repo: RepositoryData; settings: PRReviewSettingsData | null; guardianLogin: string | null;
  onSave: (s: TriggerSettingsPayload) => Promise<void>; onRepair: () => Promise<void>;
  onRemove: () => Promise<void>; onBack: () => void;
}) {
  const [tab, setTab] = useState<Tab>(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    return AGENT_TABS.some(t => t.id === requested) ? requested as Tab : "project";
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url);
  }, [tab]);
  const [baseline, setBaseline] = useState(() => initialDraft(settings));
  const [draft, setDraft] = useState(baseline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [memoryDirty, setMemoryDirty] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const a = draft.agentSettings!;
  const phraseError = phraseValidationError(draft.mentionTriggerPhrase, draft.summaryTriggerPhrase, a);
  const bot = `@${guardianLogin || "bot"}`;

  // Polling must not remount the form or erase an unsaved draft.
  useEffect(() => {
    if (!dirty && !busy) { const next = initialDraft(settings); setBaseline(next); setDraft(next); }
  }, [settings]);
  useEffect(() => {
    if (!dirty && !memoryDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, memoryDirty]);
  const leave = () => { if (!(dirty || memoryDirty) || window.confirm("Leave without saving your changes?")) onBack(); };
  const patch = (p: Partial<TriggerSettingsPayload>) => { setDraft(d => ({ ...d, ...p })); setSaved(false); setError(null); };
  const patchAgent = (p: Partial<AgentSettings>) => patch({ agentSettings: { ...a, ...p } });
  const enabled = (id: Tab) => id === "review" ? a.reviewEnabled : id === "security" ? draft.reviewerEnabled!.security
    : id === "designAlternatives" ? draft.reviewerEnabled!["design-alternatives"] : id === "project" ? true : a[id].enabled;
  const toggleAgent = (checked: boolean) => {
    if (tab === "review") patchAgent({ reviewEnabled: checked });
    else if (tab === "security" || tab === "designAlternatives") patch({ reviewerEnabled: {
      ...draft.reviewerEnabled!, [tab === "security" ? "security" : "design-alternatives"]: checked,
    } });
    else if (tab === "assistant" || tab === "summary") patchAgent({ [tab]: { ...a[tab], enabled: checked } });
  };
  const perform = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const save = () => perform(async () => {
    if (phraseError) throw new Error(phraseError);
    await onSave(draft); setBaseline(draft); setSaved(true);
  });
  const agent = AGENT_TABS.find(t => t.id === tab);
  const phrase = tab === "review" ? draft.mentionTriggerPhrase : tab === "summary" ? draft.summaryTriggerPhrase
    : tab === "project" ? "" : a[tab].phrase;
  const phraseChange = (value: string) => {
    if (tab === "review") patch({ mentionTriggerPhrase: value });
    else if (tab === "summary") patch({ summaryTriggerPhrase: value });
    else if (tab !== "project") patchAgent({ [tab]: { ...a[tab], phrase: value } });
  };
  const navButton = (id: Tab, name: string, Icon: LucideIcon) => <button key={id} type="button"
    id={`settings-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls="settings-panel" tabIndex={tab === id ? 0 : -1}
    title={id === "project" ? "Project settings" : `${name} · ${enabled(id) ? "On" : "Off"}`}
    onClick={() => setTab(id)} className={`relative flex min-w-0 min-h-11 shrink-0 items-center gap-2 rounded-md px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === id ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
    <Icon className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{name}</span>
    {id !== "project" && <><span aria-hidden="true" className={`ml-2 h-1.5 w-1.5 shrink-0 rounded-full ${enabled(id) ? "bg-primary" : "bg-muted-foreground/40"}`} /><span className="sr-only">{enabled(id) ? "On" : "Off"}</span></>}
  </button>;
  return <div>
    <Button variant="ghost" size="sm" onClick={leave} className="mb-5 -ml-2"><ArrowLeft className="h-4 w-4" />Back</Button>
    <header className="mb-7 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-xl font-semibold tracking-tight">Project settings</h1>
        <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground"><Github className="h-4 w-4" />
          <a href={repo.url} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">{repo.name}</a>
          <RepoVisibilityBadge visibility={repo.visibility} />
        </div></div>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Plug className="h-3.5 w-3.5" />{settings?.webhookConnected ? "GitHub connected" : "GitHub not subscribed"}</span>
    </header>
    <div className="grid min-w-0 grid-cols-1 items-start gap-6 md:grid-cols-[200px_minmax(0,1fr)] md:gap-9">
      <nav aria-label="Settings sections" role="tablist" aria-orientation="vertical" className="flex min-w-0 flex-col gap-1 md:sticky md:top-4"
        onKeyDown={e => {
          if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
          e.preventDefault(); const ids: Tab[] = ["project", ...AGENT_TABS.map(t => t.id)];
          const i = ids.indexOf(tab); const next = e.key === "Home" ? 0 : e.key === "End" ? ids.length - 1
            : (i + (["ArrowDown", "ArrowRight"].includes(e.key) ? 1 : -1) + ids.length) % ids.length;
          setTab(ids[next]); (e.currentTarget.querySelector(`#settings-tab-${ids[next]}`) as HTMLButtonElement | null)?.focus();
        }}>
        <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">Project</p>
        {navButton("project", "General", Settings)}
        <p className="mt-4 px-3 pb-1 text-xs font-medium text-muted-foreground">Agents</p>
        <div className="grid grid-cols-2 gap-1 pb-1 md:flex md:flex-col">
          {AGENT_TABS.map(t => navButton(t.id, t.name, t.icon))}
        </div>
      </nav>
      <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} tabIndex={0} className="min-w-0 space-y-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div hidden={tab !== "project"} className="space-y-6">
          <div><h2 className="text-lg font-semibold">Project</h2><p className="mt-1 text-sm text-muted-foreground">Shared access, knowledge, and connection for every agent.</p></div>
          <Section title="Who may trigger agents" description="Applies to comments, review requests, and automatic PR events. Your connected GitHub account is always allowed.">
            <div className="grid gap-2 sm:grid-cols-2">
              {([ ["allowlist", "Selected people only", "Only you and accounts you allow."], ["blocklist", "Everyone except blocked", "Anyone not on your blocklist."] ] as const).map(([mode, title, hint]) =>
                <label key={mode} className={`flex cursor-pointer items-start gap-2.5 rounded-md border p-3 ${draft.triggerAccessMode === mode ? "border-primary bg-accent" : "hover:bg-muted"}`}>
                  <input type="radio" name="trigger-access" checked={draft.triggerAccessMode === mode} disabled={busy} onChange={() => patch({ triggerAccessMode: mode })} className="mt-1 accent-primary" />
                  <span><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs text-muted-foreground">{hint}</span></span>
                </label>)}
            </div>
            <TriggerUserListEditor mode={draft.triggerAccessMode} guardianGithubLogin={guardianLogin}
              value={draft.triggerAccessMode === "allowlist" ? draft.triggerAllowlist : draft.triggerBlocklist} disabled={busy}
              onChange={v => patch(draft.triggerAccessMode === "allowlist" ? { triggerAllowlist: v } : { triggerBlocklist: v })} />
          </Section>
          <Section title="Review guidance" description="Additional instructions shared by Code Review, Security, and Design & Alternatives.">
            <label htmlFor="review-rules" className="sr-only">Review guidance</label>
            <textarea id="review-rules" value={draft.customRules} disabled={busy} onChange={e => patch({ customRules: e.target.value })} rows={3} placeholder="e.g. Focus on compatibility with existing API clients."
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </Section>
          <Section title="Project memory" description="Repository knowledge shared with agents. Memory has its own save button and change history.">
            <ProjectMemoryCard repoName={repo.name} initialProjectMemory={settings?.projectMemory ?? null} onDirtyChange={setMemoryDirty} />
          </Section>
          <Section title="Connection">
            <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
              <dt className="text-muted-foreground">GitHub webhook</dt><dd>{settings?.webhookConnected ? "Connected" : "Not subscribed"}{settings?.githubWebhookId ? ` · #${settings.githubWebhookId}` : ""}</dd>
              <dt className="text-muted-foreground">Event routines</dt><dd>{settings?.eventRoutinesReady === true ? "Ready" : settings?.eventRoutinesReady === false ? "Missing or disabled" : "Unknown"}</dd>
            </dl>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void perform(onRepair)}><Wrench className="h-4 w-4" />Repair connection</Button>
          </Section>
          <Section title="Remove repository" description="Deletes Code Review settings here, not the GitHub repository.">
            {confirmRemove ? <div className="flex items-center gap-2"><Button variant="destructive" size="sm" disabled={busy} onClick={() => void perform(async () => {
              if (!(dirty || memoryDirty) || window.confirm("Remove this repository and discard unsaved changes?")) await onRemove();
            })}>Confirm remove</Button><Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>Cancel</Button></div>
              : <Button variant="outline" size="sm" className="text-destructive" onClick={() => setConfirmRemove(true)}>Remove repository</Button>}
          </Section>
        </div>
        {agent && <>
          <div className="flex items-start justify-between gap-5"><div>
            <h2 className="text-lg font-semibold">{agent.name}</h2><p className="mt-1 text-sm text-muted-foreground">{agent.description}</p>
          </div><Switch checked={enabled(tab)} aria-label={`Enable ${agent.name}`} disabled={busy} onCheckedChange={toggleAgent} /></div>
          {!enabled(tab) && <p className="rounded-md border bg-muted p-3 text-sm text-muted-foreground">This agent is off. Configure it below; it will not run until enabled.</p>}
          {tab === "assistant" && <p className="text-sm text-muted-foreground">Opt-in, reply-only assistant. Use an addressed request; bare mentions are ignored to prevent reply loops.</p>}
          <fieldset disabled={busy} className="space-y-6">
            <Section title="When it runs">
              {tab === "review" ? <div className="divide-y">
                <SettingRow title="When a PR is opened" checked={draft.autoReview && draft.triggerOnCreate} onChange={v => patch({ autoReview: v || (draft.autoReview && draft.triggerOnPush), triggerOnCreate: v, triggerOnPush: draft.autoReview && draft.triggerOnPush })} />
                <SettingRow title="When new commits are pushed" checked={draft.autoReview && draft.triggerOnPush} onChange={v => patch({ autoReview: v || (draft.autoReview && draft.triggerOnCreate), triggerOnPush: v, triggerOnCreate: draft.autoReview && draft.triggerOnCreate })} />
                <SettingRow title="When a review is requested" description={`Only requests addressed to ${bot}.`} checked={draft.manualTriggerEnabled && draft.triggerOnReviewRequest} onChange={v => patch({ manualTriggerEnabled: v || (draft.manualTriggerEnabled && draft.triggerOnMention), triggerOnReviewRequest: v, triggerOnMention: draft.manualTriggerEnabled && draft.triggerOnMention })} />
                <SettingRow title="On a trigger comment" checked={draft.manualTriggerEnabled && draft.triggerOnMention} onChange={v => patch({ manualTriggerEnabled: v || (draft.manualTriggerEnabled && draft.triggerOnReviewRequest), triggerOnMention: v, triggerOnReviewRequest: draft.manualTriggerEnabled && draft.triggerOnReviewRequest })} />
              </div> : tab === "security" || tab === "designAlternatives" ? <div className="divide-y">
                <SettingRow title="When a PR is opened" checked={a[tab].onCreate} onChange={v => patchAgent({ [tab]: { ...a[tab], onCreate: v } })} />
                <SettingRow title="When new commits are pushed" checked={a[tab].onPush} onChange={v => patchAgent({ [tab]: { ...a[tab], onPush: v } })} />
                <SettingRow title="When a review is requested" description={`Only requests addressed to ${bot}.`} checked={a[tab].onReviewRequest} onChange={v => patchAgent({ [tab]: { ...a[tab], onReviewRequest: v } })} />
                <SettingRow title="On its own trigger comment" checked={a[tab].onMention} onChange={v => patchAgent({ [tab]: { ...a[tab], onMention: v } })} />
                <SettingRow title="Also run with Code Review commands" description={`Run alongside Code Review for ${bot} ${draft.mentionTriggerPhrase}.`} checked={a[tab].withReviewCommand} onChange={v => patchAgent({ [tab]: { ...a[tab], withReviewCommand: v } })} />
              </div> : (tab === "assistant" || tab === "summary") ? <div>
                <SettingRow title="On a trigger comment" description={tab === "assistant" ? "PR and issue comments with an addressed request." : "PR comments only."} checked={a[tab].onMention} onChange={v => patchAgent({ [tab]: { ...a[tab], onMention: v } })} />
                <p className="text-sm text-muted-foreground">No automatic events. {tab === "summary" ? "Summaries are requested when you need a recap." : "The assistant responds only when asked."}</p>
              </div> : null}
            </Section>
            <Section title="Trigger phrase" description={tab === "assistant" ? "Follow the phrase with your question or request." : "Write exactly this command in a PR comment. Case and extra whitespace do not matter."}>
              <label htmlFor="agent-phrase" className="sr-only">{agent.name} trigger phrase</label>
              <input id="agent-phrase" type="text" value={phrase} maxLength={80} onChange={e => phraseChange(e.target.value)} aria-describedby="phrase-example phrase-help" aria-invalid={!!phraseError}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <div id="phrase-example" aria-live="polite" className="rounded-md border bg-muted/40 px-3 py-3">
                <p className="mb-1 text-xs text-muted-foreground">Comment to write</p>
                <code className="break-words text-sm">{bot} {phrase.trim() || "<phrase>"}{tab === "assistant" ? " Why is this approach used?" : ""}</code>
              </div>
              <p id="phrase-help" className="text-xs text-muted-foreground">Each agent needs a different phrase, even when it is off.</p>
            </Section>

          </fieldset>
        </>}
      </div>
    </div>
    <footer className="sticky bottom-0 z-10 mt-8 flex flex-wrap items-center justify-between gap-3 border-t bg-background py-4">
      <div className="min-w-0 text-sm" aria-live="polite">
        {error ? <p role="alert" className="text-destructive">{error}</p> : dirty && phraseError ? <p role="alert" className="text-destructive">{phraseError}</p>
          : <span className="text-muted-foreground">{dirty ? "Unsaved changes across settings" : saved ? "Settings saved" : "All settings up to date"}</span>}
      </div>
      <div className="ml-auto flex shrink-0 gap-2"><Button variant="ghost" disabled={!dirty || busy} onClick={() => { const next = initialDraft(settings); setDraft(next); setBaseline(next); setError(null); setSaved(false); }}>Discard</Button>
        <Button disabled={!dirty || busy || !!phraseError} onClick={() => void save()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? "Saving…" : "Save changes"}</Button></div>
    </footer>
  </div>;
}

export function TriggerSettingsPage({ dashboard, ghAuth, error, onBack, onSave, onRepair, onRemoveRepository }: {
  dashboard: DashboardData | null; ghAuth: GhAuthStatus | null; refreshing: boolean; error: string | null;
  onBack: () => void; onRefresh: () => void; onSave: (repo: string, settings: TriggerSettingsPayload) => Promise<void>;
  onRepair: () => Promise<void>; onRemoveRepository: (id: string) => Promise<void>;
}) {
  const repositories = dashboard?.repositories ?? [];
  const requested = getTriggerSettingsRepoParam();
  const repo = repositories.find(r => r.name === requested) ?? repositories[0];
  const settings = dashboard?.prReviewSettings.find(s => s.repo === repo?.name) ?? null;
  return <div className="mx-auto w-full max-w-5xl">
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    {!dashboard ? <p className="py-12 text-sm text-muted-foreground">Loading settings…</p>
      : !repo ? <p className="py-12 text-sm text-muted-foreground">No repositories yet. Add one from the dashboard first.</p>
      : <TriggerSettingsForm key={repo.name} repo={repo} settings={settings} guardianLogin={settings?.guardianGithubLogin ?? ghAuth?.login ?? null}
        onSave={s => onSave(repo.name, s)} onRepair={onRepair} onRemove={() => onRemoveRepository(repo.id)} onBack={onBack} />}
  </div>;
}
