import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Layers, Inbox, Brain, ShieldCheck, Database, ArrowRight,
  AlertTriangle, GitBranch, Send, Ticket, Sparkles, Search,
  Activity, Zap, ChevronRight, Boxes,
} from 'lucide-react'
import { useStore } from '../../lib/store'
import type { AlertQueueItem } from '../../lib/store'

// ── Severity palette (shared look with the rest of the SOC UI) ─────────────────
const SEV: Record<AlertQueueItem['severity'], { color: string; bg: string; border: string }> = {
  CRITICAL: { color:'#f87171', bg:'rgba(239,68,68,0.14)',  border:'rgba(239,68,68,0.45)'  },
  HIGH:     { color:'#fb923c', bg:'rgba(249,115,22,0.13)', border:'rgba(249,115,22,0.42)' },
  MEDIUM:   { color:'#fbbf24', bg:'rgba(234,179,8,0.12)',  border:'rgba(234,179,8,0.38)'  },
  LOW:      { color:'#34d399', bg:'rgba(52,211,153,0.11)', border:'rgba(52,211,153,0.34)' },
  INFO:     { color:'#94a3b8', bg:'rgba(100,116,139,0.10)',border:'rgba(100,116,139,0.30)'},
}

const STATUS_LABEL: Record<AlertQueueItem['status'], { label: string; color: string }> = {
  new:          { label:'New',          color:'#38bdf8' },
  acknowledged: { label:'Acknowledged', color:'#fbbf24' },
  dispatched:   { label:'Dispatched',   color:'#34d399' },
  dismissed:    { label:'Dismissed',    color:'#64748b' },
}

// ── Triage pipeline stages (scaffold — agent logic wires here next) ────────────
const STAGES: { id: string; label: string; icon: typeof Brain; desc: string; color: string }[] = [
  { id:'triage',    label:'Triage',      icon:Search,       desc:'Deduplicate, prioritize, assign incident #', color:'#38bdf8' },
  { id:'enrich',    label:'Enrich',      icon:Database,     desc:'GeoIP, asset criticality, reputation, IOCs', color:'#a78bfa' },
  { id:'score',     label:'Score',       icon:Activity,     desc:'TP/FP + risk + confidence banding',          color:'#fbbf24' },
  { id:'decide',    label:'Decide',      icon:Brain,        desc:'Verdict + recommended action (HITL gate)',   color:'#34d399' },
]

// ── Feature-mapping targets (scaffold — each hooks an existing subsystem) ───────
const MAP_TARGETS: { id: string; label: string; icon: typeof GitBranch; hint: string; color: string }[] = [
  { id:'playbooks', label:'Response Playbooks', icon:GitBranch,  hint:'Match alert type → SOAR playbook',        color:'#fbbf24' },
  { id:'soar',      label:'SOAR Dispatch',      icon:Send,       hint:'Execute / export the mapped playbook',    color:'#00e5ff' },
  { id:'kb',        label:'Industry KB',        icon:Boxes,      hint:'Ground triage in the sector baseline',     color:'#34d399' },
  { id:'itsm',      label:'ITSM Ticket',        icon:Ticket,     hint:'Open the incident system-of-record',       color:'#a78bfa' },
]

interface Props {
  onClose: () => void
}

export default function AgenticTriageLayer({ onClose }: Props) {
  const alertQueue = useStore(s => s.alertQueue)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = useMemo(
    () => alertQueue.find(a => a.id === selectedId) ?? null,
    [alertQueue, selectedId],
  )

  const sevCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const a of alertQueue) c[a.severity] = (c[a.severity] ?? 0) + 1
    return c
  }, [alertQueue])

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'rgba(4,7,14,0.86)', backdropFilter: 'blur(10px)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-6 py-4 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(8,12,22,0.9)' }}>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'rgba(0,229,255,0.10)', border: '1px solid rgba(0,229,255,0.28)' }}>
          <Layers className="w-4.5 h-4.5" style={{ color: '#00e5ff', width: 18, height: 18 }} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-white">Agentic Triage Layer</h1>
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.30)', color: '#fbbf24' }}>
              Scaffold
            </span>
          </div>
          <p className="text-[11.5px] text-slate-400 leading-tight mt-0.5">
            Alerts flow in → agents triage, enrich &amp; score → outcomes map to playbooks, SOAR &amp; the KB.
          </p>
        </div>

        {/* Live queue stats */}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <Inbox className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[11px] font-mono text-slate-200 font-semibold">{alertQueue.length}</span>
            <span className="text-[10px] text-slate-500">in queue</span>
          </div>
          {(['CRITICAL','HIGH','MEDIUM','LOW'] as const).map(s => (
            sevCounts[s] ? (
              <div key={s} className="px-2 py-1 rounded-lg text-[10px] font-bold font-mono"
                style={{ background: SEV[s].bg, border: `1px solid ${SEV[s].border}`, color: SEV[s].color }}>
                {sevCounts[s]} {s[0]}
              </div>
            ) : null
          ))}
          <button onClick={onClose} title="Close triage layer"
            className="ml-1 w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-80"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: '#94a3b8' }}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Three-zone body ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(280px,1fr)_minmax(300px,1.1fr)_minmax(260px,0.9fr)] gap-px"
        style={{ background: 'rgba(255,255,255,0.06)' }}>

        {/* Zone 1 — Incoming Alerts (wired to the shared queue) */}
        <Zone title="Incoming Alerts" icon={Inbox} accent="#38bdf8"
          subtitle={`${alertQueue.length} from the shared queue`}>
          {alertQueue.length === 0 ? (
            <EmptyState icon={Inbox}
              title="No alerts yet"
              body="Generate alerts from the Alert Generator (or enable Auto) — they appear here for triage." />
          ) : (
            <div className="space-y-2">
              {alertQueue.map(a => {
                const sev = SEV[a.severity]
                const st  = STATUS_LABEL[a.status]
                const sel = a.id === selectedId
                return (
                  <button key={a.id} onClick={() => setSelectedId(sel ? null : a.id)}
                    className="w-full text-left rounded-lg p-3 transition-all"
                    style={{
                      background: sel ? 'rgba(0,229,255,0.06)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${sel ? 'rgba(0,229,255,0.35)' : 'rgba(255,255,255,0.07)'}`,
                    }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: sev.bg, border: `1px solid ${sev.border}`, color: sev.color }}>
                        {a.severity}
                      </span>
                      <span className="text-[9px] font-semibold shrink-0" style={{ color: st.color }}>● {st.label}</span>
                      <span className="ml-auto text-[9px] font-mono text-slate-600 truncate">{a.techniqueId}</span>
                    </div>
                    <div className="text-[12px] font-medium text-slate-200 leading-snug line-clamp-2">{a.title}</div>
                    <div className="flex items-center gap-2 mt-1.5 text-[9.5px] text-slate-500">
                      <span className="truncate">{a.tactic}</span>
                      <span>·</span>
                      <span className="font-mono truncate">{a.sourceHost || a.sourceIp || '—'}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </Zone>

        {/* Zone 2 — Agent Triage Pipeline (scaffold) */}
        <Zone title="Agent Triage Pipeline" icon={Brain} accent="#a78bfa"
          subtitle={selected ? 'Processing selected alert' : 'Select an alert to trace'}>
          {/* Selected alert banner */}
          <AnimatePresence mode="wait">
            {selected ? (
              <motion.div key={selected.id} initial={{ opacity:0, y:-4 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
                className="rounded-lg p-2.5 mb-3 flex items-center gap-2"
                style={{ background: SEV[selected.severity].bg, border: `1px solid ${SEV[selected.severity].border}` }}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: SEV[selected.severity].color }} />
                <span className="text-[11px] font-medium text-slate-100 truncate">{selected.title}</span>
              </motion.div>
            ) : (
              <div className="rounded-lg p-2.5 mb-3 text-[10.5px] text-slate-500 text-center"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.10)' }}>
                No alert selected
              </div>
            )}
          </AnimatePresence>

          {/* Stage rail */}
          <div className="space-y-2">
            {STAGES.map((stage, i) => {
              const Icon = stage.icon
              const live = !!selected
              return (
                <div key={stage.id}>
                  <div className="rounded-lg p-3 flex items-start gap-3 transition-all"
                    style={{
                      background: live ? `${stage.color}0d` : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${live ? `${stage.color}44` : 'rgba(255,255,255,0.07)'}`,
                    }}>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: `${stage.color}18`, border: `1px solid ${stage.color}40` }}>
                      <Icon className="w-3.5 h-3.5" style={{ color: stage.color }} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold text-slate-100">{stage.label}</span>
                        <span className="text-[8.5px] font-mono px-1 py-0.5 rounded text-slate-500"
                          style={{ background: 'rgba(255,255,255,0.04)' }}>agent</span>
                      </div>
                      <p className="text-[10px] text-slate-500 leading-snug mt-0.5">{stage.desc}</p>
                    </div>
                    <span className="ml-auto text-[8.5px] font-semibold uppercase tracking-wide shrink-0"
                      style={{ color: live ? stage.color : '#475569' }}>
                      {live ? 'ready' : 'idle'}
                    </span>
                  </div>
                  {i < STAGES.length - 1 && (
                    <div className="flex justify-center py-0.5">
                      <ChevronRight className="w-3.5 h-3.5 rotate-90" style={{ color: '#334155' }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <ScaffoldNote text="Wires to the Master Agent + specialist agents from Agentic SOC. Destructive verdicts pass through the human-in-the-loop approval gate." />
        </Zone>

        {/* Zone 3 — Mapped Actions / Knowledge (scaffold) */}
        <Zone title="Mapped Actions / KB" icon={ShieldCheck} accent="#34d399"
          subtitle="Where triage outcomes connect">
          <div className="space-y-2">
            {MAP_TARGETS.map(t => {
              const Icon = t.icon
              return (
                <div key={t.id} className="rounded-lg p-3 flex items-center gap-3 transition-all group cursor-default"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.12)' }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: `${t.color}14`, border: `1px solid ${t.color}33` }}>
                    <Icon className="w-4 h-4" style={{ color: t.color }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold text-slate-200">{t.label}</div>
                    <div className="text-[10px] text-slate-500 leading-snug mt-0.5">{t.hint}</div>
                  </div>
                  <span className="text-[9px] font-semibold px-2 py-1 rounded-md shrink-0"
                    style={{ background: `${t.color}12`, border: `1px solid ${t.color}30`, color: t.color }}>
                    Map →
                  </span>
                </div>
              )
            })}
          </div>
          <ScaffoldNote text="Each target hooks an existing subsystem — this is the seam where the triage layer maps into the rest of ATLAS." />
        </Zone>
      </div>

      {/* ── Flow footer ──────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-center gap-3 px-6 py-2.5 border-t text-[10.5px] font-medium"
        style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(8,12,22,0.9)', color: '#64748b' }}>
        <span className="flex items-center gap-1.5" style={{ color:'#38bdf8' }}><Inbox className="w-3 h-3" />Ingest</span>
        <ArrowRight className="w-3 h-3" />
        <span className="flex items-center gap-1.5" style={{ color:'#a78bfa' }}><Brain className="w-3 h-3" />Agentic Triage</span>
        <ArrowRight className="w-3 h-3" />
        <span className="flex items-center gap-1.5" style={{ color:'#34d399' }}><Zap className="w-3 h-3" />Map &amp; Act</span>
      </div>
    </motion.div>
  )
}

// ── Building blocks ─────────────────────────────────────────────────────────────
function Zone({ title, subtitle, icon: Icon, accent, children }: {
  title: string; subtitle: string; icon: typeof Inbox; accent: string; children: React.ReactNode
}) {
  return (
    <div className="flex flex-col min-h-0" style={{ background: 'rgba(6,10,18,0.96)' }}>
      <div className="shrink-0 px-4 py-3 border-b flex items-center gap-2"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
          style={{ background: `${accent}14`, border: `1px solid ${accent}33` }}>
          <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
        </div>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-slate-100 leading-none">{title}</div>
          <div className="text-[9.5px] text-slate-500 leading-none mt-1">{subtitle}</div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3">{children}</div>
    </div>
  )
}

function EmptyState({ icon: Icon, title, body }: { icon: typeof Inbox; title: string; body: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6 py-10">
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <Icon className="w-5 h-5 text-slate-500" />
      </div>
      <div className="text-[12.5px] font-semibold text-slate-300">{title}</div>
      <div className="text-[10.5px] text-slate-500 max-w-[220px] leading-relaxed">{body}</div>
    </div>
  )
}

function ScaffoldNote({ text }: { text: string }) {
  return (
    <div className="mt-3 rounded-lg p-2.5 flex items-start gap-2"
      style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.18)' }}>
      <Sparkles className="w-3 h-3 shrink-0 mt-0.5" style={{ color: '#fbbf24' }} />
      <span className="text-[9.5px] text-slate-400 leading-relaxed">{text}</span>
    </div>
  )
}
