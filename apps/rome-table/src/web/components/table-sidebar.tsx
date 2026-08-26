import { useState } from "react";
import { cn } from "../lib/utils";
import type { TableGroup } from "../types";

interface TableSidebarProps {
  groups: TableGroup[];
  selectedTable: string | null;
  onSelectTable: (fullName: string) => void;
}

export function TableSidebar({ groups, selectedTable, onSelectTable }: TableSidebarProps) {
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const lowerFilter = filter.toLowerCase();

  const filteredGroups = groups
    .map((g) => ({
      ...g,
      tables: g.tables.filter(
        (t) =>
          t.toLowerCase().includes(lowerFilter) ||
          g.displayName.toLowerCase().includes(lowerFilter),
      ),
    }))
    .filter((g) => g.tables.length > 0);

  function fullName(group: TableGroup, table: string) {
    return group.tablePrefix ? `${group.tablePrefix}__${table}` : table;
  }

  function toggleGroup(source: string) {
    setCollapsed((prev) => ({ ...prev, [source]: !prev[source] }));
  }

  return (
    <aside className="rt-sidebar">
      {/* Search */}
      <div className="rt-sidebar-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          placeholder="Filter tables..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rt-filter-input"
        />
      </div>

      {/* SidebarMenu */}
      <nav className="rt-sidebar-menu">
        {filteredGroups.map((group) => {
          const isCollapsed = collapsed[group.source] ?? false;
          return (
            <div key={group.source} className="rt-menu-group">
              {/* SidebarGroupLabel */}
              <button
                className="rt-menu-group-label"
                onClick={() => toggleGroup(group.source)}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={cn("rt-chevron", !isCollapsed && "rt-chevron-open")}
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
                <GroupIcon group={group} />
                <span className="rt-menu-group-text">{group.displayName}</span>
                <span className="rt-menu-badge">{group.tables.length}</span>
              </button>

              {/* SidebarMenuItems */}
              {!isCollapsed && (
                <ul className="rt-menu-items">
                  {group.tables.map((table) => {
                    const full = fullName(group, table);
                    const active = selectedTable === full;
                    return (
                      <li key={full}>
                        <button
                          className={cn("rt-menu-item", active && "rt-menu-item-active")}
                          onClick={() => onSelectTable(full)}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="rt-menu-item-icon">
                            <path d="M12 3v18" /><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" />
                          </svg>
                          <span className="rt-menu-item-text">{table}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function GroupIcon({ group }: { group: TableGroup }) {
  if (group.source === "system") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="rt-menu-group-icon">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5V19A9 3 0 0 0 21 19V5" />
        <path d="M3 12A9 3 0 0 0 21 12" />
      </svg>
    );
  }

  if (group.iconUrl) {
    return (
      <img
        src={group.iconUrl}
        alt=""
        className="rt-menu-group-app-icon"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    );
  }

  return (
    <span className="rt-menu-group-fallback-icon">
      {group.displayName.charAt(0).toUpperCase()}
    </span>
  );
}
