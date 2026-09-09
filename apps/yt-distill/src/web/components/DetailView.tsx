import { useCallback, useEffect, useMemo, useState } from "react";
import { navigateToApp, useCaller } from "@rome-os/app-web-sdk";
import { Button } from "@rome-os/ui/button";
import { Card, CardContent } from "@rome-os/ui/card";
import { Spinner } from "@rome-os/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@rome-os/ui/tabs";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { getDistillation, type ArtifactType, type Distillation } from "../lib/api";
import { ErrorPanel } from "./ErrorPanel";
import { GenerateMore } from "./GenerateMore";
import { SearchableMarkdown } from "./SearchableMarkdown";
import { MarkmapView } from "./MarkmapView";
import { SlidesView } from "./SlidesView";
import { StatusBadge } from "./StatusBadge";
import { TranscriptView } from "./TranscriptView";

const TAB_LABELS: Record<ArtifactType, string> = {
  mindmap: "Mindmap",
  summary: "Summary",
  slides: "Slides",
};

export function DetailView({ id }: { id: string }) {
  const caller = useCaller();
  const isOwner = caller?.kind === "guardian";
  const [record, setRecord] = useState<Distillation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      setRecord(await getDistillation(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const tabs = useMemo<{ value: string; label: string }[]>(() => {
    if (!record) return [];
    const list: { value: string; label: string }[] = [];
    if (record.mindmapMd) list.push({ value: "mindmap", label: TAB_LABELS.mindmap });
    if (record.summaryMd) list.push({ value: "summary", label: TAB_LABELS.summary });
    if (record.slidesHtml) list.push({ value: "slides", label: TAB_LABELS.slides });
    if (record.transcript) list.push({ value: "transcript", label: "Transcript" });
    return list;
  }, [record]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-12">
      <div className="mb-4">
        <Button variant="ghost" size="sm" onClick={() => navigateToApp("")}>
          <ArrowLeft className="size-4" /> Back
        </Button>
      </div>

      {loading && !record ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Spinner size="sm" /> Loading…
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
              <RefreshCw className="size-4" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : record ? (
        <>
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
                {record.title ?? record.url}
              </h1>
              <StatusBadge status={record.status} />
            </div>
            <p className="text-sm text-muted-foreground">
              {record.channel ? `${record.channel} · ` : ""}
              <a
                href={record.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary underline"
              >
                Watch on YouTube <ExternalLink className="size-3.5" />
              </a>
            </p>
          </header>

          <div className="mt-6">
            {record.status === "error" ? (
              <ErrorPanel record={record} isOwner={isOwner} onRefresh={() => load()} />
            ) : record.status === "pending" ? (
              <Card>
                <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                  <Spinner size="sm" /> Still processing — refresh in a moment.
                  <Button variant="ghost" size="sm" onClick={() => void load()}>
                    <RefreshCw className="size-4" /> Refresh
                  </Button>
                </CardContent>
              </Card>
            ) : tabs.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No artifacts were generated for this video.
                </CardContent>
              </Card>
            ) : (
              <>
                {record.errorMessage ? (
                  <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    {record.errorMessage}
                  </div>
                ) : null}
                <Tabs defaultValue={tabs[0]?.value}>
                  <TabsList>
                    {tabs.map((t) => (
                      <TabsTrigger key={t.value} value={t.value}>
                        {t.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  {record.mindmapMd ? (
                    <TabsContent value="mindmap" className="pt-4">
                      <MarkmapView markdown={record.mindmapMd} />
                    </TabsContent>
                  ) : null}

                  {record.summaryMd ? (
                    <TabsContent value="summary" className="pt-4">
                      <SearchableMarkdown markdown={record.summaryMd} />
                    </TabsContent>
                  ) : null}

                  {record.slidesHtml ? (
                    <TabsContent value="slides" className="pt-4">
                      <SlidesView html={record.slidesHtml} />
                    </TabsContent>
                  ) : null}

                  {record.transcript ? (
                    <TabsContent value="transcript" className="pt-4">
                      <TranscriptView transcript={record.transcript} videoId={record.videoId} />
                    </TabsContent>
                  ) : null}
                </Tabs>
              </>
            )}
          </div>

          {isOwner && record.transcript && record.status !== "pending" ? (
            <GenerateMore key={record.updatedAt} record={record} onDone={() => load(true)} />
          ) : null}
        </>
      ) : null}
    </main>
  );
}
