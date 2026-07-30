import { useEffect, useState } from 'react'
import AgingCurvesSection from '../components/insights/AgingCurvesSection'
import ConsistencySection from '../components/insights/ConsistencySection'
import TrendsSection from '../components/insights/TrendsSection'
import { api } from '../lib/api'
import type { AgingCurvesResponse, TrendsResponse } from '../lib/types'

/**
 * Insights: descriptive analytics over the full weekly history — aging
 * curves, weekly consistency profiles, and league-wide era trends. Each
 * section loads (and fails) independently; the consistency season list
 * comes from the trends response, so one 404 never blanks the page.
 */
export default function Insights() {
  const [aging, setAging] = useState<AgingCurvesResponse | null>(null)
  const [agingError, setAgingError] = useState<string | null>(null)
  const [trends, setTrends] = useState<TrendsResponse | null>(null)
  const [trendsError, setTrendsError] = useState<string | null>(null)

  useEffect(() => {
    api
      .analysisAging()
      .then(setAging)
      .catch((err) =>
        setAgingError(err instanceof Error ? err.message : 'Could not load aging curves.'),
      )
    api
      .analysisTrends()
      .then(setTrends)
      .catch((err) =>
        setTrendsError(err instanceof Error ? err.message : 'Could not load era trends.'),
      )
  }, [])

  const seasons = (trends?.seasons ?? []).map((s) => s.season)

  return (
    <div className="space-y-10">
      <header className="animate-slide-up">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          <span aria-hidden="true">🔬</span> Insights
        </h1>
        <p className="max-w-3xl text-ink-2">
          What two-plus decades of weekly stats say about how players age, who you can trust week
          to week, and how the scoring pie moves between positions.
        </p>
      </header>
      <AgingCurvesSection data={aging} error={agingError} />
      <ConsistencySection seasons={seasons} />
      <TrendsSection data={trends} error={trendsError} />
    </div>
  )
}
