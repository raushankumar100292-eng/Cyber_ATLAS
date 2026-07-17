import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Zap, GitBranch, Play, CheckCircle2, Clock, AlertTriangle,
  ArrowRight, Plus, Settings, Activity, Shield, RefreshCw,
  ChevronDown, ChevronRight, Code2, Database, Globe, Bell,
  Sparkles, Trash2, Eye,
} from 'lucide-react'
import PlaybookBuilder, { type GeneratedPlaybook } from './PlaybookBuilder'
import { useStore } from '../../lib/store'

const SAVED_PB_STORAGE = 'atlas_soar_generated'

type PlaybookStatus = 'active' | 'draft' | 'paused'
type RunStatus      = 'success' | 'running' | 'failed' | 'pending'

interface StaticPlaybook {
  id: string; name: string; trigger: string; steps: number
  status: PlaybookStatus; lastRun: string; successRate: number; category: string
}
interface Run {
  id: string; playbook: string; started: string; duration: string; status: RunStatus; trigger: string
}

const STATIC_PLAYBOOKS: StaticPlaybook[] = [
  { id:'pb1', name:'Phishing Email Response',       trigger:'Email Alert',       steps:8,  status:'active', lastRun:'2 min ago',  successRate:97,  category:'Email' },
  { id:'pb2', name:'Endpoint Isolation',            trigger:'EDR High Severity', steps:5,  status:'active', lastRun:'15 min ago', successRate:100, category:'Endpoint' },
  { id:'pb3', name:'Brute Force Lockout',           trigger:'SIEM Rule Match',   steps:4,  status:'active', lastRun:'1 hr ago',   successRate:94,  category:'Identity' },
  { id:'pb4', name:'Ransomware Containment',        trigger:'Manual Trigger',    steps:12, status:'draft',  lastRun:'Never',      successRate:0,   category:'Endpoint' },
  { id:'pb5', name:'IOC Enrichment & Block',        trigger:'Threat Intel Feed', steps:6,  status:'active', lastRun:'5 min ago',  successRate:99,  category:'Threat Intel' },
  { id:'pb6', name:'Vulnerability Ticket Creation', trigger:'Scanner Alert',     steps:3,  status:'paused', lastRun:'3 days ago', successRate:88,  category:'Vuln Mgmt' },
]

const RECENT_RUNS: Run[] = [
  { id:'r1', playbook:'IOC Enrichment & Block',  started:'10:42 AM', duration:'4s',  status:'success', trigger:'Threat Intel Feed' },
  { id:'r2', playbook:'Phishing Email Response', started:'10:40 AM', duration:'18s', status:'success', trigger:'Email Alert' },
  { id:'r3', playbook:'Brute Force Lockout',     started:'10:31 AM', duration:'7s',  status:'running', trigger:'SIEM Rule Match' },
  { id:'r4', playbook:'Endpoint Isolation',      started:'10:28 AM', duration:'11s', status:'success', trigger:'EDR High Severity' },
  { id:'r5', playbook:'Phishing Email Response', started:'10:15 AM', duration:'—',   status:'failed',  trigger:'Email Alert' },
  { id:'r6', playbook:'IOC Enrichment & Block',  started:'09:58 AM', duration:'3s',  status:'success', trigger:'Threat Intel Feed' },
]

const STAT_CARDS = [
  { label:'Active Playbooks', value:'4',   sub:'of 6 total',         icon:GitBranch,    color:'#00e5ff', bg:'rgba(0,229,255,0.08)',    border:'rgba(0,229,255,0.20)' },
  { label:'Runs Today',       value:'127', sub:'+14% vs yesterday',   icon:Play,         color:'#34d399', bg:'rgba(52,211,153,0.08)',   border:'rgba(52,211,153,0.20)' },
  { label:'Avg Response',     value:'8s',  sub:'mean automation time',icon:Clock,        color:'#818cf8', bg:'rgba(129,140,248,0.08)', border:'rgba(129,140,248,0.20)' },
  { label:'Success Rate',     value:'96%', sub:'last 30 days',        icon:CheckCircle2, color:'#fbbf24', bg:'rgba(251,191,36,0.08)',  border:'rgba(251,191,36,0.20)' },
]

const INTEGRATION_ICONS: { label:string; icon:typeof Globe; color:string }[] = [
  { label:'SIEM',         icon:Database, color:'#00e5ff' },
  { label:'EDR',          icon:Shield,   color:'#f87171' },
  { label:'Threat Intel', icon:Globe,    color:'#818cf8' },
  { label:'Ticketing',    icon:Bell,     color:'#fbbf24' },
  { label:'Firewall',     icon:Settings, color:'#34d399' },
  { label:'Identity',     icon:Activity, color:'#e879f9' },
]

const STATUS_STYLE: Record<PlaybookStatus,{color:string;bg:string;border:string;label:string}> = {
  active: { color:'#34d399', bg:'rgba(52,211,153,0.10)',  border:'rgba(52,211,153,0.25)',  label:'Active' },
  draft:  { color:'#94a3b8', bg:'rgba(148,163,184,0.08)', border:'rgba(148,163,184,0.20)', label:'Draft' },
  paused: { color:'#fbbf24', bg:'rgba(251,191,36,0.10)',  border:'rgba(251,191,36,0.25)',  label:'Paused' },
}
const RUN_STYLE: Record<RunStatus,{color:string;bg:string;icon:typeof CheckCircle2;label:string}> = {
  success: { color:'#34d399', bg:'rgba(52,211,153,0.10)',  icon:CheckCircle2,  label:'Success' },
  running: { color:'#818cf8', bg:'rgba(129,140,248,0.10)', icon:RefreshCw,     label:'Running' },
  failed:  { color:'#f87171', bg:'rgba(248,113,113,0.10)', icon:AlertTriangle, label:'Failed'  },
  pending: { color:'#94a3b8', bg:'rgba(148,163,184,0.08)', icon:Clock,         label:'Pending' },
}

function loadSaved(): GeneratedPlaybook[] {
  try { return JSON.parse(localStorage.getItem(SAVED_PB_STORAGE) ?? '[]') }
  catch { return [] }
}

export default function SoarView() {
  const [selectedPlaybook, setSelectedPlaybook] = useState<string|null>(null)
  const [expandedCategory, setExpandedCategory] = useState<string|null>('Email')
  const [activeTab, setActiveTab]               = useState<'playbooks'|'runs'|'integrations'>('playbooks')
  const [showBuilder, setShowBuilder]           = useState(false)
  const [viewingFlow, setViewingFlow]           = useState<GeneratedPlaybook|null>(null)

  const apiKey = useStore(s => s.apiKey)

  const [generatedPlaybooks, setGeneratedPlaybooks] = useState<GeneratedPlaybook[]>(loadSaved)

  function handleGenerated(pb: GeneratedPlaybook) {
    setGeneratedPlaybooks(prev => {
      const next = [pb, ...prev]
      localStorage.setItem(SAVED_PB_STORAGE, JSON.stringify(next))
      return next
    })
    setShowBuilder(false)
    setActiveTab('playbooks')       // switch to playbooks tab to see it
    setExpandedCategory('AI Generated')
  }

  function deleteGenerated(id: string) {
    setGeneratedPlaybooks(prev => {
      const next = prev.filter(p => p.id !== id)
      localStorage.setItem(SAVED_PB_STORAGE, JSON.stringify(next))
      return next
    })
  }

  const staticCategories = [...new Set(STATIC_PLAYBOOKS.map(p => p.category))]

  return (
    <div className="h-full overflow-y-auto">
      <AnimatePresence>
        {(showBuilder || viewingFlow) && (
          <PlaybookBuilder
            apiKey={apiKey}
            onClose={() => { setShowBuilder(false); setViewingFlow(null) }}
            onGenerated={handleGenerated}
          />
        )}
      </AnimatePresence>

      <div className="max-w-6xl mx-auto px-8 py-10">

        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background:'rgba(251,191,36,0.10)', border:'1px solid rgba(251,191,36,0.25)' }}>
                <Zap className="w-4 h-4 text-amber-400" />
              </div>
              <h1 className="text-xl font-semibold text-white">SOAR Engineer</h1>
              <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
                style={{ background:'rgba(52,211,153,0.10)', border:'1px solid rgba(52,211,153,0.25)', color:'#34d399' }}>
                Live
              </span>
            </div>
            <p className="text-sm text-slate-500 ml-11">
              Security Orchestration, Automation &amp; Response — manage playbooks, monitor runs, and configure integrations.
            </p>
          </div>
          <button onClick={() => setShowBuilder(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all mt-1 hover:opacity-80"
            style={{ background:'rgba(251,191,36,0.10)', border:'1px solid rgba(251,191,36,0.25)', color:'#fbbf24' }}>
            <Plus className="w-4 h-4" />New Playbook
          </button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {STAT_CARDS.map(({ label, value, sub, icon: Icon, color, bg, border }) => (
            <div key={label} className="rounded-xl border px-4 py-4" style={{ borderColor:border, background:bg }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color, opacity:0.7 }}>{label}</span>
                <Icon className="w-4 h-4" style={{ color, opacity:0.5 }} />
              </div>
              <div className="text-2xl font-bold font-mono" style={{ color }}>{value}</div>
              <div className="text-[11px] text-slate-600 mt-1">{sub}</div>
            </div>
          ))}
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 border-b border-white/[0.06]">
          {(['playbooks','runs','integrations'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="px-4 py-2.5 text-xs font-semibold capitalize transition-all border-b-2 -mb-px"
              style={{
                borderBottomColor: activeTab === tab ? '#fbbf24' : 'transparent',
                color:   activeTab === tab ? '#fbbf24' : '#64748b',
                background: activeTab === tab ? 'rgba(251,191,36,0.04)' : 'transparent',
              }}>
              {tab === 'playbooks'    && <><GitBranch className="w-3.5 h-3.5 inline mr-1.5" />Playbooks</>}
              {tab === 'runs'         && <><Activity   className="w-3.5 h-3.5 inline mr-1.5" />Recent Runs</>}
              {tab === 'integrations' && <><Settings   className="w-3.5 h-3.5 inline mr-1.5" />Integrations</>}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">

          {/* ── Playbooks tab ─────────────────────────────────────────────── */}
          {activeTab === 'playbooks' && (
            <motion.div key="playbooks" initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }} className="space-y-3">

              {/* ── AI Generated section ─────────────────────────────────── */}
              {generatedPlaybooks.length > 0 && (
                <div className="rounded-xl border overflow-hidden"
                  style={{ borderColor:'rgba(251,191,36,0.25)', background:'rgba(251,191,36,0.02)' }}>
                  {/* section header */}
                  <button
                    onClick={() => setExpandedCategory(expandedCategory === 'AI Generated' ? null : 'AI Generated')}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]">
                    {expandedCategory === 'AI Generated'
                      ? <ChevronDown className="w-4 h-4 text-amber-400" />
                      : <ChevronRight className="w-4 h-4 text-amber-400" />}
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-sm font-semibold text-amber-300">AI Generated</span>
                    <span className="text-[11px] font-mono text-slate-500 ml-1">
                      {generatedPlaybooks.length} playbook{generatedPlaybooks.length !== 1 ? 's' : ''}
                    </span>
                    <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full font-semibold"
                      style={{ background:'rgba(251,191,36,0.10)', border:'1px solid rgba(251,191,36,0.20)', color:'#fbbf24' }}>
                      New
                    </span>
                  </button>

                  <AnimatePresence>
                    {expandedCategory === 'AI Generated' && (
                      <motion.div initial={{ height:0 }} animate={{ height:'auto' }}
                        exit={{ height:0 }} className="overflow-hidden border-t border-white/[0.06]">
                        {generatedPlaybooks.map(pb => (
                          <div key={pb.id}
                            className="px-5 py-4 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors">
                            <div className="flex items-center gap-3">
                              {/* Icon */}
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                                style={{ background:'rgba(251,191,36,0.10)', border:'1px solid rgba(251,191,36,0.20)' }}>
                                <Sparkles className="w-4 h-4 text-amber-400" />
                              </div>

                              {/* Info */}
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-slate-200">{pb.name}</div>
                                <div className="text-[11px] text-slate-600 mt-0.5 flex items-center gap-2 flex-wrap">
                                  <span className="font-mono">{pb.nodeCount} steps</span>
                                  <span>·</span>
                                  <span>Trigger: <span className="text-slate-500">{pb.trigger}</span></span>
                                  <span>·</span>
                                  <span className="text-slate-700">Generated {pb.createdAt}</span>
                                </div>
                              </div>

                              {/* Actions */}
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                                  style={{ background:'rgba(251,191,36,0.10)', border:'1px solid rgba(251,191,36,0.25)', color:'#fbbf24' }}>
                                  AI
                                </span>
                                <button
                                  onClick={() => setViewingFlow(pb)}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
                                  style={{ background:'rgba(0,229,255,0.08)', border:'1px solid rgba(0,229,255,0.20)', color:'#00e5ff' }}>
                                  <Eye className="w-3 h-3" />View
                                </button>
                                <button
                                  onClick={() => deleteGenerated(pb.id)}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all hover:opacity-80"
                                  style={{ background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.20)', color:'#f87171' }}>
                                  <Trash2 className="w-3 h-3" />Delete
                                </button>
                              </div>
                            </div>

                            {/* Description */}
                            {pb.description && (
                              <p className="text-[11px] text-slate-600 mt-2 ml-11 leading-relaxed line-clamp-2">
                                {pb.description}
                              </p>
                            )}
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* ── Static playbook categories ───────────────────────────── */}
              {staticCategories.map(cat => {
                const items = STATIC_PLAYBOOKS.filter(p => p.category === cat)
                const open  = expandedCategory === cat
                return (
                  <div key={cat} className="rounded-xl border border-white/[0.08] overflow-hidden">
                    <button onClick={() => setExpandedCategory(open ? null : cat)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors">
                      {open ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                      <span className="text-sm font-semibold text-slate-300">{cat}</span>
                      <span className="text-[11px] font-mono text-slate-600">{items.length} playbook{items.length !== 1 ? 's' : ''}</span>
                      <span className="ml-auto text-[11px] text-slate-700">{items.filter(p => p.status==='active').length} active</span>
                    </button>

                    <AnimatePresence>
                      {open && (
                        <motion.div initial={{ height:0 }} animate={{ height:'auto' }}
                          exit={{ height:0 }} className="overflow-hidden border-t border-white/[0.06]">
                          {items.map(pb => {
                            const s = STATUS_STYLE[pb.status]
                            const isSel = selectedPlaybook === pb.id
                            return (
                              <div key={pb.id}
                                className={`px-5 py-4 border-b border-white/[0.04] last:border-0 cursor-pointer transition-colors ${isSel?'bg-white/[0.04]':'hover:bg-white/[0.02]'}`}
                                onClick={() => setSelectedPlaybook(isSel ? null : pb.id)}>
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                                    style={{ background:'rgba(251,191,36,0.08)', border:'1px solid rgba(251,191,36,0.15)' }}>
                                    <GitBranch className="w-4 h-4 text-amber-400" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-slate-200">{pb.name}</div>
                                    <div className="text-[11px] text-slate-600 mt-0.5 flex items-center gap-2">
                                      <span className="font-mono">{pb.steps} steps</span>
                                      <span>·</span>
                                      <span>Trigger: <span className="text-slate-500">{pb.trigger}</span></span>
                                      <span>·</span>
                                      <span>Last run: <span className="text-slate-500">{pb.lastRun}</span></span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-3 shrink-0">
                                    {pb.status === 'active' && (
                                      <div className="text-[11px] font-mono" style={{ color:'#34d399' }}>{pb.successRate}% success</div>
                                    )}
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                                      style={{ background:s.bg, border:`1px solid ${s.border}`, color:s.color }}>{s.label}</span>
                                    <button className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
                                      style={{ background:'rgba(0,229,255,0.08)', border:'1px solid rgba(0,229,255,0.20)', color:'#00e5ff' }}
                                      onClick={e => e.stopPropagation()}>
                                      <Play className="w-2.5 h-2.5" />Run
                                    </button>
                                  </div>
                                </div>

                                <AnimatePresence>
                                  {isSel && (
                                    <motion.div initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }}
                                      exit={{ opacity:0, height:0 }} className="mt-4 overflow-hidden">
                                      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                                        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-3">Playbook Steps</div>
                                        <div className="flex items-center flex-wrap">
                                          {Array.from({ length: pb.steps }, (_, idx) => (
                                            <div key={idx} className="flex items-center">
                                              <div className="flex flex-col items-center gap-1">
                                                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold font-mono"
                                                  style={{ background:'rgba(251,191,36,0.10)', border:'1px solid rgba(251,191,36,0.20)', color:'#fbbf24' }}>
                                                  {idx+1}
                                                </div>
                                                <span className="text-[9px] text-slate-700 whitespace-nowrap">
                                                  {['Ingest','Parse','Enrich','Correlate','Score','Block','Notify','Ticket','Close','Report','Verify','Archive'][idx] ?? `Step ${idx+1}`}
                                                </span>
                                              </div>
                                              {idx < pb.steps-1 && <ArrowRight className="w-3 h-3 text-slate-700 mx-1" />}
                                            </div>
                                          ))}
                                        </div>
                                        <div className="flex gap-2 mt-4">
                                          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                                            style={{ background:'rgba(129,140,248,0.10)', border:'1px solid rgba(129,140,248,0.25)', color:'#818cf8' }}>
                                            <Code2 className="w-3 h-3" />Edit YAML
                                          </button>
                                          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                                            style={{ background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.20)', color:'#f87171' }}>
                                            <Settings className="w-3 h-3" />Configure
                                          </button>
                                        </div>
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            )
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </motion.div>
          )}

          {/* ── Recent Runs tab ───────────────────────────────────────────── */}
          {activeTab === 'runs' && (
            <motion.div key="runs" initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}>
              <div className="rounded-xl border border-white/[0.08] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">Execution Log</span>
                  <span className="ml-auto text-[10px] font-mono text-slate-600">Today · {RECENT_RUNS.length} entries</span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06]">
                      {['Status','Playbook','Trigger','Started','Duration'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {RECENT_RUNS.map(run => {
                      const rs   = RUN_STYLE[run.status]
                      const Icon = rs.icon
                      return (
                        <tr key={run.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-1.5 w-fit px-2 py-0.5 rounded-full text-[11px] font-semibold"
                              style={{ background:rs.bg, color:rs.color }}>
                              <Icon className={`w-3 h-3 ${run.status==='running'?'animate-spin':''}`} />{rs.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-200 font-medium">{run.playbook}</td>
                          <td className="px-4 py-3 text-slate-500 text-[12px]">{run.trigger}</td>
                          <td className="px-4 py-3 text-slate-500 font-mono text-[12px]">{run.started}</td>
                          <td className="px-4 py-3 text-slate-500 font-mono text-[12px]">{run.duration}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}

          {/* ── Integrations tab ─────────────────────────────────────────── */}
          {activeTab === 'integrations' && (
            <motion.div key="integrations" initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}>
              <div className="grid grid-cols-3 gap-4">
                {INTEGRATION_ICONS.map(({ label, icon: Icon, color }) => (
                  <div key={label} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 flex items-center gap-4 hover:bg-white/[0.04] transition-colors cursor-pointer group">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background:`${color}15`, border:`1px solid ${color}30` }}>
                      <Icon className="w-5 h-5" style={{ color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-200">{label}</div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                        <span className="text-[11px] text-slate-600">Connected</span>
                      </div>
                    </div>
                    <Settings className="w-4 h-4 text-slate-700 group-hover:text-slate-500 transition-colors" />
                  </div>
                ))}
                <div className="rounded-xl border border-dashed border-white/[0.08] p-5 flex items-center gap-4 hover:bg-white/[0.02] transition-colors cursor-pointer">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-dashed border-white/[0.12]">
                    <Plus className="w-5 h-5 text-slate-600" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-500">Add Integration</div>
                    <div className="text-[11px] text-slate-700 mt-0.5">Connect a new tool</div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}
