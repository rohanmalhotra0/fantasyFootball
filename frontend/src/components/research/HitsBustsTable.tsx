import type { HitBustRow } from '../../lib/types'
import { downloadCsv, toCsv, type CsvColumn } from '../../lib/csv'

/**
 * Hits (model found value) or busts (model was fooled). diff comes from the
 * API as actual_rank - rank: negative = finished better than predicted.
 * The badge pairs an arrow icon with words ("+38 better") — never color alone.
 */
interface Props {
  title: string
  rows: HitBustRow[]
  exportTestId: string
  exportFilename: string
}

const CSV_COLUMNS: CsvColumn<HitBustRow>[] = [
  { header: 'name', value: (r) => r.name },
  { header: 'position', value: (r) => r.position },
  { header: 'model_rank', value: (r) => r.rank },
  { header: 'actual_finish', value: (r) => r.actual_rank },
  { header: 'actual_points', value: (r) => r.actual },
  { header: 'diff', value: (r) => r.diff },
]

function DiffBadge({ diff }: { diff: number }) {
  if (diff < 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg bg-green-100 px-2 py-0.5 font-bold text-green-900">
        <span aria-hidden="true">▲</span> +{-diff} better
      </span>
    )
  }
  if (diff > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg bg-red-100 px-2 py-0.5 font-bold text-red-900">
        <span aria-hidden="true">▼</span> {diff} worse
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-0.5 font-bold text-slate-700">
      <span aria-hidden="true">=</span> exact
    </span>
  )
}

export default function HitsBustsTable({ title, rows, exportTestId, exportFilename }: Props) {
  return (
    <section className="card space-y-4" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">{title}</h2>
        <button
          type="button"
          className="btn-secondary"
          data-testid={exportTestId}
          aria-label={`Export ${title} as CSV`}
          onClick={() => downloadCsv(exportFilename, toCsv(rows, CSV_COLUMNS))}
        >
          <span aria-hidden="true">⬇</span> Export CSV
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-slate-600">No rows for this year.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th scope="col" className="py-2 pr-3">
                  Player
                </th>
                <th scope="col" className="py-2 pr-3">
                  Pos
                </th>
                <th scope="col" className="py-2 pr-3">
                  Model rank
                </th>
                <th scope="col" className="py-2 pr-3">
                  Finished
                </th>
                <th scope="col" className="py-2">
                  Diff
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.name}-${row.rank}`} className="border-b border-slate-100">
                  <th scope="row" className="py-2 pr-3 font-bold">
                    {row.name}
                  </th>
                  <td className="py-2 pr-3">{row.position}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.rank}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.actual_rank}</td>
                  <td className="py-2">
                    <DiffBadge diff={row.diff} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
