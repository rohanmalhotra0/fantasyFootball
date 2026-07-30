import type { YearMetrics } from '../../lib/types'

/**
 * One row per validation year: Spearman for the model, the naive baseline,
 * and ADP. When ADP data exists for a year, all three come from the drafted
 * subset so they are directly comparable; otherwise model/naive use the
 * full player pool and ADP shows an em dash. The best value per row is bold
 * with a visually-hidden "(best)" for screen readers.
 */
export default function ValidationTable({ validation }: { validation: YearMetrics[] }) {
  return (
    <div className="space-y-3">
      <table data-testid="validation-table" className="w-full text-left">
        <caption className="mb-2 text-left text-slate-600">
          Higher = better ranking of who actually scored
        </caption>
        <thead>
          <tr className="border-b-2 border-slate-200">
            <th scope="col" className="py-2 pr-3">
              Year
            </th>
            <th scope="col" className="py-2 pr-3">
              Model
            </th>
            <th scope="col" className="py-2 pr-3">
              Naive
            </th>
            <th scope="col" className="py-2">
              ADP
            </th>
          </tr>
        </thead>
        <tbody>
          {validation.map((m) => (
            <ValidationRow key={m.season} metrics={m} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ValidationRow({ metrics }: { metrics: YearMetrics }) {
  const hasAdp = metrics.spearman_adp_drafted !== null
  // Comparable basis: drafted subset when ADP exists, full pool otherwise.
  const model = hasAdp
    ? (metrics.spearman_model_drafted ?? metrics.spearman_model)
    : metrics.spearman_model
  const naive = hasAdp
    ? (metrics.spearman_naive_drafted ?? metrics.spearman_naive)
    : metrics.spearman_naive
  const adp = metrics.spearman_adp_drafted
  const best = Math.max(model, naive, adp ?? -Infinity)

  return (
    <tr className="border-b border-slate-100">
      <th scope="row" className="py-2 pr-3 font-bold">
        {metrics.season}
      </th>
      <SpearmanCell value={model} best={best} />
      <SpearmanCell value={naive} best={best} />
      {adp === null ? (
        <td className="py-2 text-slate-400" title="needs ADP data">
          —
        </td>
      ) : (
        <SpearmanCell value={adp} best={best} />
      )}
    </tr>
  )
}

function SpearmanCell({ value, best }: { value: number; best: number }) {
  const isBest = value === best
  return (
    <td
      className={`py-2 pr-3 tabular-nums ${isBest ? 'font-bold' : ''}`}
      data-winner={isBest ? 'true' : undefined}
    >
      {value.toFixed(2)}
      {isBest && <span className="sr-only"> (best)</span>}
    </td>
  )
}
