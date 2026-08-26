import "./styles.css";
import { useState, useCallback, useEffect } from "react";
import { fetchAppApi, type RomeAppBootstrap } from "@rome-os/app-web-sdk";
import {
  FileText,
  Loader2,
  Copy,
  Check,
  Send,
  History,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Period = "last-day" | "last-week" | "this-week" | "last-month";

interface PeriodOption {
  value: Period;
  label: string;
  description: string;
}

const PERIOD_OPTIONS: PeriodOption[] = [
  { value: "last-day", label: "最近一天", description: "过去 24 小时" },
  { value: "this-week", label: "本周", description: "周一至今" },
  { value: "last-week", label: "最近一周", description: "过去 7 天" },
  { value: "last-month", label: "最近一个月", description: "过去 30 天" },
];

interface SummaryResult {
  id?: string;
  report: string;
  period: string;
  periodLabel: string;
  windowHours: number;
  sourcesCollected: number;
  wechatSent: boolean;
}

interface ReportListItem {
  id: string;
  period: string;
  periodLabel: string;
  preview: string;
  sourcesCollected: number;
  wechatSent: boolean;
  createdAt: string;
}

interface RawSource {
  source: string;
  content: string;
}

interface ReportDetail {
  id: string;
  period: string;
  periodLabel: string;
  windowHours: number;
  report: string;
  rawSources: RawSource[];
  sourcesCollected: number;
  wechatSent: boolean;
  createdAt: string;
}

// ─── Copy Button ───────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void handleCopy()}
      className="gap-1.5"
    >
      {copied ? (
        <>
          <Check className="size-3.5" />
          已复制
        </>
      ) : (
        <>
          <Copy className="size-3.5" />
          复制
        </>
      )}
    </Button>
  );
}

// ─── Source name translation ───────────────────────────────────
const SOURCE_LABELS: Record<string, string> = {
  webchat: "Webchat 对话",
  wechat: "微信消息",
  discord: "Discord 消息",
  telegram: "Telegram 消息",
  "action-logs": "Action 执行日志",
  github: "GitHub 活动",
};

// ─── Raw Source Viewer ─────────────────────────────────────────
function RawSourceViewer({ sources }: { sources: RawSource[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  return (
    <div className="space-y-2">
      {sources.map((src, idx) => {
        const isExpanded = expandedIdx === idx;
        const isEmpty = src.content.startsWith("(");
        return (
          <div key={idx} className="rounded-lg border">
            <button
              onClick={() => setExpandedIdx(isExpanded ? null : idx)}
              className="flex w-full items-center justify-between p-3 text-left text-sm hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                {isExpanded ? (
                  <ChevronDown className="size-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-4 text-muted-foreground" />
                )}
                <span className="font-medium">
                  {SOURCE_LABELS[src.source] ?? src.source}
                </span>
                {isEmpty && (
                  <span className="text-xs text-muted-foreground">(无数据)</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {src.content.length.toLocaleString()} 字符
              </span>
            </button>
            {isExpanded && (
              <div className="border-t px-3 pb-3">
                <div className="flex justify-end pt-2 pb-1">
                  <CopyButton text={src.content} />
                </div>
                <pre className="max-h-96 overflow-auto rounded-md bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap">
                  {src.content}
                </pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Report Detail View ────────────────────────────────────────
function ReportDetailView({
  report,
  onBack,
}: {
  report: ReportDetail;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        返回历史记录
      </button>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-lg">
              {report.periodLabel} 工作总结
            </CardTitle>
            <CardDescription className="flex items-center gap-2 mt-1">
              <Clock className="size-3" />
              {new Date(report.createdAt).toLocaleString("zh-CN")}
              {report.wechatSent && (
                <span className="flex items-center gap-1 text-green-600">
                  <Send className="size-3" />
                  已发送到微信
                </span>
              )}
            </CardDescription>
          </div>
          <CopyButton text={report.report} />
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border bg-muted/30 p-5 text-sm leading-relaxed whitespace-pre-wrap font-mono">
            {report.report}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">原始数据来源</CardTitle>
          <CardDescription>
            共 {report.rawSources.length} 个数据源，点击展开查看原始内容
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RawSourceViewer sources={report.rawSources} />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Report Display (after generation) ─────────────────────────
function ReportDisplay({
  result,
  onViewDetail,
}: {
  result: SummaryResult;
  onViewDetail?: (id: string) => void;
}) {
  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-lg">工作总结报告</CardTitle>
          <CardDescription className="flex items-center gap-2 mt-1">
            {result.wechatSent && (
              <span className="flex items-center gap-1 text-green-600">
                <Send className="size-3" />
                已发送到微信
              </span>
            )}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {result.id && onViewDetail && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onViewDetail(result.id!)}
              className="gap-1.5"
            >
              <FileText className="size-3.5" />
              查看详情
            </Button>
          )}
          <CopyButton text={result.report} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border bg-muted/30 p-5 text-sm leading-relaxed whitespace-pre-wrap font-mono">
          {result.report}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Report History List ───────────────────────────────────────
function ReportHistory({
  onSelectReport,
}: {
  onSelectReport: (id: string) => void;
}) {
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchAppApi("reports")
      .then((r) => r.json())
      .then((data: { success: boolean; data?: ReportListItem[] }) => {
        if (data.success && data.data) {
          setReports(data.data);
        }
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin mr-2" />
        加载历史记录...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        暂无历史报告
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {reports.map((r) => (
        <button
          key={r.id}
          onClick={() => onSelectReport(r.id)}
          className="w-full rounded-lg border p-4 text-left hover:bg-muted/50 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{r.periodLabel}</span>
              {r.wechatSent && <Send className="size-3 text-green-600" />}
            </div>
            <span className="text-xs text-muted-foreground">
              {new Date(r.createdAt).toLocaleString("zh-CN")}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
            {r.preview}
          </p>
        </button>
      ))}
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────
type View = "main" | "detail";

export default function App({
  bootstrap: _bootstrap,
}: {
  bootstrap: RomeAppBootstrap;
}) {
  const [view, setView] = useState<View>("main");
  const [selectedPeriod, setSelectedPeriod] = useState<Period>("last-day");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [sendToWechat, setSendToWechat] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  // Detail view state
  const [detailReport, setDetailReport] = useState<ReportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadReportDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const response = await fetchAppApi(`reports/${id}`);
      const data = (await response.json()) as {
        success: boolean;
        data?: ReportDetail;
      };
      if (data.success && data.data) {
        setDetailReport(data.data);
        setView("detail");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const generateSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const body: Record<string, unknown> = {
        period: selectedPeriod,
        sendToWechat,
      };

      const response = await fetchAppApi("generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as {
        status: string;
        data?: SummaryResult;
        error?: string;
      };

      if (data.status === "ok" && data.data) {
        setResult(data.data);
        // Refresh history list
        setHistoryKey((k) => k + 1);
      } else {
        setError(data.error ?? "生成失败，请重试");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, sendToWechat]);

  // ── Detail View ──
  if (view === "detail" && detailReport) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-center gap-3 mb-6">
          <FileText className="size-7 text-primary" />
          <h1 className="text-3xl font-semibold tracking-tight">工作总结</h1>
        </div>
        <ReportDetailView
          report={detailReport}
          onBack={() => {
            setView("main");
            setDetailReport(null);
          }}
        />
      </main>
    );
  }

  // ── Main View ──
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <FileText className="size-7 text-primary" />
        <h1 className="text-3xl font-semibold tracking-tight">工作总结</h1>
      </div>
      <p className="mt-2 text-muted-foreground">
        汇总对话记录、消息历史和 GitHub 活动，按项目维度生成结构化工作报告。
      </p>

      {/* Period Selection */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>选择时间范围</CardTitle>
          <CardDescription>选择要总结的时间段</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSelectedPeriod(opt.value)}
                disabled={loading}
                className={`rounded-lg border p-3 text-left transition-all hover:border-primary/50 ${
                  selectedPeriod === opt.value
                    ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                    : "border-border"
                } ${loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {opt.description}
                </div>
              </button>
            ))}
          </div>

          {/* WeChat toggle */}
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={sendToWechat}
                onChange={(e) => setSendToWechat(e.target.checked)}
                disabled={loading}
                className="size-4 rounded border-input accent-primary"
              />
              <span className="text-sm">同时发送到微信</span>
            </label>
            {sendToWechat && (
              <span className="text-xs text-muted-foreground">
                将自动发送到你绑定的微信账号
              </span>
            )}
          </div>

          {/* Generate button */}
          <Button
            onClick={() => void generateSummary()}
            disabled={loading}
            className="w-full"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin" />
                正在生成报告，请稍候...
              </>
            ) : (
              <>
                <FileText />
                生成工作总结
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Error display */}
      {error && (
        <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Loading detail overlay */}
      {detailLoading && (
        <div className="mt-4 flex items-center justify-center py-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" />
          加载报告详情...
        </div>
      )}

      {/* Report display */}
      {result && (
        <ReportDisplay
          result={result}
          onViewDetail={(id) => void loadReportDetail(id)}
        />
      )}

      {/* History section */}
      <Card className="mt-8">
        <CardHeader>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center justify-between w-full"
          >
            <div className="flex items-center gap-2">
              <History className="size-4" />
              <CardTitle className="text-base">历史报告</CardTitle>
            </div>
            {showHistory ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
          </button>
        </CardHeader>
        {showHistory && (
          <CardContent>
            <ReportHistory
              key={historyKey}
              onSelectReport={(id) => void loadReportDetail(id)}
            />
          </CardContent>
        )}
      </Card>
    </main>
  );
}
