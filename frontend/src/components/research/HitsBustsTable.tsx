import type { HitBustRow } from '../../lib/types'
import { downloadCsv, toCsv, type CsvColumn } from '../../lib/csv'
import PositionChip from '../board/PositionChip'

/**
 * Hits (model found value) or busts (model was fooled). diff comes from the
 * API as actual_rank - rank: negative = finished better than predicted.
 * The badge pairs an arrow icon with words ("+38 better") — never color alone.
 */
interface Props {
  tableTestId: string
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
      <span className="chip whitespace-nowrap bg-good/15 text-good">
        <span aria-hidden="true">▲</span> +{-diff} better
      </span>
    )
  }
  if (diff > 0) {
    return (
      <span className="chip whitespace-nowrap bg-bad/15 text-bad">
        <span aria-hidden="true">▼</span> {diff} worse
      </span>
    )
  }
  return (
    <span className="chip whitespace-nowrap bg-raised text-ink-2">
      <span aria-hidden="true">=</span> exact
    </span>
  )
}

export default function HitsBustsTable({ title, rows, exportTestId, exportFilename, tableTestId }: Props) {
  return (
    <section className="card space-y-4" aria-label={title} data-testid={tableTestId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title">{title}</h2>
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
        <p className="text-ink-2">
          <span aria-hidden="true">📭</span> No rows for this year.
        </p>
      ) : (
        <div className="table-shell overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Pos</th>
                <th scope="col">Model rank</th>
                <th scope="col">Finished</th>
                <th scope="col">Diff</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.name}-${row.rank}`}>
                  {/* row headers opt out of the sticky column-header skin */}
                  <th scope="row" className="!static !bg-transparent !text-ink">
                    {row.name}
                  </th>
                  <td>
                    <PositionChip position={row.position} />
                  </td>
                  <td className="tabular-nums">{row.rank}</td>
                  <td className="tabular-nums">{row.actual_rank}</td>
                  <td>
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
