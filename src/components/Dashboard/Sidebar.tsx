import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileDown, ShieldCheck, AlertTriangle, Activity,
  Database, Radio, ChevronRight, TrendingUp, Zap,
  ArrowUpRight, ArrowDownRight,
  ChevronLeft, Pin, PinOff,
} from 'lucide-react'
import { useStore } from '../../lib/store'
import { overallCoverage, tacticCoverage, downloadReport } from '../../lib/coverage'
import { tactics, techniques, shortName } from '../../lib/atlas'
import { colorForTactic } from '../../lib/theme'

// ── Coverage gauge (SVG 3/4-circle arc) ───────────────────────────────────────
const RADIUS = 46
const CIRC = 2 * Math.PI * RADIUS          // 288.9
const ARC  = CIRC * 0.75                   // 216.7  — visible sweep
const GAP  = CIRC - ARC                    // 72.2   — hidden 1/4 at bottom

function CoverageGauge({
  pct, full, partial, total,
}: { pct: number; full: number; partial: number; total: number }) {
  const color = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#f43f5e'
  const fullArc  = (full  / Math.max(total, 1)) * ARC
  const partArc  = (partial / Math.max(total, 1)) * ARC
  const noneArc  = ARC - fullArc - partArc

  // Starting rotation: -225° puts the arc start at bottom-left
  const rotation = 'rotate(-225, 56, 56)'

  return (
    <div className="relative flex items-center justify-center">
      <svg width="112" height="112" viewBox="0 0 112 112">
        {/* Track */}
        <circle
          cx="56" cy="56" r={RADIUS}
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${ARC} ${GAP}`}
          transform={rotation}
        />
        {/* None / uncovered (red) */}
        {noneArc > 0.5 && (
          <circle
            cx="56" cy="56" r={RADIUS}
            fill="none"
            stroke="rgba(244,63,94,0.25)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${ARC} ${GAP}`}
            strokeDashoffset={0}
            transform={rotation}
          />
        )}
        {/* Partial coverage (amber) */}
        {partArc > 0.5 && (
          <circle
            cx="56" cy="56" r={RADIUS}
            fill="none"
            stroke="#f59e0b"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${fullArc + partArc} ${CIRC - (fullArc + partArc)}`}
            strokeDashoffset={0}
            transform={rotation}
          />
        )}
        {/* Full coverage (green) */}
        {fullArc > 0.5 && (
          <circle
            cx="56" cy="56" r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${fullArc} ${CIRC - fullArc}`}
            strokeDashoffset={0}
            transform={rotation}
          />
        )}
        {/* Center percentage */}
        <text
          x="56" y="52"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="22"
          fontWeight="700"
          fontFamily="'JetBrains Mono', monospace"
          fill={color}
        >
          {pct}%
        </text>
        <text
          x="56" y="68"
          textAnchor="middle"
          fontSize="9"
          fontFamily="sans-serif"
          fill="#64748b"
          letterSpacing="1"
        >
          COVERED
        </text>
      </svg>
    </div>
  )
}

// ── Compact KPI tile ──────────────────────────────────────────────────────────
interface KpiTileProps {
  value: string | number
  subValue?: string
  label: string
  color: string
  icon: React.ReactNode
  trend?: 'up' | 'down' | null
}

function KpiTile({ value, subValue, label, color, icon, trend }: KpiTileProps) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 flex flex-col gap-1 min-w-0">
      <div className="flex items-center justify-between">
        <div className="opacity-60" style={{ color }}>{icon}</div>
        {trend === 'up' && <ArrowUpRight className="w-3 h-3 text-green-400" />}
        {trend === 'down' && <ArrowDownRight className="w-3 h-3 text-red-400" />}
      </div>
      <div className="flex items-baseline gap-1 min-w-0">
        <span className="text-base font-bold font-mono leading-none truncate" style={{ color }}>
          {value}
        </span>
        {subValue && (
          <span className="text-[10px] text-slate-600 font-mono shrink-0">/{subValue}</span>
        )}
      </div>
      <div className="text-[10px] text-slate-600 uppercase tracking-wide leading-tight truncate">{label}</div>
    </div>
  )
}

// ── Tactic heatmap cell ───────────────────────────────────────────────────────
function TacticCell({
  tac, pct, selected, onClick,
}: { tac: (typeof tactics)[0]; pct: number; selected: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  const bg = pct >= 70 ? 'rgba(34,197,94,0.35)'
    : pct >= 40 ? 'rgba(245,158,11,0.35)'
    : pct > 0   ? 'rgba(244,63,94,0.35)'
    : 'rgba(255,255,255,0.04)'
  const border = selected ? colorForTactic(tac.id) : 'transparent'

  return (
    <div className="relative">
      <button
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="w-full rounded-md transition-all duration-200"
        style={{
          background: bg,
          border: `1px solid ${border}`,
          height: 28,
        }}
      >
        <span className="text-[9px] font-mono text-white/60 px-0.5 leading-none block truncate">
          {shortName(tac)}
        </span>
      </button>
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: -2 }} exit={{ opacity: 0 }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 pointer-events-none"
          >
            <div className="rounded-lg border border-white/[0.12] bg-slate-900/95 backdrop-blur px-2.5 py-1.5 text-center whitespace-nowrap shadow-xl">
              <div className="text-[11px] font-semibold text-slate-200">{tac.name}</div>
              <div className="text-[10px] font-mono mt-0.5" style={{
                color: pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#f43f5e',
              }}>{pct}% coverage</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Risk badge ─────────────────────────────────────────────────────────────────
function RiskBadge({ level }: { level: 'critical' | 'high' | 'medium' | 'low' }) {
  const map = {
    critical: { label: 'CRITICAL', color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
    high:     { label: 'HIGH',     color: '#f43f5e', bg: 'rgba(244,63,94,0.12)'  },
    medium:   { label: 'MED',      color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    low:      { label: 'LOW',      color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  },
  }
  const m = map[level]
  return (
    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded" style={{ color: m.color, background: m.bg }}>
      {m.label}
    </span>
  )
}

// ── Section divider ────────────────────────────────────────────────────────────
function Section({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-t border-white/[0.05]">
      <div className="flex items-center gap-1.5 px-4 py-2">
        <span className="text-slate-600">{icon}</span>
        <span className="text-[9px] font-semibold text-slate-600 uppercase tracking-widest">{label}</span>
      </div>
      {children}
    </div>
  )
}

// ── Mini horizontal bar ────────────────────────────────────────────────────────
function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1 flex-1 rounded-full bg-white/[0.05] overflow-hidden">
      <motion.div
        className="h-full rounded-full"
        style={{ background: color }}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
    </div>
  )
}

// ── Main Sidebar ───────────────────────────────────────────────────────────────
export default function Sidebar({
  onCollapse,
  pinned,
  onTogglePin,
}: {
  onCollapse?: () => void
  pinned?: boolean
  onTogglePin?: () => void
}) {
  const coverage     = useStore(s => s.coverage)
  const coverageMap  = useStore(s => s.coverageMap)
  const useCases     = useStore(s => s.useCases)
  const analysis     = useStore(s => s.useCaseAnalysis)
  const selectTactic = useStore(s => s.selectTactic)
  const selectedId   = useStore(s => s.selectedTacticId)
  const useCaseTacticMap = useStore(s => s.useCaseTacticMap)

  const stats = useMemo(() => {
    if (!coverage) return null
    if (useCaseTacticMap.size > 0) {
      const full    = coverage.entries.filter(e => e.level === 'full').length
      const partial = coverage.entries.filter(e => e.level === 'partial').length
      return { full, partial, none: 0, untagged: 0, total: coverage.entries.length }
    }
    return overallCoverage(coverageMap)
  }, [coverage, coverageMap, useCaseTacticMap])

  const kpis = useMemo(() => {
    if (!coverage || !stats) return null

    const parentTechs = techniques.filter(t => !t.isSubtechnique)
    const subTechs    = techniques.filter(t => t.isSubtechnique)
    const coveredParent = parentTechs.filter(t => coverageMap.has(t.id)).length
    const coveredSub    = subTechs.filter(t => coverageMap.has(t.id)).length

    const detectionRules = useCases.length > 0
      ? useCases.length
      : coverage.entries.length

    // Unique data sources
    const sourceSet = analysis
      ? analysis.logSourceBreakdown.length
      : new Set(
          coverage.entries.flatMap(e =>
            e.logSources?.length ? e.logSources : e.tool ? [e.tool] : [],
          ),
        ).size

    // Telemetry health: weighted by full coverage ratio + source diversity bonus
    const qualityScore = stats.total > 0
      ? Math.round(
          ((stats.full + stats.partial * 0.5) / stats.total) * 100 * 0.85
          + Math.min(sourceSet * 0.8, 15),
        )
      : 0
    const clampedHealth = Math.min(99, Math.max(1, qualityScore))
    const healthLabel = clampedHealth >= 80 ? 'Healthy'
      : clampedHealth >= 55 ? 'Moderate'
      : 'At Risk'
    const healthColor = clampedHealth >= 80 ? '#22c55e'
      : clampedHealth >= 55 ? '#f59e0b'
      : '#f43f5e'

    return {
      coveredParent, totalParent: parentTechs.length,
      coveredSub,    totalSub: subTechs.length,
      detectionRules,
      sourceCount: sourceSet,
      healthScore: clampedHealth,
      healthLabel,
      healthColor,
    }
  }, [coverage, coverageMap, useCases, analysis, stats])

  // Per-tactic coverage stats
  const tacticStats = useMemo(() => {
    return tactics.map(tac => {
      let pct = 0
      if (useCaseTacticMap.size > 0) {
        const maxCount = Math.max(1, ...Array.from(useCaseTacticMap.values()))
        const count = useCaseTacticMap.get(tac.name.toLowerCase().trim()) ?? 0
        pct = Math.round((count / maxCount) * 100)
      } else {
        const c = tacticCoverage(tac.id, coverageMap)
        pct = c.total > 0 ? Math.round(((c.full + c.partial * 0.5) / c.total) * 100) : 0
      }
      const risk: 'critical' | 'high' | 'medium' | 'low' =
        pct === 0   ? 'critical'
        : pct < 35  ? 'high'
        : pct < 70  ? 'medium'
        : 'low'
      return { tac, pct, risk }
    })
  }, [coverageMap, useCaseTacticMap])

  const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 }
  const gapItems = [...tacticStats]
    .filter(t => t.risk !== 'low')
    .sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk])

  if (!coverage || !stats || !kpis) return null

  const coveredPct  = Math.round(((stats.full + stats.partial) / stats.total) * 100)
  const coverColor  = coveredPct >= 70 ? '#22c55e' : coveredPct >= 40 ? '#f59e0b' : '#f43f5e'

  const logSources = analysis?.logSourceBreakdown
    ?? ([] as { source: string; count: number }[])

  const uploadDate = new Date(coverage.uploadedAt).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  return (
    <div className="flex flex-col h-full overflow-y-auto overflow-x-hidden text-xs">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.05] shrink-0">
        <div className="flex items-start gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shrink-0" />
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.15em]">
                Coverage Intelligence
              </span>
            </div>
            <div className="text-sm font-semibold text-white truncate leading-tight">{coverage.name}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-slate-600 font-mono">{uploadDate}</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold"
                style={{
                  background: coverage.sourceFormat === 'usecases' ? 'rgba(129,140,248,0.15)' : 'rgba(0,229,255,0.1)',
                  color: coverage.sourceFormat === 'usecases' ? '#818cf8' : '#00e5ff',
                }}>
                {coverage.sourceFormat === 'usecases' ? 'USE CASES' : 'COVERAGE MAP'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Pin button */}
            {onTogglePin && (
              <button
                onClick={onTogglePin}
                title={pinned ? 'Unpin panel' : 'Pin panel open'}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:bg-white/[0.08]"
                style={{
                  border: '1px solid rgba(255,255,255,0.07)',
                  color: pinned ? '#00e5ff' : '#475569',
                }}
              >
                {pinned ? <Pin className="w-3 h-3" /> : <PinOff className="w-3 h-3" />}
              </button>
            )}
            {/* Export */}
            <button
              onClick={() => downloadReport(coverage, useCases)}
              title="Export Report"
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all hover:bg-white/[0.08] text-slate-600 hover:text-cyan-400"
              style={{ border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <FileDown className="w-3.5 h-3.5" />
            </button>
            {/* Collapse button */}
            {onCollapse && (
              <button
                onClick={onCollapse}
                title="Collapse panel"
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all hover:bg-white/[0.08] text-slate-600 hover:text-cyan-400"
                style={{ border: '1px solid rgba(255,255,255,0.07)' }}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Coverage Gauge + segmented bar ────────────────────────────────── */}
      <div className="px-4 py-4 border-b border-white/[0.05] shrink-0">
        <div className="flex items-center gap-4">
          <CoverageGauge
            pct={coveredPct}
            full={stats.full}
            partial={stats.partial}
            total={stats.total}
          />
          <div className="flex-1 min-w-0 space-y-2.5">
            {/* Technique count */}
            <div>
              <div className="flex items-baseline gap-1 mb-0.5">
                <span className="text-lg font-bold font-mono leading-none" style={{ color: coverColor }}>
                  {stats.full + stats.partial}
                </span>
                <span className="text-[11px] text-slate-600 font-mono">/ {stats.total}</span>
              </div>
              <div className="text-[10px] text-slate-600 uppercase tracking-wide">Techniques</div>
            </div>
            {/* Coverage level legend */}
            <div className="space-y-1">
              {[
                { label: 'Full',    value: stats.full,    pct: Math.round((stats.full / stats.total) * 100),    color: '#22c55e' },
                { label: 'Partial', value: stats.partial, pct: Math.round((stats.partial / stats.total) * 100), color: '#f59e0b' },
                { label: 'Gap',     value: stats.none + stats.untagged, pct: Math.round(((stats.none + stats.untagged) / stats.total) * 100), color: '#f43f5e' },
              ].map(({ label, value, pct, color }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ background: color }} />
                  <span className="text-[10px] text-slate-600 w-10 shrink-0">{label}</span>
                  <MiniBar pct={pct} color={color} />
                  <span className="text-[10px] font-mono text-slate-500 w-5 text-right shrink-0">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI Grid ──────────────────────────────────────────────────────── */}
      <Section label="Key Performance Indicators" icon={<TrendingUp className="w-3 h-3" />}>
        <div className="px-3 pb-3 grid grid-cols-2 gap-2">
          <KpiTile
            value={kpis.coveredParent}
            subValue={String(kpis.totalParent)}
            label="Techniques Covered"
            color="#00e5ff"
            icon={<ShieldCheck className="w-3.5 h-3.5" />}
          />
          <KpiTile
            value={kpis.coveredSub}
            subValue={String(kpis.totalSub)}
            label="Sub-techniques"
            color="#818cf8"
            icon={<Zap className="w-3.5 h-3.5" />}
          />
          <KpiTile
            value={kpis.detectionRules}
            label={useCases.length > 0 ? 'Detection Rules' : 'Mapped Entries'}
            color="#34d399"
            icon={<Activity className="w-3.5 h-3.5" />}
          />
          <KpiTile
            value={kpis.sourceCount || '—'}
            label="Data Sources"
            color="#f59e0b"
            icon={<Database className="w-3.5 h-3.5" />}
          />
        </div>

        {/* Telemetry health — full-width */}
        <div className="px-3 pb-3">
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5" style={{ color: kpis.healthColor }} />
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">Telemetry Health</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono font-bold" style={{ color: kpis.healthColor }}>
                  {kpis.healthLabel}
                </span>
                <span className="text-[10px] font-mono text-slate-600">{kpis.healthScore}%</span>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{
                  background: `linear-gradient(90deg, ${kpis.healthColor}99, ${kpis.healthColor})`,
                }}
                initial={{ width: 0 }}
                animate={{ width: `${kpis.healthScore}%` }}
                transition={{ duration: 1, ease: 'easeOut' }}
              />
            </div>
          </div>
        </div>
      </Section>

      {/* ── Tactic Heatmap ────────────────────────────────────────────────── */}
      <Section label="Tactic Coverage Map" icon={<ShieldCheck className="w-3 h-3" />}>
        <div className="px-3 pb-3 grid grid-cols-7 gap-1">
          {tacticStats.map(({ tac, pct }) => (
            <TacticCell
              key={tac.id}
              tac={tac}
              pct={pct}
              selected={selectedId === tac.id}
              onClick={() => selectTactic(selectedId === tac.id ? null : tac.id)}
            />
          ))}
        </div>
        {/* Heatmap legend */}
        <div className="flex items-center gap-3 px-3 pb-3">
          {[
            { label: '≥70%', color: 'rgba(34,197,94,0.35)'  },
            { label: '40–70%', color: 'rgba(245,158,11,0.35)' },
            { label: '<40%', color: 'rgba(244,63,94,0.35)'   },
            { label: 'None', color: 'rgba(255,255,255,0.04)' },
          ].map(({ label, color }) => (
            <div key={label} className="flex items-center gap-1">
              <div className="w-3 h-2 rounded-sm" style={{ background: color }} />
              <span className="text-[9px] text-slate-700">{label}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Risk Intelligence ─────────────────────────────────────────────── */}
      {gapItems.length > 0 && (
        <Section label="Risk Intelligence" icon={<AlertTriangle className="w-3 h-3" />}>
          <div className="px-3 pb-3 space-y-1">
            {gapItems.slice(0, 8).map(({ tac, pct, risk }) => {
              const barColor = risk === 'critical' ? '#fb923c'
                : risk === 'high'   ? '#f43f5e'
                : risk === 'medium' ? '#f59e0b'
                : '#22c55e'
              return (
                <button
                  key={tac.id}
                  onClick={() => selectTactic(selectedId === tac.id ? null : tac.id)}
                  className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-all hover:bg-white/[0.04] text-left group"
                  style={{ border: '1px solid transparent' }}
                >
                  <RiskBadge level={risk} />
                  <span className="flex-1 text-[11px] text-slate-400 group-hover:text-slate-300 truncate transition-colors">
                    {tac.name}
                  </span>
                  <span className="font-mono text-[10px] shrink-0" style={{ color: barColor }}>
                    {pct}%
                  </span>
                  <ChevronRight className="w-3 h-3 text-slate-700 shrink-0" />
                </button>
              )
            })}
          </div>
        </Section>
      )}

      {/* ── Top Data Sources ──────────────────────────────────────────────── */}
      {logSources.length > 0 && (
        <Section label="Top Data Sources" icon={<Database className="w-3 h-3" />}>
          <div className="px-3 pb-3 space-y-1.5">
            {logSources.slice(0, 6).map(({ source, count }, i) => {
              const maxCount = logSources[0].count
              const pct = Math.round((count / maxCount) * 100)
              const colors = ['#00e5ff', '#818cf8', '#34d399', '#f59e0b', '#f43f5e', '#d946ef']
              const color = colors[i % colors.length]
              return (
                <div key={source} className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-[11px] text-slate-400 font-mono w-20 truncate shrink-0">{source}</span>
                  <MiniBar pct={pct} color={color} />
                  <span className="text-[10px] text-slate-600 font-mono w-5 text-right shrink-0">{count}</span>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* ── Tactic Detail (scrollable fallback for no use-case analysis) ────── */}
      {!analysis && (
        <Section label="By Tactic" icon={<Activity className="w-3 h-3" />}>
          <div className="px-3 pb-3 space-y-1">
            {tacticStats.map(({ tac, pct, risk }) => {
              const color = colorForTactic(tac.id)
              const barColor = risk === 'low' ? '#22c55e' : risk === 'medium' ? '#f59e0b' : '#f43f5e'
              const isSelected = selectedId === tac.id
              return (
                <button
                  key={tac.id}
                  onClick={() => selectTactic(isSelected ? null : tac.id)}
                  className="w-full rounded-lg px-2 py-1.5 text-left transition-all hover:bg-white/[0.04] group"
                  style={{
                    background: isSelected ? `${color}10` : undefined,
                    border: `1px solid ${isSelected ? color + '30' : 'transparent'}`,
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                    <span className="text-[11px] text-slate-400 group-hover:text-slate-300 flex-1 truncate transition-colors">
                      {tac.name}
                    </span>
                    <span className="font-mono text-[10px] shrink-0" style={{ color: barColor }}>{pct}%</span>
                  </div>
                  <div className="ml-3.5 h-0.5 rounded-full bg-white/[0.05] overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: barColor }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                    />
                  </div>
                </button>
              )
            })}
          </div>
        </Section>
      )}

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 mt-auto border-t border-white/[0.05] shrink-0">
        <button
          onClick={() => downloadReport(coverage, useCases)}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-medium text-slate-500 hover:text-cyan-400 transition-all hover:bg-white/[0.04]"
          style={{ border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <FileDown className="w-3.5 h-3.5" />
          Export Full Report
          <ArrowUpRight className="w-3 h-3 ml-auto" />
        </button>
      </div>
    </div>
  )
}
