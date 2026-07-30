// Shared bits for the Insights charts.
//
// All chart colors are `rgb(var(--de-…))` strings so they resolve at paint
// time and the light/dark toggle restyles every chart with the rest of the
// system (tokens live in styles/index.css).

/** Theme-reactive position hues (same tokens as tailwind `pos-*` / RankScatter). */
export const POS_COLORS: Record<string, string> = {
  QB: 'rgb(var(--de-pos-qb))',
  RB: 'rgb(var(--de-pos-rb))',
  WR: 'rgb(var(--de-pos-wr))',
  TE: 'rgb(var(--de-pos-te))',
}

/** Recessive chart chrome — grid/axis strokes and tick text. */
export const CHART_EDGE = 'rgb(var(--de-edge))'
export const CHART_INK_2 = 'rgb(var(--de-ink-2))'
export const CHART_INK_3 = 'rgb(var(--de-ink-3))'
export const CHART_SURFACE = 'rgb(var(--de-surface))'
export const CHART_ACCENT = 'rgb(var(--de-accent))'

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

/** Tinted chip skin per position — hue arrives as border/fill + a solid
 *  swatch dot while the text stays in ink tokens (color never text-borne). */
export const POS_CHIP: Record<string, { chip: string; dot: string }> = {
  QB: { chip: 'border-pos-qb/60 bg-pos-qb/15', dot: 'bg-pos-qb' },
  RB: { chip: 'border-pos-rb/60 bg-pos-rb/15', dot: 'bg-pos-rb' },
  WR: { chip: 'border-pos-wr/60 bg-pos-wr/15', dot: 'bg-pos-wr' },
  TE: { chip: 'border-pos-te/60 bg-pos-te/15', dot: 'bg-pos-te' },
}
export const POS_CHIP_FALLBACK = { chip: 'border-edge bg-raised/60', dot: 'bg-ink-3' }

export const POS_LABELS: Record<string, string> = {
  QB: 'Quarterbacks',
  RB: 'Running backs',
  WR: 'Wide receivers',
  TE: 'Tight ends',
}

export function pct(share: number, digits = 0): string {
  return `${(share * 100).toFixed(digits)}%`
}
