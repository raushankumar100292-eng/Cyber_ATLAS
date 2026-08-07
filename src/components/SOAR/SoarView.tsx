import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Zap, GitBranch, Play, CheckCircle2, Clock, AlertTriangle,
  ArrowRight, Plus, Settings, Activity, Shield, RefreshCw,
  Database, Globe, Bell, Sparkles, Trash2, Eye, FileText,
  User, Cpu, ShieldCheck, History, LayoutGrid, Tag as TagIcon,
} from 'lucide-react'
import PlaybookBuilder, { type GeneratedPlaybook } from './PlaybookBuilder'
import { useStore } from '../../lib/store'
import {
  fetchPlaybooks, savePlaybook, deletePlaybook, touchPlaybook,
  fetchTokenSummary,
  type PlaybookRecord, type PlaybookRecStatus, type TokenSummary,
} from '../../lib/socDb'
import type { PlaybookFlow, FlowNode } from '../../lib/groq'

const SAVED_PB_STORAGE = 'atlas_soar_generated'

type RunStatus = 'success' | 'running' | 'failed' | 'pending'
interface Run { id: string; playbook: string; started: string; duration: string; status: RunStatus; trigger: string }

// ── Recent Runs / Integrations remain demo data (addressed in SOAR-0 track) ────
const RECENT_RUNS: Run[] = [
  { id:'r1', playbook:'IOC Enrichment & Block',  started:'10:42 AM', duration:'4s',  status:'success', trigger:'Threat Intel Feed' },
  { id:'r2', playbook:'Phishing Email Response', started:'10:40 AM', duration:'18s', status:'success', trigger:'Email Alert' },
  { id:'r3', playbook:'Brute Force Lockout',     started:'10:31 AM', duration:'7s',  status:'running', trigger:'SIEM Rule Match' },
  { id:'r4', playbook:'Endpoint Isolation',      started:'10:28 AM', duration:'11s', status:'success', trigger:'EDR High Severity' },
  { id:'r5', playbook:'Phishing Email Response', started:'10:15 AM', duration:'—',   status:'failed',  trigger:'Email Alert' },
  { id:'r6', playbook:'IOC Enrichment & Block',  started:'09:58 AM', duration:'3s',  status:'success', trigger:'Threat Intel Feed' },
]

const INTEGRATION_ICONS: { label:string; icon:typeof Globe; color:string }[] = [
  { label:'SIEM',         icon:Database, color:'#00e5ff' },
  { label:'EDR',          icon:Shield,   color:'#f87171' },
  { label:'Threat Intel', icon:Globe,    color:'#818cf8' },
  { label:'Ticketing',    icon:Bell,     color:'#fbbf24' },
  { label:'Firewall',     icon:Settings, color:'#34d399' },
  { label:'Identity',     icon:Activity, color:'#e879f9' },
]

const RUN_STYLE: Record<RunStatus,{color:string;bg:string;icon:typeof CheckCircle2;label:string}> = {
  success: { color:'#34d399', bg:'rgba(52,211,153,0.10)',  icon:CheckCircle2,  label:'Success' },
  running: { color:'#818cf8', bg:'rgba(129,140,248,0.10)', icon:RefreshCw,     label:'Running' },
  failed:  { color:'#f87171', bg:'rgba(248,113,113,0.10)', icon:AlertTriangle, label:'Failed'  },
  pending: { color:'#94a3b8', bg:'rgba(148,163,184,0.08)', icon:Clock,         label:'Pending' },
}

// ── Playbook status → style ────────────────────────────────────────────────────
const REC_STATUS: Record<PlaybookRecStatus,{label:string;color:string;bg:string;border:string}> = {
  draft:    { label:'Draft',    color:'#94a3b8', bg:'rgba(148,163,184,0.10)', border:'rgba(148,163,184,0.28)' },
  active:   { label:'Active',   color:'#34d399', bg:'rgba(52,211,153,0.12)',  border:'rgba(52,211,153,0.32)' },
  approved: { label:'Approved', color:'#00e5ff', bg:'rgba(0,229,255,0.12)',   border:'rgba(0,229,255,0.32)' },
  paused:   { label:'Paused',   color:'#fbbf24', bg:'rgba(251,191,36,0.12)',  border:'rgba(251,191,36,0.32)' },
  archived: { label:'Archived', color:'#64748b', bg:'rgba(100,116,139,0.10)', border:'rgba(100,116,139,0.25)' },
}

// Source-driven accent (Manual vs AI-generated) — the two card "types".
const SOURCE_META = {
  manual: { label:'Manual',       icon:FileText, color:'#38bdf8', bg:'rgba(56,189,248,0.10)',  border:'rgba(56,189,248,0.28)' },
  ai:     { label:'AI Generated', icon:Sparkles, color:'#fbbf24', bg:'rgba(251,191,36,0.10)',  border:'rgba(251,191,36,0.28)' },
} as const

type Category = 'all' | 'manual' | 'ai' | 'approved' | 'recent'
const CATEGORIES: { id:Category; label:string; icon:typeof LayoutGrid }[] = [
  { id:'all',      label:'All Playbooks',    icon:LayoutGrid },
  { id:'manual',   label:'Manual',           icon:FileText },
  { id:'ai',       label:'AI-Generated',     icon:Sparkles },
  { id:'approved', label:'Approved',         icon:ShieldCheck },
  { id:'recent',   label:'Recently Used',    icon:History },
]

// ── Helpers ────────────────────────────────────────────────────────────────────
function timeAgo(ms: number): string {
  if (!ms) return '—'
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ms).toLocaleDateString()
}
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}
const STATUS_LIST: PlaybookRecStatus[] = ['draft','active','approved','paused','archived']

function normalizeRecord(r: Partial<PlaybookRecord> & Record<string, unknown>): PlaybookRecord {
  const flow = (r.flow as PlaybookFlow) ?? { name: String(r.name ?? ''), description:'', trigger: String(r.trigger ?? ''), nodes: [], edges: [] }
  return {
    id:           String(r.id ?? `pb-${Math.random().toString(36).slice(2)}`),
    name:         String(r.name ?? 'Untitled Playbook'),
    source:       r.source === 'ai' ? 'ai' : 'manual',
    status:       STATUS_LIST.includes(r.status as PlaybookRecStatus) ? (r.status as PlaybookRecStatus) : 'draft',
    version:      typeof r.version === 'number' ? r.version : 1,
    useCase:      String(r.useCase ?? r.trigger ?? ''),
    tags:         Array.isArray(r.tags) ? (r.tags as string[]) : [],
    createdBy:    String(r.createdBy ?? 'You'),
    description:  String(r.description ?? ''),
    trigger:      String(r.trigger ?? ''),
    nodeCount:    typeof r.nodeCount === 'number' ? r.nodeCount : (flow.nodes?.length ?? 0),
    flow,
    contentHash:  String(r.contentHash ?? ''),
    createdAtMs:  typeof r.createdAtMs === 'number' ? r.createdAtMs : Date.now(),
    updatedAtMs:  typeof r.updatedAtMs === 'number' ? r.updatedAtMs : (typeof r.createdAtMs === 'number' ? r.createdAtMs : Date.now()),
    lastUsedAtMs: typeof r.lastUsedAtMs === 'number' ? r.lastUsedAtMs : 0,
  }
}

// Small demo flow so built-in starter playbooks render a real diagram on View.
function demoFlow(name: string, trigger: string, steps: { label:string; type:FlowNode['type']; tool:string }[]): PlaybookFlow {
  const mid = steps.map((s, i) => ({ id:`n${i+2}`, type:s.type, label:s.label, description:`${s.label} step`, tool:s.tool }))
  const nodes: FlowNode[] = [
    { id:'n1', type:'trigger', label:trigger, description:'Playbook trigger', tool:'SIEM' },
    ...mid,
    { id:`n${steps.length+2}`, type:'end', label:'Close Case', description:'Resolve and document', tool:'ServiceNow' },
  ]
  const edges = nodes.slice(0, -1).map((n, i) => ({ id:`e${i+1}`, from:n.id, to:nodes[i+1].id }))
  return { name, description:`${name} — automated response playbook.`, trigger, nodes, edges }
}

const DAY = 86_400_000
// Starter library — seeded once on first run so all four categories are populated.
// Demonstrates both card types (Manual + AI Generated) and every status.
const BUILTINS: PlaybookRecord[] = [
  { id:'builtin-pb1', name:'Phishing Email Response', source:'manual', status:'active', version:3,
    useCase:'Phishing / BEC', tags:['Email','VirusTotal','Slack'], createdBy:'SOC Team',
    description:'Detonate attachments, extract & enrich IOCs, quarantine mailbox, and notify the SOC on a suspected phishing email.',
    trigger:'Email Alert', nodeCount:8, contentHash:'', createdAtMs:Date.now()-30*DAY, updatedAtMs:Date.now()-2*DAY, lastUsedAtMs:Date.now()-2*3600_000,
    flow:demoFlow('Phishing Email Response','Email Alert',[
      {label:'Extract IOCs',type:'action',tool:'Parser'},{label:'Enrich',type:'action',tool:'VirusTotal'},
      {label:'Is Malicious?',type:'condition',tool:'ThreatIntel'},{label:'Quarantine Mailbox',type:'action',tool:'O365'},
      {label:'Notify SOC',type:'notification',tool:'Slack'}]) },
  { id:'builtin-pb2', name:'Endpoint Isolation', source:'manual', status:'approved', version:2,
    useCase:'Malware / Ransomware', tags:['EDR','Firewall'], createdBy:'SOC Team',
    description:'Contain a high-severity EDR detection by isolating the host, killing the process, and opening an incident ticket.',
    trigger:'EDR High Severity', nodeCount:5, contentHash:'', createdAtMs:Date.now()-22*DAY, updatedAtMs:Date.now()-10*DAY, lastUsedAtMs:0,
    flow:demoFlow('Endpoint Isolation','EDR High Severity',[
      {label:'Isolate Host',type:'action',tool:'EDR'},{label:'Kill Process',type:'action',tool:'EDR'},
      {label:'Open Ticket',type:'action',tool:'ServiceNow'}]) },
  { id:'builtin-pb3', name:'Brute Force Lockout', source:'ai', status:'active', version:1,
    useCase:'Credential Access', tags:['Okta','SIEM'], createdBy:'AI Agent',
    description:'Auto-authored from repeated failed-login clusters: lock the account, force MFA re-enrollment, and alert identity team.',
    trigger:'SIEM Rule Match', nodeCount:6, contentHash:'', createdAtMs:Date.now()-9*DAY, updatedAtMs:Date.now()-1*DAY, lastUsedAtMs:Date.now()-40*60_000,
    flow:demoFlow('Brute Force Lockout','SIEM Rule Match',[
      {label:'Correlate Logins',type:'action',tool:'SIEM'},{label:'Over Threshold?',type:'condition',tool:'SIEM'},
      {label:'Lock Account',type:'action',tool:'Okta'},{label:'Notify Identity',type:'notification',tool:'Teams'}]) },
  { id:'builtin-pb4', name:'Ransomware Containment', source:'manual', status:'draft', version:1,
    useCase:'Impact / Destruction', tags:['EDR','Backup','Firewall'], createdBy:'You',
    description:'Draft: network-segment the host, snapshot for forensics, disable shares, and trigger backup verification.',
    trigger:'Manual Trigger', nodeCount:9, contentHash:'', createdAtMs:Date.now()-3*DAY, updatedAtMs:Date.now()-3*DAY, lastUsedAtMs:0,
    flow:demoFlow('Ransomware Containment','Manual Trigger',[
      {label:'Segment Host',type:'action',tool:'Firewall'},{label:'Snapshot',type:'action',tool:'EDR'},
      {label:'Disable Shares',type:'action',tool:'AD'},{label:'Verify Backups',type:'action',tool:'Backup'}]) },
  { id:'builtin-pb5', name:'IOC Enrichment & Block', source:'ai', status:'approved', version:4,
    useCase:'Threat Intel', tags:['MISP','Firewall','AbuseIPDB'], createdBy:'AI Agent',
    description:'Auto-authored enrichment loop: score indicators against intel feeds and push confirmed-malicious IOCs to the firewall.',
    trigger:'Threat Intel Feed', nodeCount:6, contentHash:'', createdAtMs:Date.now()-18*DAY, updatedAtMs:Date.now()-4*3600_000, lastUsedAtMs:Date.now()-5*60_000,
    flow:demoFlow('IOC Enrichment & Block','Threat Intel Feed',[
      {label:'Enrich Indicator',type:'action',tool:'MISP'},{label:'Confirmed Bad?',type:'condition',tool:'AbuseIPDB'},
      {label:'Block at Firewall',type:'action',tool:'Firewall'},{label:'Log Verdict',type:'notification',tool:'SIEM'}]) },
  { id:'builtin-pb6', name:'Vulnerability Ticket Creation', source:'manual', status:'paused', version:1,
    useCase:'Vuln Mgmt', tags:['Jira','Scanner'], createdBy:'SOC Team',
    description:'Open and route a remediation ticket when the scanner reports a new critical vulnerability on a production asset.',
    trigger:'Scanner Alert', nodeCount:3, contentHash:'', createdAtMs:Date.now()-40*DAY, updatedAtMs:Date.now()-15*DAY, lastUsedAtMs:0,
    flow:demoFlow('Vulnerability Ticket Creation','Scanner Alert',[
      {label:'Assess Severity',type:'condition',tool:'Scanner'},{label:'Create Ticket',type:'action',tool:'Jira'}]) },
]

function loadLocal(): PlaybookRecord[] {
  const raw = localStorage.getItem(SAVED_PB_STORAGE)
  if (raw == null) {           // first run — seed starter library
    try { localStorage.setItem(SAVED_PB_STORAGE, JSON.stringify(BUILTINS)) } catch { /* ignore */ }
    return BUILTINS
  }
  try {
    const arr = JSON.parse(raw) as unknown[]
    return arr.map(r => normalizeRecord(r as Record<string, unknown>))
  } catch { return [] }
}
function persistLocal(list: PlaybookRecord[]): void {
  try { localStorage.setItem(SAVED_PB_STORAGE, JSON.stringify(list)) } catch { /* ignore */ }
}
function mergeById(base: PlaybookRecord[], incoming: PlaybookRecord[]): PlaybookRecord[] {
  const map = new Map(base.map(p => [p.id, p]))
  for (const p of incoming) map.set(p.id, p)   // incoming (DB) wins
  return Array.from(map.values())
}

// ── Playbook card ──────────────────────────────────────────────────────────────
function PlaybookCard({ pb, onView, onApprove, onRun, onDelete }: {
  pb: PlaybookRecord
  onView: (pb: PlaybookRecord) => void
  onApprove: (pb: PlaybookRecord) => void
  onRun: (pb: PlaybookRecord) => void
  onDelete: (pb: PlaybookRecord) => void
}) {
  const src = SOURCE_META[pb.source]
  const st  = REC_STATUS[pb.status]
  const SrcIcon = src.icon
  const canApprove = pb.status !== 'approved' && pb.status !== 'archived'

  return (
    <motion.div layout initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, scale:0.97 }}
      className="rounded-2xl border overflow-hidden flex flex-col"
      style={{ borderColor: src.border, background:'rgba(255,255,255,0.02)' }}>

      {/* Accent bar */}
      <div style={{ height:3, background:`linear-gradient(90deg, ${src.color}, transparent)` }} />

      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Header row */}
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background:src.bg, border:`1px solid ${src.border}` }}>
            <SrcIcon className="w-4.5 h-4.5" style={{ color:src.color, width:18, height:18 }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-100 leading-snug truncate">{pb.name}</div>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ color:src.color, background:src.bg, border:`1px solid ${src.border}` }}>{src.label}</span>
              <span className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ color:st.color, background:st.bg, border:`1px solid ${st.border}` }}>{st.label}</span>
            </div>
          </div>
        </div>

        {/* Description */}
        {pb.description && (
          <p className="text-[11.5px] text-slate-400 leading-relaxed line-clamp-2">{pb.description}</p>
        )}

        {/* Metadata grid */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[10.5px]">
          <Meta icon={Cpu}    label="Use Case" value={pb.useCase || '—'} />
          <Meta icon={GitBranch} label="Steps"  value={`${pb.nodeCount} nodes`} />
          <Meta icon={History} label="Version"  value={`v${pb.version}`} />
          <Meta icon={Clock}  label="Updated"   value={timeAgo(pb.updatedAtMs)} />
          <Meta icon={User}   label="Created By" value={pb.createdBy} />
          <Meta icon={Play}   label="Last Used" value={pb.lastUsedAtMs ? timeAgo(pb.lastUsedAtMs) : 'never'} />
        </div>

        {/* Tags */}
        {pb.tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <TagIcon className="w-3 h-3 text-slate-500 shrink-0" />
            {pb.tags.map(t => (
              <span key={t} className="text-[9.5px] font-medium px-1.5 py-0.5 rounded-md text-slate-300"
                style={{ background:'rgba(148,163,184,0.10)', border:'1px solid rgba(148,163,184,0.18)' }}>{t}</span>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 mt-auto pt-1">
          <CardBtn onClick={() => onView(pb)} color="#00e5ff" icon={Eye} label="View" />
          <CardBtn onClick={() => onRun(pb)}  color="#34d399" icon={Play} label="Run" />
          {canApprove && <CardBtn onClick={() => onApprove(pb)} color="#a78bfa" icon={ShieldCheck} label="Approve" />}
          <button onClick={() => onDelete(pb)} title="Delete playbook"
            className="ml-auto w-7 h-7 rounded-lg flex items-center justify-center transition-all hover:opacity-80"
            style={{ background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.20)', color:'#f87171' }}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function Meta({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Icon className="w-3 h-3 text-slate-500 shrink-0" />
      <span className="text-slate-500 shrink-0">{label}:</span>
      <span className="text-slate-300 font-medium truncate">{value}</span>
    </div>
  )
}

function CardBtn({ onClick, color, icon: Icon, label }: { onClick: () => void; color: string; icon: typeof Eye; label: string }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all hover:opacity-80"
      style={{ background:`${color}14`, border:`1px solid ${color}33`, color }}>
      <Icon className="w-3 h-3" />{label}
    </button>
  )
}

// ── Main view ──────────────────────────────────────────────────────────────────
export default function SoarView() {
  const [activeTab, setActiveTab] = useState<'playbooks'|'runs'|'integrations'>('playbooks')
  const [category, setCategory]   = useState<Category>('all')
  const [showBuilder, setShowBuilder] = useState(false)
  const [viewingFlow, setViewingFlow] = useState<PlaybookFlow | null>(null)

  const apiKey = useStore(s => s.apiKey)

  const [playbooks, setPlaybooks] = useState<PlaybookRecord[]>(loadLocal)
  const [tokenSummary, setTokenSummary] = useState<TokenSummary>({ totalCalls:0, totalTokens:0, byFeature:[] })

  // Hydrate the library + token stats from the DB (system of record) on mount.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [dbPlaybooks, summary] = await Promise.all([fetchPlaybooks(), fetchTokenSummary()])
      if (!alive) return
      if (dbPlaybooks.length) {
        setPlaybooks(prev => {
          const merged = mergeById(prev, dbPlaybooks.map(p => normalizeRecord(p as unknown as Record<string, unknown>)))
          persistLocal(merged)
          return merged
        })
      }
      setTokenSummary(summary)
    })()
    return () => { alive = false }
  }, [])

  const update = useCallback((next: PlaybookRecord[]) => {
    persistLocal(next)
    setPlaybooks(next)
  }, [])

  const handleGenerated = useCallback((pb: GeneratedPlaybook) => {
    setPlaybooks(prev => {
      const next = mergeById(prev, [normalizeRecord(pb as unknown as Record<string, unknown>)])
      persistLocal(next)
      return next
    })
    setShowBuilder(false)
    setCategory(pb.source === 'ai' ? 'ai' : 'manual')
    fetchTokenSummary().then(setTokenSummary)   // refresh token counter after a generation
  }, [])

  const handleView = useCallback((pb: PlaybookRecord) => {
    setViewingFlow(pb.flow)
    const now = Date.now()
    touchPlaybook(pb.id)
    update(playbooks.map(p => p.id === pb.id ? { ...p, lastUsedAtMs: now } : p))
  }, [playbooks, update])

  const handleRun = useCallback((pb: PlaybookRecord) => {
    // Execution engine lands in SOAR-1; for now, mark the playbook as recently used.
    const now = Date.now()
    touchPlaybook(pb.id)
    update(playbooks.map(p => p.id === pb.id ? { ...p, lastUsedAtMs: now } : p))
  }, [playbooks, update])

  const handleApprove = useCallback((pb: PlaybookRecord) => {
    const updated: PlaybookRecord = { ...pb, status:'approved', updatedAtMs: Date.now() }
    savePlaybook(updated)
    update(playbooks.map(p => p.id === pb.id ? updated : p))
  }, [playbooks, update])

  const handleDelete = useCallback((pb: PlaybookRecord) => {
    deletePlaybook(pb.id)
    update(playbooks.filter(p => p.id !== pb.id))
  }, [playbooks, update])

  // Category counts + filtered/sorted list.
  const counts = useMemo(() => ({
    all:      playbooks.length,
    manual:   playbooks.filter(p => p.source === 'manual').length,
    ai:       playbooks.filter(p => p.source === 'ai').length,
    approved: playbooks.filter(p => p.status === 'approved' || p.status === 'active').length,
    recent:   playbooks.filter(p => p.lastUsedAtMs > 0).length,
  }), [playbooks])

  const visible = useMemo(() => {
    let list = playbooks
    if (category === 'manual')   list = list.filter(p => p.source === 'manual')
    if (category === 'ai')       list = list.filter(p => p.source === 'ai')
    if (category === 'approved') list = list.filter(p => p.status === 'approved' || p.status === 'active')
    if (category === 'recent')   list = list.filter(p => p.lastUsedAtMs > 0)
    const sorted = [...list].sort((a, b) => category === 'recent'
      ? b.lastUsedAtMs - a.lastUsedAtMs
      : b.updatedAtMs - a.updatedAtMs)
    return sorted
  }, [playbooks, category])

  // Honest, computed stat cards (replacing the old mock values).
  const statCards = useMemo(() => [
    { label:'Total Playbooks', value:String(counts.all),      sub:`${counts.approved} live`,         icon:GitBranch,    color:'#00e5ff' },
    { label:'AI Generated',    value:String(counts.ai),        sub:'agent-authored',                  icon:Sparkles,     color:'#fbbf24' },
    { label:'Manual',          value:String(counts.manual),    sub:'from response plans',             icon:FileText,     color:'#38bdf8' },
    { label:'Tokens Used',     value:fmtTokens(tokenSummary.totalTokens), sub:`${tokenSummary.totalCalls} generations`, icon:Cpu, color:'#a78bfa' },
  ], [counts, tokenSummary])

  return (
    <div className="h-full overflow-y-auto">
      <AnimatePresence>
        {(showBuilder || viewingFlow) && (
          <PlaybookBuilder
            apiKey={apiKey}
            source="manual"
            initialFlow={viewingFlow ?? undefined}
            onClose={() => { setShowBuilder(false); setViewingFlow(null) }}
            onGenerated={handleGenerated}
          />
        )}
      </AnimatePresence>

      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8 sm:py-10">

        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
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
            <p className="text-sm text-slate-400 sm:ml-11">
              Security Orchestration, Automation &amp; Response — a reusable, DB-backed playbook library.
            </p>
          </div>
          <button onClick={() => setShowBuilder(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-80 shrink-0"
            style={{ background:'rgba(251,191,36,0.10)', border:'1px solid rgba(251,191,36,0.25)', color:'#fbbf24' }}>
            <Plus className="w-4 h-4" />New Playbook
          </button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-8">
          {statCards.map(({ label, value, sub, icon: Icon, color }) => (
            <div key={label} className="rounded-xl border px-4 py-4"
              style={{ borderColor:`${color}33`, background:`${color}14` }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color, opacity:0.85 }}>{label}</span>
                <Icon className="w-4 h-4" style={{ color, opacity:0.6 }} />
              </div>
              <div className="text-2xl font-bold font-mono" style={{ color }}>{value}</div>
              <div className="text-[11px] text-slate-400 mt-1">{sub}</div>
            </div>
          ))}
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 border-b border-white/[0.06] overflow-x-auto">
          {(['playbooks','runs','integrations'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="px-4 py-2.5 text-xs font-semibold capitalize transition-all border-b-2 -mb-px whitespace-nowrap"
              style={{
                borderBottomColor: activeTab === tab ? '#fbbf24' : 'transparent',
                color:   activeTab === tab ? '#fbbf24' : '#94a3b8',
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
            <motion.div key="playbooks" initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}>

              {/* Category filter chips */}
              <div className="flex gap-2 mb-5 flex-wrap">
                {CATEGORIES.map(({ id, label, icon: Icon }) => {
                  const active = category === id
                  return (
                    <button key={id} onClick={() => setCategory(id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-semibold transition-all"
                      style={{
                        background: active ? 'rgba(251,191,36,0.12)' : 'rgba(148,163,184,0.06)',
                        border: `1px solid ${active ? 'rgba(251,191,36,0.35)' : 'rgba(148,163,184,0.15)'}`,
                        color: active ? '#fbbf24' : '#94a3b8',
                      }}>
                      <Icon className="w-3.5 h-3.5" />{label}
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                        style={{ background: active ? 'rgba(251,191,36,0.15)' : 'rgba(148,163,184,0.12)', color: active ? '#fbbf24' : '#64748b' }}>
                        {counts[id]}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* Responsive card grid */}
              {visible.length > 0 ? (
                <motion.div layout className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
                  <AnimatePresence>
                    {visible.map(pb => (
                      <PlaybookCard key={pb.id} pb={pb}
                        onView={handleView} onApprove={handleApprove} onRun={handleRun} onDelete={handleDelete} />
                    ))}
                  </AnimatePresence>
                </motion.div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/[0.10] py-16 flex flex-col items-center gap-3 text-center">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                    style={{ background:'rgba(251,191,36,0.08)', border:'1px solid rgba(251,191,36,0.20)' }}>
                    <Sparkles className="w-5 h-5 text-amber-400" />
                  </div>
                  <div className="text-sm font-semibold text-slate-300">No playbooks in this category yet</div>
                  <div className="text-[12px] text-slate-500 max-w-xs">
                    {category === 'ai'
                      ? 'Agent-authored playbooks (Part 2) will appear here once alert-driven generation is enabled.'
                      : 'Generate one from a response plan to start building your library.'}
                  </div>
                  <button onClick={() => setShowBuilder(true)}
                    className="mt-2 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-80"
                    style={{ background:'rgba(251,191,36,0.10)', border:'1px solid rgba(251,191,36,0.25)', color:'#fbbf24' }}>
                    <Plus className="w-4 h-4" />New Playbook
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {/* ── Recent Runs tab ───────────────────────────────────────────── */}
          {activeTab === 'runs' && (
            <motion.div key="runs" initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}>
              <div className="rounded-xl border border-white/[0.08] overflow-hidden">
                <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">Execution Log</span>
                  <span className="ml-auto text-[10px] font-mono text-slate-500">demo data · SOAR-0</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr className="border-b border-white/[0.06]">
                        {['Status','Playbook','Trigger','Started','Duration'].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {RECENT_RUNS.map(run => {
                        const rs = RUN_STYLE[run.status]; const Icon = rs.icon
                        return (
                          <tr key={run.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                            <td className="px-4 py-3">
                              <span className="flex items-center gap-1.5 w-fit px-2 py-0.5 rounded-full text-[11px] font-semibold"
                                style={{ background:rs.bg, color:rs.color }}>
                                <Icon className={`w-3 h-3 ${run.status==='running'?'animate-spin':''}`} />{rs.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-200 font-medium">{run.playbook}</td>
                            <td className="px-4 py-3 text-slate-400 text-[12px]">{run.trigger}</td>
                            <td className="px-4 py-3 text-slate-400 font-mono text-[12px]">{run.started}</td>
                            <td className="px-4 py-3 text-slate-400 font-mono text-[12px]">{run.duration}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* ── Integrations tab ─────────────────────────────────────────── */}
          {activeTab === 'integrations' && (
            <motion.div key="integrations" initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {INTEGRATION_ICONS.map(({ label, icon: Icon, color }) => (
                  <div key={label} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 flex items-center gap-4 hover:bg-white/[0.04] transition-colors cursor-pointer group">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background:`${color}15`, border:`1px solid ${color}30` }}>
                      <Icon className="w-5 h-5" style={{ color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-200">{label}</div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        <span className="text-[11px] text-slate-400">Simulated</span>
                      </div>
                    </div>
                    <Settings className="w-4 h-4 text-slate-500 group-hover:text-slate-300 transition-colors" />
                  </div>
                ))}
                <div className="rounded-xl border border-dashed border-white/[0.10] p-5 flex items-center gap-4 hover:bg-white/[0.02] transition-colors cursor-pointer">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-dashed border-white/[0.15]">
                    <Plus className="w-5 h-5 text-slate-400" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-300">Add Integration</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Real connectors land in SOAR-3</div>
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
