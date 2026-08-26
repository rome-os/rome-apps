import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import {
  fetchAppApi,
  getCurrentAppPath,
  navigateToApp,
  subscribeToAppPath,
  type RomeAppBootstrap,
} from "@rome-os/app-web-sdk";
import { TableSidebar } from "./components/table-sidebar";
import { TableSelector } from "./components/table-selector";
import { TableViewer } from "./components/table-viewer";
import type { TableGroup } from "./types";
import "./styles.css";

function useBreakpoint(): "sm" | "md" | "lg" {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("resize", cb);
      return () => window.removeEventListener("resize", cb);
    },
    () => {
      const w = window.innerWidth;
      if (w < 640) return "sm";
      if (w < 1024) return "md";
      return "lg";
    },
  );
}

interface RouteState {
  source: string | null;
  table: string | null;
}

function parseRoute(path: string, groups: TableGroup[]): RouteState {
  if (!path) return { source: null, table: null };
  const parts = path.split("/");
  const sourceId = parts[0] || null;
  const shortTable = parts[1] || null;

  if (!sourceId) return { source: null, table: null };

  const group = groups.find((g) => g.source === sourceId);
  if (!group) return { source: sourceId, table: null };

  if (!shortTable) return { source: sourceId, table: null };

  const fullName = group.tablePrefix
    ? `${group.tablePrefix}__${shortTable}`
    : shortTable;

  if (group.tables.includes(shortTable)) {
    return { source: sourceId, table: fullName };
  }

  return { source: sourceId, table: null };
}

function buildRoute(source: string | null, fullTable: string | null, groups: TableGroup[]): string {
  if (!source) return "";
  const group = groups.find((g) => g.source === source);
  if (!fullTable || !group) return source;

  const shortName = group.tablePrefix && fullTable.startsWith(`${group.tablePrefix}__`)
    ? fullTable.slice(group.tablePrefix.length + 2)
    : fullTable;

  return `${source}/${shortName}`;
}

export default function RomeTableApp({ bootstrap }: { bootstrap: RomeAppBootstrap }) {
  const bp = useBreakpoint();
  const [groups, setGroups] = useState<TableGroup[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [initialPath] = useState(() => getCurrentAppPath());

  // Load groups, then apply initial route
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetchAppApi("tables");
        if (!res.ok) return;
        const data = (await res.json()) as { groups: TableGroup[] };
        if (cancelled) return;

        setGroups(data.groups);

        const route = parseRoute(initialPath, data.groups);
        if (route.source) {
          setSelectedSource(route.source);
          if (route.table) setSelectedTable(route.table);
        } else if (data.groups.length > 0) {
          setSelectedSource(data.groups[0].source);
        }
      } catch { /* ignore */ }
    }
    load();
    return () => { cancelled = true; };
  }, [initialPath]);

  // Listen for browser back/forward
  useEffect(() => {
    if (groups.length === 0) return;
    return subscribeToAppPath((path) => {
      const route = parseRoute(path, groups);
      setSelectedSource(route.source);
      setSelectedTable(route.table);
    });
  }, [groups]);

  const navigate = useCallback(
    (source: string | null, table: string | null) => {
      navigateToApp(buildRoute(source, table, groups));
    },
    [groups],
  );

  function handleSelectTable(fullName: string) {
    setSelectedTable(fullName);
    const group = groups.find((g) => {
      if (g.tablePrefix) return fullName.startsWith(`${g.tablePrefix}__`);
      return g.tables.includes(fullName);
    });
    const src = group?.source ?? selectedSource;
    if (group) setSelectedSource(src);
    navigate(src, fullName);
  }

  function handleSelectSource(source: string) {
    setSelectedSource(source);
    setSelectedTable(null);
    navigate(source, null);
  }

  const compact = bp === "sm";

  return (
    <div className="rt-shell">
      <header className="rt-header">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>
        </svg>
        <h2 className="rt-title">Database</h2>
      </header>

      {bp === "lg" ? (
        <div className="rt-layout-lg">
          <TableSidebar
            groups={groups}
            selectedTable={selectedTable}
            onSelectTable={handleSelectTable}
          />
          <main className="rt-main">
            {selectedTable ? (
              <TableViewer tableName={selectedTable} />
            ) : (
              <EmptyState />
            )}
          </main>
        </div>
      ) : (
        <div className="rt-layout-sm">
          <TableSelector
            groups={groups}
            selectedSource={selectedSource}
            selectedTable={selectedTable}
            onSelectSource={handleSelectSource}
            onSelectTable={handleSelectTable}
          />
          <main className="rt-main">
            {selectedTable ? (
              <TableViewer tableName={selectedTable} compact={compact} />
            ) : (
              <EmptyState />
            )}
          </main>
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rt-empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
        <path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>
      </svg>
      <p>Select a table to browse</p>
    </div>
  );
}
