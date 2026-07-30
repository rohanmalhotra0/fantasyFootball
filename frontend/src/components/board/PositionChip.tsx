// Colored position chip. The position text is ALWAYS inside the chip so
// color is never the only signal. The hue arrives as a tinted fill + a
// solid swatch dot while the text itself stays in ink tokens — text never
// wears the series color (theme tokens: tailwind.config.js `pos`).

const POS_STYLE: Record<string, { chip: string; dot: string }> = {
  QB: { chip: 'border-pos-qb/60 bg-pos-qb/15', dot: 'bg-pos-qb' },
  RB: { chip: 'border-pos-rb/60 bg-pos-rb/15', dot: 'bg-pos-rb' },
  WR: { chip: 'border-pos-wr/60 bg-pos-wr/15', dot: 'bg-pos-wr' },
  TE: { chip: 'border-pos-te/60 bg-pos-te/15', dot: 'bg-pos-te' },
  K: { chip: 'border-pos-k/60 bg-pos-k/15', dot: 'bg-pos-k' },
  DST: { chip: 'border-pos-dst/60 bg-pos-dst/15', dot: 'bg-pos-dst' },
}
const FALLBACK = { chip: 'border-edge bg-raised/60', dot: 'bg-ink-3' }

interface PositionChipProps {
  position: string
  team?: string | null
}

export default function PositionChip({ position, team }: PositionChipProps) {
  const style = POS_STYLE[position] ?? FALLBACK
  return (
    <span className={`chip whitespace-nowrap border text-ink ${style.chip}`}>
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-sm ${style.dot}`} />
      {position}
      {team ? <span className="font-normal text-ink-2">· {team}</span> : null}
    </span>
  )
}
