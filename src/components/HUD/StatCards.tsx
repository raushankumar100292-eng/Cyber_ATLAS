import { useStore } from '../../lib/store'

interface CardProps {
  label: string
  value: number
  color: string
  icon: string
}

function Card({ label, value, color, icon }: CardProps) {
  return (
    <div className="glass hud-frame rounded px-3 py-2 min-w-28 animate-fade-in-up">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">{icon}</span>
        <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{label}</span>
      </div>
      <div className="font-mono text-2xl font-bold tabular-nums" style={{ color, textShadow: `0 0 14px ${color}88` }}>
        {value.toLocaleString()}
      </div>
    </div>
  )
}

export default function StatCards() {
  const eventCount = useStore(s => s.eventCount)
  const blockedCount = useStore(s => s.blockedCount)
  const criticalCount = useStore(s => s.criticalCount)

  return (
    <>
      <Card label="Events" value={eventCount} color="#00e5ff" icon="⚡" />
      <Card label="Blocked" value={blockedCount} color="#30d158" icon="🛡" />
      <Card label="Critical" value={criticalCount} color="#ff2d55" icon="🔴" />
    </>
  )
}
