import "./styles.css";
import { useState } from "react";
import type { RomeAppBootstrap } from "@rome-os/app-web-sdk";
import { ArrowRight, CheckCircle2, FileText, Lightbulb, MessageSquare, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface ChatSession {
  id: string;
}

const CHAT_SESSIONS_CHANGED_EVENT = "rome:chat-sessions-changed";

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown; message?: unknown };
    return String(payload.error ?? payload.message ?? `HTTP ${response.status}`);
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function createBrainstormSession(): Promise<ChatSession> {
  const response = await fetch("/api/chat/sessions", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Brainstorm",
      projectPath: "default",
      reasoningEffort: "high",
      agentName: "brainstorm",
    }),
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  return (await response.json()) as ChatSession;
}

export default function App({ bootstrap: _bootstrap }: { bootstrap: RomeAppBootstrap }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startBrainstorm(): Promise<void> {
    setStarting(true);
    setError(null);
    try {
      const session = await createBrainstormSession();
      window.dispatchEvent(new CustomEvent(CHAT_SESSIONS_CHANGED_EVENT));
      window.location.assign(`/chat/${encodeURIComponent(session.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-card">
            <Lightbulb className="h-5 w-5 text-primary" aria-hidden />
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Brainstorm</h1>
            <p className="text-sm text-muted-foreground">先把想法磨成设计，再进入实现。</p>
          </div>
        </div>
      </section>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>使用说明</CardTitle>
          <CardDescription>
            这个 App 注册了一个 <code>brainstorm</code> agent，用来做需求澄清、方案比较和设计文档。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 text-sm leading-6">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border bg-background p-4">
              <MessageSquare className="mb-3 h-4 w-4 text-primary" aria-hidden />
              <h2 className="font-medium">一问一答</h2>
              <p className="mt-1 text-muted-foreground">它会先读项目上下文，再一次只问一个关键问题。</p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <Route className="mb-3 h-4 w-4 text-primary" aria-hidden />
              <h2 className="font-medium">方案比较</h2>
              <p className="mt-1 text-muted-foreground">通常给出 2–3 个路径、取舍和推荐方案。</p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <FileText className="mb-3 h-4 w-4 text-primary" aria-hidden />
              <h2 className="font-medium">设计落盘</h2>
              <p className="mt-1 text-muted-foreground">方案确认后写入 spec，并在实现前请你复核。</p>
            </div>
          </div>

          <div className="rounded-lg border bg-muted p-4">
            <h2 className="font-medium">适合什么时候用</h2>
            <ul className="mt-3 space-y-2 text-muted-foreground">
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />做新功能、新 App、复杂改动之前。</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />你有一个模糊想法，但还没定需求边界。</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />你想先拿到可审阅的设计 spec，再开始写代码。</li>
            </ul>
          </div>

          <div className="rounded-lg border p-4">
            <h2 className="font-medium">建议开场</h2>
            <p className="mt-2 text-muted-foreground">
              直接描述你的粗略目标，例如："我想做一个能自动整理 inbox 的 App，先帮我 brainstorm 设计。"
            </p>
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              无法启动 Brainstorm 对话：{error}
            </div>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button onClick={() => void startBrainstorm()} disabled={starting} size="lg">
            {starting ? "正在创建对话…" : "开始 Brainstorm"}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
