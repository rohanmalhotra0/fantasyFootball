import type { YearMetrics } from '../../lib/types'

/**
 * Broadcast scoreboard: one row per validation year with Spearman for the
 * model, the naive baseline, and ADP. When ADP data exists for a year, all
 * three come from the drafted subset so they are directly comparable;
 * otherwise model/naive use the full player pool and ADP shows an em dash.
 *
 * Every value is printed; the inline bar under each number is a redundant
 * magnitude cue (token colors, swatches repeated in the column headers so
 * identity is text + swatch, never color alone). The best value per row is
 * bold with a subtle accent glow and a visually-hidden "(best)".
 */
export default function ValidationTable({ validation }: { validation: YearMetrics[] }) {
  return (
    <div className="overflow-x-auto">
      <table data-testid="validation-table" className="w-full text-left">
        <caption className="mb-3 text-left text-ink-3">
          Higher = better ranking of who actually scored
        </caption>
        <thead>
          <tr className="border-b-2 border-edge">
            <th scope="col" className="py-2 pr-3 text-ink-2">
              Year
            </th>
            <ColumnHeader label="Model" swatchClass="bg-accent" />
            <ColumnHeader label="Naive" swatchClass="bg-ink-3" />
            <ColumnHeader label="ADP" swatchClass="bg-accent-2" last />
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

function ColumnHeader({
  label,
  swatchClass,
  last = false,
}: {
  label: string
  swatchClass: string
  last?: boolean
}) {
  return (
    <th scope="col" className={`py-2 text-ink-2 ${last ? '' : 'pr-3'}`}>
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-sm ${swatchClass}`} />
        {label}
      </span>
    </th>
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
    <tr className="border-b border-edge/40 transition-colors hover:bg-raised/40">
      <th scope="row" className="py-2.5 pr-3 font-display text-lg font-bold">
        {metrics.season}
      </th>
      <SpearmanCell value={model} best={best} barClass="bg-accent" />
      <SpearmanCell value={naive} best={best} barClass="bg-ink-3" />
      {adp === null ? (
        <td className="py-2.5 text-ink-3" title="needs ADP data">
          —
        </td>
      ) : (
        <SpearmanCell value={adp} best={best} barClass="bg-accent-2" last />
      )}
    </tr>
  )
}

function SpearmanCell({
  value,
  best,
  barClass,
  last = false,
}: {
  value: number
  best: number
  barClass: string
  last?: boolean
}) {
  const isBest = value === best
  // Spearman lives in [-1, 1]; the bar shows the positive share of the scale.
  const width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`
  return (
    <td
      className={`py-2.5 align-middle tabular-nums ${last ? '' : 'pr-3'} ${
        isBest ? 'font-bold text-ink' : 'text-ink-2'
      }`}
      data-winner={isBest ? 'true' : undefined}
    >
      <span
        className={`block max-w-[7rem] rounded-lg px-2 py-1 ${
          isBest ? 'bg-accent/10 shadow-glow-sm ring-1 ring-accent/40' : ''
        }`}
      >
        <span className="block">
          {value.toFixed(2)}
          {isBest && <span className="sr-only"> (best)</span>}
        </span>
        <span
          aria-hidden="true"
          className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-raised"
        >
          <span className={`block h-full rounded-full ${barClass}`} style={{ width }} />
        </span>
      </span>
    </td>
  )
}
