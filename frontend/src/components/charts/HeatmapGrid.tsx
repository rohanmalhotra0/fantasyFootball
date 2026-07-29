import type { CSSProperties } from 'react'
import type { Heatmap } from '../../lib/types'

/**
 * CSS-grid heatmap. Every cell prints its NUMBER — color is a redundant
 * intensity cue, never the only signal (relief rule: the value is always
 * readable as text, plus a title attr on each cell).
 *
 * scale="diverging": blue = positive, red = negative, near-white = zero.
 * scale="sequential": one green ramp, light -> dark with magnitude.
 */
interface Props {
  title: string
  heatmap: Heatmap
  scale: 'diverging' | 'sequential'
  format: 'number' | 'percent'
  testId: string
}

// Diverging pair: warm/cool poles + near-white midpoint (blue-700 / red-700).
const POSITIVE_RGB = '29, 78, 216' // blue-700
const NEGATIVE_RGB = '185, 28, 28' // red-700
// Sequential single hue for the hit-rate grid (green-700).
const SEQUENTIAL_RGB = '21, 128, 61'

function formatValue(value: number, format: 'number' | 'percent'): string {
  if (format === 'percent') {
    // Backend sends fractions (0..1); tolerate values already in 0..100.
    const pct = value <= 1 ? value * 100 : value
    return `${Math.round(pct)}%`
  }
  return value.toFixed(1)
}

export default function HeatmapGrid({ title, heatmap, scale, format, testId }: Props) {
  const flat = heatmap.values.flat().filter((v): v is number => v !== null)
  const maxAbs = Math.max(...flat.map((v) => Math.abs(v)), 1e-9)

  const cellStyle = (value: number): CSSProperties => {
    const t = Math.min(Math.abs(value) / maxAbs, 1)
    const rgb =
      scale === 'sequential' ? SEQUENTIAL_RGB : value >= 0 ? POSITIVE_RGB : NEGATIVE_RGB
    return {
      backgroundColor: `rgba(${rgb}, ${(t * 0.88).toFixed(3)})`,
      color: t > 0.55 ? '#ffffff' : '#0f172a',
    }
  }

  // Text summary so nothing is color-only: name the strongest cell.
  let summary = ''
  if (flat.length > 0) {
    let best: { row: string; col: string; value: number } | null = null
    heatmap.values.forEach((rowVals, ri) => {
      rowVals.forEach((v, ci) => {
        if (v !== null && (best === null || v > best.value)) {
          best = { row: heatmap.rows[ri], col: heatmap.cols[ci], value: v }
        }
      })
    })
    if (best !== null) {
      const b = best as { row: string; col: string; value: number }
      summary = `Best cell: ${b.col} in ${b.row} (${formatValue(b.value, format)}).`
    }
  }

  const gridTemplate = `minmax(3rem, auto) repeat(${heatmap.cols.length}, minmax(3.5rem, 1fr))`

  return (
    <section className="card space-y-4" data-testid={testId} aria-label={title}>
      <h2 className="text-xl font-bold">{title}</h2>
      {summary && <p className="text-slate-700">{summary}</p>}
      <div className="overflow-x-auto">
        <div
          role="table"
          aria-label={`${title} values`}
          className="grid gap-0.5 text-center"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          {/* header row */}
          <div role="columnheader" aria-label="Round" className="p-2 font-bold" />
          {heatmap.cols.map((col) => (
            <div key={col} role="columnheader" className="p-2 font-bold">
              {col}
            </div>
          ))}
          {heatmap.rows.map((rowLabel, ri) => (
            <RowCells
              key={rowLabel}
              rowLabel={rowLabel}
              cols={heatmap.cols}
              values={heatmap.values[ri] ?? []}
              format={format}
              cellStyle={cellStyle}
            />
          ))}
        </div>
      </div>
      <p className="text-slate-600">{heatmap.note}</p>
    </section>
  )
}

function RowCells({
  rowLabel,
  cols,
  values,
  format,
  cellStyle,
}: {
  rowLabel: string
  cols: string[]
  values: (number | null)[]
  format: 'number' | 'percent'
  cellStyle: (value: number) => CSSProperties
}) {
  return (
    <>
      <div role="rowheader" className="p-2 text-right font-bold">
        {rowLabel}
      </div>
      {cols.map((col, ci) => {
        const value = values[ci] ?? null
        if (value === null) {
          return (
            <div
              key={col}
              role="cell"
              title={`${rowLabel} ${col}: no data`}
              className="rounded bg-slate-100 p-2 text-slate-400"
            >
              —
            </div>
          )
        }
        return (
          <div
            key={col}
            role="cell"
            title={`${rowLabel} ${col}: ${formatValue(value, format)}`}
            className="rounded p-2 font-bold tabular-nums"
            style={cellStyle(value)}
          >
            {formatValue(value, format)}
          </div>
        )
      })}
    </>
  )
}
