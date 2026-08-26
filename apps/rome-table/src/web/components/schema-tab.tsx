import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./ui/table";
import type { TableSchema } from "../types";

interface SchemaTabProps {
  schema: TableSchema;
  compact?: boolean;
}

export function SchemaTab({ schema, compact }: SchemaTabProps) {
  return (
    <div className="rt-schema">
      <div className="rt-schema-section">
        <h4 className="rt-section-title">Columns</h4>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              {!compact && <TableHead>Nullable</TableHead>}
              {!compact && <TableHead>Default</TableHead>}
              <TableHead>PK</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {schema.columns.map((col) => (
              <TableRow key={col.name}>
                <TableCell className="rt-cell-mono">{col.name}</TableCell>
                <TableCell className="rt-cell-muted">{col.type}</TableCell>
                {!compact && (
                  <TableCell>{col.notNull ? "NOT NULL" : "NULL"}</TableCell>
                )}
                {!compact && (
                  <TableCell className="rt-cell-muted">
                    {col.defaultValue ?? "-"}
                  </TableCell>
                )}
                <TableCell>
                  {col.primaryKey && <span className="rt-pk-badge">PK</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {schema.indexes.length > 0 && (
        <div className="rt-schema-section">
          <h4 className="rt-section-title">Indexes</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Columns</TableHead>
                <TableHead>Unique</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schema.indexes.map((idx) => (
                <TableRow key={idx.name}>
                  <TableCell className="rt-cell-mono">{idx.name}</TableCell>
                  <TableCell className="rt-cell-mono">
                    {idx.columns.join(", ")}
                  </TableCell>
                  <TableCell>
                    {idx.unique && <span className="rt-unique-badge">UNIQUE</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
