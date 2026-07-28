import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '../../lib/store'
import {
  USE_CASES, groqGenerateAlert, localGenerateAlert, parseAlert, buildAlertQueueItem,
  type UseCaseId, type SiemAlert,
} from './alertGenUtils'
import {
  Zap, Play, Square, Trash2, Copy, Check, ChevronDown, ChevronRight,
  AlertTriangle, Shield, Mail, Server, Database, Key, Network, Cloud,
  Users, Activity, RefreshCw, Clock, Eye, Shuffle, Download,
} from 'lucide-react'

// ── Icon / color maps ─────────────────────────────────────────────────────────
const UC_ICONS: Record<UseCaseId, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  phishing: Mail, malware: AlertTriangle, lateral: Network,
  exfil: Database, brute: Key, privesc: Shield,
  c2: Activity, cloud: Cloud, insider: Users, supply: Server,
}
const UC_COLORS: Record<UseCaseId, string> = {
  phishing: '#f87171', malware: '#fb923c', lateral: '#fbbf24',
  exfil: '#a78bfa', brute: '#818cf8', privesc: '#34d399',
  c2: '#00e5ff', cloud: '#38bdf8', insider: '#fb7185', supply: '#e879f9',
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface AlertEntry { id: string; useCase: string; alert: SiemAlert; raw: string; createdAt: number }
type FilterSev = 'ALL' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

const SEV_META: Record<string, { bg: string; border: string; text: string; glow: string; dim: string }> = {
  CRITICAL: { bg: 'rgba(239,68,68,0.15)',  border: 'rgba(239,68,68,0.55)',  text: '#f87171', glow: 'rgba(239,68,68,0.30)', dim: 'rgba(239,68,68,0.08)'  },
  HIGH:     { bg: 'rgba(249,115,22,0.13)', border: 'rgba(249,115,22,0.50)', text: '#fb923c', glow: 'rgba(249,115,22,0.22)', dim: 'rgba(249,115,22,0.07)' },
  MEDIUM:   { bg: 'rgba(234,179,8,0.12)',  border: 'rgba(234,179,8,0.44)',  text: '#fbbf24', glow: 'rgba(234,179,8,0.16)', dim: 'rgba(234,179,8,0.07)'  },
  LOW:      { bg: 'rgba(52,211,153,0.10)', border: 'rgba(52,211,153,0.38)', text: '#34d399', glow: 'rgba(52,211,153,0.14)', dim: 'rgba(52,211,153,0.06)' },
  INFO:     { bg: 'rgba(100,116,139,0.08)',border: 'rgba(100,116,139,0.30)',text: '#94a3b8', glow: 'rgba(100,116,139,0.10)', dim: 'rgba(100,116,139,0.05)'},
}
const INTERVALS = [
  { label: '15 s',  value: 15  },
  { label: '30 s',  value: 30  },
  { label: '1 min', value: 60  },
  { label: '2 min', value: 120 },
  { label: '5 min', value: 300 },
]

// ── Severity badge ────────────────────────────────────────────────────────────
function SevBadge({ sev }: { sev: string }) {
  const m = SEV_META[sev] ?? SEV_META.INFO
  const prominent = sev === 'CRITICAL' || sev === 'HIGH'
  return (
    <span className="px-2 py-0.5 rounded text-[9.5px] font-bold font-mono uppercase tracking-widest shrink-0"
      style={{
        background: m.bg,
        border: `1px solid ${m.border}`,
        color: m.text,
        boxShadow: prominent ? `0 0 7px ${m.glow}` : undefined,
      }}>
      {sev}
    </span>
  )
}

// ── Alert card ────────────────────────────────────────────────────────────────
function AlertCard({ entry, onCopy }: { entry: AlertEntry; onCopy: (e: AlertEntry) => void }) {
  const [open,   setOpen]   = useState(false)
  const [copied, setCopied] = useState(false)
  const a        = entry.alert
  const ucColor  = UC_COLORS[entry.useCase as UseCaseId] ?? '#94a3b8'
  const UcIcon   = UC_ICONS[entry.useCase as UseCaseId] ?? Server
  const sevMeta  = SEV_META[a.severity] ?? SEV_META.INFO
  const prominent = a.severity === 'CRITICAL' || a.severity === 'HIGH'

  const handleCopy = (ev: React.MouseEvent) => {
    ev.stopPropagation()
    onCopy(entry)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }} transition={{ duration: 0.18 }}
      className="rounded-lg border overflow-hidden mb-2"
      style={{
        background: prominent ? sevMeta.bg : 'rgba(255,255,255,0.03)',
        borderColor: prominent ? sevMeta.border : 'rgba(255,255,255,0.09)',
        boxShadow: prominent
          ? `0 0 20px ${sevMeta.glow}, 0 1px 6px rgba(0,0,0,0.35)`
          : undefined,
      }}>

      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none transition-colors hover:bg-white/[0.025]"
        onClick={() => setOpen(o => !o)}>

        {/* Severity accent bar */}
        <div className="w-[3px] h-10 rounded-full shrink-0"
          style={{ background: sevMeta.text, boxShadow: prominent ? `0 0 5px ${sevMeta.text}` : undefined }} />

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Top meta row */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <SevBadge sev={a.severity} />
            <span className="text-[9.5px] font-mono text-slate-400 tracking-wide">{a.alert_id}</span>
            <span className="text-[9.5px] px-1.5 py-0.5 rounded font-mono"
              style={{ background: `${ucColor}15`, color: ucColor, border: `1px solid ${ucColor}30` }}>
              {a.technique_id}
            </span>
            {/* Use case badge */}
            <span className="flex items-center gap-1 text-[9.5px] px-1.5 py-0.5 rounded font-medium"
              style={{ background: `${ucColor}10`, color: ucColor, border: `1px solid ${ucColor}20` }}>
              <UcIcon className="w-2.5 h-2.5" style={{ color: ucColor }} />
              {USE_CASES.find(u => u.id === entry.useCase)?.label ?? entry.useCase}
            </span>
          </div>
          {/* Title */}
          <div className="text-[13px] font-semibold text-white leading-snug truncate">{a.title}</div>
          {/* Source → Dest */}
          <div className="text-[10.5px] text-slate-400 mt-0.5 font-mono truncate">
            {a.source.hostname}&nbsp;<span className="text-slate-600">·</span>&nbsp;{a.source.user}
            &nbsp;<span className="text-slate-500">→</span>&nbsp;
            {a.destination.hostname ?? a.destination.ip}:{a.destination.port}
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[9.5px] text-slate-500 font-mono tabular-nums">
            {new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          <button onClick={handleCopy} title="Copy JSON" className="p-1 rounded transition-colors hover:bg-white/[0.05]"
            style={{ color: copied ? '#34d399' : '#475569' }}>
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </button>
          <span className="text-slate-600 transition-transform" style={{ transform: open ? 'rotate(90deg)' : 'none', display: 'inline-flex' }}>
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </div>
      </div>

      {/* Expanded detail */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} style={{ overflow: 'hidden' }}>
            <div className="px-4 pb-4 pt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>

              {/* Description */}
              <p className="text-[12px] text-slate-300 leading-relaxed mb-4">{a.description}</p>

              {/* Source / Destination */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                {[
                  { label: 'Source', fields: [['IP', a.source.ip], ['Host', a.source.hostname], ['User', a.source.user], ...(a.source.process ? [['Proc', a.source.process]] : [])] },
                  { label: 'Destination', fields: [['IP', a.destination.ip], ...(a.destination.hostname ? [['Host', a.destination.hostname]] : []), ['Port', String(a.destination.port)]] },
                ].map(({ label, fields }) => (
                  <div key={label}>
                    <div className="text-[9.5px] text-slate-500 uppercase tracking-widest font-semibold mb-1.5">{label}</div>
                    <div className="space-y-1">
                      {fields.map(([k, v]) => (
                        <div key={k} className="flex gap-1.5 text-[11px]">
                          <span className="text-slate-500 font-mono w-8 shrink-0">{k}</span>
                          <span className="text-slate-200 font-mono break-all">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Evidence */}
              <div className="mb-4">
                <div className="text-[9.5px] text-slate-500 uppercase tracking-widest font-semibold mb-2">Evidence</div>
                <ul className="space-y-1">
                  {a.evidence.map((ev, i) => (
                    <li key={i} className="flex items-start gap-2 text-[11.5px] text-slate-300">
                      <span className="mt-0.5 shrink-0 text-[10px]" style={{ color: sevMeta.text }}>▸</span>
                      {ev}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Raw log */}
              <div className="mb-4">
                <div className="text-[9.5px] text-slate-500 uppercase tracking-widest font-semibold mb-2">Raw Log</div>
                <div className="px-3 py-2 rounded text-[10.5px] font-mono text-slate-400 break-all leading-relaxed"
                  style={{ background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  {a.raw_log}
                </div>
              </div>

              {/* Recommended action */}
              <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg"
                style={{ background: 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.18)' }}>
                <Eye className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-[9.5px] text-cyan-500 uppercase tracking-widest font-semibold mb-1">Recommended Action</div>
                  <div className="text-[11.5px] text-cyan-100 leading-relaxed">{a.recommended_action}</div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function AlertGeneratorView() {
  const pushAlert          = useStore(s => s.pushAlert)
  const autoGenMode        = useStore(s => s.autoGenMode)
  const autoGenInterval    = useStore(s => s.autoGenInterval)
  const autoGenUseCase     = useStore(s => s.autoGenUseCase)
  const autoGenLastFiredAt = useStore(s => s.autoGenLastFiredAt)
  const setAutoGenMode     = useStore(s => s.setAutoGenMode)
  const setAutoGenInterval = useStore(s => s.setAutoGenInterval)
  const setAutoGenUseCase  = useStore(s => s.setAutoGenUseCase)
  const autoGenRotate      = useStore(s => s.autoGenRotate)
  const setAutoGenRotate   = useStore(s => s.setAutoGenRotate)
  const apiKey             = useStore(s => s.apiKey)

  const [selectedUC,  setSelectedUC]  = useState<UseCaseId>(() => (autoGenMode ? autoGenUseCase as UseCaseId : 'phishing'))
  const [alerts,      setAlerts]      = useState<AlertEntry[]>([])
  const [generating,  setGenerating]  = useState(false)
  const [countdown,   setCountdown]   = useState(0)
  const [error,       setError]       = useState('')
  const [filterSev,   setFilterSev]   = useState<FilterSev>('ALL')

  const generatingRef  = useRef(false)
  const lastFiredAtRef = useRef(autoGenLastFiredAt)

  useEffect(() => { lastFiredAtRef.current = autoGenLastFiredAt }, [autoGenLastFiredAt])

  // Live countdown ticker
  useEffect(() => {
    if (!autoGenMode) { setCountdown(0); return }
    const tick = setInterval(() => {
      const elapsed    = (Date.now() - lastFiredAtRef.current) / 1000
      const remaining  = Math.max(0, Math.round(autoGenInterval - elapsed))
      setCountdown(remaining)
    }, 500)
    return () => clearInterval(tick)
  }, [autoGenMode, autoGenInterval])

  // Manual generate
  const doGenerate = useCallback(async () => {
    if (generatingRef.current) return
    generatingRef.current = true
    setGenerating(true)
    setError('')
    try {
      const uc = USE_CASES.find(u => u.id === selectedUC)!
      let data: SiemAlert
      if (apiKey.trim()) {
        data = parseAlert(await groqGenerateAlert(apiKey.trim(), uc))
      } else {
        data = localGenerateAlert(uc)
      }
      const qi = buildAlertQueueItem(data, uc)
      setAlerts(prev => [{ id: qi.id, useCase: selectedUC, alert: data, raw: JSON.stringify(data, null, 2), createdAt: Date.now() }, ...prev].slice(0, 200))
      pushAlert(qi)
    } catch (e: unknown) {
      try {
        const uc   = USE_CASES.find(u => u.id === selectedUC)!
        const data = localGenerateAlert(uc)
        const qi   = buildAlertQueueItem(data, uc)
        setAlerts(prev => [{ id: qi.id, useCase: selectedUC, alert: data, raw: JSON.stringify(data, null, 2), createdAt: Date.now() }, ...prev].slice(0, 200))
        pushAlert(qi)
        setError(`Groq unavailable — local synthetic alert generated instead.`)
      } catch {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      generatingRef.current = false
      setGenerating(false)
    }
  }, [apiKey, selectedUC, pushAlert])

  // Mirror store queue → local display list (all use cases, no filter)
  const alertQueue = useStore(s => s.alertQueue)
  const seenIdsRef = useRef(new Set<string>())
  useEffect(() => {
    alertQueue.forEach(a => {
      if (seenIdsRef.current.has(a.id)) return
      seenIdsRef.current.add(a.id)
      const entry: AlertEntry = {
        id: a.id, useCase: a.useCase, createdAt: a.createdAt, raw: '',
        alert: {
          alert_id: a.alertId, timestamp: a.timestamp, severity: a.severity,
          title: a.title, description: a.description, tactic: a.tactic,
          technique_id: a.techniqueId, technique_name: a.techniqueName,
          source: { ip: a.sourceIp, hostname: a.sourceHost, user: a.sourceUser, process: a.sourceProcess ?? undefined },
          destination: { ip: a.destIp, hostname: a.destHost, port: a.destPort },
          evidence: a.evidence, raw_log: a.rawLog, recommended_action: a.recommendedAction,
        },
      }
      setAlerts(prev => {
        if (prev.some(e => e.id === a.id)) return prev
        return [entry, ...prev].slice(0, 200)
      })
    })
  }, [alertQueue])

  const handleToggleAuto = () => {
    if (!autoGenMode) setAutoGenUseCase(selectedUC)
    setAutoGenMode(!autoGenMode)
  }
  const handleStopAuto    = () => { setAutoGenMode(false); setCountdown(0) }
  const handleSelectUC    = (id: UseCaseId) => { setSelectedUC(id); if (autoGenMode) setAutoGenUseCase(id) }
  const handleClearAll    = () => { setAlerts([]); seenIdsRef.current.clear(); setAutoGenMode(false); setFilterSev('ALL') }
  const handleCopyEntry   = useCallback(async (e: AlertEntry) => {
    await navigator.clipboard.writeText(JSON.stringify(e.alert, null, 2))
  }, [])
  const handleExport = () => {
    const blob = new Blob([JSON.stringify(alerts.map(e => e.alert), null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `atlas-alerts-${Date.now()}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  const uc         = USE_CASES.find(u => u.id === selectedUC)!
  const ucColor    = UC_COLORS[selectedUC]
  const UcIcon     = UC_ICONS[selectedUC]

  // Severity counts for filter tabs
  const sevCounts  = alerts.reduce((acc, e) => {
    acc[e.alert.severity] = (acc[e.alert.severity] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  const filteredAlerts = filterSev === 'ALL' ? alerts : alerts.filter(e => e.alert.severity === filterSev)

  const SEV_FILTERS: { key: FilterSev; label: string }[] = [
    { key: 'ALL',      label: 'All'      },
    { key: 'CRITICAL', label: 'Critical' },
    { key: 'HIGH',     label: 'High'     },
    { key: 'MEDIUM',   label: 'Medium'   },
    { key: 'LOW',      label: 'Low'      },
  ]

  return (
    <div className="h-full flex overflow-hidden" style={{ background: 'rgba(7,10,18,0.95)' }}>

      {/* ── Left sidebar ─────────────────────────────────────────────────── */}
      <div className="w-56 shrink-0 flex flex-col border-r overflow-hidden"
        style={{ background: 'rgba(5,8,16,0.80)', borderColor: 'rgba(255,255,255,0.06)' }}>

        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
              style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.25)' }}>
              <Zap className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <span className="text-[12.5px] font-bold text-white tracking-tight">Alert Generator</span>
            {autoGenMode && (
              <span className="ml-auto flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" style={{ animation: 'ping 1s cubic-bezier(0,0,0.2,1) infinite' }} />
                <span className="text-[9px] font-mono font-bold text-amber-400 tracking-wider">LIVE</span>
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            Synthetic SIEM alerts for end-to-end SOC pipeline testing
          </p>
        </div>

        {/* Rotate mode banner */}
        {autoGenMode && autoGenRotate && (
          <div className="mx-2 mt-2 px-2 py-1.5 rounded-md flex items-center gap-1.5"
            style={{ background: 'rgba(167,139,250,0.10)', border: '1px solid rgba(167,139,250,0.25)' }}>
            <Shuffle className="w-3 h-3 text-violet-400 shrink-0" />
            <span className="text-[9.5px] text-violet-300 font-semibold">Rotating all use cases</span>
          </div>
        )}

        {/* Use case list */}
        <div className="flex-1 overflow-y-auto py-2 px-1.5">
          <div className="text-[9px] text-slate-600 uppercase tracking-widest font-bold px-1.5 mb-1.5">Use Cases</div>
          {USE_CASES.map(u => {
            const Icon   = UC_ICONS[u.id]
            const color  = UC_COLORS[u.id]
            const active = selectedUC === u.id
            const isAuto = autoGenMode && autoGenUseCase === u.id && !autoGenRotate
            return (
              <button key={u.id} onClick={() => handleSelectUC(u.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md mb-px text-left transition-all group"
                style={{
                  background: active ? `${color}14` : 'transparent',
                  border: `1px solid ${active ? color + '35' : 'transparent'}`,
                }}>
                <div className="w-5 h-5 rounded flex items-center justify-center shrink-0"
                  style={{ background: active ? `${color}22` : `${color}0D` }}>
                  <Icon className="w-3 h-3" style={{ color: active ? color : `${color}99` }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold leading-tight truncate"
                    style={{ color: active ? color : '#94a3b8' }}>{u.label}</div>
                  <div className="text-[9px] text-slate-600 leading-tight">{u.tactic}</div>
                </div>
                {isAuto && (
                  <span className="text-[7.5px] font-mono font-bold text-amber-400 border border-amber-400/25 rounded px-1 py-px shrink-0"
                    style={{ animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' }}>
                    AUTO
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Session stats footer */}
        {alerts.length > 0 && (
          <div className="px-3 py-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] text-slate-600 uppercase tracking-widest font-bold">Session</span>
              <span className="text-[10px] font-mono font-bold text-slate-300">{alerts.length} alerts</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).filter(s => sevCounts[s]).map(s => (
                <button key={s} onClick={() => setFilterSev(filterSev === s ? 'ALL' : s)}
                  className="flex items-center justify-between px-2 py-1 rounded transition-all"
                  style={{
                    background: filterSev === s ? SEV_META[s].bg : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${filterSev === s ? SEV_META[s].border : 'rgba(255,255,255,0.06)'}`,
                  }}>
                  <span className="text-[8.5px] font-bold font-mono" style={{ color: SEV_META[s].text }}>{s[0]}</span>
                  <span className="text-[10px] font-mono font-bold" style={{ color: SEV_META[s].text }}>{sevCounts[s]}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Main panel ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex flex-col min-w-0">

        {/* Control bar */}
        <div className="flex items-center gap-0 px-4 py-2 border-b shrink-0"
          style={{ background: 'rgba(7,10,18,0.90)', backdropFilter: 'blur(10px)', borderColor: 'rgba(255,255,255,0.06)' }}>

          {/* Active use case indicator */}
          <div className="flex items-center gap-2 pr-3 mr-3 border-r shrink-0" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
            <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: `${ucColor}18` }}>
              <UcIcon className="w-3 h-3" style={{ color: ucColor }} />
            </div>
            <div>
              <div className="text-[11px] font-semibold leading-none" style={{ color: ucColor }}>{uc.label}</div>
              <div className="text-[9px] text-slate-600 leading-none mt-0.5">{uc.tactic}</div>
            </div>
          </div>

          {/* Auto controls group */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 font-medium">Auto</span>
            {/* Toggle */}
            <button onClick={handleToggleAuto} title={autoGenMode ? 'Disable auto-generation' : 'Enable auto-generation'}
              className="w-9 h-5 rounded-full transition-all relative shrink-0 cursor-pointer"
              style={{
                background: autoGenMode ? 'rgba(251,191,36,0.22)' : 'rgba(255,255,255,0.06)',
                border: `1px solid ${autoGenMode ? 'rgba(251,191,36,0.50)' : 'rgba(255,255,255,0.10)'}`,
              }}>
              <div className="absolute top-0.5 w-4 h-4 rounded-full transition-all duration-200"
                style={{ left: autoGenMode ? '18px' : '2px', background: autoGenMode ? '#fbbf24' : '#374151' }} />
            </button>

            {/* Interval */}
            <select value={autoGenInterval} onChange={e => setAutoGenInterval(Number(e.target.value))}
              className="h-7 text-[10.5px] text-slate-300 rounded-md px-2 focus:outline-none cursor-pointer transition-colors"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)' }}>
              {INTERVALS.map(i => (
                <option key={i.value} value={i.value} style={{ background: '#0f172a', color: '#cbd5e1' }}>{i.label}</option>
              ))}
            </select>

            {/* Rotate toggle */}
            <button onClick={() => setAutoGenRotate(!autoGenRotate)}
              title="Rotate: randomly pick a different use case on each Auto tick"
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[10.5px] font-semibold transition-all cursor-pointer"
              style={{
                background: autoGenRotate ? 'rgba(167,139,250,0.15)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${autoGenRotate ? 'rgba(167,139,250,0.45)' : 'rgba(255,255,255,0.09)'}`,
                color: autoGenRotate ? '#a78bfa' : '#475569',
                boxShadow: autoGenRotate ? '0 0 10px rgba(167,139,250,0.18)' : undefined,
              }}>
              <Shuffle className="w-3 h-3" />
              Rotate
            </button>

            {/* Running status */}
            {autoGenMode && (
              <div className="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[10.5px] font-mono"
                style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.18)' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                  style={{ animation: 'ping 1s cubic-bezier(0,0,0.2,1) infinite' }} />
                <span className="text-amber-400 font-semibold">running</span>
                {countdown > 0 && (
                  <span className="text-amber-600 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {countdown}s
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Right action group */}
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={doGenerate} disabled={generating}
              title={apiKey.trim() ? 'Generate an AI-powered alert via Groq' : 'Generate a local synthetic alert (no API key set)'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer"
              style={{
                background: generating ? 'rgba(251,191,36,0.05)' : 'rgba(251,191,36,0.10)',
                border: `1px solid rgba(251,191,36,${generating ? '0.12' : '0.28'})`,
                color: generating ? '#78350f' : '#fbbf24',
                opacity: generating ? 0.7 : 1,
              }}>
              {generating
                ? <><RefreshCw className="w-3 h-3 animate-spin" />Generating…</>
                : <><Play className="w-3 h-3" />Generate Alert</>}
            </button>

            <button onClick={handleStopAuto} disabled={!autoGenMode}
              title={autoGenMode ? 'Stop background auto-generation' : 'Auto-generation is not running'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all"
              style={{
                background: autoGenMode ? 'rgba(248,113,113,0.10)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${autoGenMode ? 'rgba(248,113,113,0.35)' : 'rgba(255,255,255,0.07)'}`,
                color: autoGenMode ? '#f87171' : '#334155',
                cursor: autoGenMode ? 'pointer' : 'not-allowed',
              }}>
              <Square className="w-3 h-3" />Stop Auto
            </button>

            {alerts.length > 0 && (
              <>
                <button onClick={handleExport}
                  title="Export all alerts as JSON"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer"
                  style={{ background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.20)', color: '#38bdf8' }}>
                  <Download className="w-3 h-3" />Export
                </button>
                <button onClick={handleClearAll}
                  title="Clear all alerts and stop auto-generation"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer"
                  style={{ background: 'rgba(100,116,139,0.07)', border: '1px solid rgba(100,116,139,0.18)', color: '#475569' }}>
                  <Trash2 className="w-3 h-3" />Clear
                </button>
              </>
            )}
          </div>
        </div>

        {/* Error banner */}
        <AnimatePresence>
          {error && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }}
              className="flex items-center gap-2 px-4 py-2 text-[11px] shrink-0"
              style={{ background: 'rgba(239,68,68,0.07)', borderBottom: '1px solid rgba(239,68,68,0.15)', color: '#f87171' }}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError('')} className="text-red-600 hover:text-red-400 transition-colors px-1">✕</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Severity filter tabs */}
        {alerts.length > 0 && (
          <div className="flex items-center gap-1 px-4 py-2 border-b shrink-0"
            style={{ borderColor: 'rgba(255,255,255,0.05)', background: 'rgba(7,10,18,0.60)' }}>
            {SEV_FILTERS.map(({ key, label }) => {
              const count  = key === 'ALL' ? alerts.length : (sevCounts[key] ?? 0)
              const active = filterSev === key
              const meta   = key !== 'ALL' ? SEV_META[key] : null
              return (
                <button key={key} onClick={() => setFilterSev(key)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10.5px] font-semibold transition-all cursor-pointer"
                  style={{
                    background: active ? (meta?.bg ?? 'rgba(255,255,255,0.08)') : 'transparent',
                    border: `1px solid ${active ? (meta?.border ?? 'rgba(255,255,255,0.18)') : 'transparent'}`,
                    color: active ? (meta?.text ?? '#e2e8f0') : '#475569',
                    boxShadow: active && meta ? `0 0 8px ${meta.glow}` : undefined,
                  }}>
                  {label}
                  {count > 0 && (
                    <span className="text-[9px] font-mono font-bold px-1 py-px rounded"
                      style={{ background: active ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.06)', color: 'inherit' }}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
            <div className="ml-auto flex items-center gap-1 text-[10px] text-slate-600 font-mono">
              <ChevronDown className="w-3 h-3" />
              {filteredAlerts.length} shown
            </div>
          </div>
        )}

        {/* Alert feed */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <AnimatePresence mode="popLayout">
            {filteredAlerts.length === 0 ? (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-full text-center py-16">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: `${ucColor}0D`, border: `1px solid ${ucColor}22` }}>
                  <UcIcon className="w-6 h-6" style={{ color: ucColor, opacity: 0.5 }} />
                </div>
                {filterSev !== 'ALL' ? (
                  <>
                    <p className="text-slate-400 text-sm font-semibold mb-1">No {filterSev} alerts</p>
                    <button onClick={() => setFilterSev('ALL')}
                      className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors underline underline-offset-2">
                      Show all severities
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-slate-300 text-sm font-semibold mb-2">No alerts yet</p>
                    <p className="text-slate-500 text-xs max-w-64 leading-relaxed">
                      Click <span className="text-amber-400 font-semibold">Generate Alert</span> for a one-off, or enable{' '}
                      <span className="text-amber-400 font-semibold">Auto</span> to stream alerts on a timer — even while on other tabs.
                    </p>
                  </>
                )}
              </motion.div>
            ) : (
              filteredAlerts.map(entry => (
                <AlertCard key={entry.id} entry={entry} onCopy={handleCopyEntry} />
              ))
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
