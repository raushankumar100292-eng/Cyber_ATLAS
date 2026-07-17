import { useStore } from '../../lib/store'
import { severityColor, statusColor } from '../../lib/theme'

export default function ThreatFeed() {
  const allEvents = useStore(s => s.events)
  const events = allEvents.slice(0, 24)
  const feedPaused = useStore(s => s.feedPaused)
  const toggleFeed = useStore(s => s.toggleFeed)

  const doubled = [...events, ...events]

  return (
    <div className="glass border-t border-cyan-500/20 px-3 py-2">
      <div className="flex items-center gap-3 overflow-hidden">
        <button
          onClick={toggleFeed}
          className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-cyan-400/60 hover:text-cyan-400 transition-colors"
        >
          {feedPaused ? '▶ LIVE' : '⏸ FEED'}
        </button>
        <div className="h-3 w-px bg-cyan-500/20 shrink-0" />

        <div className="overflow-hidden flex-1 relative">
          <div
            className="flex gap-8"
            style={{
              width: 'max-content',
              animation: feedPaused ? 'none' : 'ticker 60s linear infinite',
            }}
          >
            {doubled.map((e, idx) => (
              <span
                key={`${e.id}-${idx}`}
                className="flex items-center gap-2 shrink-0 text-xs font-mono whitespace-nowrap"
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: severityColor[e.severity] }}
                />
                <span className="text-slate-400">{e.srcCity}</span>
                <span className="text-cyan-700">→</span>
                <span className="text-slate-400">{e.dstCity}</span>
                <span className="text-slate-600">·</span>
                <span
                  className="text-[10px] uppercase font-bold"
                  style={{ color: severityColor[e.severity] }}
                >
                  {e.severity}
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-300">{e.techniqueName}</span>
                <span className="text-slate-600">·</span>
                <span className="text-[10px]" style={{ color: statusColor[e.status] }}>
                  {e.status}
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
