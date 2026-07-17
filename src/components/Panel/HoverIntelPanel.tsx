import { useCallback, useEffect, useRef, useState } from 'react'
import type { ElementType } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  ExternalLink,
  Shield,
  Target,
  TrendingUp,
  Search, Hammer, LogIn, Terminal, Anchor,
  EyeOff, KeyRound, Compass, ArrowRightLeft, Database,
  Radio, Upload, Flame,
  BarChart3,
  Layers,
  Sparkles,
  RefreshCw,
  BookOpen,
} from 'lucide-react'
import { tacticById, topTechniquesForTactic, subtechniquesOf } from '../../lib/atlas'
import { colorForTactic } from '../../lib/theme'
import { useStore } from '../../lib/store'
import { tacticCoverage } from '../../lib/coverage'
import { suggestTacticCoverage } from '../../lib/groq'
import type { Tactic, CoverageEntry } from '../../lib/types'
import type { TacticCoverageSummary } from '../../lib/groq'

const GROQ_KEY_STORAGE = 'atlas_groq_key'

// Module-level cache so suggestions survive panel re-hovers in one session
const suggestionsCache = new Map<string, string>()

// ── Tactic icon map ───────────────────────────────────────────────────────────

const TACTIC_ICON_MAP: Record<string, ElementType> = {
  'TA0043': Search,
  'TA0042': Hammer,
  'TA0001': LogIn,
  'TA0002': Terminal,
  'TA0003': Anchor,
  'TA0004': TrendingUp,
  'TA0005': EyeOff,
  'TA0006': KeyRound,
  'TA0007': Compass,
  'TA0008': ArrowRightLeft,
  'TA0009': Database,
  'TA0011': Radio,
  'TA0010': Upload,
  'TA0040': Flame,
}

// ── Metrics ───────────────────────────────────────────────────────────────────

interface Metrics {
  totalTechniques: number
  fullTechniques: number
  partialTechniques: number
  noneTechniques: number
  totalSubtechniques: number
  coveredSubtechniques: number
  coveragePct: number
  maturityScore: number
  rulesCount: number
  riskLevel: string
  riskColor: string
  status: string
  statusColor: string
  hasData: boolean
  isUseCaseFormat: boolean
}

function computeMetrics(
  tactic: Tactic,
  coverageMap: Map<string, CoverageEntry>,
  useCaseTacticMap: Map<string, number>,
): Metrics {
  const techniques = topTechniquesForTactic(tactic.id)
  const totalTechniques = techniques.length
  const hasAttck = useCaseTacticMap.size > 0
  const hasAtlas = coverageMap.size > 0
  const hasData  = hasAttck || hasAtlas

  let coveragePct = 0
  let fullTechniques = 0
  let partialTechniques = 0
  let coveredSubtechniques = 0
  let totalSubtechniques = 0
  let rulesCount = 0

  for (const tech of techniques) {
    const subs = subtechniquesOf(tech.id)
    totalSubtechniques += subs.length
    if (hasAtlas) {
      for (const sub of subs) {
        const e = coverageMap.get(sub.id)
        if (e && e.level !== 'none') coveredSubtechniques++
      }
    }
  }

  if (hasAttck) {
    const count    = useCaseTacticMap.get(tactic.name.toLowerCase().trim()) ?? 0
    const maxCount = Math.max(1, ...Array.from(useCaseTacticMap.values()))
    coveragePct       = Math.round((count / maxCount) * 100)
    fullTechniques    = Math.round((count / maxCount) * totalTechniques * 0.6)
    partialTechniques = Math.round((count / maxCount) * totalTechniques * 0.4)
    rulesCount        = count
  } else if (hasAtlas) {
    const cov   = tacticCoverage(tactic.id, coverageMap)
    coveragePct = cov.total > 0
      ? Math.round(((cov.full + cov.partial * 0.5) / cov.total) * 100)
      : 0
    fullTechniques    = cov.full
    partialTechniques = cov.partial
    rulesCount        = cov.full * 2 + cov.partial
  }

  const noneTechniques = Math.max(0, totalTechniques - fullTechniques - partialTechniques)

  let riskLevel = 'Critical'; let riskColor = '#dc2626'
  if (!hasData)               { riskLevel = 'Unknown';  riskColor = '#64748b' }
  else if (coveragePct >= 75) { riskLevel = 'Low';      riskColor = '#16a34a' }
  else if (coveragePct >= 50) { riskLevel = 'Medium';   riskColor = '#d97706' }
  else if (coveragePct >= 25) { riskLevel = 'High';     riskColor = '#ea580c' }

  let status = 'No Coverage'; let statusColor = '#dc2626'
  if (!hasData)               { status = 'Not Assessed';     statusColor = '#64748b' }
  else if (coveragePct >= 80) { status = 'Good Coverage';    statusColor = '#16a34a' }
  else if (coveragePct >= 55) { status = 'Partial Coverage'; statusColor = '#d97706' }
  else if (coveragePct > 0)   { status = 'Needs Attention';  statusColor = '#ea580c' }

  let maturityScore = 0
  if (hasData && totalTechniques > 0) {
    const breadth = (fullTechniques + partialTechniques) / totalTechniques
    maturityScore = Math.round((breadth * 0.4 + (coveragePct / 100) * 0.6) * 100)
  }

  return {
    totalTechniques, fullTechniques, partialTechniques, noneTechniques,
    totalSubtechniques, coveredSubtechniques,
    coveragePct, maturityScore, rulesCount,
    riskLevel, riskColor, status, statusColor,
    hasData, isUseCaseFormat: hasAttck,
  }
}

// ── Coverage Arc Gauge ────────────────────────────────────────────────────────

function CoverageArcGauge({
  full, partial, none, total, pct, statusColor,
}: {
  full: number; partial: number; none: number
  total: number; pct: number; statusColor: string
}) {
  const R = 52; const SW = 10; const PAD = SW + 4
  const SIZE = (R + PAD) * 2
  const CIRC = 2 * Math.PI * R
  const ARC  = CIRC * 0.75
  const fullLen    = total > 0 ? (full / total) * ARC : 0
  const partialLen = total > 0 ? (partial / total) * ARC : 0
  const noneLen    = total > 0 ? (none / total) * ARC : 0
  const cx = R + PAD; const cy = R + PAD

  return (
    <div style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}>
      <svg width={SIZE} height={SIZE} style={{ transform: 'rotate(-225deg)', display: 'block' }}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(0,0,0,0.07)"
          strokeWidth={SW} strokeDasharray={`${ARC} ${CIRC}`} strokeLinecap="butt" />
        {fullLen > 0 && (
          <circle cx={cx} cy={cy} r={R} fill="none" stroke="#16a34a"
            strokeWidth={SW} strokeDasharray={`${fullLen} ${CIRC}`}
            strokeDashoffset={0} strokeLinecap="butt" />
        )}
        {partialLen > 0 && (
          <circle cx={cx} cy={cy} r={R} fill="none" stroke="#f59e0b"
            strokeWidth={SW} strokeDasharray={`${partialLen} ${CIRC}`}
            strokeDashoffset={-fullLen} strokeLinecap="butt" />
        )}
        {noneLen > 0 && (
          <circle cx={cx} cy={cy} r={R} fill="none" stroke="#ef4444"
            strokeWidth={SW} strokeDasharray={`${noneLen} ${CIRC}`}
            strokeDashoffset={-(fullLen + partialLen)} strokeLinecap="butt" />
        )}
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', paddingBottom: 12,
      }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.75 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          style={{
            fontFamily: 'Orbitron, sans-serif', fontSize: 23, fontWeight: 800,
            color: statusColor, letterSpacing: '0.02em', lineHeight: 1,
          }}
        >
          {pct}%
        </motion.div>
        <div style={{
          fontFamily: 'Inter, sans-serif', fontSize: 8, color: '#94a3b8',
          textTransform: 'uppercase' as const, letterSpacing: '0.10em', marginTop: 4, fontWeight: 600,
        }}>
          Coverage
        </div>
      </div>
    </div>
  )
}

// ── Coverage bar ──────────────────────────────────────────────────────────────

function CoverageBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 4, background: 'rgba(0,0,0,0.07)', borderRadius: 2, overflow: 'hidden' }}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.9, ease: 'easeOut', delay: 0.1 }}
        style={{
          height: '100%',
          background: `linear-gradient(90deg, ${color}bb, ${color})`,
          borderRadius: 2, boxShadow: `0 0 6px ${color}44`,
        }}
      />
    </div>
  )
}

// ── Stat tile ─────────────────────────────────────────────────────────────────

function StatTile({ label, value, sub, color, icon: Icon }: {
  label: string; value: string | number; sub?: string; color: string; icon: ElementType
}) {
  return (
    <div style={{
      background: `${color}0e`, border: `1px solid ${color}28`, borderRadius: 8,
      padding: '9px 11px', position: 'relative' as const, overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute' as const, top: 0, left: 0, right: 0, height: 1,
        background: `linear-gradient(90deg, transparent, ${color}40, transparent)`,
      }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
        <Icon size={9} style={{ color, flexShrink: 0 }} />
        <span style={{
          fontSize: 7.5, color: '#64748b', textTransform: 'uppercase' as const,
          letterSpacing: '0.09em', fontFamily: 'Inter, sans-serif', fontWeight: 600,
        }}>
          {label}
        </span>
      </div>
      <div style={{
        fontSize: 15, fontWeight: 700, color,
        fontFamily: 'Orbitron, sans-serif', lineHeight: 1, letterSpacing: '0.02em',
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 8, color: '#64748b', marginTop: 3, fontFamily: 'JetBrains Mono, monospace' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

// ── Section divider ───────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon, label, right,
}: { icon: ElementType; label: string; right?: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 8, color: '#64748b', fontFamily: 'Inter, sans-serif', fontWeight: 700,
      textTransform: 'uppercase' as const, letterSpacing: '0.10em',
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '8px 16px 5px', borderTop: '1px solid rgba(0,0,0,0.05)',
      flexShrink: 0,
    }}>
      <Icon size={9} style={{ color: '#94a3b8' }} />
      <span style={{ flex: 1 }}>{label}</span>
      {right}
    </div>
  )
}

// ── Markdown renderer (headers, bold, bullets) ────────────────────────────────

function MarkdownBlock({ text }: { text: string }) {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []

  lines.forEach((line, i) => {
    if (line.startsWith('## ')) {
      nodes.push(
        <div key={i} style={{
          fontFamily: 'Orbitron, sans-serif', fontSize: 9.5, fontWeight: 700,
          color: '#0f172a', marginTop: 12, marginBottom: 4,
          textTransform: 'uppercase' as const, letterSpacing: '0.07em',
        }}>
          {line.slice(3)}
        </div>
      )
    } else if (line.startsWith('**') && line.endsWith('**')) {
      nodes.push(
        <div key={i} style={{
          fontFamily: 'Inter, sans-serif', fontSize: 10.5, fontWeight: 700, color: '#1e293b',
          marginTop: 6, marginBottom: 2,
        }}>
          {line.replace(/\*\*/g, '')}
        </div>
      )
    } else if (line.startsWith('- ') || line.startsWith('• ')) {
      const content = line.slice(2)
      nodes.push(
        <div key={i} style={{
          display: 'flex', gap: 7, alignItems: 'flex-start',
          fontSize: 10.5, color: '#374151', fontFamily: 'Inter, sans-serif',
          lineHeight: 1.55, marginBottom: 3,
        }}>
          <span style={{ color: '#6366f1', flexShrink: 0, marginTop: 1, fontSize: 9 }}>▸</span>
          <span dangerouslySetInnerHTML={{
            __html: content
              .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#1e293b">$1</strong>')
              .replace(/`(.+?)`/g, '<code style="font-family:JetBrains Mono,monospace;font-size:9px;background:rgba(0,0,0,0.06);padding:1px 4px;border-radius:3px">$1</code>'),
          }} />
        </div>
      )
    } else if (line.trim() === '') {
      nodes.push(<div key={i} style={{ height: 4 }} />)
    } else if (line.trim()) {
      nodes.push(
        <div key={i} style={{
          fontSize: 10.5, color: '#374151', fontFamily: 'Inter, sans-serif',
          lineHeight: 1.55, marginBottom: 3,
        }}
          dangerouslySetInnerHTML={{
            __html: line
              .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#1e293b">$1</strong>')
              .replace(/`(.+?)`/g, '<code style="font-family:JetBrains Mono,monospace;font-size:9px;background:rgba(0,0,0,0.06);padding:1px 4px;border-radius:3px">$1</code>'),
          }}
        />
      )
    }
  })

  return <>{nodes}</>
}

// ── Panel body ────────────────────────────────────────────────────────────────

function TacticIntelContent({ tactic }: { tactic: Tactic }) {
  const coverageMap      = useStore(s => s.coverageMap)
  const useCaseTacticMap = useStore(s => s.useCaseTacticMap)
  const useCases         = useStore(s => s.useCases)
  const selectTactic     = useStore(s => s.selectTactic)
  const pinnedTacticId   = useStore(s => s.pinnedTacticId)
  const pinTactic        = useStore(s => s.pinTactic)

  const color      = colorForTactic(tactic.id)
  const m          = computeMetrics(tactic, coverageMap, useCaseTacticMap)
  const TacticIcon = (TACTIC_ICON_MAP[tactic.id] ?? Shield) as ElementType
  const techniques = topTechniquesForTactic(tactic.id)

  // Filter use cases to this tactic
  const tacticUseCases = useCases.filter(uc =>
    uc.tacticId === tactic.id ||
    uc.tacticName.toLowerCase().trim() === tactic.name.toLowerCase().trim()
  )

  // AI suggestions state
  const [aiText, setAiText]         = useState(() => suggestionsCache.get(tactic.id) ?? '')
  const [aiLoading, setAiLoading]   = useState(false)
  const [aiError, setAiError]       = useState('')
  const abortRef = useRef(false)

  const runSuggestions = useCallback(async () => {
    const apiKey = localStorage.getItem(GROQ_KEY_STORAGE)?.trim()
    if (!apiKey) {
      setAiError('No Groq API key found. Enter it in the Upload panel first.')
      return
    }
    setAiLoading(true)
    setAiError('')
    setAiText('')
    abortRef.current = false
    suggestionsCache.delete(tactic.id)

    const full      = techniques.filter(t => coverageMap.get(t.id)?.level === 'full')
    const partial   = techniques.filter(t => coverageMap.get(t.id)?.level === 'partial')
    const uncovered = techniques.filter(t => {
      const e = coverageMap.get(t.id)
      return !e || e.level === 'none'
    })

    const summary: TacticCoverageSummary = {
      tacticName: tactic.name,
      tacticId:   tactic.id,
      pct:        m.coveragePct,
      full:      full.map(t => ({ id: t.id, name: t.name })),
      partial:   partial.map(t => ({ id: t.id, name: t.name })),
      uncovered: uncovered.map(t => ({ id: t.id, name: t.name })),
      useCases:  tacticUseCases.map(u => ({
        name:          u.useCaseName,
        techniqueId:   u.subTechniqueId ?? u.techniqueId,
        techniqueName: u.subTechniqueName ?? u.techniqueName,
        logSource:     u.logSource,
      })),
    }

    await suggestTacticCoverage(apiKey, summary, {
      onToken: token => {
        if (!abortRef.current) setAiText(prev => prev + token)
      },
      onDone: full => {
        suggestionsCache.set(tactic.id, full)
        setAiLoading(false)
      },
      onError: err => {
        setAiError(err)
        setAiLoading(false)
      },
    })
  }, [tactic, techniques, coverageMap, tacticUseCases, m.coveragePct])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{
        padding: '16px 18px 12px',
        borderBottom: '1px solid rgba(0,0,0,0.07)',
        background: `linear-gradient(135deg, ${color}09 0%, transparent 55%)`,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, marginBottom: 9 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9,
            background: `${color}14`, border: `1px solid ${color}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, marginTop: 2,
          }}>
            <TacticIcon size={17} style={{ color }} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'Orbitron, sans-serif', fontSize: 15, fontWeight: 700,
              color: '#0f172a', lineHeight: 1.25, marginBottom: 6,
            }}>
              {tactic.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
              <span style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 9,
                color: `${color}cc`, background: `${color}12`,
                border: `1px solid ${color}28`, borderRadius: 4, padding: '1px 7px',
              }}>
                {tactic.id}
              </span>
              <span style={{
                fontSize: 9, fontWeight: 600, color: m.statusColor,
                background: `${m.statusColor}12`, border: `1px solid ${m.statusColor}25`,
                borderRadius: 4, padding: '1px 7px',
                fontFamily: 'Inter, sans-serif', letterSpacing: '0.04em',
              }}>
                {m.status}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <button
              onClick={() => selectTactic(tactic.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 9, color: '#475569',
                background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.09)',
                borderRadius: 5, padding: '3px 8px', cursor: 'pointer',
                fontFamily: 'Inter, sans-serif', fontWeight: 600,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = color; e.currentTarget.style.borderColor = `${color}50` }}
              onMouseLeave={e => { e.currentTarget.style.color = '#475569'; e.currentTarget.style.borderColor = 'rgba(0,0,0,0.09)' }}
            >
              <Target size={8} />
              Matrix
            </button>
            {pinnedTacticId === tactic.id && (
              <button
                onClick={() => pinTactic(null)}
                style={{
                  width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, color: '#94a3b8',
                  background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)',
                  borderRadius: 5, cursor: 'pointer', padding: 0, lineHeight: 1,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#dc2626'; e.currentTarget.style.background = 'rgba(220,38,38,0.08)' }}
                onMouseLeave={e => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.background = 'rgba(0,0,0,0.04)' }}
              >
                ×
              </button>
            )}
          </div>
        </div>

        <div style={{
          fontSize: 11, color: '#475569', lineHeight: 1.6, fontFamily: 'Inter, sans-serif',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden',
        }}>
          {tactic.description}
        </div>
      </div>

      {/* ── Coverage Intelligence ── */}
      {m.hasData ? (
        <>
          <SectionHeader icon={BarChart3} label="Coverage Intelligence" />
          <div style={{ padding: '4px 18px 8px', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
            <CoverageArcGauge
              full={m.fullTechniques} partial={m.partialTechniques}
              none={m.noneTechniques} total={m.totalTechniques}
              pct={m.coveragePct} statusColor={m.statusColor}
            />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { label: 'Full Coverage',    count: m.fullTechniques,    col: '#16a34a' },
                { label: 'Partial Coverage', count: m.partialTechniques, col: '#f59e0b' },
                { label: 'Not Covered',      count: m.noneTechniques,    col: '#94a3b8' },
              ].map(({ label, count, col }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: col, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#475569' }}>{label}</span>
                  <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 11, fontWeight: 700, color: col }}>{count}</span>
                </div>
              ))}
              <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '1px 0' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 9.5, color: '#64748b' }}>Sub-techniques</span>
                <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 11, fontWeight: 700, color }}>{m.coveredSubtechniques}/{m.totalSubtechniques}</span>
              </div>
              {m.maturityScore > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 8, color: '#94a3b8' }}>Maturity</span>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 8, color: '#64748b' }}>{m.maturityScore}%</span>
                  </div>
                  <CoverageBar pct={m.maturityScore} color={color} />
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, padding: '0 14px 8px', flexShrink: 0 }}>
            <StatTile label="Techniques" value={`${m.fullTechniques + m.partialTechniques}/${m.totalTechniques}`} sub={`${m.coveragePct}% effective`} color={m.statusColor} icon={CheckCircle} />
            <StatTile label="Sub-Techs"  value={m.coveredSubtechniques} sub={`of ${m.totalSubtechniques}`}         color={color}           icon={Layers} />
            <StatTile label="Risk"       value={m.riskLevel}            sub={m.isUseCaseFormat ? `${m.rulesCount} rules` : `${m.maturityScore}% maturity`} color={m.riskColor} icon={AlertTriangle} />
          </div>
        </>
      ) : (
        <div style={{ padding: '14px 16px 10px', flexShrink: 0 }}>
          <div style={{
            background: 'rgba(0,0,0,0.025)', border: '1px dashed rgba(0,0,0,0.11)',
            borderRadius: 10, padding: '14px 16px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' as const,
          }}>
            <Activity size={18} style={{ color: '#94a3b8' }} />
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
              Upload coverage data to see intelligence insights for this tactic.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, width: '100%' }}>
              <StatTile label="Techniques" value={m.totalTechniques}    sub="in this tactic" color={color} icon={Target} />
              <StatTile label="Sub-Techs"  value={m.totalSubtechniques} sub="total"          color={color} icon={Layers} />
            </div>
          </div>
        </div>
      )}

      {/* ── Use Cases ── (scrollable) */}
      {tacticUseCases.length > 0 && (
        <>
          <SectionHeader
            icon={BookOpen}
            label={`Detection Use Cases · ${tacticUseCases.length}`}
            right={
              tactic.attackUrl ? (
                <a
                  href={tactic.attackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8, color: '#94a3b8', textDecoration: 'none' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = '#0284c7' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = '#94a3b8' }}
                >
                  <ExternalLink size={8} />
                  ATT&CK
                </a>
              ) : undefined
            }
          />
          <div style={{ flexShrink: 0, maxHeight: 200, overflowY: 'auto', padding: '4px 14px 10px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {tacticUseCases.map((uc, idx) => {
                const techId = uc.subTechniqueId ?? uc.techniqueId
                const techName = uc.subTechniqueName ?? uc.techniqueName
                const entry = coverageMap.get(techId)
                const lvlColor =
                  entry?.level === 'full'    ? '#16a34a' :
                  entry?.level === 'partial' ? '#f59e0b' :
                                              '#94a3b8'
                return (
                  <div key={idx} style={{
                    padding: '7px 10px',
                    background: `${lvlColor}08`,
                    border: `1px solid ${lvlColor}22`,
                    borderLeft: `2.5px solid ${lvlColor}`,
                    borderRadius: '0 7px 7px 0',
                  }}>
                    <div style={{
                      fontFamily: 'Inter, sans-serif', fontSize: 10.5, fontWeight: 600,
                      color: '#1e293b', marginBottom: 3, lineHeight: 1.3,
                    }}>
                      {uc.useCaseName}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '3px 8px', alignItems: 'center' }}>
                      <span style={{
                        fontFamily: 'JetBrains Mono, monospace', fontSize: 8, color: lvlColor,
                        background: `${lvlColor}14`, border: `1px solid ${lvlColor}28`,
                        borderRadius: 3, padding: '1px 5px',
                      }}>
                        {techId}
                      </span>
                      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 9, color: '#64748b' }}>
                        {techName.length > 26 ? techName.slice(0, 24) + '…' : techName}
                      </span>
                      {uc.logSource && (
                        <span style={{
                          fontFamily: 'Inter, sans-serif', fontSize: 8, color: '#94a3b8',
                          background: 'rgba(0,0,0,0.05)', borderRadius: 3, padding: '1px 5px',
                          border: '1px solid rgba(0,0,0,0.08)',
                        }}>
                          {uc.logSource}
                        </span>
                      )}
                      {uc.detectionCategory && (
                        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 8, color: '#94a3b8' }}>
                          {uc.detectionCategory}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* ── AI Suggestions ── (flex-1 scrollable) */}
      <SectionHeader
        icon={Sparkles}
        label="AI Recommendations"
        right={
          <button
            onClick={runSuggestions}
            disabled={aiLoading}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 8, fontWeight: 700, letterSpacing: '0.06em',
              color: aiLoading ? '#94a3b8' : '#6366f1',
              background: aiLoading ? 'rgba(0,0,0,0.04)' : 'rgba(99,102,241,0.09)',
              border: `1px solid ${aiLoading ? 'rgba(0,0,0,0.08)' : 'rgba(99,102,241,0.28)'}`,
              borderRadius: 5, padding: '3px 8px',
              cursor: aiLoading ? 'not-allowed' : 'pointer',
              fontFamily: 'Inter, sans-serif',
              textTransform: 'uppercase' as const,
            }}
            onMouseEnter={e => { if (!aiLoading) { e.currentTarget.style.background = 'rgba(99,102,241,0.16)' } }}
            onMouseLeave={e => { if (!aiLoading) { e.currentTarget.style.background = 'rgba(99,102,241,0.09)' } }}
          >
            {aiLoading
              ? <><RefreshCw size={8} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</>
              : aiText
                ? <><RefreshCw size={8} /> Regenerate</>
                : <><Sparkles size={8} /> Generate</>
            }
          </button>
        }
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 16px' }}>
        {/* Error */}
        {aiError && (
          <div style={{
            padding: '10px 12px', borderRadius: 7,
            background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.22)',
            fontFamily: 'Inter, sans-serif', fontSize: 10.5, color: '#dc2626', lineHeight: 1.5,
          }}>
            {aiError}
          </div>
        )}

        {/* Empty state */}
        {!aiText && !aiLoading && !aiError && (
          <div style={{
            padding: '20px 12px', display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 10, textAlign: 'center' as const,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'rgba(99,102,241,0.09)', border: '1px solid rgba(99,102,241,0.20)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Sparkles size={16} style={{ color: '#6366f1' }} />
            </div>
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: '#64748b', lineHeight: 1.6, maxWidth: 300 }}>
              Click <strong style={{ color: '#6366f1' }}>Generate</strong> to get AI-powered recommendations
              for reaching 100% coverage on this tactic.
            </div>
            <div style={{
              display: 'flex', gap: 6, flexWrap: 'wrap' as const, justifyContent: 'center',
              marginTop: 2,
            }}>
              {['Quick Wins', 'Priority Gaps', 'Use Case Templates', 'Roadmap'].map(tag => (
                <span key={tag} style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 8.5, color: '#6366f1',
                  background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)',
                  borderRadius: 4, padding: '2px 8px',
                }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Streaming / completed text */}
        {(aiText || aiLoading) && (
          <div>
            <MarkdownBlock text={aiText} />
            {aiLoading && (
              <span style={{
                display: 'inline-block', width: 7, height: 14,
                background: '#6366f1', borderRadius: 1, marginLeft: 2,
                animation: 'blink 0.7s step-end infinite',
                verticalAlign: 'middle',
              }} />
            )}
          </div>
        )}
      </div>

      {/* Cursor blink animation */}
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes spin  { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function HoverIntelPanel() {
  const hoveredTacticId = useStore(s => s.hoveredTacticId)
  const pinnedTacticId  = useStore(s => s.pinnedTacticId)
  const view = useStore(s => s.view)
  const [activeTacticId, setActiveTacticId] = useState<string | null>(null)
  const isPanelHovered = useRef(false)
  const closeTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const scheduleClose = useCallback(() => {
    if (pinnedTacticId) return
    clearClose()
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      setActiveTacticId(null)
    }, 380)
  }, [clearClose, pinnedTacticId])

  useEffect(() => {
    if (hoveredTacticId) {
      clearClose()
      setActiveTacticId(hoveredTacticId)
    } else if (pinnedTacticId) {
      clearClose()
      setActiveTacticId(pinnedTacticId)
    } else {
      scheduleClose()
    }
  }, [hoveredTacticId, pinnedTacticId, clearClose, scheduleClose])

  if (view !== 'globe') return null

  const tactic = activeTacticId ? tacticById.get(activeTacticId) : null
  const color  = tactic ? colorForTactic(tactic.id) : '#0284c7'

  return (
    <AnimatePresence>
      {tactic && (
        <motion.div
          key={tactic.id}
          initial={{ x: '100%', opacity: 0, scale: 0.98 }}
          animate={{ x: 0, opacity: 1, scale: 1 }}
          exit={{ x: '100%', opacity: 0, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          onMouseEnter={() => { isPanelHovered.current = true; clearClose() }}
          onMouseLeave={() => { isPanelHovered.current = false; if (!hoveredTacticId) scheduleClose() }}
          style={{
            position: 'absolute', top: 0, bottom: 0, right: 0,
            width: 480, zIndex: 50,
            background: 'rgba(255,255,255,0.995)',
            borderLeft: `2px solid ${color}28`,
            boxShadow: `-32px 0 64px rgba(0,0,0,0.18), -4px 0 16px rgba(0,0,0,0.10), inset 1px 0 0 ${color}18`,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
        >
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: 2,
            background: `linear-gradient(to bottom, transparent 5%, ${color}55 40%, ${color}55 60%, transparent 95%)`,
            pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 1,
            background: `linear-gradient(90deg, ${color}44, transparent 60%)`,
            pointerEvents: 'none',
          }} />
          <div style={{ position: 'relative', zIndex: 1, height: '100%', overflow: 'hidden' }}>
            <TacticIntelContent tactic={tactic} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
