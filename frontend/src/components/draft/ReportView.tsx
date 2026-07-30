// Post-draft report: one giant grade, the pick-by-pick value table,
// position strengths, and a CSV export.

import { downloadCsv, toCsv } from '../../lib/csv'
import type { DraftReport } from '../../lib/types'
import { PosChip } from './RecCard'

const STRENGTH_LABEL: Record<'strong' | 'average' | 'weak', { icon: string; cls: string }> = {
  strong: { icon: '✅', cls: 'border-green-500 bg-green-50 text-green-900' },
  average: { icon: '➖', cls: 'border-slate-400 bg-slate-100 text-slate-800' },
  weak: { icon: '⚠️', cls: 'border-amber-500 bg-amber-50 text-amber-900' },
}

function ValueBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="text-slate-400">—</span>
  if (value >= 0) {
    return (
      <span className="whitespace-nowrap font-bold text-green-800">
        <span aria-hidden="true">▲</span> +{value} value
      </span>
    )
  }
  return (
    <span className="whitespace-nowrap font-bold text-red-800">
      <span aria-hidden="true">▼</span> {value} reach
    </span>
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
      <section className="card flex flex-col items-center gap-4 text-center md:flex-row md:text-left">
        <p
          data-testid="report-grade"
          aria-label={`Draft grade: ${report.grade}`}
          className="shrink-0 rounded-2xl bg-slate-900 px-8 py-4 text-[5rem] font-bold leading-none text-white"
        >
          {report.grade}
        </p>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Your draft grade</h2>
          <p className="text-lg">{report.grade_reason}</p>
          <p className="text-slate-700">
            Total VORP <span className="font-bold">{Math.round(report.my_total_vorp)}</span> vs
            league average <span className="font-bold">{Math.round(report.league_avg_vorp)}</span> ·
            projected <span className="font-bold">{Math.round(report.my_projected_points)} pts</span>
          </p>
        </div>
      </section>

      <section className="card space-y-3" aria-label="Position strengths">
        <h3 className="text-xl font-bold">Position strengths</h3>
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

      <section className="card space-y-4" aria-label="Pick by pick value">
        <h3 className="text-xl font-bold">Pick by pick</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead>
              <tr className="border-b-2 border-slate-200 text-slate-600">
                <th scope="col" className="px-3 py-2">Rd</th>
                <th scope="col" className="px-3 py-2">Player</th>
                <th scope="col" className="px-3 py-2">Proj</th>
                <th scope="col" className="px-3 py-2">VORP</th>
                <th scope="col" className="px-3 py-2">ADP rank</th>
                <th scope="col" className="px-3 py-2">Value</th>
              </tr>
            </thead>
            <tbody>
              {report.picks.map((pick) => (
                <tr key={pick.overall} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-bold">{pick.round}</td>
                  <td className="px-3 py-2">
                    <span className="mr-2 font-bold">{pick.player_name}</span>
                    <PosChip position={pick.position} />
                  </td>
                  <td className="px-3 py-2">
                    {pick.projected_points != null ? Math.round(pick.projected_points) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {pick.vorp != null ? Math.round(pick.vorp) : '—'}
                  </td>
                  <td className="px-3 py-2">{pick.adp_rank ?? '—'}</td>
                  <td className="px-3 py-2">
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
