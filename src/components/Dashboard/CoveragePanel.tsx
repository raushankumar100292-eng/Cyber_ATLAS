import { useMemo } from 'react'
import { useStore } from '../../lib/store'
import { overallCoverage, tacticCoverage, downloadReport } from '../../lib/coverage'
import { tactics } from '../../lib/atlas'
import { colorForTactic } from '../../lib/theme'
import { FileDown, Database, TrendingUp, Shield } from 'lucide-react'

const CATEGORY_COLORS: Record<string, string> = {
  Identity: '#00e5ff',
  Endpoint: '#ff9f43',
  Network: '#54a0ff',
  Cloud: '#5f27cd',
  AD: '#ee5a24',
  Windows: '#0abde3',
  Kubernetes: '#10ac84',
}

function MiniBar({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className="h-1 rounded-full bg-white/5 overflow-hidden">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

export default function CoveragePanel() {
  const coverage = useStore(s => s.coverage)
  const coverageMap = useStore(s => s.coverageMap)
  const useCases = useStore(s => s.useCases)
  const analysis = useStore(s => s.useCaseAnalysis)

  const stats = useMemo(() => {
    if (!coverage) return null
    return overallCoverage(coverageMap)
  }, [coverage, coverageMap])

  // Empty state — no upload button, just prompt
  if (!coverage || !stats) {
    return (
      <div className="glass border border-cyan-500/15 rounded-xl px-5 py-4 flex items-center gap-4">
        <Database className="w-5 h-5 text-cyan-500/30 shrink-0" />
        <div>
          <div className="text-xs text-slate-400 font-medium">No coverage data</div>
          <div className="text-[11px] text-slate-600 mt-0.5">
            Click <span className="text-cyan-500 font-mono">Upload Data</span> in the toolbar to begin
          </div>
        </div>
      </div>
    )
  }

  const coveredPct = Math.round(((stats.full + stats.partial) / stats.total) * 100)
  const fullPct = Math.round((stats.full / stats.total) * 100)
  const partialPct = Math.round((stats.partial / stats.total) * 100)

  return (
    <div className="glass border border-cyan-500/15 rounded-xl overflow-hidden">

      {/* Header */}
      <div className="px-4 py-3 border-b border-cyan-500/15 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
              {coverage.sourceFormat === 'usecases' ? 'Use Case Coverage' : 'Coverage'}
            </span>
          </div>
          <div className="text-sm font-medium text-white truncate mt-0.5 max-w-[160px]">{coverage.name}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-right">
            <div className="text-2xl font-mono font-bold text-cyan-400">{coveredPct}%</div>
            <div className="text-[10px] text-slate-600">covered</div>
          </div>
          <button
            onClick={() => downloadReport(coverage, useCases)}
            title="Export Report"
            className="flex items-center justify-center w-7 h-7 rounded-lg transition-all hover:bg-cyan-500/15 group"
            style={{ border: '1px solid rgba(0,229,255,0.2)' }}
          >
            <FileDown className="w-3.5 h-3.5 text-slate-600 group-hover:text-cyan-400 transition-colors" />
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 divide-x divide-cyan-500/10">
        {[
          { label: 'Full', value: stats.full, pct: fullPct, color: '#30d158' },
          { label: 'Partial', value: stats.partial, pct: partialPct, color: '#ffd60a' },
          { label: 'None', value: stats.none, pct: 100 - fullPct - partialPct, color: '#ff2d55' },
        ].map(s => (
          <div key={s.label} className="px-3 py-2.5">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[10px] text-slate-600 uppercase tracking-wider">{s.label}</span>
              <span className="font-mono text-[11px]" style={{ color: s.color }}>{s.pct}%</span>
            </div>
            <MiniBar value={s.value} total={stats.total} color={s.color} />
            <div className="font-mono text-xs mt-1" style={{ color: `${s.color}cc` }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Use case insights (only when use case format) */}
      {analysis && (
        <div className="border-t border-cyan-500/10 px-4 py-3 space-y-2.5">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3 text-purple-400" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Insights</span>
            <span className="ml-auto font-mono text-[10px] text-slate-600">{analysis.total} use cases</span>
          </div>

          {/* Detection categories */}
          <div className="flex flex-wrap gap-1">
            {analysis.categoryBreakdown.map(({ category, count }) => {
              const col = CATEGORY_COLORS[category] ?? '#64748b'
              return (
                <span key={category}
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                  style={{ background: `${col}15`, color: col, border: `1px solid ${col}30` }}>
                  {category} {count}
                </span>
              )
            })}
          </div>

          {/* Top log sources */}
          <div>
            <div className="text-[9px] text-slate-700 uppercase tracking-widest mb-1">Log Sources</div>
            <div className="space-y-0.5">
              {analysis.logSourceBreakdown.slice(0, 4).map(({ source, count }) => (
                <div key={source} className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 w-24 truncate font-mono">{source}</span>
                  <div className="flex-1 h-0.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full bg-cyan-500/40 rounded-full"
                      style={{ width: `${(count / analysis.logSourceBreakdown[0].count) * 100}%` }} />
                  </div>
                  <span className="text-[10px] text-slate-600 font-mono w-4 text-right">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Gaps */}
          {analysis.topGaps.length > 0 && (
            <div className="rounded-lg bg-red-500/8 border border-red-500/15 px-2.5 py-2">
              <div className="flex items-center gap-1.5 mb-1">
                <Shield className="w-3 h-3 text-red-400" />
                <span className="text-[9px] text-red-400 uppercase tracking-widest">Gap Tactics</span>
              </div>
              <div className="text-[10px] text-slate-500 leading-relaxed">
                {analysis.topGaps.join(' · ')}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Per-tactic breakdown */}
      <div className="px-4 py-3 border-t border-cyan-500/10 space-y-1.5 max-h-44 overflow-y-auto">
        <div className="text-[10px] font-mono uppercase tracking-widest text-slate-600 mb-2">By Tactic</div>
        {tactics.map(tac => {
          const c = tacticCoverage(tac.id, coverageMap)
          const color = colorForTactic(tac.id)
          const pct = c.total > 0 ? Math.round(((c.full + c.partial * 0.5) / c.total) * 100) : 0
          return (
            <div key={tac.id} className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
              <span className="text-[10px] text-slate-400 flex-1 truncate">{tac.name}</span>
              <div className="w-16 h-0.5 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: pct > 66 ? '#30d158' : pct > 33 ? '#ffd60a' : '#ff2d55' }} />
              </div>
              <span className="font-mono text-[10px] w-7 text-right" style={{ color }}>{pct}%</span>
            </div>
          )
        })}
      </div>

      {/* Footer — date + export */}
      <div className="px-4 py-2.5 border-t border-cyan-500/10 flex items-center justify-between">
        <span className="text-[10px] text-slate-700 font-mono">
          {new Date(coverage.uploadedAt).toLocaleDateString()}
        </span>
        <button
          onClick={() => downloadReport(coverage, useCases)}
          className="flex items-center gap-1.5 text-[10px] font-mono text-slate-600 hover:text-cyan-400 transition-colors"
        >
          <FileDown className="w-3 h-3" />
          Export Report
        </button>
      </div>
    </div>
  )
}
