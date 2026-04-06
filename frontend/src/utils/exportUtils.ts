/**
 * SHAKTI — Shared Export Utilities
 * PDF, CSV, and Excel export with CSV injection protection.
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

// ─── CSV Injection Protection ─────────────────────────────
const DANGEROUS_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

function sanitizeCell(value: unknown): string {
  const str = String(value ?? '');
  if (DANGEROUS_PREFIXES.some(p => str.startsWith(p))) {
    return `'${str}`;
  }
  return str;
}

// ─── CSV Export ─────────────────────────────────────────────
export function exportToCSV(
  data: Record<string, unknown>[],
  columns: { key: string; label: string }[],
  filename = 'export.csv'
) {
  if (!data.length) return;

  const header = columns.map(c => sanitizeCell(c.label)).join(',');
  const rows = data.map(row =>
    columns.map(c => {
      const val = sanitizeCell(row[c.key]);
      // Wrap in quotes if it contains comma, newline, or quotes
      if (val.includes(',') || val.includes('\n') || val.includes('"')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    }).join(',')
  );

  const csv = [header, ...rows].join('\n');
  downloadBlob(csv, filename, 'text/csv;charset=utf-8;');
}

// ─── Excel Export ───────────────────────────────────────────
export function exportToExcel(
  data: Record<string, unknown>[],
  columns: { key: string; label: string }[],
  filename = 'export.xlsx'
) {
  if (!data.length) return;

  const wsData = [
    columns.map(c => c.label),
    ...data.map(row => columns.map(c => sanitizeCell(row[c.key]))),
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Auto-size columns
  const colWidths = columns.map((c) => {
    const maxLen = Math.max(
      c.label.length,
      ...data.map(row => String(row[c.key] ?? '').length)
    );
    return { wch: Math.min(maxLen + 2, 50) };
  });
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, 'Data');
  XLSX.writeFile(wb, filename);
}

// ─── PDF Export ─────────────────────────────────────────────
export function exportToPDF(
  data: Record<string, unknown>[],
  columns: { key: string; label: string }[],
  title = 'SHAKTI Export',
  filename = 'export.pdf'
) {
  if (!data.length) return;

  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait' });

  // Title
  doc.setFontSize(16);
  doc.setTextColor(75, 0, 130);
  doc.text(title, 14, 20);

  // Metadata
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
  doc.text(`Records: ${data.length}`, 14, 33);

  // Table
  autoTable(doc, {
    startY: 38,
    head: [columns.map(c => c.label)],
    body: data.map(row => columns.map(c => sanitizeCell(row[c.key]))),
    theme: 'grid',
    headStyles: {
      fillColor: [75, 0, 130],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: {
      fontSize: 7,
      textColor: [50, 50, 50],
    },
    alternateRowStyles: {
      fillColor: [245, 245, 255],
    },
    styles: {
      cellPadding: 2,
      overflow: 'linebreak',
    },
    margin: { top: 38 },
    didDrawPage: (hookData: any) => {
      // Footer with page number
      const pageCount = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Page ${hookData.pageNumber} of ${pageCount} — SHAKTI Confidential`,
        doc.internal.pageSize.getWidth() / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      );
    },
  });

  doc.save(filename);
}

// ─── Helper ─────────────────────────────────────────────────
function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default { exportToCSV, exportToExcel, exportToPDF };
