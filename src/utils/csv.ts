/**
 * RFC 4180 Compliant CSV Generation Utility
 */

export interface CsvColumn<T = any> {
  key: keyof T | string;
  label: string;
  format?: (value: any, row: T) => string | number | null | undefined;
}

export function escapeCsvValue(val: any): string {
  if (val === null || val === undefined) return '';

  let str: string;
  if (val instanceof Date) {
    str = val.toISOString();
  } else if (typeof val === 'object') {
    str = JSON.stringify(val);
  } else {
    str = String(val);
  }

  // If value contains comma, double-quote, or newline, wrap in double quotes and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function generateCsv<T = any>(columns: CsvColumn<T>[], rows: T[]): string {
  // UTF-8 BOM for Microsoft Excel / Google Sheets compatibility
  const BOM = '\uFEFF';

  const headerLine = columns.map((col) => escapeCsvValue(col.label)).join(',');

  const dataLines = rows.map((row) => {
    return columns
      .map((col) => {
        let value: any;
        if (col.format) {
          value = col.format((row as any)[col.key], row);
        } else {
          value = (row as any)[col.key];
        }
        return escapeCsvValue(value);
      })
      .join(',');
  });

  return `${BOM}${headerLine}\r\n${dataLines.join('\r\n')}\r\n`;
}

