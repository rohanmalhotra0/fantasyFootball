// Tiny CSV writer used by the research pages' "Export CSV" buttons.
// RFC 4180 style: CRLF line endings, quote fields containing , " or newlines.

export interface CsvColumn<T> {
  header: string
  value: (row: T) => string | number | boolean | null | undefined
}

/** Quote a single field when it needs it (comma, quote, CR or LF inside). */
export function csvEscape(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`
  }
  return field
}

function cell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  return csvEscape(String(value))
}

/** Build a CSV string: header row + one row per item. */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines: string[] = []
  lines.push(columns.map((c) => csvEscape(c.header)).join(','))
  for (const row of rows) {
    lines.push(columns.map((c) => cell(c.value(row))).join(','))
  }
  return lines.join('\r\n')
}

/** Trigger a browser download of a CSV string. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
