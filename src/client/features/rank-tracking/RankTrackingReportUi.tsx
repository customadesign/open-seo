import { Loader2 } from "lucide-react";

export function LoadingState() {
  return (
    <div className="flex items-center justify-center p-10">
      <Loader2 className="size-4 animate-spin text-base-content/50" />
    </div>
  );
}

export function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-lg border border-dashed border-base-300 p-8 text-center text-sm text-base-content/60">
      {children}
    </div>
  );
}

export function ReportTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<string | number>>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function formatPosition(position: number | null): string {
  return position == null ? "—" : String(position);
}

export function formatSigned(value: number | null, digits = 1): string {
  if (value == null) return "—";
  const rounded = value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}
