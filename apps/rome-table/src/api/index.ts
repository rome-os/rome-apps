import { sql } from "drizzle-orm";
import type {
  RomeAppApiHandler,
  RomeAppApiRequest,
  RomeAppContext,
} from "@rome-os/app-runtime";

type DbType = "sqlite" | "postgresql";

interface TableGroup {
  source: string;
  displayName: string;
  tablePrefix: string;
  iconUrl: string | null;
  tables: string[];
}

interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
}

interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}

function getDbType(): DbType {
  const t = process.env.DATABASE_TYPE;
  return t === "postgresql" ? "postgresql" : "sqlite";
}

class RomeTableApiHandler implements RomeAppApiHandler {
  private readonly dbType: DbType;

  constructor(private readonly ctx: RomeAppContext) {
    this.dbType = getDbType();
  }

  async handle(request: RomeAppApiRequest): Promise<Response> {
    const route = request.path.join("/");

    if (request.method === "GET" && route === "tables") {
      return this.listTables();
    }

    const schemaMatch = route.match(/^tables\/(.+)\/schema$/);
    if (request.method === "GET" && schemaMatch) {
      return this.getTableSchema(schemaMatch[1]);
    }

    const rowsMatch = route.match(/^tables\/(.+)\/rows$/);
    if (request.method === "GET" && rowsMatch) {
      return this.getTableRows(rowsMatch[1], request.query);
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // ── Dialect-aware introspection ──

  private getAllTableNames(): string[] {
    if (this.dbType === "postgresql") {
      const rows = this.ctx.db.connection.all<{ table_name: string }>(
        sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
      );
      return rows.map((r) => r.table_name);
    }
    const rows = this.ctx.db.connection.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );
    return rows.map((r) => r.name);
  }

  private getColumns(tableName: string): ColumnInfo[] {
    if (this.dbType === "postgresql") {
      const rows = this.ctx.db.connection.all<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        sql`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${tableName} ORDER BY ordinal_position`,
      );
      const pkCols = this.getPgPrimaryKeyColumns(tableName);
      return rows.map((c) => ({
        name: c.column_name,
        type: c.data_type,
        notNull: c.is_nullable === "NO",
        defaultValue: c.column_default,
        primaryKey: pkCols.has(c.column_name),
      }));
    }

    const rows = this.ctx.db.connection.all<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>(sql.raw(`PRAGMA table_info("${tableName}")`));

    return rows.map((c) => ({
      name: c.name,
      type: c.type,
      notNull: c.notnull === 1,
      defaultValue: c.dflt_value,
      primaryKey: c.pk > 0,
    }));
  }

  private getIndexes(tableName: string): IndexInfo[] {
    if (this.dbType === "postgresql") {
      const rows = this.ctx.db.connection.all<{
        indexname: string;
        indexdef: string;
      }>(
        sql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ${tableName}`,
      );
      return rows.map((r) => ({
        name: r.indexname,
        unique: r.indexdef.toUpperCase().includes("UNIQUE"),
        columns: extractPgIndexColumns(r.indexdef),
      }));
    }

    const indexList = this.ctx.db.connection.all<{
      name: string;
      unique: number;
    }>(sql.raw(`PRAGMA index_list("${tableName}")`));

    const indexes: IndexInfo[] = [];
    for (const idx of indexList) {
      const cols = this.ctx.db.connection.all<{ name: string }>(
        sql.raw(`PRAGMA index_info("${idx.name}")`),
      );
      indexes.push({
        name: idx.name,
        unique: idx.unique === 1,
        columns: cols.map((c) => c.name),
      });
    }
    return indexes;
  }

  private getColumnNames(tableName: string): string[] {
    return this.getColumns(tableName).map((c) => c.name);
  }

  private getPgPrimaryKeyColumns(tableName: string): Set<string> {
    const rows = this.ctx.db.connection.all<{ column_name: string }>(
      sql`SELECT kcu.column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name = ${tableName}`,
    );
    return new Set(rows.map((r) => r.column_name));
  }

  /**
   * Pick the best default ORDER BY column for "newest first":
   * updated_at → created_at → PK → (none).
   */
  private getDefaultSortColumn(tableName: string): string | null {
    if (this.dbType === "sqlite") return "rowid";

    const cols = this.getColumnNames(tableName);
    for (const candidate of ["updated_at", "created_at"]) {
      if (cols.includes(candidate)) return candidate;
    }
    const pkCols = this.getPgPrimaryKeyColumns(tableName);
    if (pkCols.size === 1) return [...pkCols][0];
    return null;
  }

  private getRowCount(tableName: string): number {
    const rows = this.ctx.db.connection.all<{ cnt: number }>(
      sql.raw(`SELECT COUNT(*) as cnt FROM "${tableName}"`),
    );
    return rows[0]?.cnt ?? 0;
  }

  // ── Validation ──

  private isValidTable(name: string): boolean {
    return this.getAllTableNames().includes(name);
  }

  // ── Handlers ──

  private async listTables(): Promise<Response> {
    const allTables = this.getAllTableNames();

    const appMap = new Map<string, string[]>();
    const systemTables: string[] = [];

    for (const table of allTables) {
      if (table.startsWith("__drizzle") || table.endsWith("__drizzle_migrations")) continue;

      const sep = table.indexOf("__");
      if (sep > 0) {
        const prefix = table.slice(0, sep);
        const shortName = table.slice(sep + 2);
        if (shortName.startsWith("drizzle_")) continue;
        if (!appMap.has(prefix)) appMap.set(prefix, []);
        appMap.get(prefix)!.push(shortName);
      } else {
        systemTables.push(table);
      }
    }

    const groups: TableGroup[] = [];

    if (systemTables.length > 0) {
      groups.push({
        source: "system",
        displayName: "System",
        tablePrefix: "",
        iconUrl: null,
        tables: systemTables,
      });
    }

    const catalog = (this.ctx as unknown as Record<string, unknown>).catalog as
      | { get(id: string): { manifest?: { name?: string }; iconAbsolutePath?: string } | null }
      | undefined;

    for (const [prefix, tables] of appMap) {
      if (tables.length === 0) continue;
      let displayName = prefix;
      let hasIcon = false;
      try {
        const appView = catalog?.get(prefix);
        if (appView?.manifest?.name) displayName = appView.manifest.name;
        if (appView?.iconAbsolutePath) hasIcon = true;
      } catch { /* fallback to prefix */ }
      groups.push({
        source: prefix,
        displayName,
        tablePrefix: prefix,
        iconUrl: hasIcon ? `/api/apps/${prefix}/icon` : null,
        tables,
      });
    }

    return Response.json({ groups });
  }

  private async getTableSchema(tableName: string): Promise<Response> {
    if (!this.isValidTable(tableName)) {
      return Response.json({ error: "table_not_found" }, { status: 404 });
    }

    const columns = this.getColumns(tableName);
    const indexes = this.getIndexes(tableName);
    const rowCount = this.getRowCount(tableName);
    const defaultSort = this.getDefaultSortColumn(tableName);

    return Response.json({ tableName, columns, indexes, rowCount, defaultSort });
  }

  private async getTableRows(
    tableName: string,
    query: URLSearchParams,
  ): Promise<Response> {
    if (!this.isValidTable(tableName)) {
      return Response.json({ error: "table_not_found" }, { status: 404 });
    }

    const page = Math.max(0, parseInt(query.get("page") ?? "0", 10) || 0);
    const pageSize = Math.min(
      200,
      Math.max(1, parseInt(query.get("pageSize") ?? "50", 10) || 50),
    );
    const order = query.get("order") === "desc" ? "DESC" : "ASC";

    const defaultSort = this.getDefaultSortColumn(tableName);
    const orderBy = query.get("orderBy") ?? defaultSort;

    const validColumns = this.getColumnNames(tableName);
    let safeOrderBy: string | null = null;
    if (orderBy === "rowid" && this.dbType === "sqlite") {
      safeOrderBy = "rowid";
    } else if (orderBy && validColumns.includes(orderBy)) {
      safeOrderBy = orderBy;
    }

    const total = this.getRowCount(tableName);
    const offset = page * pageSize;

    const orderClause = safeOrderBy
      ? `ORDER BY "${safeOrderBy}" ${order}`
      : "";

    const rows = this.ctx.db.connection.all<Record<string, unknown>>(
      sql.raw(
        `SELECT * FROM "${tableName}" ${orderClause} LIMIT ${pageSize} OFFSET ${offset}`,
      ),
    );

    return Response.json({ rows, total, page, pageSize });
  }
}

function extractPgIndexColumns(indexdef: string): string[] {
  const match = indexdef.match(/\(([^)]+)\)/);
  if (!match) return [];
  return match[1].split(",").map((s) => s.trim().replace(/^"(.*)"$/, "$1"));
}

export function createApiHandler(ctx: RomeAppContext): RomeAppApiHandler {
  return new RomeTableApiHandler(ctx);
}
