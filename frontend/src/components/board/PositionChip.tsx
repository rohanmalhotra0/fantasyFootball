// Colored position chip. The position text is ALWAYS inside the chip so
// color is never the only signal (theme colors: tailwind.config.js `pos`).

const POS_BG: Record<string, string> = {
  QB: 'bg-pos-qb',
  RB: 'bg-pos-rb',
  WR: 'bg-pos-wr',
  TE: 'bg-pos-te',
  K: 'bg-pos-k',
  DST: 'bg-pos-dst',
}

interface PositionChipProps {
  position: string
  team?: string | null
}

export default function PositionChip({ position, team }: PositionChipProps) {
  const bg = POS_BG[position] ?? 'bg-slate-600'
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-0.5 text-base font-bold text-white ${bg}`}
    >
      {position}
      {team ? <span className="font-normal opacity-90">· {team}</span> : null}
    </span>
  )
}
