import { tactics } from './atlas'

// A neon spectrum walked around the color wheel so adjacent orbit nodes
// stay visually distinct. Order matches the ATLAS kill-chain order.
const NEON_SPECTRUM = [
  '#00e5ff', // cyan
  '#22d3ee',
  '#38bdf8', // sky
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#d946ef', // fuchsia
  '#ec4899', // pink
  '#f43f5e', // rose
  '#fb7185',
  '#f59e0b', // amber
  '#facc15', // yellow
  '#a3e635', // lime
  '#34d399', // emerald
  '#2dd4bf', // teal
  '#14b8a6',
]

export const tacticColor: Record<string, string> = {}
tactics.forEach((t, i) => {
  tacticColor[t.id] = NEON_SPECTRUM[i % NEON_SPECTRUM.length]
})

export function colorForTactic(id: string | null | undefined): string {
  if (!id) return '#00e5ff'
  return tacticColor[id] ?? '#00e5ff'
}

export const severityColor: Record<string, string> = {
  critical: '#ff2d55',
  high: '#ff7a00',
  medium: '#ffd60a',
  low: '#30d158',
}

export const statusColor: Record<string, string> = {
  detected: '#ffd60a',
  blocked: '#30d158',
  investigating: '#00e5ff',
}
