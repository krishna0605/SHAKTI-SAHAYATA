import React, { useMemo } from 'react';

type AnyRow = Record<string, unknown>;

const formatCell = (value: unknown) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const RecordTable: React.FC<{
  rows: AnyRow[];
  maxRows?: number;
  className?: string;
}> = ({ rows, maxRows = 50, className }) => {
  const previewRows = useMemo(() => (Array.isArray(rows) ? rows.slice(0, maxRows) : []), [rows, maxRows]);
  const columns = useMemo(() => {
    const set = new Set<string>();
    for (const row of previewRows) {
      Object.keys(row || {}).forEach((k) => set.add(k));
    }
    // Common identifiers first.
    const preferred = ['id', 'case_id', 'file_id', 'record_id', 'created_at'];
    const ordered = [
      ...preferred.filter((k) => set.has(k)),
      ...[...set].filter((k) => !preferred.includes(k)).sort((a, b) => a.localeCompare(b))
    ];
    return ordered;
  }, [previewRows]);

  if (!previewRows.length) {
    return <div className={className}>No records to display.</div>;
  }

  return (
    <div className={`w-full overflow-x-auto ${className || ''}`}>
      <table className="min-w-max w-full text-sm text-left border border-slate-200 dark:border-slate-700">
        <thead className="bg-slate-50 dark:bg-slate-800">
          <tr>
            {columns.map((col) => (
              <th key={col} className="px-3 py-2 whitespace-nowrap border-b border-slate-200 dark:border-slate-700 font-semibold">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {previewRows.map((row, idx) => (
            <tr key={row.id ? String(row.id) : `r-${idx}`} className={idx % 2 === 0 ? 'bg-white dark:bg-slate-900' : 'bg-slate-50/60 dark:bg-slate-900/40'}>
              {columns.map((col) => (
                <td key={`${idx}-${col}`} className="px-3 py-2 whitespace-nowrap border-b border-slate-100 dark:border-slate-800">
                  {formatCell(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > previewRows.length ? (
        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Showing first {previewRows.length} rows of {rows.length}.
        </div>
      ) : null}
    </div>
  );
};

