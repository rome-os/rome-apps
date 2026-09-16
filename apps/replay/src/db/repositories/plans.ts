import { eq } from "drizzle-orm";
import type { AppDbContext, DrizzleDb } from "@rome-os/app-runtime";
import { createAppDbSchema } from "../schema.js";
import { DEFAULT_SPEED, DEFAULT_TURN_BUDGET_MS } from "../../lib/plan-settings.js";

export interface Plan {
  id: string;
  name: string;
  createdAt: Date;
  /** Ordered trace ids — the order is the replay order. */
  traceIds: string[];
  /** Playback speed multiplier — every pacing delay is divided by it. */
  speed: number;
  /** Wall-clock typewriter budget per turn (ms); past it, blocks emit instantly. */
  turnBudgetMs: number;
}

/** Optional playback settings for a new plan; omitted fields take the defaults. */
export interface PlanSettings {
  speed?: number;
  turnBudgetMs?: number;
}

function parseTraceIds(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export class PlansRepository {
  private readonly tables;

  constructor(
    private readonly db: DrizzleDb,
    tablePrefix: string,
  ) {
    this.tables = createAppDbSchema(tablePrefix);
  }

  async insert(name: string, traceIds: string[], settings: PlanSettings = {}): Promise<Plan> {
    const row = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date(),
      traceIdsJson: JSON.stringify(traceIds),
      speed: settings.speed ?? DEFAULT_SPEED,
      turnBudgetMs: settings.turnBudgetMs ?? DEFAULT_TURN_BUDGET_MS,
    };
    this.db.insert(this.tables.plans).values(row).run();
    return {
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      traceIds,
      speed: row.speed,
      turnBudgetMs: row.turnBudgetMs,
    };
  }

  async byId(id: string): Promise<Plan | undefined> {
    const row = this.db.select().from(this.tables.plans).where(eq(this.tables.plans.id, id)).get();
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      createdAt: row.createdAt,
      traceIds: parseTraceIds(row.traceIdsJson),
      speed: row.speed,
      turnBudgetMs: row.turnBudgetMs,
    };
  }
}

export function createPlansRepository(ctx: AppDbContext): PlansRepository {
  return new PlansRepository(ctx.connection, ctx.tablePrefix);
}
