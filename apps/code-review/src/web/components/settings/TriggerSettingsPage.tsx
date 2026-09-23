import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, AtSign, Ban, Brain, CheckCircle, Clock, Eye, ExternalLink, Github, GitPullRequest, MessageSquare, Plug, Plus, RefreshCw, Settings, Trash2, Users, Wrench, X, XCircle, type LucideIcon } from "lucide-react";
import { Alert, AlertDescription } from "@rome-os/ui/alert";
import { Badge } from "@rome-os/ui/badge";
import { Button } from "@rome-os/ui/button";
import { Card, CardContent } from "@rome-os/ui/card";
import { Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@rome-os/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@rome-os/ui/field";
import { IconButton } from "@rome-os/ui/icon-button";
import { Input } from "@rome-os/ui/input";
import {
  FormRow,
  FormRowControl,
  FormRowDescription,
  FormRowHeading,
  FormRowLabel,
  FormRows,
} from "@rome-os/ui/layout-form";
import {
  PageActions,
  PageDescription,
  PageHeader,
  PageHeaderNav,
  PageHeading,
  PageTitle,
  Section,
  SectionActions,
  SectionDescription,
  SectionHeader,
  SectionHeading,
  SectionTitle,
} from "@rome-os/ui/page";
import { RadioGroup, RadioGroupItem } from "@rome-os/ui/radio-group";
import { Spinner } from "@rome-os/ui/spinner";
import { Switch } from "@rome-os/ui/switch";
import { Textarea } from "@rome-os/ui/textarea";
import { GithubUserAvatar } from "@/components/github/GithubUserAvatar";
import { ProjectMemoryCard } from "@/components/settings/ProjectMemoryCard";
import type { DashboardData, GhAuthStatus, GithubUserProfile, PRReviewSettingsData, TriggerAccessMode, TriggerSettingsPayload } from "@/types";
import { fetchGithubUserProfile, getAppBasePath, getTriggerSettingsRepoParam, normalizeGithubLoginInput, normalizeGithubLogins } from "@/lib/helpers";
import { TRIGGER_SETTINGS_ROUTE } from "@/lib/constants";

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
    <Dialog open={open} onClose={onClose} size="md">
      <DialogHeader onClose={onClose}>
        <DialogTitle>
              {mode === "blocklist" ? "Block GitHub user" : "Allow GitHub user"}
        </DialogTitle>
        <DialogDescription>Look up a GitHub ID, verify the avatar and name, then confirm.</DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit}>
        <DialogBody>
          <div className="flex gap-2">
            <Input
              type="text"
              value={loginInput}
              onChange={(event) => {
                setLoginInput(event.target.value);
                setProfile(null);
                setError(null);
              }}
              placeholder="github-login"
              autoFocus
              className="flex-1"
            />
            <Button type="button" variant="outline" onClick={() => void lookup()} disabled={loading}>
              {loading ? <Spinner size="sm" label="Looking up GitHub user" /> : "Lookup"}
            </Button>
          </div>

          {error && (
            <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
          )}

          {profile && (
            <Card>
              <CardContent className="flex items-center gap-3">
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
              </CardContent>
            </Card>
          )}
        </DialogBody>
        <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!profile || loading}>
              {mode === "blocklist" ? "Block user" : "Allow user"}
            </Button>
        </DialogFooter>
      </form>
    </Dialog>
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
            <Badge className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px]">You</Badge>
          </div>
        ) : mode === "allowlist" ? (
          <Badge variant="outline">GitHub account not connected</Badge>
        ) : null}
        {value.map((login) => (
          <div key={login} className="group relative">
            <GithubUserAvatar login={login} profile={profiles[login]} className="h-10 w-10" />
            <IconButton
              label={`Remove @${login}`}
              icon={<X />}
              size="xs"
              onClick={() => removeLogin(login)}
              disabled={disabled}
              className="absolute -right-1 -top-1 rounded-full border bg-background text-destructive"
            />
          </div>
        ))}
        <IconButton
          label={mode === "blocklist" ? "Add GitHub user to blocklist" : "Add GitHub user to allowlist"}
          icon={<Plus />}
          size="md"
          onClick={() => setDialogOpen(true)}
          disabled={disabled}
          className="rounded-full border-2 border-dashed"
        />
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

// --- Trigger Settings ---

/** A section header with a semantic icon and an optional right-aligned action (e.g. a master switch). */
function SettingsSectionHeader({
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
    <SectionHeader>
      <SectionHeading>
        <SectionTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </SectionTitle>
        {description && <SectionDescription>{description}</SectionDescription>}
      </SectionHeading>
      {action && <SectionActions>{action}</SectionActions>}
    </SectionHeader>
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
  initialTriggerAccessMode,
  initialTriggerAllowlist,
  initialTriggerBlocklist,
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
  initialTriggerAccessMode: TriggerAccessMode;
  initialTriggerAllowlist: string[];
  initialTriggerBlocklist: string[];
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
  const [triggerAccessMode, setTriggerAccessMode] = useState<TriggerAccessMode>(initialTriggerAccessMode);
  const [triggerAllowlist, setTriggerAllowlist] = useState(
    normalizeGithubLogins(initialTriggerAllowlist),
  );
  const [triggerBlocklist, setTriggerBlocklist] = useState(
    normalizeGithubLogins(initialTriggerBlocklist),
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
        triggerAccessMode,
        triggerAllowlist,
        triggerBlocklist,
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
        triggerAccessMode,
        triggerAllowlist,
        triggerBlocklist,
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
              <Spinner size="xs" label="Saving settings" />
              Saving
            </span>
          )}
        </div>
        <Button onClick={() => void handleSave()} disabled={saving || autoSaving}>
          {saving ? (autoReview || triggerOnRequest ? "Setting up webhook..." : "Saving...") : "Save changes"}
        </Button>
      </div>
      {saveError && (
        <Alert variant="destructive"><AlertDescription>{saveError}</AlertDescription></Alert>
      )}

      {/* 1 — Who can use it */}
      <Section>
        <SettingsSectionHeader
          icon={Users}
          title="Who can use it"
          description="Choose a default, then add the exceptions. Your connected account is always allowed."
        />
        <Card>
          <CardContent className="space-y-4">
        <RadioGroup
          className="grid gap-2 sm:grid-cols-2"
          aria-label="Who can trigger the bot"
          value={triggerAccessMode}
          disabled={controlsDisabled}
          orientation="horizontal"
          onValueChange={(value) => {
            const mode = value as TriggerAccessMode;
            setTriggerAccessMode(mode);
            void persistSettings({ triggerAccessMode: mode });
          }}
        >
          <label className={`flex cursor-pointer gap-3 rounded-md border p-3 transition-colors ${triggerAccessMode === "allowlist" ? "border-primary bg-primary/5" : "bg-background/60 hover:bg-muted/40"}`}>
            <RadioGroupItem
              value="allowlist"
              aria-label="Selected people only"
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium">Selected people only</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">Start closed. Only you and people you allow can trigger the bot.</span>
            </span>
          </label>
          <label className={`flex cursor-pointer gap-3 rounded-md border p-3 transition-colors ${triggerAccessMode === "blocklist" ? "border-primary bg-primary/5" : "bg-background/60 hover:bg-muted/40"}`}>
            <RadioGroupItem
              value="blocklist"
              aria-label="Everyone except blocked"
              className="mt-1"
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-medium"><Ban className="h-3.5 w-3.5" />Everyone except blocked</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">Start open. Any GitHub user can trigger the bot unless you block them.</span>
            </span>
          </label>
        </RadioGroup>
        <div>
          <TriggerUserListEditor
            mode={triggerAccessMode}
            guardianGithubLogin={guardianGithubLogin}
            value={triggerAccessMode === "blocklist" ? triggerBlocklist : triggerAllowlist}
            disabled={controlsDisabled}
            onChange={(next) => {
              if (triggerAccessMode === "blocklist") {
                setTriggerBlocklist(next);
                void persistSettings({ triggerBlocklist: next });
              } else {
                setTriggerAllowlist(next);
                void persistSettings({ triggerAllowlist: next });
              }
            }}
          />
        </div>
          </CardContent>
        </Card>
      </Section>

      {/* 2 — Code reviews */}
      <Section>
        <SettingsSectionHeader
          icon={GitPullRequest}
          title="Code reviews"
          description="The bot reviews pull requests and posts inline findings. Choose when it runs."
        />
        <FormRows className="max-w-none">
          <FormRow>
            <FormRowHeading>
              <FormRowLabel>Automatically</FormRowLabel>
              <FormRowDescription>Review on PR activity — no mention needed.</FormRowDescription>
            </FormRowHeading>
            <FormRowControl>
              <Switch
                checked={autoReview}
                disabled={controlsDisabled}
                onCheckedChange={handleAutoReviewChange}
                aria-label="Toggle automatic reviews"
              />
            </FormRowControl>
          </FormRow>
          {autoReview && (
            <>
              <FormRow className="bg-surface-muted/30 pl-7">
                <FormRowHeading>
                  <FormRowLabel>When a PR is opened</FormRowLabel>
                </FormRowHeading>
                <FormRowControl>
                  <Switch
                    checked={triggerOnCreate}
                    disabled={controlsDisabled}
                    onCheckedChange={(checked) => handleAutoTriggerChange(setTriggerOnCreate, checked, triggerOnPush)}
                    aria-label="Toggle PR opened trigger"
                  />
                </FormRowControl>
              </FormRow>
              <FormRow className="bg-surface-muted/30 pl-7">
                <FormRowHeading>
                  <FormRowLabel>When new commits are pushed</FormRowLabel>
                </FormRowHeading>
                <FormRowControl>
                  <Switch
                    checked={triggerOnPush}
                    disabled={controlsDisabled}
                    onCheckedChange={(checked) => handleAutoTriggerChange(setTriggerOnPush, checked, triggerOnCreate)}
                    aria-label="Toggle new commits trigger"
                  />
                </FormRowControl>
              </FormRow>
            </>
          )}
          <FormRow>
            <FormRowHeading>
              <FormRowLabel>On GitHub review request</FormRowLabel>
              <FormRowDescription>When someone requests a review from {botHandle}.</FormRowDescription>
            </FormRowHeading>
            <FormRowControl>
            <Switch
              checked={triggerOnReviewRequest}
              disabled={controlsDisabled}
              onCheckedChange={(checked) => handleManualSubTriggerChange(setTriggerOnReviewRequest, checked, triggerOnMention)}
              aria-label="Toggle review request trigger"
            />
            </FormRowControl>
          </FormRow>
        </FormRows>
        <Card>
          <CardContent>
          <Field className="pt-1">
            <FieldLabel htmlFor="custom-review-rules">Custom review rules</FieldLabel>
            <Textarea
              id="custom-review-rules"
              value={customRules}
              onChange={(e) => setCustomRules(e.target.value)}
              placeholder={`Extra rules the reviewer must also check, e.g.\n- Check error handling\n- Require JSDoc for new functions\n- Flag direct DOM manipulation`}
              rows={4}
            />
            <FieldDescription>Applied on top of the reviewer's defaults. Save with the button below.</FieldDescription>
          </Field>
          </CardContent>
        </Card>
      </Section>

      {/* 3 — @mention assistant */}
      <Section>
        <SettingsSectionHeader
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
          <Card>
            <CardContent className="space-y-4">
            <div className="rounded-8 bg-surface-muted p-3">
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
            <Field>
              <FieldLabel htmlFor="review-phrase">Review phrase</FieldLabel>
              <Input
                id="review-phrase"
                type="text"
                value={mentionTriggerPhrase}
                onChange={(e) => setMentionTriggerPhrase(e.target.value)}
                placeholder="PTAL"
                size="sm"
                className="w-full max-w-xs"
              />
              <FieldDescription>
                e.g. <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{mentionCommand || `${botHandle} ${mentionTriggerPhrase || "PTAL"}`}</code> runs a full review.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="summary-phrase">Summary phrase</FieldLabel>
              <Input
                id="summary-phrase"
                type="text"
                value={summaryTriggerPhrase}
                onChange={(e) => setSummaryTriggerPhrase(e.target.value)}
                placeholder="summary"
                size="sm"
                className="w-full max-w-xs"
              />
              <FieldDescription>
                e.g. <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{summaryCommand || `${botHandle} ${summaryTriggerPhrase || "summary"}`}</code> posts a discussion summary (PR only).
              </FieldDescription>
            </Field>
            </CardContent>
          </Card>
        ) : (
          <Alert variant="info">
            <AlertDescription>Off — the bot ignores @mentions entirely: no questions, feedback, code tasks, or phrase reviews.</AlertDescription>
          </Alert>
        )}
      </Section>

      {/* Project memory — shared knowledge for every task the bot runs here */}
      <Section>
        <SettingsSectionHeader
          icon={Brain}
          title="Project memory"
          description="Shared knowledge the bot uses for everything it does here — reviews, questions, feedback and code tasks. It also writes here from your feedback."
        />
        <div>
          <ProjectMemoryCard repoName={repoName} initialProjectMemory={initialProjectMemory} />
        </div>
      </Section>

      {/* 5 — Connection (read-only) */}
      {(autoReview || triggerOnRequest || webhookInfo?.githubWebhookId || webhookInfo?.eventRoutineStatus) && (
        <Section>
          <SettingsSectionHeader
            icon={Plug}
            title="Connection"
            description="The GitHub webhook and event routines that deliver these triggers."
          />
          <FormRows className="max-w-none">
            <FormRow>
              <FormRowHeading>
                <FormRowLabel>GitHub webhook</FormRowLabel>
                <FormRowDescription>Receives pull request events from GitHub.</FormRowDescription>
              </FormRowHeading>
              <FormRowControl>
              {webhookInfo?.webhookConnected ? (
                <Badge variant="success" className="gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="warning" className="gap-1">
                  <Clock className="h-3 w-3" />
                  Not subscribed
                </Badge>
              )}
              {webhookInfo?.githubWebhookId && (
                <span className="text-xs font-mono text-muted-foreground">#{webhookInfo.githubWebhookId}</span>
              )}
              </FormRowControl>
            </FormRow>
            <FormRow>
              <FormRowHeading>
                <FormRowLabel>Event routines</FormRowLabel>
                <FormRowDescription>Routes webhook events to the review workflow.</FormRowDescription>
              </FormRowHeading>
              <FormRowControl>
              {webhookInfo?.eventRoutinesReady === true ? (
                <Badge variant="success" className="gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Ready
                </Badge>
              ) : webhookInfo?.eventRoutinesReady === false ? (
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="h-3 w-3" />
                  Missing or disabled
                </Badge>
              ) : (
                <Badge variant="warning" className="gap-1">
                  <Clock className="h-3 w-3" />
                  Unknown
                </Badge>
              )}
              </FormRowControl>
            </FormRow>
          </FormRows>
          <div className="space-y-2">
            {webhookInfo?.eventRoutineStatus && !webhookInfo.eventRoutineStatus.ready && (
              <p className="text-xs text-muted-foreground">
                Missing: {webhookInfo.eventRoutineStatus.missing.join(", ") || "none"};
                disabled: {webhookInfo.eventRoutineStatus.disabled.join(", ") || "none"}.
              </p>
            )}
            {!webhookInfo?.webhookConnected && (autoReview || triggerOnRequest) && (
              <Alert variant="info"><AlertDescription>On save, Rome registers its own GitHub webhook on this repo. Event routines are tracked separately and must also be ready.</AlertDescription></Alert>
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
                      <Spinner size="sm" label="Repairing connection" />
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
        </Section>
      )}

      {/* Danger zone — remove this repository */}
      <Section>
        <SettingsSectionHeader
          icon={Trash2}
          title="Danger zone"
          description="Remove this repository from Code Review. This deletes its automation settings here — it does not touch the GitHub repository."
        />
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent>
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
                    <Spinner size="sm" label="Removing repository" />
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
          </CardContent>
        </Card>
      </Section>

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
      <PageHeader>
        <PageHeaderNav>
          <Button variant="ghost" size="sm" onClick={onBack} className="mb-3 -ml-2">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </PageHeaderNav>
        <PageHeading>
          <div className="flex items-center gap-3">
            <Settings className="h-7 w-7 text-primary" />
            <div className="min-w-0">
              <PageTitle>Automation</PageTitle>
              <PageDescription>
                When and how the assistant reviews PRs and responds to @mentions.
              </PageDescription>
            </div>
          </div>
        </PageHeading>
        <PageActions>
        <Button onClick={onRefresh} disabled={refreshing} variant="outline" size="sm">
          {refreshing ? <Spinner size="sm" label="Refreshing settings" /> : <RefreshCw />}
          Refresh
        </Button>
        </PageActions>
      </PageHeader>

      {error && (
        <Alert variant="destructive" className="mb-5"><AlertDescription>{error}</AlertDescription></Alert>
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
              initialTriggerAccessMode={selectedSettings?.triggerAccessMode ?? "allowlist"}
              initialTriggerAllowlist={selectedSettings?.triggerAllowlist ?? selectedSettings?.manualTriggerAllowlist ?? []}
              initialTriggerBlocklist={selectedSettings?.triggerBlocklist ?? []}
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
