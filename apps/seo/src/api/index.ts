import type {
  RomeAppApiHandler,
  RomeAppApiRequest,
  RomeAppContext,
} from "@rome-os/app-runtime";
import { createRunsRepository } from "../db/repositories/runs.js";
import { SEO_WORKFLOWS, validateSeoWorkflowArgs } from "../lib/workflows.js";
import { validateUrl } from "../lib/safe-fetch.js";

export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return {
    async handle(request: RomeAppApiRequest) {
      const repo = createRunsRepository(ctx.db);
      const route = request.path.join("/");
      const json = (data: unknown, status = 200) =>
        Response.json(data, {
          status,
          headers: { "Cache-Control": "no-store" },
        });
      repo.expireInterrupted();
      if (request.method === "GET" && route === "dashboard")
        return json({ workflows: SEO_WORKFLOWS, runs: repo.list() });
      if (request.path[0] === "runs" && request.path.length === 2) {
        const run = repo.get(request.path[1]);
        if (!run) return json({ error: "Run not found" }, 404);
        if (request.method === "GET") return json({ run });
        if (request.method === "DELETE") {
          if (["pending", "running"].includes(run.status))
            return json(
              { error: "Wait for this run to finish before deleting it." },
              409,
            );
          repo.delete(run.id);
          return json({ deleted: true });
        }
      }
      if (request.method === "POST" && route === "runs") {
        try {
          if ((request.body?.byteLength || 0) > 64_000)
            return json({ error: "Input is too large (64 KB maximum)." }, 413);
          const body = JSON.parse(new TextDecoder().decode(request.body));
          if (
            !body ||
            typeof body !== "object" ||
            !["check", "workflow"].includes(body.kind)
          )
            throw new Error("Choose an instant check or AI workflow.");
          let input: Record<string, string>;
          let title: string;
          let workflow: string | null = null;
          if (body.kind === "check") {
            if (typeof body.input?.url !== "string")
              throw new Error("A URL is required.");
            input = { url: validateUrl(body.input.url).href };
            title = new URL(input.url).hostname;
          } else {
            workflow = body.workflow;
            if (
              typeof workflow !== "string" ||
              !Object.hasOwn(SEO_WORKFLOWS, workflow)
            )
              throw new Error("Unknown workflow.");
            const spec = SEO_WORKFLOWS[workflow];
            input = {};
            for (const field of spec.fields) {
              const value = body.input?.[field.name];
              if (value !== undefined && typeof value !== "string")
                throw new Error(`${field.name} must be text.`);
              if (typeof value === "string") {
                if (value.length > 12_000)
                  throw new Error(
                    `${field.name} is too long (12,000 characters maximum).`,
                  );
                input[field.name] = value.trim();
              }
            }
            const error = validateSeoWorkflowArgs(workflow, input);
            if (error) throw new Error(error);
            title = spec.title;
          }
          if (repo.activeCount() >= 3)
            return json(
              {
                error:
                  "Three jobs are already running. Wait for one to finish.",
              },
              429,
            );
          const id = crypto.randomUUID();
          repo.insert({
            id,
            kind: body.kind,
            workflow,
            title,
            input,
            status: "pending",
            createdAt: Date.now(),
          });
          try {
            const receipt = await ctx.runAction(
              "seo:run_dashboard",
              { id },
              { detached: true },
            );
            repo.update(id, { executionId: receipt.executionId });
          } catch (error) {
            repo.update(id, {
              status: "failed",
              error: "Could not start job. Re-run to try again.",
              completedAt: Date.now(),
            });
            return json(
              {
                error: error instanceof Error ? error.message : String(error),
                id,
              },
              500,
            );
          }
          return json({ id }, 202);
        } catch (error) {
          return json(
            {
              error:
                error instanceof SyntaxError
                  ? "Invalid JSON body."
                  : error instanceof Error
                    ? error.message
                    : String(error),
            },
            400,
          );
        }
      }
      return json({ error: "Not found" }, 404);
    },
  };
}
