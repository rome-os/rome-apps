import "./styles.css";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  fetchAppApi,
  getCurrentAppPath,
  navigateToApp,
  subscribeToAppPath,
  buildAppUrl,
  type RomeAppBootstrap,
} from "@rome-os/app-web-sdk";
import {
  Plus,
  Send,
  ClipboardList,
  BarChart3,
  ArrowLeft,
  Loader2,
  CheckCircle,
  Star,
  Link2,
  Trash2,
  Eye,
  Coins,
  Zap,
  Clock,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/* ─────────────────────────────────────────────────────────────────────
   Types
   ───────────────────────────────────────────────────────────────────── */

interface SurveyData {
  id: string;
  title: string;
  goal: string;
  description: string | null;
  schemaDefinition: string | null;
  formDefinition: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  responseCount?: number;
}

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  metadata?: string | null;
  uiBlock?: string | null;
  createdAt: string;
}

interface UIBlock {
  type: "single_choice" | "multiple_choice" | "rating";
  options?: string[];
  scale?: number;
  lowLabel?: string;
  midLabel?: string;
  highLabel?: string;
  fieldKey?: string;
}

interface AgentReply {
  message: string;
  stage?: string;
  uiBlock?: UIBlock | null;
  done?: boolean;
}

interface ResponseData {
  id: string;
  surveyId: string;
  respondentId: string | null;
  answers: string | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
}

interface ResponseTokenInfo {
  tokens: number;
  costUsd: number;
  calls: number;
}

interface AccountingActionBucket {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  calls: number;
  durationMs: number;
}

interface AccountingSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalCostUsd: number;
  totalCalls: number;
  totalDurationMs: number;
  byActionType: Record<string, AccountingActionBucket>;
}

/* ─────────────────────────────────────────────────────────────────────
   Router
   ───────────────────────────────────────────────────────────────────── */

function parseRoute(path: string): { page: string; id?: string; sub?: string; subId?: string } {
  const parts = path.split("/").filter(Boolean);
  return { page: parts[0] || "", id: parts[1], sub: parts[2], subId: parts[3] };
}

export default function App({ bootstrap: _bootstrap }: { bootstrap: RomeAppBootstrap }) {
  const [path, setPath] = useState(() => getCurrentAppPath());

  useEffect(() => subscribeToAppPath(setPath), []);

  const route = parseRoute(path);

  if (route.page === "design" && route.id) {
    return <DesignPage surveyId={route.id} />;
  }
  if (route.page === "respond" && route.id) {
    return <RespondPage surveyId={route.id} />;
  }
  if (route.page === "results" && route.id) {
    if (route.sub === "response" && route.subId) {
      return <ResponseDetailPage surveyId={route.id} responseId={route.subId} />;
    }
    return <ResultsPage surveyId={route.id} />;
  }

  return <SurveyListPage />;
}

/* ═══════════════════════════════════════════════════════════════════════
   Survey List (Merchant Home)
   ═══════════════════════════════════════════════════════════════════════ */

function SurveyListPage() {
  const [surveys, setSurveys] = useState<SurveyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [goal, setGoal] = useState("");

  const loadSurveys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAppApi("surveys");
      const data = await res.json();
      setSurveys(data.surveys || []);
    } catch { /* empty */ }
    setLoading(false);
  }, []);

  useEffect(() => { void loadSurveys(); }, [loadSurveys]);

  async function handleCreate() {
    if (!goal.trim()) return;
    setCreating(true);
    try {
      const res = await fetchAppApi("surveys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goal.trim() }),
      });
      const data = await res.json();
      if (data.survey) {
        navigateToApp(`design/${data.survey.id}`);
      }
    } catch { /* empty */ }
    setCreating(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this survey and all its responses?")) return;
    await fetchAppApi(`surveys/${id}`, { method: "DELETE" });
    void loadSurveys();
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <ClipboardList className="h-7 w-7 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">AI Survey Builder</h1>
      </div>

      {/* Create new survey */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-lg">New Survey</CardTitle>
          <CardDescription>Describe your research goal and AI will design the survey.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Understand why users churn after 30 days..."
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <Button onClick={handleCreate} disabled={creating || !goal.trim()}>
              {creating ? <Loader2 className="animate-spin" /> : <Plus className="h-4 w-4" />}
              Create
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Survey list */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : surveys.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">No surveys yet. Create one above!</p>
      ) : (
        <div className="space-y-3">
          {surveys.map((s) => (
            <Card key={s.id} className="hover:border-primary/30 transition-colors">
              <CardContent className="flex items-center justify-between py-4 px-5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium truncate">{s.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      s.status === "active" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                    }`}>
                      {s.status}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground truncate mt-0.5">{s.goal}</p>
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  {s.status === "active" && (
                    <>
                      <span className="text-xs text-muted-foreground">{s.responseCount ?? 0} responses</span>
                      <Button variant="ghost" size="sm" onClick={() => navigateToApp(`results/${s.id}`)}>
                        <BarChart3 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => navigateToApp(`respond/${s.id}`)}>
                        <Link2 className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  {s.status === "designing" && (
                    <Button variant="ghost" size="sm" onClick={() => navigateToApp(`design/${s.id}`)}>
                      Design
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(s.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Design Page (Merchant ⟷ Design Agent Chat)
   ═══════════════════════════════════════════════════════════════════════ */

function DesignPage({ surveyId }: { surveyId: string }) {
  const [survey, setSurvey] = useState<SurveyData | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    const [sRes, mRes] = await Promise.all([
      fetchAppApi(`surveys/${surveyId}`),
      fetchAppApi(`surveys/${surveyId}/messages`),
    ]);
    const sData = await sRes.json();
    const mData = await mRes.json();
    setSurvey(sData.survey);
    setMessages(mData.messages || []);
  }, [surveyId]);

  useEffect(() => { void loadData(); }, [loadData]);
  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function handleSend() {
    if (!input.trim() || sending) return;
    const msg = input.trim();
    setInput("");
    setSending(true);

    // Optimistic user message
    setMessages((prev) => [...prev, {
      id: `temp-${Date.now()}`,
      role: "user",
      content: msg,
      createdAt: new Date().toISOString(),
    }]);

    try {
      const res = await fetchAppApi(`surveys/${surveyId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (data.reply) {
        setMessages((prev) => [...prev, {
          id: `reply-${Date.now()}`,
          role: "assistant",
          content: data.reply.message,
          metadata: JSON.stringify({ stage: data.reply.stage }),
          createdAt: new Date().toISOString(),
        }]);
        // Refresh survey for updated status/schema
        const sRes = await fetchAppApi(`surveys/${surveyId}`);
        const sData = await sRes.json();
        setSurvey(sData.survey);
      }
    } catch { /* empty */ }
    setSending(false);
  }

  async function handleApprove() {
    setApproving(true);
    setApproveError(null);
    try {
      const res = await fetchAppApi(`surveys/${surveyId}/approve`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Approve failed");
      }
      const sRes = await fetchAppApi(`surveys/${surveyId}`);
      const sData = await sRes.json();
      setSurvey(sData.survey);
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : "Failed to publish survey");
    } finally {
      setApproving(false);
    }
  }

  if (!survey) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const hasForm = !!survey.formDefinition;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigateToApp("")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold truncate">{survey.title}</h2>
          <p className="text-xs text-muted-foreground truncate">{survey.goal}</p>
        </div>
        {hasForm && survey.status === "designing" && (
          <Button size="sm" onClick={handleApprove} disabled={approving}>
            {approving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Publishing…
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4" /> Approve & Publish
              </>
            )}
          </Button>
        )}
        {survey.status === "active" && (
          <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2 py-1 rounded-full">
            Published
          </span>
        )}
      </div>

      {/* Approve status bar */}
      {approving && (
        <div className="flex items-center gap-2 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-3 py-2 mb-2 shrink-0">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600 dark:text-blue-400" />
          <span className="text-xs text-blue-700 dark:text-blue-300">
            Pre-generating survey greeting and publishing… This may take a moment.
          </span>
        </div>
      )}
      {approveError && (
        <div className="flex items-center gap-2 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 px-3 py-2 mb-2 shrink-0">
          <span className="text-xs text-red-700 dark:text-red-300">
            {approveError}
          </span>
          <button onClick={() => setApproveError(null)} className="ml-auto text-xs text-red-500 hover:text-red-700">✕</button>
        </div>
      )}

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto rounded-lg border bg-muted/30 p-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            Start by describing your research goal in detail. The AI will ask clarifying questions and design your survey.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap ${
              m.role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-card border text-card-foreground"
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-card border rounded-lg px-4 py-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Description preview */}
      {survey.description && (
        <details className="mt-3 shrink-0">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            Survey Specification Preview
          </summary>
          <div className="mt-2 rounded-md border bg-muted/50 p-3 text-xs whitespace-pre-wrap max-h-48 overflow-y-auto">
            {survey.description}
          </div>
        </details>
      )}

      {/* Input */}
      {survey.status === "designing" && (
        <div className="flex gap-2 mt-3 shrink-0">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Describe your needs or respond to the AI..."
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={sending}
          />
          <Button onClick={handleSend} disabled={sending || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      )}
    </main>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Respond Page (Consumer Survey Chat)
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Enriches a rating UIBlock with contextual labels extracted from the
 * agent's message text if the agent didn't populate them in the uiBlock.
 * Handles both Chinese and English patterns.
 */
function enrichRatingLabels(block: UIBlock, messageText: string): UIBlock {
  if (block.type !== "rating") return block;
  if (block.lowLabel && block.highLabel) return block; // already has labels

  const enriched = { ...block };
  const scale = block.scale || 10;

  // Chinese: "1分表示XXX" "1表示XXX" "1代表XXX"
  // English: "1 means XXX" "1 = XXX" "where 1 is XXX"
  const lowPatterns = [
    /1\s*(?:分\s*)?(?:表示|代表|为|是|=|＝)\s*([^，。,;、\n)）]+)/,
    /(?:where|with)\s+1\s+(?:being|meaning|is|=)\s+([^,;.\n)）]+)/i,
    /1\s*(?:means?|indicates?)\s+([^,;.\n)）]+)/i,
  ];
  const highPatterns = [
    new RegExp(`${scale}\\s*(?:分\\s*)?(?:表示|代表|为|是|=|＝)\\s*([^，。,;、\\n)）]+)`),
    new RegExp(`(?:and|while|,)\\s*${scale}\\s+(?:being|meaning|is|=)\\s+([^,;.\\n)）]+)`, "i"),
    new RegExp(`${scale}\\s*(?:means?|indicates?)\\s+([^,;.\\n)）]+)`, "i"),
  ];
  const mid = Math.ceil(scale / 2);
  const midPatterns = [
    new RegExp(`${mid}\\s*(?:分\\s*)?(?:表示|代表|为|是|=|＝)\\s*([^，。,;、\\n)）]+)`),
  ];

  for (const pat of lowPatterns) {
    const m = messageText.match(pat);
    if (m && !enriched.lowLabel) { enriched.lowLabel = m[1].trim(); break; }
  }
  for (const pat of highPatterns) {
    const m = messageText.match(pat);
    if (m && !enriched.highLabel) { enriched.highLabel = m[1].trim(); break; }
  }
  for (const pat of midPatterns) {
    const m = messageText.match(pat);
    if (m && !enriched.midLabel) { enriched.midLabel = m[1].trim(); break; }
  }

  return enriched;
}

function RespondPage({ surveyId }: { surveyId: string }) {
  const [survey, setSurvey] = useState<{ id: string; title: string; description: string | null } | null>(null);
  const [responseId, setResponseId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [latestUiBlock, setLatestUiBlock] = useState<UIBlock | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load survey info only on mount
  useEffect(() => {
    async function loadSurvey() {
      try {
        const sRes = await fetchAppApi(`public/surveys/${surveyId}`);
        if (!sRes.ok) {
          setError("This survey is not available.");
          setInitializing(false);
          return;
        }
        const sData = await sRes.json();
        setSurvey(sData.survey);
      } catch {
        setError("Failed to load survey.");
      }
      setInitializing(false);
    }
    void loadSurvey();
  }, [surveyId]);

  // Start the survey session when user clicks "Start"
  async function handleStart() {
    if (!survey) return;
    setStarted(true);

    try {
      const rRes = await fetchAppApi("public/surveys/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surveyId }),
      });
      const rData = await rRes.json();
      if (rData.response) {
        setResponseId(rData.response.id);
        if (rData.initialReply) {
          const reply = rData.initialReply as AgentReply;
          const enrichedBlock = reply.uiBlock
            ? enrichRatingLabels(reply.uiBlock, reply.message)
            : null;
          setMessages([{
            id: "init",
            role: "assistant",
            content: reply.message,
            uiBlock: enrichedBlock ? JSON.stringify(enrichedBlock) : null,
            createdAt: new Date().toISOString(),
          }]);
          if (enrichedBlock) setLatestUiBlock(enrichedBlock);
          if (reply.done) setDone(true);
        }
      }
    } catch {
      setError("Failed to start the survey. Please try again.");
      setStarted(false);
    }
  }

  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function sendMessage(text: string) {
    if (!responseId || !text.trim() || sending) return;
    setSending(true);
    setLatestUiBlock(null);

    setMessages((prev) => [...prev, {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    }]);
    setInput("");

    try {
      const res = await fetchAppApi("public/responses/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responseId, message: text }),
      });
      const data = await res.json();
      if (data.reply) {
        const reply = data.reply as AgentReply;
        const enrichedBlock = reply.uiBlock
          ? enrichRatingLabels(reply.uiBlock, reply.message)
          : null;
        setMessages((prev) => [...prev, {
          id: `bot-${Date.now()}`,
          role: "assistant",
          content: reply.message,
          uiBlock: enrichedBlock ? JSON.stringify(enrichedBlock) : null,
          createdAt: new Date().toISOString(),
        }]);
        if (enrichedBlock) setLatestUiBlock(enrichedBlock);
        if (reply.done) setDone(true);
      }
    } catch { /* empty */ }
    setSending(false);
  }

  // Global loading
  if (initializing) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  // Error state
  if (error && !started) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12 text-center">
        <p className="text-destructive">{error}</p>
      </main>
    );
  }

  if (!survey) return null;

  // Welcome screen — shown BEFORE user starts the survey
  if (!started) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <Card>
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <ClipboardList className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-xl">{survey.title}</CardTitle>
            {survey.description && (
              <CardDescription className="mt-2 text-sm whitespace-pre-wrap leading-relaxed">
                {survey.description}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="text-center pt-4 pb-6">
            <p className="text-sm text-muted-foreground mb-6">
              This is an AI-powered conversational survey. An AI interviewer will guide you through a series of questions — just answer naturally.
            </p>
            <Button size="lg" onClick={handleStart} className="px-8">
              <ClipboardList className="h-4 w-4" />
              Start Survey
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  // Waiting for the first agent response after clicking Start
  const agentLoading = started && messages.length === 0 && !error;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 flex flex-col h-[calc(100vh-4rem)]">
      <div className="text-center mb-4 shrink-0">
        <h2 className="text-lg font-semibold">{survey.title}</h2>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto rounded-lg border bg-muted/30 p-4 space-y-3">
        {agentLoading && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Preparing your survey questions...</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id}>
            <div className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border text-card-foreground"
              }`}>
                {m.content}
              </div>
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-card border rounded-lg px-4 py-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Rich UI Block */}
      {latestUiBlock && !done && (
        <div className="mt-3 shrink-0">
          <RichInput uiBlock={latestUiBlock} onSubmit={sendMessage} disabled={sending} />
        </div>
      )}

      {/* Text input — only shown when there are messages but no uiBlock */}
      {!done && !latestUiBlock && !agentLoading && responseId && (
        <div className="flex gap-2 mt-3 shrink-0">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage(input)}
            placeholder="Type your answer..."
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={sending}
          />
          <Button onClick={() => sendMessage(input)} disabled={sending || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      )}

      {done && (
        <div className="mt-4 text-center shrink-0">
          <CheckCircle className="h-8 w-8 text-green-500 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Thank you for completing this survey!</p>
        </div>
      )}
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Rich Input Component (Single/Multiple Choice, Rating)
   ───────────────────────────────────────────────────────────────────── */

function RichInput({ uiBlock, onSubmit, disabled }: { uiBlock: UIBlock; onSubmit: (text: string) => void; disabled: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [rating, setRating] = useState(0);
  const [otherText, setOtherText] = useState("");
  const [showOtherInput, setShowOtherInput] = useState(false);

  // Helper: check if an option is the "Other" option
  const isOtherOption = (opt: string) =>
    /^(其他|other)/i.test(opt.trim());

  if (uiBlock.type === "single_choice" && uiBlock.options) {
    return (
      <div className="rounded-lg border bg-card p-4 space-y-2">
        {uiBlock.options.map((opt) => {
          if (isOtherOption(opt)) {
            return (
              <div key={opt}>
                {!showOtherInput ? (
                  <button
                    disabled={disabled}
                    onClick={() => setShowOtherInput(true)}
                    className="w-full text-left rounded-md border border-dashed px-4 py-2.5 text-sm hover:bg-accent hover:border-primary/50 transition-colors disabled:opacity-50 text-muted-foreground"
                  >
                    {opt}
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={otherText}
                      onChange={(e) => setOtherText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && otherText.trim() && onSubmit(otherText.trim())}
                      placeholder="Please specify..."
                      autoFocus
                      className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <Button
                      size="sm"
                      disabled={disabled || !otherText.trim()}
                      onClick={() => { onSubmit(otherText.trim()); setOtherText(""); setShowOtherInput(false); }}
                    >
                      <Send className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            );
          }
          return (
            <button
              key={opt}
              disabled={disabled}
              onClick={() => { setShowOtherInput(false); onSubmit(opt); }}
              className="w-full text-left rounded-md border px-4 py-2.5 text-sm hover:bg-accent hover:border-primary/50 transition-colors disabled:opacity-50"
            >
              {opt}
            </button>
          );
        })}
      </div>
    );
  }

  if (uiBlock.type === "multiple_choice" && uiBlock.options) {
    const regularOptions = uiBlock.options.filter((o) => !isOtherOption(o));
    const hasOther = uiBlock.options.some(isOtherOption);

    return (
      <div className="rounded-lg border bg-card p-4 space-y-2">
        {regularOptions.map((opt) => (
          <label key={opt} className="flex items-center gap-3 rounded-md border px-4 py-2.5 text-sm cursor-pointer hover:bg-accent transition-colors">
            <input
              type="checkbox"
              checked={selected.includes(opt)}
              onChange={(e) => {
                setSelected((prev) =>
                  e.target.checked ? [...prev, opt] : prev.filter((s) => s !== opt)
                );
              }}
              className="h-4 w-4 rounded border-input"
            />
            {opt}
          </label>
        ))}
        {hasOther && (
          <div className="flex items-center gap-3 rounded-md border border-dashed px-4 py-2.5 text-sm">
            <input
              type="checkbox"
              checked={!!otherText.trim()}
              onChange={(e) => { if (!e.target.checked) setOtherText(""); }}
              className="h-4 w-4 rounded border-input"
            />
            <input
              type="text"
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              placeholder="Other (please specify)..."
              className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground"
            />
          </div>
        )}
        <Button
          className="w-full mt-2"
          disabled={disabled || (selected.length === 0 && !otherText.trim())}
          onClick={() => {
            const all = [...selected, ...(otherText.trim() ? [otherText.trim()] : [])];
            onSubmit(all.join(", "));
            setSelected([]);
            setOtherText("");
          }}
        >
          Confirm Selection
        </Button>
      </div>
    );
  }

  if (uiBlock.type === "rating") {
    const scale = uiBlock.scale || 10;
    const mid = Math.ceil(scale / 2);
    const lowLabel = uiBlock.lowLabel || `1 = Lowest`;
    const midLabel = uiBlock.midLabel;
    const highLabel = uiBlock.highLabel || `${scale} = Highest`;

    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap gap-1 justify-center">
          {Array.from({ length: scale }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              disabled={disabled}
              onClick={() => setRating(n)}
              className={`flex items-center justify-center w-9 h-9 rounded-md border text-sm font-medium transition-colors ${
                rating === n
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-accent hover:border-primary/50"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        {/* Contextual rating labels */}
        <div className="flex justify-between text-xs text-muted-foreground mt-2 px-1">
          <span className="max-w-[30%] text-left">{lowLabel}</span>
          {midLabel && <span className="max-w-[30%] text-center">{midLabel}</span>}
          <span className="max-w-[30%] text-right">{highLabel}</span>
        </div>
        <Button
          className="w-full mt-3"
          disabled={disabled || rating === 0}
          onClick={() => { onSubmit(String(rating)); setRating(0); }}
        >
          <Star className="h-4 w-4" /> Submit Rating
        </Button>
      </div>
    );
  }

  return null;
}

/* ═══════════════════════════════════════════════════════════════════════
   Results Page (Merchant Analytics)
   ═══════════════════════════════════════════════════════════════════════ */

function ResultsPage({ surveyId }: { surveyId: string }) {
  const [survey, setSurvey] = useState<SurveyData | null>(null);
  const [responses, setResponses] = useState<ResponseData[]>([]);
  const [total, setTotal] = useState(0);
  const [accounting, setAccounting] = useState<AccountingSummary | null>(null);
  const [tokenMap, setTokenMap] = useState<Record<string, ResponseTokenInfo>>({});

  useEffect(() => {
    async function load() {
      const [sRes, rRes, aRes] = await Promise.all([
        fetchAppApi(`surveys/${surveyId}`),
        fetchAppApi(`surveys/${surveyId}/responses`),
        fetchAppApi(`surveys/${surveyId}/accounting`),
      ]);
      const sData = await sRes.json();
      const rData = await rRes.json();
      setSurvey(sData.survey);
      setResponses(rData.responses || []);
      setTotal(rData.total || 0);
      if (rData.tokenMap) setTokenMap(rData.tokenMap);
      try {
        const aData = await aRes.json();
        if (aData.accounting) setAccounting(aData.accounting);
      } catch { /* accounting not available yet */ }
    }
    void load();
  }, [surveyId]);

  if (!survey) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigateToApp("")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h2 className="font-semibold">{survey.title} — Results</h2>
          <p className="text-xs text-muted-foreground">{total} response(s)</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigateToApp(`respond/${surveyId}`)}>
          <Link2 className="h-4 w-4" /> Survey Link
        </Button>
      </div>

      {responses.length === 0 ? (
        <p className="text-center text-muted-foreground py-12">No responses yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border rounded-lg overflow-hidden">
            <thead className="bg-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">#</th>
                <th className="text-left px-4 py-2 font-medium">Respondent</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Answers</th>
                <th className="text-right px-4 py-2 font-medium">Tokens</th>
                <th className="text-right px-4 py-2 font-medium">Cost</th>
                <th className="text-left px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {responses.map((r, i) => {
                const answers = r.answers ? JSON.parse(r.answers) : {};
                const answerCount = Object.keys(answers).length;
                const rTokens = tokenMap[r.id];
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/50 transition-colors">
                    <td className="px-4 py-2">{i + 1}</td>
                    <td className="px-4 py-2">{r.respondentId || "Anonymous"}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        r.status === "completed" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                      }`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{answerCount} field(s)</td>
                    <td className="px-4 py-2 text-right text-muted-foreground text-xs">
                      {rTokens ? formatTokens(rTokens.tokens) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground text-xs">
                      {rTokens ? formatCost(rTokens.costUsd) : "—"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground text-xs">{new Date(r.startedAt).toLocaleDateString()}</td>
                    <td className="px-4 py-2">
                      <Button variant="ghost" size="sm" onClick={() => navigateToApp(`results/${surveyId}/response/${r.id}`)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Accounting / Token Usage Block */}
      <AccountingBlock accounting={accounting} />
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   Accounting Block (Token Usage Statistics)
   ───────────────────────────────────────────────────────────────────── */

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${ms}ms`;
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

const ACTION_LABELS: Record<string, string> = {
  design: "Survey Design",
  chat: "Survey Chat",
};

function AccountingBlock({ accounting, title, description }: {
  accounting: AccountingSummary | null;
  title?: string;
  description?: string;
}) {
  const blockTitle = title || "Token Usage & Cost";
  const blockDescription = description || "AI resource consumption for this survey";

  if (!accounting || accounting.totalCalls === 0) {
    return (
      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">{blockTitle}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No token usage recorded yet. Usage data will appear here after survey interactions.</p>
        </CardContent>
      </Card>
    );
  }

  const totalTokens = accounting.totalInputTokens + accounting.totalOutputTokens;
  const actionTypes = Object.entries(accounting.byActionType);

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm">{blockTitle}</CardTitle>
        </div>
        <CardDescription>{blockDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Summary stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border bg-muted/30 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Zap className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs text-muted-foreground">Total Tokens</span>
            </div>
            <p className="text-lg font-semibold">{formatTokens(totalTokens)}</p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Coins className="h-3.5 w-3.5 text-green-500" />
              <span className="text-xs text-muted-foreground">Est. Cost</span>
            </div>
            <p className="text-lg font-semibold">{formatCost(accounting.totalCostUsd)}</p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Activity className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-xs text-muted-foreground">API Calls</span>
            </div>
            <p className="text-lg font-semibold">{accounting.totalCalls}</p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-center">
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Clock className="h-3.5 w-3.5 text-purple-500" />
              <span className="text-xs text-muted-foreground">Total Time</span>
            </div>
            <p className="text-lg font-semibold">{formatDuration(accounting.totalDurationMs)}</p>
          </div>
        </div>

        {/* Token breakdown bar */}
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
            <span>Token Breakdown</span>
            <span>{formatTokens(totalTokens)} total</span>
          </div>
          <div className="h-3 rounded-full bg-muted overflow-hidden flex">
            {accounting.totalInputTokens > 0 && (
              <div
                className="bg-blue-500 h-full transition-all"
                style={{ width: `${(accounting.totalInputTokens / totalTokens) * 100}%` }}
                title={`Input: ${formatTokens(accounting.totalInputTokens)}`}
              />
            )}
            {accounting.totalOutputTokens > 0 && (
              <div
                className="bg-emerald-500 h-full transition-all"
                style={{ width: `${(accounting.totalOutputTokens / totalTokens) * 100}%` }}
                title={`Output: ${formatTokens(accounting.totalOutputTokens)}`}
              />
            )}
          </div>
          <div className="flex gap-4 mt-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500" /> Input: {formatTokens(accounting.totalInputTokens)}
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Output: {formatTokens(accounting.totalOutputTokens)}
            </span>
            {accounting.totalCacheReadTokens > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400" /> Cache Read: {formatTokens(accounting.totalCacheReadTokens)}
              </span>
            )}
            {accounting.totalCacheWriteTokens > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-orange-400" /> Cache Write: {formatTokens(accounting.totalCacheWriteTokens)}
              </span>
            )}
          </div>
        </div>

        {/* Per-action breakdown table */}
        {actionTypes.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Breakdown by Action</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border rounded-lg overflow-hidden">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left px-3 py-1.5 font-medium">Action</th>
                    <th className="text-right px-3 py-1.5 font-medium">Calls</th>
                    <th className="text-right px-3 py-1.5 font-medium">Input</th>
                    <th className="text-right px-3 py-1.5 font-medium">Output</th>
                    <th className="text-right px-3 py-1.5 font-medium">Cache R/W</th>
                    <th className="text-right px-3 py-1.5 font-medium">Cost</th>
                    <th className="text-right px-3 py-1.5 font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {actionTypes.map(([type, bucket]) => (
                    <tr key={type} className="border-t">
                      <td className="px-3 py-1.5 font-medium">{ACTION_LABELS[type] || type}</td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">{bucket.calls}</td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">{formatTokens(bucket.inputTokens)}</td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">{formatTokens(bucket.outputTokens)}</td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">
                        {formatTokens(bucket.cacheReadTokens)} / {formatTokens(bucket.cacheWriteTokens)}
                      </td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">{formatCost(bucket.costUsd)}</td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">{formatDuration(bucket.durationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Response Detail Page (View chat history for a single response)
   ═══════════════════════════════════════════════════════════════════════ */

function ResponseDetailPage({ surveyId, responseId }: { surveyId: string; responseId: string }) {
  const [response, setResponse] = useState<ResponseData | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [accounting, setAccounting] = useState<AccountingSummary | null>(null);

  useEffect(() => {
    async function load() {
      const res = await fetchAppApi(`surveys/${surveyId}/responses/${responseId}`);
      const data = await res.json();
      setResponse(data.response);
      setMessages(data.messages || []);
      if (data.accounting) setAccounting(data.accounting);
    }
    void load();
  }, [surveyId, responseId]);

  if (!response) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const answers = response.answers ? JSON.parse(response.answers) : {};

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigateToApp(`results/${surveyId}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h2 className="font-semibold">Response Detail</h2>
          <p className="text-xs text-muted-foreground">
            {response.respondentId || "Anonymous"} — {response.status}
          </p>
        </div>
      </div>

      {/* Collected data */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm">Collected Data</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(answers).length === 0 ? (
            <p className="text-sm text-muted-foreground">No data collected yet.</p>
          ) : (
            <dl className="space-y-2">
              {Object.entries(answers).map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <dt className="text-sm font-medium min-w-[120px]">{key}:</dt>
                  <dd className="text-sm text-muted-foreground">{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>

      {/* Chat history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Conversation History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 max-h-96 overflow-y-auto">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              }`}>
                {m.content}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Token usage for this response */}
      <AccountingBlock accounting={accounting} title="Conversation Token Usage" description="AI resource consumption for this conversation" />
    </main>
  );
}
