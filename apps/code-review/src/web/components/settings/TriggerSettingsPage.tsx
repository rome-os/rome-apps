import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, AtSign, Brain, CheckCircle, Clock, Eye, ExternalLink, Github, GitPullRequest, Loader2, MessageSquare, Plug, Plus, RefreshCw, Settings, Trash2, Users, Wrench, X, XCircle, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { GithubUserAvatar } from "@/components/github/GithubUserAvatar";
import { ProjectMemoryCard } from "@/components/settings/ProjectMemoryCard";
import type { DashboardData, GhAuthStatus, GithubUserProfile, PRReviewSettingsData, TriggerSettingsPayload } from "@/types";
import { fetchGithubUserProfile, getAppBasePath, getTriggerSettingsRepoParam, normalizeGithubLoginInput, normalizeGithubLogins } from "@/lib/helpers";
import { TRIGGER_SETTINGS_ROUTE } from "@/lib/constants";

function AddAllowlistUserDialog({
  open,
  existingLogins,
  onClose,
  onConfirm,
}: {
  open: boolean;
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
    if (existingLogins.includes(login)) {
      setError(`@${login} is already allowed.`);
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
            <h2 className="text-base font-semibold">Add GitHub user</h2>
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
              Confirm
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TriggerAllowlistEditor({
  guardianGithubLogin,
  value,
  onChange,
}: {
  guardianGithubLogin: string | null;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [profiles, setProfiles] = useState<Record<string, GithubUserProfile>>({});
  const [loadingProfiles, setLoadingProfiles] = useState<Record<string, boolean>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const guardianLogin = guardianGithubLogin ? normalizeGithubLoginInput(guardianGithubLogin) : null;
  const visibleLogins = useMemo(
    () => [
      ...(guardianLogin ? [guardianLogin] : []),
      ...value.filter((login) => login !== guardianLogin),
    ],
    [guardianLogin, value],
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
      <div className="flex flex-wrap items-center gap-2">
        {guardianLogin ? (
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
        ) : (
          <span className="rounded-full border border-dashed px-3 py-1.5 text-xs text-muted-foreground">
            GitHub account not connected
          </span>
        )}
        {value.map((login) => (
          <div key={login} className="group relative">
            <GithubUserAvatar login={login} profile={profiles[login]} className="h-10 w-10" />
            <button
              type="button"
              onClick={() => removeLogin(login)}
              className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-destructive group-hover:flex"
              aria-label={`Remove @${login}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed bg-background text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          aria-label="Add GitHub user to trigger allowlist"
          title="Add GitHub user"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Only these people can trigger the bot — reviews, questions, feedback, and code tasks.
      </p>
      <AddAllowlistUserDialog
        open={dialogOpen}
        existingLogins={visibleLogins}
        onClose={() => setDialogOpen(false)}
        onConfirm={addProfile}
      />
    </div>
  );
}

// --- Trigger Settings ---

/** A section header with a semantic icon and an optional right-aligned action (e.g. a master switch). */
function SectionHeader({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function TriggerSettingsForm({
  repoName,
  initialAutoReview,
  initialTriggerOnCreate,
  initialTriggerOnRequest,
  initialTriggerOnReviewRequest,
  initialTriggerOnMention,
  initialTriggerOnPush,
  initialTriggerAllowlist,
  initialMentionTriggerPhrase,
  initialSummaryTriggerPhrase,
  initialCustomRules,
  initialProjectMemory,
  guardianGithubLogin,
  webhookInfo,
  onSave,
  onRepair,
  onRemoveRepo,
}: {
  repoName: string;
  initialAutoReview: boolean;
  initialTriggerOnCreate: boolean;
  initialTriggerOnRequest: boolean;
  initialTriggerOnReviewRequest: boolean;
  initialTriggerOnMention: boolean;
  initialTriggerOnPush: boolean;
  initialTriggerAllowlist: string[];
  initialMentionTriggerPhrase: string;
  initialSummaryTriggerPhrase: string;
  initialCustomRules: string;
  initialProjectMemory: string | null;
  guardianGithubLogin: string | null;
  webhookInfo: PRReviewSettingsData | null;
  onSave: (settings: TriggerSettingsPayload) => Promise<void>;
  onRepair: () => Promise<void>;
  onRemoveRepo: () => Promise<void>;
}) {
  const [autoReview, setAutoReview] = useState(initialAutoReview);
  const [triggerOnCreate, setTriggerOnCreate] = useState(initialTriggerOnCreate);
  const [triggerOnRequest, setTriggerOnRequest] = useState(initialTriggerOnRequest);
  const [triggerOnReviewRequest, setTriggerOnReviewRequest] = useState(initialTriggerOnReviewRequest);
  const [triggerOnMention, setTriggerOnMention] = useState(initialTriggerOnMention);
  const [triggerOnPush, setTriggerOnPush] = useState(initialTriggerOnPush);
  const [triggerAllowlist, setTriggerAllowlist] = useState(
    normalizeGithubLogins(initialTriggerAllowlist),
  );
  const [mentionTriggerPhrase, setMentionTriggerPhrase] = useState(initialMentionTriggerPhrase || "PTAL");
  const [summaryTriggerPhrase, setSummaryTriggerPhrase] = useState(initialSummaryTriggerPhrase || "summary");
  const [customRules, setCustomRules] = useState(initialCustomRules);
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const controlsDisabled = saving || autoSaving;

  const handleRepair = async () => {
    setRepairing(true);
    setSaveError(null);
    try {
      await onRepair();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setRepairing(false);
    }
  };

  const handleRemoveRepo = async () => {
    setRemoving(true);
    setSaveError(null);
    try {
      await onRemoveRepo();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setRemoving(false);
      setConfirmingRemove(false);
    }
  };

  const persistSettings = async (overrides: Partial<TriggerSettingsPayload>) => {
    setAutoSaving(true);
    setSaveError(null);
    try {
      await onSave({
        autoReview,
        triggerOnCreate,
        manualTriggerEnabled: triggerOnRequest,
        triggerOnReviewRequest,
        triggerOnMention,
        triggerOnPush,
        customRules,
        triggerAllowlist,
        mentionTriggerPhrase,
        summaryTriggerPhrase,
        ...overrides,
      });
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setAutoSaving(false);
    }
  };

  // Auto-enable auto review when any auto trigger is checked.
  const handleAutoTriggerChange = (setter: (v: boolean) => void, value: boolean, otherAutoTrigger: boolean) => {
    setter(value);
    const nextAutoReview = value ? true : otherAutoTrigger;
    if (value) {
      setAutoReview(true);
    } else if (!otherAutoTrigger) {
      setAutoReview(false);
    }
    void persistSettings({
      autoReview: nextAutoReview,
      triggerOnCreate: setter === setTriggerOnCreate ? value : triggerOnCreate,
      triggerOnPush: setter === setTriggerOnPush ? value : triggerOnPush,
    });
  };

  const handleAutoReviewChange = (checked: boolean) => {
    setAutoReview(checked);
    let nextCreate = triggerOnCreate;
    let nextPush = triggerOnPush;
    if (checked && !triggerOnCreate && !triggerOnPush) {
      // Enable auto triggers by default when turning on auto review.
      nextCreate = true;
      nextPush = true;
    } else if (!checked) {
      nextCreate = false;
      nextPush = false;
    }
    setTriggerOnCreate(nextCreate);
    setTriggerOnPush(nextPush);
    void persistSettings({
      autoReview: checked,
      triggerOnCreate: nextCreate,
      triggerOnPush: nextPush,
    });
  };

  const handleManualTriggerChange = (checked: boolean) => {
    setTriggerOnRequest(checked);
    void persistSettings({ manualTriggerEnabled: checked });
  };

  const handleManualSubTriggerChange = (
    setter: (v: boolean) => void,
    value: boolean,
    otherManualTrigger: boolean,
  ) => {
    setter(value);
    const nextManualTrigger = value ? true : otherManualTrigger;
    if (value) {
      setTriggerOnRequest(true);
    } else if (!otherManualTrigger) {
      setTriggerOnRequest(false);
    }
    void persistSettings({
      manualTriggerEnabled: nextManualTrigger,
      triggerOnReviewRequest: setter === setTriggerOnReviewRequest ? value : triggerOnReviewRequest,
      triggerOnMention: setter === setTriggerOnMention ? value : triggerOnMention,
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({
        autoReview,
        triggerOnCreate,
        manualTriggerEnabled: triggerOnRequest,
        triggerOnReviewRequest,
        triggerOnMention,
        triggerOnPush,
        customRules,
        triggerAllowlist,
        mentionTriggerPhrase,
        summaryTriggerPhrase,
      });
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const mentionCommand = [
    guardianGithubLogin ? `@${guardianGithubLogin}` : "",
    mentionTriggerPhrase || "",
  ].filter(Boolean).join(" ");

  const summaryCommand = [
    guardianGithubLogin ? `@${guardianGithubLogin}` : "",
    summaryTriggerPhrase || "",
  ].filter(Boolean).join(" ");

  const botHandle = guardianGithubLogin ? `@${guardianGithubLogin}` : "@the bot";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex max-w-full items-center gap-2 rounded-full border bg-muted/30 px-3 py-1.5 text-sm text-muted-foreground">
          <Github className="h-4 w-4 shrink-0" />
          <span className="truncate font-medium text-foreground">{repoName}</span>
          {autoSaving && (
            <span className="ml-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving
            </span>
          )}
        </div>
        <Button onClick={() => void handleSave()} disabled={saving || autoSaving}>
          {saving ? (autoReview || triggerOnRequest ? "Setting up webhook..." : "Saving...") : "Save changes"}
        </Button>
      </div>
      {saveError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {saveError}
        </div>
      )}

      {/* 1 — Who can use it */}
      <section className="space-y-3 rounded-lg border bg-muted/20 p-4">
        <SectionHeader
          icon={Users}
          title="Who can use it"
          description="Only these people's PRs and comments are acted on. You're always included."
        />
        <TriggerAllowlistEditor
          guardianGithubLogin={guardianGithubLogin}
          value={triggerAllowlist}
          onChange={(next) => {
            setTriggerAllowlist(next);
            void persistSettings({ triggerAllowlist: next });
          }}
        />
      </section>

      {/* 2 — Code reviews */}
      <section className="space-y-3 rounded-lg border bg-muted/20 p-4">
        <SectionHeader
          icon={GitPullRequest}
          title="Code reviews"
          description="The bot reviews pull requests and posts inline findings. Choose when it runs."
        />
        <div className="space-y-2 pl-9">
          {/* Automatically */}
          <div className="rounded-md border bg-background/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-sm font-medium">Automatically</span>
                <p className="text-xs text-muted-foreground">Review on PR activity — no mention needed.</p>
              </div>
              <Switch
                checked={autoReview}
                disabled={controlsDisabled}
                onCheckedChange={handleAutoReviewChange}
                aria-label="Toggle automatic reviews"
              />
            </div>
            {autoReview && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-2.5">
                  <span className="text-sm">When a PR is opened</span>
                  <Switch
                    checked={triggerOnCreate}
                    disabled={controlsDisabled}
                    onCheckedChange={(checked) => handleAutoTriggerChange(setTriggerOnCreate, checked, triggerOnPush)}
                    aria-label="Toggle PR opened trigger"
                  />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-2.5">
                  <span className="text-sm">When new commits are pushed</span>
                  <Switch
                    checked={triggerOnPush}
                    disabled={controlsDisabled}
                    onCheckedChange={(checked) => handleAutoTriggerChange(setTriggerOnPush, checked, triggerOnCreate)}
                    aria-label="Toggle new commits trigger"
                  />
                </div>
              </div>
            )}
          </div>
          {/* On review request */}
          <div className="flex items-center justify-between gap-3 rounded-md border bg-background/60 p-3">
            <div className="min-w-0">
              <span className="text-sm font-medium">On GitHub review request</span>
              <p className="text-xs text-muted-foreground">When someone requests a review from {botHandle}.</p>
            </div>
            <Switch
              checked={triggerOnReviewRequest}
              disabled={controlsDisabled}
              onCheckedChange={(checked) => handleManualSubTriggerChange(setTriggerOnReviewRequest, checked, triggerOnMention)}
              aria-label="Toggle review request trigger"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            You can also start a review by commenting the review phrase — set up under <span className="font-medium text-foreground">@mention assistant</span> below.
          </p>
          <div className="pt-1">
            <label className="mb-1 block text-sm font-medium">Custom review rules</label>
            <textarea
              value={customRules}
              onChange={(e) => setCustomRules(e.target.value)}
              placeholder={`Extra rules the reviewer must also check, e.g.\n- Check error handling\n- Require JSDoc for new functions\n- Flag direct DOM manipulation`}
              rows={4}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
            />
            <p className="mt-1 text-xs text-muted-foreground">Applied on top of the reviewer's defaults. Save with the button below.</p>
          </div>
        </div>
      </section>

      {/* 3 — @mention assistant */}
      <section className="space-y-3 rounded-lg border bg-muted/20 p-4">
        <SectionHeader
          icon={AtSign}
          title="@mention assistant"
          description={`Comment ${botHandle} on any PR or issue and it works out what you need. This one switch controls all of it.`}
          action={
            <Switch
              checked={triggerOnMention}
              disabled={controlsDisabled}
              onCheckedChange={(checked) => handleManualSubTriggerChange(setTriggerOnMention, checked, triggerOnReviewRequest)}
              aria-label="Toggle the @mention assistant"
            />
          }
        />
        {triggerOnMention ? (
          <div className="space-y-3 pl-9">
            <div className="rounded-md border bg-background/60 p-3">
              <p className="mb-1.5 text-xs font-medium">What it does with your comment:</p>
              <ul className="space-y-1.5 text-xs text-muted-foreground">
                <li className="flex items-start gap-2">
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
                  <span><span className="font-medium text-foreground">Question</span> — investigates the PR/issue and replies.</span>
                </li>
                <li className="flex items-start gap-2">
                  <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span><span className="font-medium text-foreground">Feedback</span> — a rule to remember; saved to Project memory (below).</span>
                </li>
                <li className="flex items-start gap-2">
                  <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  <span><span className="font-medium text-foreground">Code task</span> — “fix / implement …”; opens a draft PR.</span>
                </li>
                <li className="flex items-start gap-2">
                  <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
                  <span><span className="font-medium text-foreground">Review</span> — when your comment contains the review phrase below.</span>
                </li>
                <li className="flex items-start gap-2">
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-500" />
                  <span><span className="font-medium text-foreground">Summary</span> — recaps the PR's reviews &amp; discussion with a fix-size + fix-value assessment, when your comment contains the summary phrase below.</span>
                </li>
              </ul>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Review phrase</label>
              <input
                type="text"
                value={mentionTriggerPhrase}
                onChange={(e) => setMentionTriggerPhrase(e.target.value)}
                placeholder="PTAL"
                className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                e.g. <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{mentionCommand || `${botHandle} ${mentionTriggerPhrase || "PTAL"}`}</code> runs a full review.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Summary phrase</label>
              <input
                type="text"
                value={summaryTriggerPhrase}
                onChange={(e) => setSummaryTriggerPhrase(e.target.value)}
                placeholder="summary"
                className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                e.g. <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{summaryCommand || `${botHandle} ${summaryTriggerPhrase || "summary"}`}</code> posts a discussion summary (PR only).
              </p>
            </div>
          </div>
        ) : (
          <p className="pl-9 text-xs text-muted-foreground">
            Off — the bot ignores @mentions entirely: no questions, feedback, code tasks, or phrase reviews.
          </p>
        )}
      </section>

      {/* Project memory — shared knowledge for every task the bot runs here */}
      <section className="space-y-3 rounded-lg border bg-muted/20 p-4">
        <SectionHeader
          icon={Brain}
          title="Project memory"
          description="Shared knowledge the bot uses for everything it does here — reviews, questions, feedback and code tasks. It also writes here from your feedback."
        />
        <div className="pl-9">
          <ProjectMemoryCard repoName={repoName} initialProjectMemory={initialProjectMemory} />
        </div>
      </section>

      {/* 5 — Connection (read-only) */}
      {(autoReview || triggerOnRequest || webhookInfo?.githubWebhookId || webhookInfo?.eventRoutineStatus) && (
        <section className="space-y-3 rounded-lg border bg-muted/20 p-4">
          <SectionHeader
            icon={Plug}
            title="Connection"
            description="The GitHub webhook and event routines that deliver these triggers."
          />
          <div className="space-y-2 pl-9">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">GitHub webhook:</span>
              {webhookInfo?.webhookConnected ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                  <CheckCircle className="inline w-3 h-3 mr-1" />
                  Connected
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                  <Clock className="inline w-3 h-3 mr-1" />
                  Not subscribed
                </span>
              )}
              {webhookInfo?.githubWebhookId && (
                <span className="text-xs font-mono text-muted-foreground">#{webhookInfo.githubWebhookId}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Event routines:</span>
              {webhookInfo?.eventRoutinesReady === true ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                  <CheckCircle className="inline w-3 h-3 mr-1" />
                  Ready
                </span>
              ) : webhookInfo?.eventRoutinesReady === false ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                  <XCircle className="inline w-3 h-3 mr-1" />
                  Missing or disabled
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                  <Clock className="inline w-3 h-3 mr-1" />
                  Unknown
                </span>
              )}
            </div>
            {webhookInfo?.eventRoutineStatus && !webhookInfo.eventRoutineStatus.ready && (
              <p className="text-xs text-muted-foreground">
                Missing: {webhookInfo.eventRoutineStatus.missing.join(", ") || "none"};
                disabled: {webhookInfo.eventRoutineStatus.disabled.join(", ") || "none"}.
              </p>
            )}
            {!webhookInfo?.webhookConnected && (autoReview || triggerOnRequest) && (
              <p className="text-xs text-blue-800 dark:text-blue-200">
                On save, Rome registers its own GitHub webhook on this repo. Event routines are tracked separately and must also be ready.
              </p>
            )}
            {(autoReview || triggerOnRequest) &&
              (webhookInfo?.eventRoutinesReady === false || !webhookInfo?.webhookConnected) && (
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRepair()}
                    disabled={repairing || controlsDisabled}
                  >
                    {repairing ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : (
                      <Wrench className="h-4 w-4 mr-1" />
                    )}
                    {repairing ? "Repairing…" : "Repair connection"}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Re-subscribes the webhook and (re)creates the event routines.
                  </span>
                </div>
              )}
          </div>
        </section>
      )}

      {/* Danger zone — remove this repository */}
      <section className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <SectionHeader
          icon={Trash2}
          title="Danger zone"
          description="Remove this repository from Code Review. This deletes its automation settings here — it does not touch the GitHub repository."
        />
        <div className="pl-9">
          {confirmingRemove ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Remove <span className="font-medium text-foreground">{repoName}</span>?
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleRemoveRepo()}
                disabled={removing}
              >
                {removing ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    Removing...
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-1 h-4 w-4" />
                    Confirm remove
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingRemove(false)}
                disabled={removing}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmingRemove(true)}
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Remove repository
            </Button>
          )}
        </div>
      </section>

    </div>
  );
}

export function TriggerSettingsPage({
  dashboard,
  ghAuth,
  refreshing,
  error,
  onBack,
  onRefresh,
  onSave,
  onRepair,
  onRemoveRepository,
}: {
  dashboard: DashboardData | null;
  ghAuth: GhAuthStatus | null;
  refreshing: boolean;
  error: string | null;
  onBack: () => void;
  onRefresh: () => void;
  onSave: (repoName: string, settings: TriggerSettingsPayload) => Promise<void>;
  onRepair: () => Promise<void>;
  onRemoveRepository: (id: string) => Promise<void>;
}) {
  const repositories = dashboard?.repositories || [];
  const prSettings = dashboard?.prReviewSettings || [];
  const [selectedRepoName, setSelectedRepoName] = useState(() => getTriggerSettingsRepoParam() || "");

  useEffect(() => {
    if (!repositories.length) return;
    if (selectedRepoName && repositories.some((repo) => repo.name === selectedRepoName)) return;

    const fallbackRepo = repositories[0]?.name || "";
    setSelectedRepoName(fallbackRepo);
    const nextPath = `${getAppBasePath()}/${TRIGGER_SETTINGS_ROUTE}?repo=${encodeURIComponent(fallbackRepo)}`;
    window.history.replaceState({}, "", nextPath);
  }, [repositories, selectedRepoName]);

  const selectedSettings = selectedRepoName
    ? prSettings.find((settings) => settings.repo === selectedRepoName) || null
    : null;
  const selectedRepo = selectedRepoName
    ? repositories.find((repo) => repo.name === selectedRepoName) || null
    : null;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-3 -ml-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div className="flex items-center gap-3">
            <Settings className="h-7 w-7 text-primary" />
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Automation</h1>
              <p className="text-sm text-muted-foreground">
                When and how the assistant reviews PRs and responds to @mentions.
              </p>
            </div>
          </div>
        </div>
        <Button onClick={onRefresh} disabled={refreshing} variant="outline" size="sm">
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive mb-5">
          {error}
        </div>
      )}

      {!dashboard ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Loading settings...
          </CardContent>
        </Card>
      ) : repositories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No repositories added yet. Add a repository from the dashboard first.
          </CardContent>
        </Card>
      ) : (
        <div>
          {selectedRepoName && (
            <TriggerSettingsForm
              key={`${selectedRepoName}:${selectedSettings?.updatedAt || "new"}`}
              repoName={selectedRepoName}
              initialAutoReview={selectedSettings?.autoReviewEnabled ?? false}
              initialTriggerOnCreate={selectedSettings?.triggerOnCreate ?? true}
              initialTriggerOnRequest={selectedSettings?.triggerOnRequest ?? true}
              initialTriggerOnReviewRequest={selectedSettings?.triggerOnReviewRequest ?? true}
              initialTriggerOnMention={selectedSettings?.triggerOnMention ?? true}
              initialTriggerOnPush={selectedSettings?.triggerOnPush ?? true}
              initialTriggerAllowlist={selectedSettings?.triggerAllowlist ?? selectedSettings?.manualTriggerAllowlist ?? []}
              initialMentionTriggerPhrase={selectedSettings?.mentionTriggerPhrase ?? "PTAL"}
              initialSummaryTriggerPhrase={selectedSettings?.summaryTriggerPhrase ?? "summary"}
              initialCustomRules={selectedSettings?.customRules ?? ""}
              initialProjectMemory={selectedSettings?.projectMemory ?? null}
              guardianGithubLogin={selectedSettings?.guardianGithubLogin ?? ghAuth?.login ?? null}
              webhookInfo={selectedSettings}
              onSave={(settings) => onSave(selectedRepoName, settings)}
              onRepair={onRepair}
              onRemoveRepo={async () => {
                if (selectedRepo) await onRemoveRepository(selectedRepo.id);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
