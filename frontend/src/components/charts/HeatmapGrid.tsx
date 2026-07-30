import type { CSSProperties } from 'react'
import type { Heatmap } from '../../lib/types'

/**
 * CSS-grid heatmap. Every cell prints its NUMBER — color is a redundant
 * intensity cue, never the only signal (the value is always readable as
 * text, plus a title attr on each cell and a "best cell" text summary).
 *
 * Colors flow through the theme tokens so light/dark swap cleanly:
 *  - scale="sequential": single-hue alpha ramp of --de-accent
 *  - scale="diverging":  --de-good positive / --de-bad negative, with a
 *    neutral raised-gray midpoint at zero
 *
 * High-intensity cells flip their text to the page-bg token, via `dark:`
 * variant classes so each theme gets its own flip point (the light-theme
 * good/bad hues are dark enough that ink text stays readable at full
 * intensity, while the dark-theme hues are light and need the flip early).
 * Contrast at the flip points was measured against the composited cell
 * background in both themes (worst case >= 4:1 for the bold 18px values).
 */
interface Props {
  title: string
  heatmap: Heatmap
  scale: 'diverging' | 'sequential'
  format: 'number' | 'percent'
  testId: string
}

const MAX_ALPHA = 0.85
// Per-theme text-flip points (share of the ramp above which text switches
// from ink to the page-bg token). See the contrast note in the header.
const FLIP_DARK_T = 0.75
const FLIP_LIGHT_SEQUENTIAL_T = 0.9

function formatValue(value: number, format: 'number' | 'percent'): string {
  if (format === 'percent') {
    // Backend sends fractions (0..1); tolerate values already in 0..100.
    const pct = value <= 1 ? value * 100 : value
    return `${Math.round(pct)}%`
  }
  return value.toFixed(1)
}

function LegendStrip({
  scale,
  maxAbs,
  format,
}: {
  scale: 'diverging' | 'sequential'
  maxAbs: number
  format: 'number' | 'percent'
}) {
  const gradient =
    scale === 'diverging'
      ? `linear-gradient(90deg, rgb(var(--de-bad) / ${MAX_ALPHA}), rgb(var(--de-raised) / 0.5) 50%, rgb(var(--de-good) / ${MAX_ALPHA}))`
      : `linear-gradient(90deg, rgb(var(--de-accent) / 0.03), rgb(var(--de-accent) / ${MAX_ALPHA}))`
  const lo = scale === 'diverging' ? formatValue(-maxAbs, format) : formatValue(0, format)
  const hi =
    scale === 'diverging' ? `+${formatValue(maxAbs, format)}` : `max ${formatValue(maxAbs, format)}`
  return (
    <p className="flex items-center gap-2 whitespace-nowrap text-ink-3">
      <span className="font-bold tabular-nums">{lo}</span>
      <span
        aria-hidden="true"
        className="h-2.5 w-24 rounded-full border border-edge/60"
        style={{ backgroundImage: gradient }}
      />
      <span className="font-bold tabular-nums">{hi}</span>
    </p>
  )
}

export default function HeatmapGrid({ title, heatmap, scale, format, testId }: Props) {
  const flat = heatmap.values.flat().filter((v): v is number => v !== null)
  const maxAbs = Math.max(...flat.map((v) => Math.abs(v)), 1e-9)

  const cellPaint = (value: number): { style: CSSProperties; textClass: string } => {
    const t = Math.min(Math.abs(value) / maxAbs, 1)
    const hue = scale === 'sequential' ? '--de-accent' : value >= 0 ? '--de-good' : '--de-bad'
    const alpha = (t * MAX_ALPHA).toFixed(3)
    // Light theme: good/bad stay dark enough for ink text at full intensity;
    // only the accent ramp gets light-on-dark text near the top.
    const flipLight = scale === 'sequential' && t > FLIP_LIGHT_SEQUENTIAL_T
    const flipDark = t > FLIP_DARK_T
    return {
      style: {
        // Neutral raised-gray base = the diverging midpoint; the hue rides on top.
        backgroundColor: 'rgb(var(--de-raised) / 0.5)',
        backgroundImage: `linear-gradient(rgb(var(${hue}) / ${alpha}), rgb(var(${hue}) / ${alpha}))`,
      },
      textClass: `${flipLight ? 'text-bg' : 'text-ink'} ${flipDark ? 'dark:text-bg' : 'dark:text-ink'}`,
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
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="section-title">{title}</h2>
        {flat.length > 0 && <LegendStrip scale={scale} maxAbs={maxAbs} format={format} />}
      </div>
      {summary && <p className="text-ink-2">{summary}</p>}
      <div className="max-h-[28rem] overflow-auto rounded-xl">
        <div
          role="table"
          aria-label={`${title} values`}
          className="grid gap-1 text-center"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          {/* header row — sticky so long grids keep their bearings */}
          <div
            role="columnheader"
            aria-label="Round"
            className="sticky left-0 top-0 z-30 bg-surface p-2 font-bold"
          />
          {heatmap.cols.map((col) => (
            <div
              key={col}
              role="columnheader"
              className="sticky top-0 z-20 bg-surface p-2 font-bold text-ink-2"
            >
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
              cellPaint={cellPaint}
            />
          ))}
        </div>
      </div>
      <p className="text-ink-3">{heatmap.note}</p>
    </section>
  )
}

function RowCells({
  rowLabel,
  cols,
  values,
  format,
  cellPaint,
}: {
  rowLabel: string
  cols: string[]
  values: (number | null)[]
  format: 'number' | 'percent'
  cellPaint: (value: number) => { style: CSSProperties; textClass: string }
}) {
  return (
    <>
      <div
        role="rowheader"
        className="sticky left-0 z-10 bg-surface p-2 text-right font-bold text-ink-2"
      >
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
              className="rounded-md bg-raised/40 p-2 text-ink-3"
            >
              —
            </div>
          )
        }
        const paint = cellPaint(value)
        return (
          <div
            key={col}
            role="cell"
            title={`${rowLabel} ${col}: ${formatValue(value, format)}`}
            className={`relative rounded-md p-2 font-bold tabular-nums transition-transform duration-150 hover:z-10 hover:scale-110 hover:ring-2 hover:ring-accent hover:shadow-glow-sm ${paint.textClass}`}
            style={paint.style}
          >
            {formatValue(value, format)}
          </div>
        )
      })}
    </>
  )
}
