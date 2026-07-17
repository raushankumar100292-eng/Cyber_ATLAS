import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '../../lib/store'
import type { AlertQueueItem } from '../../lib/store'
import {
  USE_CASES, groqGenerateAlert, parseAlert, buildAlertQueueItem,
  type UseCaseId, type SiemAlert,
} from './alertGenUtils'
import {
  Zap, Play, Square, Trash2, Copy, Check, ChevronDown, ChevronRight,
  AlertTriangle, Shield, Mail, Server, Database, Key, Network, Cloud,
  Users, Activity, RefreshCw, Clock, Eye,
} from 'lucide-react'

// ── Icon map (kept local — utils has no React dep) ────────────────────────────
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

const SEV_META: Record<string, { bg: string; border: string; text: string }> = {
  CRITICAL: { bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.35)',   text: '#f87171' },
  HIGH:     { bg: 'rgba(249,115,22,0.10)',   border: 'rgba(249,115,22,0.30)',  text: '#fb923c' },
  MEDIUM:   { bg: 'rgba(234,179,8,0.10)',    border: 'rgba(234,179,8,0.28)',   text: '#fbbf24' },
  LOW:      { bg: 'rgba(52,211,153,0.09)',   border: 'rgba(52,211,153,0.25)',  text: '#34d399' },
  INFO:     { bg: 'rgba(100,116,139,0.09)',  border: 'rgba(100,116,139,0.25)', text: '#94a3b8' },
}
const INTERVALS = [
  { label: '15 s',  value: 15  },
  { label: '30 s',  value: 30  },
  { label: '1 min', value: 60  },
  { label: '2 min', value: 120 },
  { label: '5 min', value: 300 },
]

// ── Sub-components ────────────────────────────────────────────────────────────
function SevBadge({ sev }: { sev: string }) {
  const m = SEV_META[sev] ?? SEV_META.INFO
  return (
    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold font-mono"
      style={{ background: m.bg, border: `1px solid ${m.border}`, color: m.text }}>
      {sev}
    </span>
  )
}

function AlertCard({ entry, onCopy }: { entry: AlertEntry; onCopy: (e: AlertEntry) => void }) {
  const [open,   setOpen]   = useState(false)
  const [copied, setCopied] = useState(false)
  const a       = entry.alert
  const ucColor = UC_COLORS[entry.useCase as UseCaseId] ?? '#94a3b8'

  const handleCopy = (ev: React.MouseEvent) => {
    ev.stopPropagation()
    onCopy(entry)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.22 }}
      className="rounded-xl border overflow-hidden mb-2"
      style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.12)' }}>

      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors select-none"
        onClick={() => setOpen(o => !o)}>
        <div className="w-0.5 h-8 rounded-full shrink-0" style={{ background: SEV_META[a.severity]?.text ?? '#64748b' }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <SevBadge sev={a.severity} />
            <span className="text-[10px] font-mono text-slate-300">{a.alert_id}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-mono"
              style={{ background: `${ucColor}14`, color: ucColor, border: `1px solid ${ucColor}28` }}>
              {a.technique_id}
            </span>
          </div>
          <div className="text-[13px] font-semibold text-white truncate">{a.title}</div>
          <div className="text-[11px] text-slate-300 mt-0.5">
            {a.source.hostname} · {a.source.user} → {a.destination.hostname ?? a.destination.ip}:{a.destination.port}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-slate-300 font-mono">{new Date(a.timestamp).toLocaleTimeString()}</span>
          <button onClick={handleCopy} className="p-1.5 rounded-lg transition-colors"
            style={{ color: copied ? '#34d399' : '#475569' }}>
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
        </div>
      </div>

      {/* Expanded detail */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
            <div className="px-4 pb-4 border-t border-white/[0.06]">
              <p className="text-[13px] text-slate-200 leading-relaxed mt-3 mb-4">{a.description}</p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-2">Source</div>
                  <div className="text-[12px] text-slate-200 space-y-1">
                    <div><span className="text-slate-500 mr-1">IP</span>{a.source.ip}</div>
                    <div><span className="text-slate-500 mr-1">Host</span>{a.source.hostname}</div>
                    <div><span className="text-slate-500 mr-1">User</span>{a.source.user}</div>
                    {a.source.process && <div><span className="text-slate-500 mr-1">Proc</span>{a.source.process}</div>}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-2">Destination</div>
                  <div className="text-[12px] text-slate-200 space-y-1">
                    <div><span className="text-slate-500 mr-1">IP</span>{a.destination.ip}</div>
                    {a.destination.hostname && <div><span className="text-slate-500 mr-1">Host</span>{a.destination.hostname}</div>}
                    <div><span className="text-slate-500 mr-1">Port</span>{a.destination.port}</div>
                  </div>
                </div>
              </div>
              <div className="mb-4">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-2">Evidence</div>
                <ul className="space-y-1.5">
                  {a.evidence.map((ev, i) => (
                    <li key={i} className="flex items-start gap-2 text-[12px] text-slate-200">
                      <span style={{ color: SEV_META[a.severity]?.text ?? '#94a3b8' }}>›</span>{ev}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="mb-4">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-2">Raw Log</div>
                <div className="px-3 py-2.5 rounded-lg text-[11px] font-mono text-slate-300 break-all leading-relaxed"
                  style={{ background: 'rgba(0,0,0,0.40)', border: '1px solid rgba(255,255,255,0.10)' }}>
                  {a.raw_log}
                </div>
              </div>
              <div className="flex items-start gap-2 px-3 py-3 rounded-lg"
                style={{ background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.22)' }}>
                <Eye className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-[10px] text-cyan-400 uppercase tracking-wider font-semibold mb-1">Recommended Action</div>
                  <div className="text-[12.5px] text-cyan-100">{a.recommended_action}</div>
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
  const pushAlert              = useStore(s => s.pushAlert)
  // Auto-gen state lives in the store so it persists across tab switches
  const autoGenMode            = useStore(s => s.autoGenMode)
  const autoGenInterval        = useStore(s => s.autoGenInterval)
  const autoGenUseCase         = useStore(s => s.autoGenUseCase)
  const autoGenLastFiredAt     = useStore(s => s.autoGenLastFiredAt)
  const setAutoGenMode         = useStore(s => s.setAutoGenMode)
  const setAutoGenInterval     = useStore(s => s.setAutoGenInterval)
  const setAutoGenUseCase      = useStore(s => s.setAutoGenUseCase)

  const apiKey = useStore(s => s.apiKey)
  const [selectedUC,  setSelectedUC]  = useState<UseCaseId>('phishing')
  const [alerts,      setAlerts]      = useState<AlertEntry[]>([])
  const [generating,  setGenerating]  = useState(false)
  const [countdown,   setCountdown]   = useState(0)
  const [error,       setError]       = useState('')

  const generatingRef      = useRef(false)
  const lastFiredAtRef     = useRef(autoGenLastFiredAt)

  // Keep ref in sync so countdown interval closure reads latest value
  useEffect(() => { lastFiredAtRef.current = autoGenLastFiredAt }, [autoGenLastFiredAt])

  // Countdown display — ticks every 500ms, reads lastFiredAtRef so it doesn't re-subscribe on every fire
  useEffect(() => {
    if (!autoGenMode) { setCountdown(0); return }
    const tick = setInterval(() => {
      const elapsed  = (Date.now() - lastFiredAtRef.current) / 1000
      const remaining = Math.max(0, Math.round(autoGenInterval - elapsed))
      setCountdown(remaining)
    }, 500)
    return () => clearInterval(tick)
  }, [autoGenMode, autoGenInterval])

  // Manual generate (for the Generate Alert button in the view)
  const doGenerate = useCallback(async () => {
    if (generatingRef.current) return
    if (!apiKey.trim()) { setError('Set your Groq API key first.'); return }
    generatingRef.current = true
    setGenerating(true)
    setError('')
    try {
      const uc   = USE_CASES.find(u => u.id === selectedUC)!
      const raw  = await groqGenerateAlert(apiKey.trim(), uc)
      const data = parseAlert(raw)
      const qi   = buildAlertQueueItem(data, uc)
      setAlerts(prev => [{ id: qi.id, useCase: selectedUC, alert: data, raw, createdAt: Date.now() }, ...prev].slice(0, 200))
      pushAlert(qi)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      generatingRef.current = false
      setGenerating(false)
    }
  }, [apiKey, selectedUC, pushAlert])

  // Mirror background-generated alerts into local alert list for display
  const alertQueue        = useStore(s => s.alertQueue)
  const seenIdsRef        = useRef(new Set<string>())
  useEffect(() => {
    alertQueue.forEach(a => {
      if (seenIdsRef.current.has(a.id)) return
      // Only surface alerts that came from the auto-gen background (not manual ones already added)
      if (a.useCase === autoGenUseCase && !seenIdsRef.current.has(a.id)) {
        seenIdsRef.current.add(a.id)
        const syntheticEntry: AlertEntry = {
          id:        a.id,
          useCase:   a.useCase,
          createdAt: a.createdAt,
          raw:       '',
          alert: {
            alert_id:           a.alertId,
            timestamp:          a.timestamp,
            severity:           a.severity,
            title:              a.title,
            description:        a.description,
            tactic:             a.tactic,
            technique_id:       a.techniqueId,
            technique_name:     a.techniqueName,
            source: { ip: a.sourceIp, hostname: a.sourceHost, user: a.sourceUser, process: a.sourceProcess ?? undefined },
            destination: { ip: a.destIp, hostname: a.destHost, port: a.destPort },
            evidence:           a.evidence,
            raw_log:            a.rawLog,
            recommended_action: a.recommendedAction,
          },
        }
        setAlerts(prev => {
          if (prev.some(e => e.id === a.id)) return prev
          return [syntheticEntry, ...prev].slice(0, 200)
        })
      }
    })
  }, [alertQueue, autoGenUseCase])

  const handleToggleAuto = () => {
    if (!autoGenMode) {
      // Sync selected use case to store before enabling
      setAutoGenUseCase(selectedUC)
    }
    setAutoGenMode(!autoGenMode)
  }

  const handleSelectUC = (id: UseCaseId) => {
    setSelectedUC(id)
    if (autoGenMode) setAutoGenUseCase(id) // update background runner in real-time
  }

  const handleClearAll = () => {
    setAlerts([])
    seenIdsRef.current.clear()
    if (autoGenMode) setAutoGenMode(false)
  }

  const handleCopyEntry = useCallback(async (entry: AlertEntry) => {
    await navigator.clipboard.writeText(JSON.stringify(entry.alert, null, 2))
  }, [])

  const uc        = USE_CASES.find(u => u.id === selectedUC)!
  const ucColor   = UC_COLORS[selectedUC]
  const UcIcon    = UC_ICONS[selectedUC]
  const sevCounts = alerts.reduce((acc, e) => {
    acc[e.alert.severity] = (acc[e.alert.severity] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="h-full flex overflow-hidden">

      {/* ── Left sidebar ─────────────────────────────────────────────────── */}
      <div className="w-60 shrink-0 flex flex-col border-r border-white/[0.06] overflow-hidden"
        style={{ background: 'rgba(7,11,20,0.75)' }}>

        {/* Header */}
        <div className="px-4 pt-5 pb-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-bold text-white">Alert Generator</span>
            {/* Background running indicator */}
            {autoGenMode && (
              <span className="ml-auto flex items-center gap-1 text-[9px] font-mono text-amber-400 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                LIVE
              </span>
            )}
          </div>
          <p className="text-[10.5px] text-slate-400 leading-relaxed">
            Generate synthetic SIEM alerts for end-to-end SOC testing
          </p>
        </div>

        {/* Use case list */}
        <div className="flex-1 overflow-y-auto py-2 px-2">
          <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold px-1 mb-2">Security Use Cases</div>
          {USE_CASES.map(u => {
            const Icon    = UC_ICONS[u.id]
            const color   = UC_COLORS[u.id]
            const active  = selectedUC === u.id
            const isAuto  = autoGenMode && autoGenUseCase === u.id
            return (
              <button key={u.id} onClick={() => handleSelectUC(u.id)}
                className="w-full flex items-start gap-2.5 px-2 py-2 rounded-lg mb-0.5 text-left transition-all"
                style={{ background: active ? `${color}12` : 'transparent', border: `1px solid ${active ? color + '30' : 'transparent'}` }}>
                <div className="w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: `${color}18` }}>
                  <Icon className="w-3 h-3" style={{ color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11.5px] font-semibold leading-tight" style={{ color: active ? color : '#e2e8f0' }}>{u.label}</div>
                  <div className="text-[10px] text-slate-400 leading-tight mt-0.5">{u.tactic}</div>
                </div>
                {isAuto && (
                  <span className="text-[8px] font-mono text-amber-400 border border-amber-400/30 rounded px-1 py-0.5 shrink-0 self-center animate-pulse">AUTO</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Stats */}
        {alerts.length > 0 && (
          <div className="px-4 py-3 border-t border-white/[0.06]">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-2">
              Generated ({alerts.length})
            </div>
            <div className="flex flex-wrap gap-1">
              {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map(s =>
                sevCounts[s] ? (
                  <span key={s} className="px-1.5 py-0.5 rounded text-[9.5px] font-bold font-mono"
                    style={{ background: SEV_META[s].bg, border: `1px solid ${SEV_META[s].border}`, color: SEV_META[s].text }}>
                    {s[0]} {sevCounts[s]}
                  </span>
                ) : null
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Main panel ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex flex-col">

        {/* Control bar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-white/[0.06] shrink-0"
          style={{ background: 'rgba(7,11,20,0.8)', backdropFilter: 'blur(8px)' }}>

          {/* Use case indicator */}
          <div className="flex items-center gap-2 mr-1">
            <UcIcon className="w-4 h-4" style={{ color: ucColor }} />
            <span className="text-[13px] font-semibold" style={{ color: ucColor }}>{uc.label}</span>
          </div>

          <div className="h-4 w-px bg-white/[0.08]" />

          {/* Auto-mode controls */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-300">Auto</span>
            <button onClick={handleToggleAuto}
              className="w-9 h-5 rounded-full transition-all relative shrink-0"
              style={{
                background: autoGenMode ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.07)',
                border: `1px solid ${autoGenMode ? 'rgba(251,191,36,0.45)' : 'rgba(255,255,255,0.10)'}`,
              }}>
              <div className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
                style={{ left: autoGenMode ? '18px' : '2px', background: autoGenMode ? '#fbbf24' : '#475569' }} />
            </button>

            <select value={autoGenInterval}
              onChange={e => setAutoGenInterval(Number(e.target.value))}
              className="h-7 bg-white/[0.06] border border-white/[0.15] rounded-lg px-2 text-[11px] text-slate-200 focus:outline-none">
              {INTERVALS.map(i => (
                <option key={i.value} value={i.value} style={{ background: '#0f172a', color: '#cbd5e1' }}>{i.label}</option>
              ))}
            </select>

            {autoGenMode && (
              <div className="flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded-lg"
                style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.20)' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping shrink-0" />
                <span className="text-amber-400">running</span>
                {countdown > 0 && (
                  <>
                    <Clock className="w-3 h-3 text-amber-600" />
                    <span className="text-amber-500">next {countdown}s</span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Manual generate */}
            <button onClick={doGenerate} disabled={generating || !apiKey.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
              style={{
                background: generating ? 'rgba(251,191,36,0.06)' : 'rgba(251,191,36,0.12)',
                border: `1px solid rgba(251,191,36,${generating ? '0.15' : '0.30'})`,
                color: generating ? '#92400e' : '#fbbf24',
                opacity: !apiKey.trim() ? 0.4 : 1,
              }}>
              {generating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              {generating ? 'Generating…' : 'Generate Alert'}
            </button>

            {autoGenMode && (
              <button onClick={() => setAutoGenMode(false)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171' }}>
                <Square className="w-3 h-3" /> Stop
              </button>
            )}

            {alerts.length > 0 && (
              <button onClick={handleClearAll}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                style={{ background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.20)', color: '#64748b' }}>
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
        </div>

        {/* Error banner */}
        <AnimatePresence>
          {error && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }}
              className="flex items-center gap-2 px-5 py-2.5 text-[12px] text-red-400 shrink-0"
              style={{ background: 'rgba(239,68,68,0.07)', borderBottom: '1px solid rgba(239,68,68,0.18)' }}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {error}
              <button onClick={() => setError('')} className="ml-auto text-red-600 hover:text-red-400">✕</button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Alert feed */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <AnimatePresence mode="popLayout">
            {alerts.length === 0 ? (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: `${ucColor}10`, border: `1px solid ${ucColor}25` }}>
                  <UcIcon className="w-7 h-7" style={{ color: ucColor, opacity: 0.6 }} />
                </div>
                <p className="text-slate-200 text-sm font-semibold mb-1">No alerts yet</p>
                <p className="text-slate-400 text-xs max-w-xs leading-relaxed">
                  Click <span className="text-amber-400 font-semibold">Generate Alert</span> for a one-off, or
                  toggle <span className="text-amber-400 font-semibold">Auto</span> to generate on a timer —
                  even when you navigate to other tabs.
                </p>
              </motion.div>
            ) : (
              alerts.map(entry => (
                <AlertCard key={entry.id} entry={entry} onCopy={handleCopyEntry} />
              ))
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
