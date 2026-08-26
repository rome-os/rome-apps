import { useEffect, useState, useCallback, useRef } from "react";
import { fetchAppApi } from "@rome-os/app-web-sdk";
import { SchemaTab } from "./schema-tab";
import { DataTab } from "./data-tab";
import { cn } from "../lib/utils";
import type { TableSchema, RowsResponse } from "../types";

const AUTO_REFRESH_INTERVAL = 1000;

interface TableViewerProps {
  tableName: string;
  compact?: boolean;
}

type Tab = "schema" | "data";

export function TableViewer({ tableName, compact }: TableViewerProps) {
  const [tab, setTab] = useState<Tab>("data");
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [rowsData, setRowsData] = useState<RowsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [orderBy, setOrderBy] = useState<string | null>(null);
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(compact ? 20 : 50);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadRowsRef = useRef<() => Promise<void>>(undefined);

  useEffect(() => {
    setPage(0);
    setOrderBy(null);
    setOrder("desc");
    setSchema(null);
    setRowsData(null);
    setAutoRefresh(true);
  }, [tableName]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetchAppApi(`tables/${tableName}/schema`);
        if (!res.ok) return;
        const data = (await res.json()) as TableSchema;
        if (!cancelled) {
          setSchema(data);
          if (data.defaultSort) setOrderBy(data.defaultSort);
        }
      } catch { /* ignore */ }
    }
    load();
    return () => { cancelled = true; };
  }, [tableName]);

  const loadRows = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        order,
      });
      if (orderBy) params.set("orderBy", orderBy);
      const res = await fetchAppApi(`tables/${tableName}/rows?${params}`);
      if (!res.ok) return;
      const data = (await res.json()) as RowsResponse;
      setRowsData(data);
      setSchema((prev) => prev ? { ...prev, rowCount: data.total } : prev);
    } catch { /* ignore */ }
  }, [tableName, page, pageSize, orderBy, order]);

  loadRowsRef.current = loadRows;

  // Initial load
  useEffect(() => {
    setLoading(true);
    loadRows().finally(() => setLoading(false));
  }, [loadRows]);

  // Auto-refresh polling
  useEffect(() => {
    if (!autoRefresh || tab !== "data") return;
    const id = setInterval(() => {
      loadRowsRef.current?.();
    }, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [autoRefresh, tab]);

  function handleSort(column: string) {
    if (orderBy === column) {
      setOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setOrderBy(column);
      setOrder("asc");
    }
    setPage(0);
  }

  function handlePageChange(p: number) {
    setPage(p);
  }

  function handlePageSizeChange(s: number) {
    setPageSize(s);
    setPage(0);
  }

  return (
    <div className="rt-viewer">
      <div className="rt-viewer-header">
        <h3 className="rt-viewer-title">{tableName}</h3>
        {schema && (
          <span className="rt-row-count">{schema.rowCount} rows</span>
        )}
        <button
          className={cn("rt-auto-refresh", autoRefresh && "rt-auto-refresh-on")}
          onClick={() => setAutoRefresh((v) => !v)}
          title={autoRefresh ? "Auto-refresh on — click to pause" : "Auto-refresh paused — click to resume"}
        >
          {autoRefresh ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          )}
          <span className="rt-auto-refresh-label">{autoRefresh ? "Live" : "Paused"}</span>
        </button>
      </div>

      <div className="rt-tabs">
        <button
          className={cn("rt-tab", tab === "schema" && "rt-tab-active")}
          onClick={() => setTab("schema")}
        >
          Schema
        </button>
        <button
          className={cn("rt-tab", tab === "data" && "rt-tab-active")}
          onClick={() => setTab("data")}
        >
          Data
        </button>
      </div>

      <div className={cn("rt-tab-content", loading && "rt-loading")}>
        {tab === "schema" && schema && (
          <SchemaTab schema={schema} compact={compact} />
        )}

        {tab === "data" && schema && rowsData && (
          <DataTab
            columns={schema.columns}
            rows={rowsData.rows}
            total={rowsData.total}
            page={rowsData.page}
            pageSize={rowsData.pageSize}
            orderBy={orderBy}
            order={order}
            compact={compact}
            onSort={handleSort}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        )}

        {!schema && <div className="rt-empty">Loading...</div>}
      </div>
    </div>
  );
}
