import type { TableGroup } from "../types";

interface TableSelectorProps {
  groups: TableGroup[];
  selectedSource: string | null;
  selectedTable: string | null;
  onSelectSource: (source: string) => void;
  onSelectTable: (fullName: string) => void;
}

export function TableSelector({
  groups,
  selectedSource,
  selectedTable,
  onSelectSource,
  onSelectTable,
}: TableSelectorProps) {
  const activeGroup = groups.find((g) => g.source === selectedSource);
  const tables = activeGroup?.tables ?? [];

  function fullName(table: string) {
    if (!activeGroup) return table;
    return activeGroup.tablePrefix ? `${activeGroup.tablePrefix}__${table}` : table;
  }

  return (
    <div className="rt-selector">
      <div className="rt-selector-field">
        {activeGroup && <GroupIconSmall group={activeGroup} />}
        <select
          className="rt-select"
          value={selectedSource ?? ""}
          onChange={(e) => onSelectSource(e.target.value)}
        >
          <option value="" disabled>
            Source...
          </option>
          {groups.map((g) => (
            <option key={g.source} value={g.source}>
              {g.displayName} ({g.tables.length})
            </option>
          ))}
        </select>
      </div>

      <select
        className="rt-select"
        value={selectedTable ?? ""}
        onChange={(e) => onSelectTable(e.target.value)}
        disabled={!activeGroup}
      >
        <option value="" disabled>
          Table...
        </option>
        {tables.map((t) => {
          const full = fullName(t);
          return (
            <option key={full} value={full}>
              {t}
            </option>
          );
        })}
      </select>
    </div>
  );
}

function GroupIconSmall({ group }: { group: TableGroup }) {
  if (group.iconUrl) {
    return (
      <img
        src={group.iconUrl}
        alt=""
        className="rt-selector-icon"
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    );
  }
  return null;
}
