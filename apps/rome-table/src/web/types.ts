export interface TableGroup {
  source: string;
  displayName: string;
  tablePrefix: string;
  iconUrl: string | null;
  tables: string[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
}

export interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface TableSchema {
  tableName: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  rowCount: number;
  defaultSort: string | null;
}

export interface RowsResponse {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}
