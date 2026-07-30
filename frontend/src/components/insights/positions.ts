// Shared bits for the Insights charts.

/** App-wide fixed position hues (same as tailwind `pos` colors / RankScatter). */
export const POS_COLORS: Record<string, string> = {
  QB: '#c2410c',
  RB: '#15803d',
  WR: '#1d4ed8',
  TE: '#7e22ce',
}

export const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const

/**
 * Series order for multi-position charts (stacking + legend). Chosen so WR
 * blue and TE purple are never adjacent — that pair collapses under deutan
 * CVD (validated with the palette checker; this order passes).
 */
export const SERIES_ORDER = ['WR', 'RB', 'TE', 'QB'] as const

/** Distinct dash pattern per position so multi-line charts never rely on hue alone. */
export const POS_DASHES: Record<string, string | undefined> = {
  QB: undefined, // solid
  RB: '7 3',
  WR: '2 3',
  TE: '10 3 2 3',
}

export const POS_LABELS: Record<string, string> = {
  QB: 'Quarterbacks',
  RB: 'Running backs',
  WR: 'Wide receivers',
  TE: 'Tight ends',
}

export function pct(share: number, digits = 0): string {
  return `${(share * 100).toFixed(digits)}%`
}
