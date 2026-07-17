import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Inbox, ChevronDown, ChevronRight, Check, Trash2, Copy,
  ArrowRight, Filter, Search, RefreshCw, AlertTriangle,
  Eye, GitBranch, BarChart3, Clock, Zap,
} from 'lucide-react'
import { useStore } from '../../lib/store'
import type { AlertQueueItem } from '../../lib/store'

// ── Constants ─────────────────────────────────────────────────────────────────
const SEV_META: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  CRITICAL: { bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.35)',   text: '#f87171', dot: '#ef4444' },
  HIGH:     { bg: 'rgba(249,115,22,0.10)',  border: 'rgba(249,115,22,0.30)',  text: '#fb923c', dot: '#f97316' },
  MEDIUM:   { bg: 'rgba(234,179,8,0.10)',   border: 'rgba(234,179,8,0.28)',   text: '#fbbf24', dot: '#eab308' },
  LOW:      { bg: 'rgba(52,211,153,0.09)',  border: 'rgba(52,211,153,0.25)',  text: '#34d399', dot: '#10b981' },
  INFO:     { bg: 'rgba(100,116,139,0.09)', border: 'rgba(100,116,139,0.25)', text: '#94a3b8', dot: '#64748b' },
}

const STATUS_META: Record<AlertQueueItem['status'], { label: string; color: string; bg: string }> = {
  new:          { label: 'New',          color: '#00e5ff', bg: 'rgba(0,229,255,0.10)'   },
  acknowledged: { label: 'Acknowledged', color: '#fbbf24', bg: 'rgba(251,191,36,0.10)' },
  dispatched:   { label: 'Dispatched',   color: '#34d399', bg: 'rgba(52,211,153,0.10)' },
  dismissed:    { label: 'Dismissed',    color: '#475569', bg: 'rgba(71,85,105,0.10)'   },
}

const SEV_ORDER: AlertQueueItem['severity'][] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']

// ── Triage card ───────────────────────────────────────────────────────────────
function TriageCard({ item }: { item: AlertQueueItem }) {
  const updateAlertStatus = useStore(s => s.updateAlertStatus)
  const dismissAlert      = useStore(s => s.dismissAlert)
  const [open, setOpen]   = useState(false)
  const [copied, setCopied] = useState(false)

  const sev  = SEV_META[item.severity] ?? SEV_META.INFO
  const stat = STATUS_META[item.status]

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(JSON.stringify(item, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const age = () => {
    const secs = Math.floor((Date.now() - item.createdAt) / 1000)
    if (secs < 60)  return `${secs}s ago`
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
    return `${Math.floor(secs / 3600)}h ago`
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -24, height: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-xl border mb-2 overflow-hidden"
      style={{
        background: item.status === 'dismissed' ? 'rgba(255,255,255,0.01)' : 'rgba(255,255,255,0.025)',
        borderColor: item.status === 'dismissed' ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)',
        opacity: item.status === 'dismissed' ? 0.45 : 1,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors select-none"
        onClick={() => setOpen(o => !o)}
      >
        {/* Severity stripe */}
        <div className="w-0.5 h-8 rounded-full shrink-0" style={{ background: sev.text }} />

        {/* New pulse dot */}
        {item.status === 'new' && (
          <span className="w-2 h-2 rounded-full shrink-0 animate-pulse" style={{ background: sev.dot }} />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold font-mono"
              style={{ background: sev.bg, border: `1px solid ${sev.border}`, color: sev.text }}>
              {item.severity}
            </span>
            <span className="text-[10px] font-mono text-slate-500">{item.alertId}</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(129,140,248,0.12)', color: '#818cf8', border: '1px solid rgba(129,140,248,0.22)' }}>
              {item.techniqueId}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
              style={{ background: stat.bg, color: stat.color }}>
              {stat.label}
            </span>
          </div>
          <div className="text-[13px] font-semibold text-slate-100 truncate">{item.title}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {item.sourceHost} · {item.sourceUser} → {item.destHost}:{item.destPort}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-slate-600 font-mono">{age()}</span>
          <button onClick={handleCopy} className="p-1.5 rounded transition-colors"
            style={{ color: copied ? '#34d399' : '#475569' }}>
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-500" />}
        </div>
      </div>

      {/* Expanded */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-4 pb-4 border-t border-white/[0.06]">
              <p className="text-[12.5px] text-slate-400 leading-relaxed mt-3 mb-3">{item.description}</p>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <div className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold mb-1.5">Source</div>
                  <div className="text-[11.5px] text-slate-300 space-y-0.5">
                    <div><span className="text-slate-600">IP </span>{item.sourceIp}</div>
                    <div><span className="text-slate-600">Host </span>{item.sourceHost}</div>
                    <div><span className="text-slate-600">User </span>{item.sourceUser}</div>
                    {item.sourceProcess && <div><span className="text-slate-600">Proc </span>{item.sourceProcess}</div>}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold mb-1.5">Destination</div>
                  <div className="text-[11.5px] text-slate-300 space-y-0.5">
                    <div><span className="text-slate-600">IP </span>{item.destIp}</div>
                    <div><span className="text-slate-600">Host </span>{item.destHost}</div>
                    <div><span className="text-slate-600">Port </span>{item.destPort}</div>
                  </div>
                </div>
              </div>

              <div className="mb-3">
                <div className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold mb-1.5">Evidence</div>
                <ul className="space-y-1">
                  {item.evidence.map((ev, i) => (
                    <li key={i} className="flex items-start gap-2 text-[11.5px] text-slate-400">
                      <span style={{ color: sev.text }}>›</span>{ev}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mb-3 px-3 py-2 rounded-lg font-mono text-[10.5px] text-slate-500 break-all"
                style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.05)' }}>
                {item.rawLog}
              </div>

              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg mb-3"
                style={{ background: 'rgba(0,229,255,0.05)', border: '1px solid rgba(0,229,255,0.15)' }}>
                <Eye className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-[10px] text-cyan-600 uppercase tracking-wider font-semibold mb-0.5">Recommended Action</div>
                  <div className="text-[12px] text-cyan-300">{item.recommendedAction}</div>
                </div>
              </div>

              {/* Triage actions */}
              <div className="flex items-center gap-2 flex-wrap">
                {item.status === 'new' && (
                  <button
                    onClick={() => updateAlertStatus(item.id, 'acknowledged')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                    style={{ background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.28)', color: '#fbbf24' }}
                  >
                    <Check className="w-3 h-3" /> Acknowledge
                  </button>
                )}
                {(item.status === 'new' || item.status === 'acknowledged') && (
                  <button
                    onClick={() => updateAlertStatus(item.id, 'dispatched')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                    style={{ background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.28)', color: '#34d399' }}
                  >
                    <ArrowRight className="w-3 h-3" /> Dispatch to Agent
                  </button>
                )}
                {item.status !== 'dismissed' && (
                  <button
                    onClick={() => updateAlertStatus(item.id, 'dismissed')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                    style={{ background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.20)', color: '#64748b' }}
                  >
                    <GitBranch className="w-3 h-3" /> False Positive
                  </button>
                )}
                <button
                  onClick={() => dismissAlert(item.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all ml-auto"
                  style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.20)', color: '#f87171' }}
                >
                  <Trash2 className="w-3 h-3" /> Remove
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function SocTriageView() {
  const alertQueue      = useStore(s => s.alertQueue)
  const clearAlertQueue = useStore(s => s.clearAlertQueue)
  const setView         = useStore(s => s.setView)

  const [filterSev, setFilterSev]     = useState<string>('ALL')
  const [filterStatus, setFilterStatus] = useState<string>('ALL')
  const [search, setSearch]           = useState('')

  const filtered = useMemo(() => {
    return alertQueue.filter(a => {
      if (filterSev !== 'ALL' && a.severity !== filterSev) return false
      if (filterStatus !== 'ALL' && a.status !== filterStatus) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        return (
          a.title.toLowerCase().includes(q) ||
          a.sourceUser.toLowerCase().includes(q) ||
          a.sourceHost.toLowerCase().includes(q) ||
          a.techniqueId.toLowerCase().includes(q) ||
          a.useCaseLabel.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [alertQueue, filterSev, filterStatus, search])

  // Stats
  const total   = alertQueue.length
  const byStatus = alertQueue.reduce((acc, a) => { acc[a.status] = (acc[a.status] ?? 0) + 1; return acc }, {} as Record<string, number>)
  const bySev    = alertQueue.reduce((acc, a) => { acc[a.severity] = (acc[a.severity] ?? 0) + 1; return acc }, {} as Record<string, number>)

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Top stats bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-white/[0.06] shrink-0"
        style={{ background: 'rgba(7,11,20,0.85)', backdropFilter: 'blur(8px)' }}>

        <div className="flex items-center gap-2">
          <Inbox className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-bold text-white">SOC Triage Queue</span>
          {total > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono"
              style={{ background: 'rgba(0,229,255,0.12)', border: '1px solid rgba(0,229,255,0.25)', color: '#00e5ff' }}>
              {total}
            </span>
          )}
        </div>

        {/* Severity breakdown chips */}
        <div className="flex items-center gap-1.5">
          {SEV_ORDER.filter(s => bySev[s]).map(s => {
            const m = SEV_META[s]
            return (
              <span key={s} className="px-2 py-0.5 rounded text-[10px] font-bold font-mono cursor-pointer transition-all"
                style={{
                  background: filterSev === s ? m.bg : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${filterSev === s ? m.border : 'rgba(255,255,255,0.08)'}`,
                  color: filterSev === s ? m.text : '#475569',
                }}
                onClick={() => setFilterSev(filterSev === s ? 'ALL' : s)}
              >
                {s[0]} {bySev[s]}
              </span>
            )
          })}
        </div>

        {/* Status breakdown */}
        <div className="flex items-center gap-1.5">
          {(Object.keys(STATUS_META) as AlertQueueItem['status'][]).filter(s => byStatus[s]).map(s => {
            const m = STATUS_META[s]
            return (
              <span key={s} className="px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer transition-all"
                style={{
                  background: filterStatus === s ? m.bg : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${filterStatus === s ? m.color + '35' : 'rgba(255,255,255,0.08)'}`,
                  color: filterStatus === s ? m.color : '#475569',
                }}
                onClick={() => setFilterStatus(filterStatus === s ? 'ALL' : s)}
              >
                {m.label} {byStatus[s]}
              </span>
            )
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Go to generator */}
          <button
            onClick={() => setView('alert-gen')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
            style={{ background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.25)', color: '#fbbf24' }}
          >
            <Zap className="w-3 h-3" /> Alert Generator
          </button>

          {total > 0 && (
            <button onClick={clearAlertQueue}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
              style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.20)', color: '#f87171' }}>
              <Trash2 className="w-3 h-3" /> Clear All
            </button>
          )}
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-white/[0.04] shrink-0"
        style={{ background: 'rgba(7,11,20,0.6)' }}>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search title, user, host, technique…"
            className="w-full h-8 bg-white/[0.04] border border-white/[0.07] rounded-lg pl-9 pr-3 text-[12px] text-slate-300 placeholder-slate-700 focus:outline-none focus:border-cyan-500/30"
          />
        </div>
        <div className="flex items-center gap-1 text-[11px] text-slate-600">
          <Filter className="w-3 h-3" />
          {filtered.length} of {total} alerts
        </div>
      </div>

      {/* ── Alert list ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex">

        {/* Main feed */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <AnimatePresence mode="popLayout">
            {filtered.length === 0 ? (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center h-full text-center py-20">
                {total === 0 ? (
                  <>
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                      style={{ background: 'rgba(0,229,255,0.07)', border: '1px solid rgba(0,229,255,0.15)' }}>
                      <Inbox className="w-7 h-7 text-cyan-800" />
                    </div>
                    <p className="text-slate-500 text-sm font-medium mb-1">Queue is empty</p>
                    <p className="text-slate-700 text-xs max-w-xs leading-relaxed mb-4">
                      Generate alerts in the Alert Generator tab — they'll appear here automatically.
                    </p>
                    <button onClick={() => setView('alert-gen')}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold"
                      style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.28)', color: '#fbbf24' }}>
                      <Zap className="w-3.5 h-3.5" /> Go to Alert Generator
                    </button>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-6 h-6 text-slate-600 mb-3" />
                    <p className="text-slate-500 text-sm">No alerts match the current filter</p>
                    <button onClick={() => { setFilterSev('ALL'); setFilterStatus('ALL'); setSearch('') }}
                      className="mt-3 text-[11px] text-cyan-600 hover:text-cyan-400 transition-colors">
                      Clear filters
                    </button>
                  </>
                )}
              </motion.div>
            ) : (
              filtered.map(item => <TriageCard key={item.id} item={item} />)
            )}
          </AnimatePresence>
        </div>

        {/* Right mini-stats panel */}
        {total > 0 && (
          <div className="w-48 shrink-0 border-l border-white/[0.05] px-4 py-5 overflow-y-auto"
            style={{ background: 'rgba(7,11,20,0.5)' }}>

            <div className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold mb-3">
              <BarChart3 className="inline w-3 h-3 mr-1" />By Severity
            </div>
            {SEV_ORDER.filter(s => bySev[s]).map(s => {
              const m = SEV_META[s]
              const pct = Math.round((bySev[s] / total) * 100)
              return (
                <div key={s} className="mb-2.5">
                  <div className="flex justify-between text-[10.5px] mb-1">
                    <span style={{ color: m.text }}>{s}</span>
                    <span className="text-slate-600 font-mono">{bySev[s]}</span>
                  </div>
                  <div className="w-full h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-1 rounded-full" style={{ width: `${pct}%`, background: m.dot }} />
                  </div>
                </div>
              )
            })}

            <div className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold mt-5 mb-3">
              <Clock className="inline w-3 h-3 mr-1" />By Status
            </div>
            {(Object.keys(STATUS_META) as AlertQueueItem['status'][]).filter(s => byStatus[s]).map(s => {
              const m = STATUS_META[s]
              return (
                <div key={s} className="flex justify-between text-[11px] mb-1.5">
                  <span style={{ color: m.color }}>{m.label}</span>
                  <span className="text-slate-600 font-mono">{byStatus[s]}</span>
                </div>
              )
            })}

            <div className="mt-5 pt-4 border-t border-white/[0.06]">
              <div className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold mb-2">
                <AlertTriangle className="inline w-3 h-3 mr-1" />Action Needed
              </div>
              <div className="text-2xl font-bold font-mono" style={{ color: '#f87171' }}>
                {(byStatus['new'] ?? 0)}
              </div>
              <div className="text-[10px] text-slate-600">unacknowledged</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
