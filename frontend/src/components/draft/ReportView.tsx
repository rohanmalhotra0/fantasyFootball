// Post-draft report: one giant grade, the pick-by-pick value table,
// position strengths, and a CSV export. This is the trophy-ceremony
// screen — the grade glyph gets the full broadcast treatment.

import { downloadCsv, toCsv } from '../../lib/csv'
import type { DraftReport } from '../../lib/types'
import { PosChip } from './RecCard'

const STRENGTH_LABEL: Record<'strong' | 'average' | 'weak', { icon: string; cls: string }> = {
  strong: { icon: '✅', cls: 'border-good/60 bg-good/10 text-good' },
  average: { icon: '➖', cls: 'border-edge bg-raised/70 text-ink-2' },
  weak: { icon: '⚠️', cls: 'border-warn/60 bg-warn/10 text-warn' },
}

function ValueBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="text-ink-3">—</span>
  if (value >= 0) {
    return (
      <span className="whitespace-nowrap font-bold text-good">
        <span aria-hidden="true">▲</span> +{value} value
      </span>
    )
  }
  return (
    <span className="whitespace-nowrap font-bold text-bad">
      <span aria-hidden="true">▼</span> {value} reach
    </span>
  )
}

function ReportStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.14em] text-ink-3">{label}</p>
      <p className="font-display text-2xl font-bold tabular-nums">{value}</p>
    </div>
  )
}

interface ReportViewProps {
  report: DraftReport
  onNewDraft: () => void
}

export default function ReportView({ report, onNewDraft }: ReportViewProps) {
  const exportCsv = () => {
    const csv = toCsv(report.picks, [
      { header: 'Round', value: (p) => p.round },
      { header: 'Overall', value: (p) => p.overall },
      { header: 'Player', value: (p) => p.player_name },
      { header: 'Position', value: (p) => p.position },
      { header: 'Projected points', value: (p) => p.projected_points },
      { header: 'VORP', value: (p) => p.vorp },
      { header: 'ADP rank', value: (p) => p.adp_rank },
      { header: 'Value vs ADP', value: (p) => p.value_vs_adp },
    ])
    downloadCsv(`draft-${report.draft_id}-report.csv`, csv)
  }

  return (
    <div data-testid="draft-report" className="space-y-6">
      <section className="card-hero animate-slide-up flex flex-col items-center gap-8 text-center md:flex-row md:text-left">
        <p
          data-testid="report-grade"
          aria-label={`Draft grade: ${report.grade}`}
          className="grid h-44 w-44 shrink-0 place-items-center rounded-3xl bg-gradient-to-br from-accent to-accent-2 font-display text-[5.5rem] font-bold leading-none text-bg shadow-glow"
        >
          {report.grade}
        </p>
        <div className="min-w-0 space-y-3">
          <p className="font-bold uppercase tracking-[0.14em] text-ink-3">
            <span aria-hidden="true">🏆</span> Final grade
          </p>
          <h2 className="font-display text-3xl font-bold tracking-tight">Your draft grade</h2>
          <p className="text-xl text-ink-2">{report.grade_reason}</p>
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 md:justify-start">
            <ReportStat label="Total VORP" value={String(Math.round(report.my_total_vorp))} />
            <ReportStat label="League avg VORP" value={String(Math.round(report.league_avg_vorp))} />
            <ReportStat
              label="Projected"
              value={`${Math.round(report.my_projected_points)} pts`}
            />
          </div>
        </div>
      </section>

      <section className="card animate-slide-up space-y-3" aria-label="Position strengths">
        <h3 className="section-title">Position strengths</h3>
        <p className="flex flex-wrap gap-3">
          {Object.entries(report.position_strengths).map(([pos, strength]) => {
            const { icon, cls } = STRENGTH_LABEL[strength]
            return (
              <span
                key={pos}
                className={`whitespace-nowrap rounded-xl border-2 px-3 py-1 text-lg font-bold ${cls}`}
              >
                {pos} {strength} <span aria-hidden="true">{icon}</span>
              </span>
            )
          })}
        </p>
      </section>

      <section className="card animate-slide-up space-y-4" aria-label="Pick by pick value">
        <h3 className="section-title">Pick by pick</h3>
        <div className="overflow-x-auto">
          <table className="table-shell min-w-full text-left">
            <thead>
              <tr>
                <th scope="col">Rd</th>
                <th scope="col">Player</th>
                <th scope="col">Proj</th>
                <th scope="col">VORP</th>
                <th scope="col">ADP rank</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {report.picks.map((pick) => (
                <tr key={pick.overall}>
                  <td className="font-bold tabular-nums">{pick.round}</td>
                  <td>
                    <span className="mr-2 font-bold">{pick.player_name}</span>
                    <PosChip position={pick.position} />
                  </td>
                  <td className="tabular-nums">
                    {pick.projected_points != null ? Math.round(pick.projected_points) : '—'}
                  </td>
                  <td className="tabular-nums">
                    {pick.vorp != null ? Math.round(pick.vorp) : '—'}
                  </td>
                  <td className="tabular-nums">{pick.adp_rank ?? '—'}</td>
                  <td>
                    <ValueBadge value={pick.value_vs_adp} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-wrap gap-4">
        <button type="button" className="btn-secondary" onClick={exportCsv}>
          <span aria-hidden="true">📄</span> Export CSV
        </button>
        <button type="button" className="btn-secondary" onClick={onNewDraft}>
          <span aria-hidden="true">🆕</span> Start new draft
        </button>
      </div>
    </div>
  )
}
