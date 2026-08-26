import type {
  RomeAppApiHandler,
  RomeAppApiRequest,
  RomeAppContext,
} from "@rome-os/app-runtime";

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

class BrainstormApiHandler implements RomeAppApiHandler {
  constructor(private readonly ctx: RomeAppContext) {}

  async handle(request: RomeAppApiRequest): Promise<Response> {
    const route = request.path.join("/");

    if (request.method === "GET" && request.path.length === 0) {
      return json({
        appId: "brainstorm",
        version: "0.1.0",
        status: "ok",
        agent: "brainstorm",
      });
    }

    return json(
      {
        error: "not_found",
        appId: this.ctx.app.id,
        message: `Unknown Brainstorm API route: /${route}`,
      },
      { status: 404 },
    );
  }
}

export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return new BrainstormApiHandler(ctx);
}
