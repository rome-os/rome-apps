import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./ui/table";
import { cn } from "../lib/utils";
import type { ColumnInfo } from "../types";

interface DataTabProps {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
  orderBy: string | null;
  order: "asc" | "desc";
  compact?: boolean;
  onSort: (column: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function DataTab({
  columns,
  rows,
  total,
  page,
  pageSize,
  orderBy,
  order,
  compact,
  onSort,
  onPageChange,
  onPageSizeChange,
}: DataTabProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (compact) {
    return (
      <div className="rt-data-cards">
        {rows.length === 0 && (
          <div className="rt-empty">No data</div>
        )}

        <div className="rt-sort-bar">
          <select
            className="rt-select rt-select-sm"
            value={orderBy ?? ""}
            onChange={(e) => onSort(e.target.value)}
          >
            {columns.map((col) => (
              <option key={col.name} value={col.name}>
                {col.name}
              </option>
            ))}
          </select>
          <button
            className="rt-sort-dir-btn"
            onClick={() => onSort(orderBy ?? columns[0]?.name ?? "")}
            title={order === "asc" ? "Ascending — click to reverse" : "Descending — click to reverse"}
          >
            {order === "asc" ? "↑" : "↓"}
          </button>
        </div>

        {rows.map((row, i) => (
          <div key={i} className="rt-card">
            {columns.map((col) => (
              <div key={col.name} className="rt-card-row">
                <span className="rt-card-label">{col.name}</span>
                <span className={cn("rt-card-value", row[col.name] === null && "rt-cell-null")}>
                  {formatCellValue(row[col.name])}
                </span>
              </div>
            ))}
          </div>
        ))}

        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={pageSize}
          compact
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      </div>
    );
  }

  return (
    <div className="rt-data">
      {rows.length === 0 && (
        <div className="rt-empty">No data</div>
      )}

      {rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.name}>
                  <button
                    className="rt-sort-btn"
                    onClick={() => onSort(col.name)}
                  >
                    {col.name}
                    <SortIcon active={orderBy === col.name} direction={order} />
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={i}>
                {columns.map((col) => (
                  <TableCell
                    key={col.name}
                    className={cn(row[col.name] === null && "rt-cell-null")}
                  >
                    {formatCellValue(row[col.name])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
        compact={false}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}

function SortIcon({ active, direction }: { active: boolean; direction: "asc" | "desc" }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={cn("rt-sort-icon", active && "rt-sort-active")}
    >
      {active && direction === "asc" ? (
        <path d="m5 15 7-7 7 7" />
      ) : active && direction === "desc" ? (
        <path d="m19 9-7 7-7-7" />
      ) : (
        <>
          <path d="m7 15 5-5 5 5" />
          <path d="m7 9 5 5 5-5" />
        </>
      )}
    </svg>
  );
}

function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  compact,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  compact: boolean;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
}) {
  return (
    <div className="rt-pagination">
      <div className="rt-page-nav">
        <button
          className="rt-page-btn"
          disabled={page <= 0}
          onClick={() => onPageChange(page - 1)}
        >
          &#8249;
        </button>
        <span className="rt-page-info">
          {compact
            ? `${page + 1} / ${totalPages}`
            : `Page ${page + 1} of ${totalPages} (${total} rows)`}
        </span>
        <button
          className="rt-page-btn"
          disabled={page >= totalPages - 1}
          onClick={() => onPageChange(page + 1)}
        >
          &#8250;
        </button>
      </div>

      {!compact && (
        <select
          className="rt-select rt-select-sm"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
        >
          {[20, 50, 100, 200].map((s) => (
            <option key={s} value={s}>
              {s} / page
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
