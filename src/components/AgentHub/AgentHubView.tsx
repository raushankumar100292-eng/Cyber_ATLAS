import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '../../lib/store'
import type { TrainedAgentSkill } from '../../lib/store'
import {
  Bot, Plus, Upload, Search, X, ChevronRight, Check,
  Cpu, Shield, Zap, Eye, Target, BookOpen, Settings,
  Trash2, Edit3, Tag, AlertTriangle, CheckCircle2,
  Download, MoreVertical, Sparkles, Network, Filter,
  RefreshCw, SlidersHorizontal, Info, GripVertical,
} from 'lucide-react'
import { clsx } from 'clsx'

// ── Types ─────────────────────────────────────────────────────────────────────

type AgentStatus = 'active' | 'idle' | 'error' | 'training'
type AgentCategory = 'detection' | 'response' | 'hunting' | 'intelligence' | 'custom'

interface AgentSkill {
  id: string
  name: string
  category: string
  description: string
  builtin: boolean
}

interface Agent {
  id: string
  name: string
  description: string
  category: AgentCategory
  status: AgentStatus
  skills: AgentSkill[]
  createdAt: number
  lastRun: number | null
  runCount: number
  author: string
  version: string
  tags: string[]
}

// ── Seed data ─────────────────────────────────────────────────────────────────

const BUILTIN_SKILLS: AgentSkill[] = [
  { id: 'sk-01', name: 'Phishing Detection',      category: 'Detection',    description: 'Identify phishing indicators in email headers, URLs, and attachments',         builtin: true },
  { id: 'sk-02', name: 'Malware Analysis',         category: 'Detection',    description: 'Static and dynamic analysis of suspicious executables and scripts',            builtin: true },
  { id: 'sk-03', name: 'Network Anomaly Detection',category: 'Detection',    description: 'Baseline deviation analysis across network flows and DNS queries',             builtin: true },
  { id: 'sk-04', name: 'Endpoint Forensics',       category: 'Forensics',    description: 'Deep-dive into process trees, registry changes, and file system activity',    builtin: true },
  { id: 'sk-05', name: 'Threat Intelligence Lookup',category:'Intelligence', description: 'Enrich IOCs against MISP, VirusTotal, and internal threat feeds',            builtin: true },
  { id: 'sk-06', name: 'SOAR Playbook Execution',  category: 'Response',     description: 'Trigger and monitor automated response playbooks via SOAR platform',          builtin: true },
  { id: 'sk-07', name: 'Incident Triage',          category: 'Response',     description: 'Classify alerts by severity, assign priority, and recommend initial actions', builtin: true },
  { id: 'sk-08', name: 'Log Correlation',          category: 'Detection',    description: 'Cross-source event correlation using temporal and entity relationships',       builtin: true },
  { id: 'sk-09', name: 'Lateral Movement Tracking',category: 'Hunting',      description: 'Track attacker movement across hosts using authentication and network logs',   builtin: true },
  { id: 'sk-10', name: 'Credential Abuse Detection',category:'Detection',    description: 'Identify brute-force, pass-the-hash, and credential stuffing patterns',       builtin: true },
  { id: 'sk-11', name: 'Cloud Security Posture',   category: 'Intelligence', description: 'Assess misconfiguration and IAM exposure in AWS, Azure, and GCP environments', builtin: true },
  { id: 'sk-12', name: 'Ransomware Containment',   category: 'Response',     description: 'Automated isolation of infected endpoints and shadow copy protection checks',   builtin: true },
]

const INITIAL_AGENTS: Agent[] = [
  {
    id: 'ag-01',
    name: 'Phishing Agent',
    description: 'Specialized agent for end-to-end phishing campaign detection, URL analysis, and user reporting triage. Integrates with email gateways and sandboxing platforms.',
    category: 'detection',
    status: 'active',
    skills: [BUILTIN_SKILLS[0], BUILTIN_SKILLS[4], BUILTIN_SKILLS[6]],
    createdAt: Date.now() - 86400000 * 12,
    lastRun: Date.now() - 3600000 * 2,
    runCount: 247,
    author: 'SOC Team',
    version: '2.1.0',
    tags: ['email', 'phishing', 'url-analysis'],
  },
  {
    id: 'ag-02',
    name: 'Endpoint Mal Agent',
    description: 'Monitors endpoint telemetry for malware indicators, performs automated triage of suspicious processes, and coordinates containment with EDR platforms.',
    category: 'detection',
    status: 'active',
    skills: [BUILTIN_SKILLS[1], BUILTIN_SKILLS[3], BUILTIN_SKILLS[5], BUILTIN_SKILLS[9]],
    createdAt: Date.now() - 86400000 * 8,
    lastRun: Date.now() - 3600000 * 0.5,
    runCount: 89,
    author: 'Detection Eng',
    version: '1.4.2',
    tags: ['malware', 'endpoint', 'edr'],
  },
  {
    id: 'ag-03',
    name: 'Network Hunt Agent',
    description: 'Proactive threat hunting across network flows, DNS, and proxy logs to surface hidden adversary activity and lateral movement patterns.',
    category: 'hunting',
    status: 'idle',
    skills: [BUILTIN_SKILLS[2], BUILTIN_SKILLS[7], BUILTIN_SKILLS[8]],
    createdAt: Date.now() - 86400000 * 5,
    lastRun: Date.now() - 86400000 * 1,
    runCount: 34,
    author: 'Threat Hunt',
    version: '1.0.1',
    tags: ['network', 'hunting', 'lateral-movement'],
  },
  {
    id: 'ag-04',
    name: 'Cloud Posture Agent',
    description: 'Continuous assessment of cloud security posture across multi-cloud environments. Surfaces IAM misconfigurations, exposed storage, and risky policy changes.',
    category: 'intelligence',
    status: 'training',
    skills: [BUILTIN_SKILLS[10], BUILTIN_SKILLS[4]],
    createdAt: Date.now() - 86400000 * 2,
    lastRun: null,
    runCount: 0,
    author: 'Cloud Sec',
    version: '0.9.0',
    tags: ['cloud', 'aws', 'azure', 'iam'],
  },
  {
    id: 'ag-05',
    name: 'Ransomware Responder',
    description: 'Automated first-responder for ransomware incidents. Isolates affected hosts, preserves forensic artifacts, and initiates recovery workflows.',
    category: 'response',
    status: 'idle',
    skills: [BUILTIN_SKILLS[11], BUILTIN_SKILLS[5], BUILTIN_SKILLS[3]],
    createdAt: Date.now() - 86400000 * 15,
    lastRun: Date.now() - 86400000 * 3,
    runCount: 12,
    author: 'IR Team',
    version: '1.2.0',
    tags: ['ransomware', 'ir', 'containment'],
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<AgentCategory, { label: string; color: string; icon: React.ReactNode }> = {
  detection:    { label: 'Detection',    color: 'text-cyan-700 bg-cyan-50 border-cyan-200',     icon: <Shield  className="w-3 h-3" /> },
  response:     { label: 'Response',     color: 'text-rose-700 bg-rose-50 border-rose-200',      icon: <Zap     className="w-3 h-3" /> },
  hunting:      { label: 'Hunting',      color: 'text-amber-700 bg-amber-50 border-amber-200',   icon: <Target  className="w-3 h-3" /> },
  intelligence: { label: 'Intelligence', color: 'text-violet-700 bg-violet-50 border-violet-200',icon: <Eye     className="w-3 h-3" /> },
  custom:       { label: 'Custom',       color: 'text-slate-700 bg-slate-100 border-slate-300',  icon: <Cpu     className="w-3 h-3" /> },
}

const STATUS_META: Record<AgentStatus, { label: string; dot: string; badge: string }> = {
  active:   { label: 'Active',   dot: 'bg-emerald-400',  badge: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  idle:     { label: 'Idle',     dot: 'bg-slate-400',    badge: 'text-slate-600   bg-slate-100  border-slate-300'   },
  error:    { label: 'Error',    dot: 'bg-red-400',      badge: 'text-red-700     bg-red-50     border-red-200'     },
  training: { label: 'Training', dot: 'bg-amber-400 animate-pulse', badge: 'text-amber-700 bg-amber-50 border-amber-200' },
}

function timeAgo(ts: number | null): string {
  if (!ts) return 'Never'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function uid() { return Math.random().toString(36).slice(2, 10) }

// ── Map a SOC-trained agent (from the shared store) → Agent Hub card ───────────
const SOC_CATEGORY: Record<string, AgentCategory> = {
  phishing: 'detection', malware: 'detection', brute: 'detection', c2: 'detection',
  lateral: 'hunting', insider: 'hunting',
  exfil: 'intelligence', cloud: 'intelligence', supply: 'intelligence',
  privesc: 'response',
}
function socAgentId(alertType: string) { return `soc-${alertType}` }

function socToHubAgent(ta: TrainedAgentSkill): Agent {
  const cap = (s: string) => (s.length > 46 ? s.slice(0, 46) + '…' : s)
  const skills: AgentSkill[] = [
    ...ta.investigationSteps.map((s, i) => ({ id: `${socAgentId(ta.alertType)}-inv-${i}`,  name: cap(s), category: 'Investigation', description: s, builtin: false })),
    ...ta.remediationSteps.map((s, i)   => ({ id: `${socAgentId(ta.alertType)}-rem-${i}`,  name: cap(s), category: 'Response',      description: s, builtin: false })),
    ...ta.commonTechniques.map((s, i)   => ({ id: `${socAgentId(ta.alertType)}-tech-${i}`, name: cap(s), category: 'Technique',     description: s, builtin: false })),
  ]
  return {
    id: socAgentId(ta.alertType),
    name: ta.label,
    description: `Auto-trained by the SOC Master Agent from live ${ta.alertType} incidents. Applies ${ta.investigationSteps.length} investigation + ${ta.remediationSteps.length} remediation skills via zero-token skill reuse.`,
    category: SOC_CATEGORY[ta.alertType] ?? 'detection',
    status: 'active',
    skills,
    createdAt: ta.trainedAt,
    lastRun: ta.lastRunAt,
    runCount: ta.runCount,
    author: 'SOC Master Agent',
    version: `1.${ta.runCount}.0`,
    tags: [ta.alertType, ...ta.commonTechniques.map(t => (t.split(':')[0] || '').trim()).filter(Boolean)].slice(0, 4),
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SkillBadge({ skill, onRemove }: { skill: AgentSkill; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 border border-slate-200 text-slate-700">
      {skill.name}
      {onRemove && (
        <button onClick={onRemove} className="ml-0.5 text-slate-400 hover:text-red-500 transition-colors">
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </span>
  )
}

// ── New Agent Modal ───────────────────────────────────────────────────────────

interface NewAgentModalProps {
  onClose: () => void
  onCreate: (agent: Agent) => void
}

function NewAgentModal({ onClose, onCreate }: NewAgentModalProps) {
  const [name, setName]           = useState('')
  const [description, setDesc]    = useState('')
  const [category, setCat]        = useState<AgentCategory>('detection')
  const [author, setAuthor]       = useState('')
  const [tagInput, setTagInput]   = useState('')
  const [tags, setTags]           = useState<string[]>([])
  const [errors, setErrors]       = useState<Record<string,string>>({})

  function addTag() {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-')
    if (t && !tags.includes(t)) setTags(prev => [...prev, t])
    setTagInput('')
  }

  function validate() {
    const e: Record<string,string> = {}
    if (!name.trim())        e.name = 'Agent name is required'
    if (!description.trim()) e.description = 'Description is required'
    if (!author.trim())      e.author = 'Author is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleCreate() {
    if (!validate()) return
    onCreate({
      id: `ag-${uid()}`,
      name: name.trim(),
      description: description.trim(),
      category,
      status: 'idle',
      skills: [],
      createdAt: Date.now(),
      lastRun: null,
      runCount: 0,
      author: author.trim(),
      version: '1.0.0',
      tags,
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-10">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-100 border border-cyan-200 flex items-center justify-center">
              <Bot className="w-4 h-4 text-cyan-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">New Agent</p>
              <p className="text-xs text-slate-500">Configure a new autonomous agent</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Agent Name <span className="text-red-500">*</span></label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Phishing Agent, Endpoint Mal Agent…"
              className={clsx('w-full h-9 text-sm border rounded-lg px-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 transition-all',
                errors.name ? 'border-red-300 focus:ring-red-500/20' : 'border-slate-200 focus:border-cyan-400 focus:ring-cyan-500/10')} />
            {errors.name && <p className="text-[11px] text-red-500 mt-1">{errors.name}</p>}
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Description <span className="text-red-500">*</span></label>
            <textarea value={description} onChange={e => setDesc(e.target.value)} rows={3}
              placeholder="Describe what this agent does, its data sources, and expected outputs…"
              className={clsx('w-full text-sm border rounded-lg px-3 py-2 text-slate-800 placeholder-slate-400 resize-none focus:outline-none focus:ring-2 transition-all',
                errors.description ? 'border-red-300 focus:ring-red-500/20' : 'border-slate-200 focus:border-cyan-400 focus:ring-cyan-500/10')} />
            {errors.description && <p className="text-[11px] text-red-500 mt-1">{errors.description}</p>}
          </div>

          {/* Category + Author */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
              <select value={category} onChange={e => setCat(e.target.value as AgentCategory)}
                className="w-full h-9 text-sm border border-slate-200 rounded-lg px-3 text-slate-800 focus:outline-none focus:border-cyan-400 bg-white">
                {(Object.keys(CATEGORY_META) as AgentCategory[]).map(c => (
                  <option key={c} value={c}>{CATEGORY_META[c].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Author <span className="text-red-500">*</span></label>
              <input value={author} onChange={e => setAuthor(e.target.value)}
                placeholder="Team or individual…"
                className={clsx('w-full h-9 text-sm border rounded-lg px-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 transition-all',
                  errors.author ? 'border-red-300 focus:ring-red-500/20' : 'border-slate-200 focus:border-cyan-400 focus:ring-cyan-500/10')} />
              {errors.author && <p className="text-[11px] text-red-500 mt-1">{errors.author}</p>}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Tags</label>
            <div className="flex gap-2">
              <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }}
                placeholder="Add tag, press Enter…"
                className="flex-1 h-8 text-xs border border-slate-200 rounded-lg px-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-cyan-400" />
              <button onClick={addTag} className="h-8 px-3 text-xs rounded-lg bg-slate-100 border border-slate-200 text-slate-600 hover:bg-slate-200 transition-colors">
                <Plus className="w-3 h-3" />
              </button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tags.map(t => (
                  <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-50 border border-cyan-200 text-cyan-700">
                    {t}
                    <button onClick={() => setTags(prev => prev.filter(x => x !== t))} className="text-cyan-400 hover:text-red-500"><X className="w-2.5 h-2.5" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50">
          <p className="text-[11px] text-slate-400">Skills can be assigned after creation</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-8 px-4 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
            <button onClick={handleCreate} className="h-8 px-4 text-xs rounded-lg bg-cyan-600 text-white font-semibold hover:bg-cyan-700 transition-colors flex items-center gap-1.5">
              <Bot className="w-3.5 h-3.5" /> Create Agent
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ── Import Modal ──────────────────────────────────────────────────────────────

function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: (agents: Agent[]) => void }) {
  const [dragOver, setDragOver]   = useState(false)
  const [file, setFile]           = useState<File | null>(null)
  const [preview, setPreview]     = useState<Agent[]>([])
  const [errors, setErrors]       = useState<string[]>([])
  const [parsing, setParsing]     = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function parseCSV(text: string): { agents: Agent[]; errors: string[] } {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 2) return { agents: [], errors: ['CSV must have a header row and at least one data row'] }
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
    const nameIdx = headers.indexOf('name')
    const descIdx = headers.indexOf('description')
    const catIdx  = headers.indexOf('category')
    const authIdx = headers.indexOf('author')
    const missing = []
    if (nameIdx < 0) missing.push('name')
    if (descIdx < 0) missing.push('description')
    if (missing.length) return { agents: [], errors: [`Missing required columns: ${missing.join(', ')}`] }

    const agents: Agent[] = []
    const errs: string[] = []
    lines.slice(1).forEach((line, i) => {
      const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
      const name = cols[nameIdx] ?? ''
      const desc = cols[descIdx] ?? ''
      if (!name) { errs.push(`Row ${i + 2}: missing agent name`); return }
      const rawCat = (catIdx >= 0 ? cols[catIdx] : '').toLowerCase()
      const validCats: AgentCategory[] = ['detection','response','hunting','intelligence','custom']
      const category: AgentCategory = validCats.includes(rawCat as AgentCategory) ? rawCat as AgentCategory : 'custom'
      agents.push({
        id: `ag-${uid()}`,
        name, description: desc, category,
        status: 'idle',
        skills: [],
        createdAt: Date.now(),
        lastRun: null,
        runCount: 0,
        author: authIdx >= 0 ? (cols[authIdx] ?? 'Imported') : 'Imported',
        version: '1.0.0',
        tags: [],
      })
    })
    return { agents, errors: errs }
  }

  function handleFile(f: File) {
    if (!f.name.endsWith('.csv')) { setErrors(['Only CSV files are supported']); return }
    setFile(f)
    setParsing(true)
    const reader = new FileReader()
    reader.onload = e => {
      const { agents, errors } = parseCSV(e.target?.result as string)
      setPreview(agents)
      setErrors(errors)
      setParsing(false)
    }
    reader.readAsText(f)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.18 }}
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 z-10 overflow-hidden">

        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-violet-100 border border-violet-200 flex items-center justify-center">
              <Upload className="w-4 h-4 text-violet-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">Import Agents</p>
              <p className="text-xs text-slate-500">Upload a CSV file to bulk-import agents</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Drop zone */}
          <div onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileRef.current?.click()}
            className={clsx('relative flex flex-col items-center justify-center gap-3 h-36 rounded-xl border-2 border-dashed cursor-pointer transition-all',
              dragOver ? 'border-cyan-400 bg-cyan-50' : 'border-slate-200 bg-slate-50 hover:border-cyan-300 hover:bg-cyan-50/50')}>
            <input ref={fileRef} type="file" accept=".csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
            <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center transition-colors',
              dragOver ? 'bg-cyan-100' : 'bg-slate-200')}>
              <Upload className={clsx('w-5 h-5', dragOver ? 'text-cyan-600' : 'text-slate-500')} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-slate-700">
                {file ? file.name : 'Drop CSV here or click to browse'}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">Required columns: name, description — Optional: category, author</p>
            </div>
          </div>

          {/* Errors */}
          {errors.length > 0 && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 space-y-1">
              {errors.map((e, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-red-700">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{e}
                </div>
              ))}
            </div>
          )}

          {/* Preview */}
          {parsing && (
            <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Parsing file…
            </div>
          )}
          {preview.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-xs font-semibold text-slate-700">{preview.length} agent{preview.length !== 1 ? 's' : ''} ready to import</span>
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                {preview.map(a => (
                  <div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
                    <Bot className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-700 truncate">{a.name}</p>
                      <p className="text-[10px] text-slate-400 truncate">{a.description || '—'}</p>
                    </div>
                    <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded border', CATEGORY_META[a.category].color)}>
                      {CATEGORY_META[a.category].label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CSV template download hint */}
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Info className="w-3 h-3 shrink-0" />
            <span>CSV format: <code className="font-mono bg-slate-100 px-1 rounded">name,description,category,author</code></span>
          </div>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50">
          <span className="text-[11px] text-slate-400">{preview.length > 0 ? `${preview.length} agents parsed` : 'No file selected'}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-8 px-4 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
            <button disabled={preview.length === 0} onClick={() => { onImport(preview); onClose() }}
              className={clsx('h-8 px-4 text-xs rounded-lg font-semibold transition-colors flex items-center gap-1.5',
                preview.length > 0 ? 'bg-violet-600 text-white hover:bg-violet-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed')}>
              <Download className="w-3.5 h-3.5" /> Import {preview.length > 0 ? preview.length : ''} Agent{preview.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ── Skill Picker ──────────────────────────────────────────────────────────────

function SkillPicker({ existingIds, onAdd }: { existingIds: Set<string>; onAdd: (skill: AgentSkill) => void }) {
  const [query, setQuery]       = useState('')
  const [customName, setCustom] = useState('')
  const [customDesc, setCustomDesc] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  const filtered = BUILTIN_SKILLS.filter(s =>
    !existingIds.has(s.id) &&
    (s.name.toLowerCase().includes(query.toLowerCase()) ||
     s.category.toLowerCase().includes(query.toLowerCase()))
  )

  const categories = [...new Set(filtered.map(s => s.category))]

  function addCustom() {
    if (!customName.trim()) return
    onAdd({ id: `sk-custom-${uid()}`, name: customName.trim(), category: 'Custom', description: customDesc.trim(), builtin: false })
    setCustom(''); setCustomDesc(''); setShowCustom(false)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden w-72">
      {/* Search */}
      <div className="p-2 border-b border-slate-100">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search skills…"
            className="w-full h-8 pl-8 pr-3 text-xs border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:border-cyan-400" />
        </div>
      </div>

      <div className="max-h-56 overflow-y-auto">
        {filtered.length === 0 && !showCustom && (
          <p className="text-xs text-slate-400 text-center py-4">No matching skills</p>
        )}
        {categories.map(cat => (
          <div key={cat}>
            <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50 sticky top-0">{cat}</p>
            {filtered.filter(s => s.category === cat).map(skill => (
              <button key={skill.id} onClick={() => onAdd(skill)}
                className="w-full flex items-start gap-2.5 px-3 py-2 hover:bg-cyan-50 transition-colors text-left">
                <Sparkles className="w-3 h-3 text-slate-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-slate-700">{skill.name}</p>
                  <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{skill.description}</p>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Custom skill */}
      <div className="border-t border-slate-100">
        {!showCustom ? (
          <button onClick={() => setShowCustom(true)}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-cyan-600 hover:bg-cyan-50 transition-colors font-medium">
            <Plus className="w-3.5 h-3.5" /> Add custom skill…
          </button>
        ) : (
          <div className="p-3 space-y-2">
            <input value={customName} onChange={e => setCustom(e.target.value)}
              placeholder="Skill name…"
              className="w-full h-7 text-xs border border-slate-200 rounded-lg px-2 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-cyan-400" />
            <input value={customDesc} onChange={e => setCustomDesc(e.target.value)}
              placeholder="Short description…"
              className="w-full h-7 text-xs border border-slate-200 rounded-lg px-2 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-cyan-400" />
            <div className="flex gap-1.5">
              <button onClick={() => setShowCustom(false)} className="flex-1 h-7 text-xs rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">Cancel</button>
              <button onClick={addCustom} disabled={!customName.trim()} className="flex-1 h-7 text-xs rounded-lg bg-cyan-600 text-white font-medium hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed">Add</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Agent Tile ────────────────────────────────────────────────────────────────

interface AgentTileProps {
  agent: Agent
  selected: boolean
  onSelect: () => void
  onDelete: () => void
}

function AgentTile({ agent, selected, onSelect, onDelete }: AgentTileProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const cm = CATEGORY_META[agent.category]
  const sm = STATUS_META[agent.status]

  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }} transition={{ duration: 0.18 }}
      onClick={onSelect}
      className={clsx(
        'relative group flex flex-col bg-white rounded-2xl border-2 cursor-pointer transition-all duration-200 overflow-hidden',
        selected ? 'border-cyan-400 shadow-lg shadow-cyan-500/10' : 'border-slate-200 hover:border-slate-300 hover:shadow-md',
      )}>

      {/* Selection indicator */}
      <div className={clsx('absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all z-10',
        selected ? 'border-cyan-500 bg-cyan-500' : 'border-slate-300 bg-white group-hover:border-slate-400')}>
        {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      </div>

      {/* Category color stripe */}
      <div className={clsx('h-1 w-full', {
        'bg-cyan-400':   agent.category === 'detection',
        'bg-rose-400':   agent.category === 'response',
        'bg-amber-400':  agent.category === 'hunting',
        'bg-violet-400': agent.category === 'intelligence',
        'bg-slate-400':  agent.category === 'custom',
      })} />

      <div className="p-4 flex flex-col gap-3 flex-1">
        {/* Icon + name */}
        <div className="flex items-start gap-3">
          <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border', {
            'bg-cyan-50 border-cyan-200':   agent.category === 'detection',
            'bg-rose-50 border-rose-200':   agent.category === 'response',
            'bg-amber-50 border-amber-200': agent.category === 'hunting',
            'bg-violet-50 border-violet-200': agent.category === 'intelligence',
            'bg-slate-100 border-slate-200': agent.category === 'custom',
          })}>
            <Bot className={clsx('w-5 h-5', {
              'text-cyan-600':   agent.category === 'detection',
              'text-rose-600':   agent.category === 'response',
              'text-amber-600':  agent.category === 'hunting',
              'text-violet-600': agent.category === 'intelligence',
              'text-slate-600':  agent.category === 'custom',
            })} />
          </div>
          <div className="flex-1 min-w-0 pr-6">
            <p className="text-sm font-bold text-slate-800 truncate">{agent.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={clsx('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border', cm.color)}>
                {cm.icon}{cm.label}
              </span>
              {agent.author === 'SOC Master Agent' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border text-violet-700 bg-violet-50 border-violet-200">
                  <Sparkles className="w-2.5 h-2.5" /> SOC-trained
                </span>
              )}
              <span className="text-[10px] text-slate-400 font-mono">v{agent.version}</span>
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 flex-1">{agent.description}</p>

        {/* Skills preview */}
        <div className="flex flex-wrap gap-1">
          {agent.skills.slice(0, 2).map(s => <SkillBadge key={s.id} skill={s} />)}
          {agent.skills.length > 2 && (
            <span className="text-[10px] text-slate-400 font-medium px-1.5 py-0.5">+{agent.skills.length - 2} more</span>
          )}
          {agent.skills.length === 0 && (
            <span className="text-[10px] text-slate-400 italic">No skills assigned</span>
          )}
        </div>

        {/* Footer stats */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1.5">
            <div className={clsx('w-1.5 h-1.5 rounded-full', sm.dot)} />
            <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded border', sm.badge)}>{sm.label}</span>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-slate-400">
            <span>{agent.runCount} runs</span>
            <span>{timeAgo(agent.lastRun)}</span>
          </div>
        </div>
      </div>

      {/* Context menu */}
      <div className="absolute bottom-3 right-3" onClick={e => e.stopPropagation()}>
        <button onClick={() => setMenuOpen(o => !o)}
          className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-slate-100 transition-all">
          <MoreVertical className="w-3.5 h-3.5" />
        </button>
        <AnimatePresence>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <motion.div initial={{ opacity: 0, scale: 0.9, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.1 }}
                className="absolute bottom-full right-0 mb-1 w-36 bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden z-20">
                <button onClick={() => { onSelect(); setMenuOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">
                  <Eye className="w-3 h-3" /> View details
                </button>
                <button onClick={() => { onDelete(); setMenuOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50">
                  <Trash2 className="w-3 h-3" /> Delete agent
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function DetailPanel({ agent, onUpdate, onClose }: {
  agent: Agent
  onUpdate: (updated: Agent) => void
  onClose: () => void
}) {
  const [showSkillPicker, setShowSkillPicker] = useState(false)
  const [editDesc, setEditDesc]               = useState(false)
  const [descDraft, setDescDraft]             = useState(agent.description)
  const cm = CATEGORY_META[agent.category]
  const sm = STATUS_META[agent.status]

  function removeSkill(id: string) {
    onUpdate({ ...agent, skills: agent.skills.filter(s => s.id !== id) })
  }

  function addSkill(skill: AgentSkill) {
    if (agent.skills.find(s => s.id === skill.id)) return
    onUpdate({ ...agent, skills: [...agent.skills, skill] })
  }

  function saveDesc() {
    onUpdate({ ...agent, description: descDraft.trim() || agent.description })
    setEditDesc(false)
  }

  return (
    <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      className="flex flex-col h-full bg-white border-l border-slate-200 w-80 shrink-0 overflow-hidden">

      {/* Header */}
      <div className={clsx('px-4 py-4 border-b border-slate-100 shrink-0', {
        'bg-gradient-to-br from-cyan-50 to-white':   agent.category === 'detection',
        'bg-gradient-to-br from-rose-50 to-white':   agent.category === 'response',
        'bg-gradient-to-br from-amber-50 to-white':  agent.category === 'hunting',
        'bg-gradient-to-br from-violet-50 to-white': agent.category === 'intelligence',
        'bg-gradient-to-br from-slate-50 to-white':  agent.category === 'custom',
      })}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center border', {
              'bg-cyan-100 border-cyan-200':   agent.category === 'detection',
              'bg-rose-100 border-rose-200':   agent.category === 'response',
              'bg-amber-100 border-amber-200': agent.category === 'hunting',
              'bg-violet-100 border-violet-200': agent.category === 'intelligence',
              'bg-slate-200 border-slate-300': agent.category === 'custom',
            })}>
              <Bot className={clsx('w-5 h-5', {
                'text-cyan-600':   agent.category === 'detection',
                'text-rose-600':   agent.category === 'response',
                'text-amber-600':  agent.category === 'hunting',
                'text-violet-600': agent.category === 'intelligence',
                'text-slate-600':  agent.category === 'custom',
              })} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">{agent.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={clsx('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border', cm.color)}>
                  {cm.icon}{cm.label}
                </span>
                <div className={clsx('w-1.5 h-1.5 rounded-full', sm.dot)} />
                <span className="text-[10px] text-slate-500">{sm.label}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {/* Description */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Description</p>
            <button onClick={() => { setEditDesc(e => !e); setDescDraft(agent.description) }}
              className="text-[10px] text-cyan-600 hover:text-cyan-700 flex items-center gap-0.5">
              <Edit3 className="w-2.5 h-2.5" />{editDesc ? 'Cancel' : 'Edit'}
            </button>
          </div>
          {editDesc ? (
            <div className="space-y-1.5">
              <textarea value={descDraft} onChange={e => setDescDraft(e.target.value)} rows={4}
                className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2 text-slate-800 resize-none focus:outline-none focus:border-cyan-400" />
              <div className="flex gap-1.5">
                <button onClick={() => setEditDesc(false)} className="flex-1 h-7 text-xs rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">Cancel</button>
                <button onClick={saveDesc} className="flex-1 h-7 text-xs rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 font-medium">Save</button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-600 leading-relaxed">{agent.description}</p>
          )}
        </div>

        {/* Meta */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Author',  value: agent.author },
            { label: 'Version', value: `v${agent.version}` },
            { label: 'Runs',    value: agent.runCount.toString() },
            { label: 'Last Run',value: timeAgo(agent.lastRun) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-slate-50 rounded-lg border border-slate-100 px-3 py-2">
              <p className="text-[10px] text-slate-400 font-medium">{label}</p>
              <p className="text-xs font-semibold text-slate-700 mt-0.5">{value}</p>
            </div>
          ))}
        </div>

        {/* Tags */}
        {agent.tags.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
              <Tag className="w-3 h-3" /> Tags
            </p>
            <div className="flex flex-wrap gap-1">
              {agent.tags.map(t => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-50 border border-cyan-200 text-cyan-700 font-medium">{t}</span>
              ))}
            </div>
          </div>
        )}

        {/* Skills */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" /> Skills ({agent.skills.length})
            </p>
            <div className="relative">
              <button onClick={() => setShowSkillPicker(o => !o)}
                className="flex items-center gap-1 h-6 px-2 rounded-lg text-[11px] bg-cyan-50 border border-cyan-200 text-cyan-700 hover:bg-cyan-100 transition-colors font-medium">
                <Plus className="w-3 h-3" /> Add skill
              </button>
              <AnimatePresence>
                {showSkillPicker && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowSkillPicker(false)} />
                    <div className="absolute right-0 top-full mt-1 z-20">
                      <SkillPicker
                        existingIds={new Set(agent.skills.map(s => s.id))}
                        onAdd={skill => { addSkill(skill); setShowSkillPicker(false) }}
                      />
                    </div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>

          {agent.skills.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-6 rounded-xl bg-slate-50 border border-dashed border-slate-200">
              <Sparkles className="w-5 h-5 text-slate-300" />
              <p className="text-xs text-slate-400">No skills assigned yet</p>
              <button onClick={() => setShowSkillPicker(true)}
                className="text-xs text-cyan-600 hover:text-cyan-700 font-medium">+ Add first skill</button>
            </div>
          ) : (
            <div className="space-y-1.5">
              {agent.skills.map(skill => (
                <div key={skill.id} className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 group/skill">
                  <div className="w-5 h-5 rounded-md bg-white border border-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                    {skill.builtin ? <Sparkles className="w-2.5 h-2.5 text-cyan-500" /> : <Settings className="w-2.5 h-2.5 text-slate-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-700">{skill.name}</p>
                    <p className="text-[10px] text-slate-400 leading-tight mt-0.5 line-clamp-2">{skill.description}</p>
                    <span className="inline-block mt-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">{skill.category}</span>
                  </div>
                  <button onClick={() => removeSkill(skill.id)}
                    className="opacity-0 group-hover/skill:opacity-100 text-slate-300 hover:text-red-500 transition-all mt-0.5 shrink-0">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 px-4 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
        <span className="text-[11px] text-slate-400 flex items-center gap-1">
          <BookOpen className="w-3 h-3" /> Created {timeAgo(agent.createdAt)}
        </span>
        <span className="text-[10px] font-mono text-slate-400">{agent.id}</span>
      </div>
    </motion.div>
  )
}

// ── Main View ─────────────────────────────────────────────────────────────────

export default function AgentHubView() {
  const trainedAgents = useStore(s => s.trainedAgents)
  const [agents, setAgents]           = useState<Agent[]>(INITIAL_AGENTS)
  const [selectedId, setSelectedId]   = useState<string | null>(null)

  // Merge SOC-trained agents from the shared store into the grid. New trained
  // agents are prepended; reused ones refresh their live fields (runs, skills,
  // status) while preserving any manual edits made in the Hub.
  useEffect(() => {
    setAgents(prev => {
      const next = [...prev]
      let changed = false
      trainedAgents.forEach(ta => {
        const mapped = socToHubAgent(ta)
        const idx = next.findIndex(a => a.id === mapped.id)
        if (idx >= 0) {
          next[idx] = {
            ...next[idx],
            status: mapped.status, runCount: mapped.runCount, lastRun: mapped.lastRun,
            version: mapped.version, skills: mapped.skills, tags: mapped.tags,
          }
        } else {
          next.unshift(mapped)
        }
        changed = true
      })
      return changed ? next : prev
    })
  }, [trainedAgents])
  const [showNew, setShowNew]         = useState(false)
  const [showImport, setShowImport]   = useState(false)
  const [search, setSearch]           = useState('')
  const [catFilter, setCatFilter]     = useState<AgentCategory | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<AgentStatus | 'all'>('all')

  const selectedAgent = agents.find(a => a.id === selectedId) ?? null

  const filtered = agents.filter(a => {
    const q = search.toLowerCase()
    const matchQ = !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.tags.some(t => t.includes(q))
    const matchCat = catFilter === 'all' || a.category === catFilter
    const matchStatus = statusFilter === 'all' || a.status === statusFilter
    return matchQ && matchCat && matchStatus
  })

  const stats = {
    total:    agents.length,
    active:   agents.filter(a => a.status === 'active').length,
    skills:   agents.reduce((sum, a) => sum + a.skills.length, 0),
    runs:     agents.reduce((sum, a) => sum + a.runCount, 0),
  }

  function updateAgent(updated: Agent) {
    setAgents(prev => prev.map(a => a.id === updated.id ? updated : a))
  }

  function deleteAgent(id: string) {
    setAgents(prev => prev.filter(a => a.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const CATS: { id: AgentCategory | 'all'; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'detection', label: 'Detection' },
    { id: 'response', label: 'Response' },
    { id: 'hunting', label: 'Hunting' },
    { id: 'intelligence', label: 'Intelligence' },
    { id: 'custom', label: 'Custom' },
  ]

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#F8FAFC]">

      {/* ── Header ── */}
      <div className="shrink-0 px-6 py-4 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between gap-4">

          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-cyan-600 flex items-center justify-center shadow-md shadow-cyan-500/20">
              <Network className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-base font-bold text-slate-800">Agent Hub</p>
              <p className="text-xs text-slate-500">Manage, configure and assign skills to autonomous agents</p>
            </div>
          </div>

          {/* Stats */}
          <div className="hidden lg:flex items-center gap-1">
            {[
              { label: 'Total', value: stats.total, color: 'text-slate-700' },
              { label: 'Active', value: stats.active, color: 'text-emerald-600' },
              { label: 'Skills', value: stats.skills, color: 'text-cyan-600' },
              { label: 'Total Runs', value: stats.runs, color: 'text-violet-600' },
            ].map(s => (
              <div key={s.label} className="px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-center min-w-[64px]">
                <p className={clsx('text-lg font-bold leading-none', s.color)}>{s.value}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 h-9 px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 bg-white hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm">
              <Upload className="w-3.5 h-3.5" /> Import
            </button>
            <button onClick={() => setShowNew(true)}
              className="flex items-center gap-1.5 h-9 px-4 rounded-xl bg-cyan-600 text-white text-xs font-bold hover:bg-cyan-700 transition-all shadow-md shadow-cyan-500/20">
              <Plus className="w-3.5 h-3.5" /> New Agent
            </button>
          </div>
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-3 mt-4">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search agents by name, description or tag…"
              className="w-full h-8 pl-9 pr-3 text-xs border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 bg-white focus:outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/10" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Category pills */}
          <div className="flex items-center gap-1">
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            {CATS.map(c => (
              <button key={c.id} onClick={() => setCatFilter(c.id)}
                className={clsx('h-7 px-2.5 rounded-lg text-[11px] font-semibold border transition-all',
                  catFilter === c.id
                    ? 'bg-cyan-600 text-white border-cyan-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50')}>
                {c.label}
              </button>
            ))}
          </div>

          {/* Status filter */}
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as AgentStatus | 'all')}
            className="h-7 text-[11px] border border-slate-200 rounded-lg px-2 pr-6 text-slate-600 bg-white focus:outline-none focus:border-cyan-400 appearance-none cursor-pointer">
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="idle">Idle</option>
            <option value="training">Training</option>
            <option value="error">Error</option>
          </select>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* Tile grid */}
        <div className="flex-1 overflow-auto p-6">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center">
                <Bot className="w-8 h-8 text-slate-300" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-600">No agents found</p>
                <p className="text-xs text-slate-400 mt-1">
                  {search || catFilter !== 'all' || statusFilter !== 'all'
                    ? 'Try adjusting your filters'
                    : 'Create your first agent to get started'}
                </p>
              </div>
              {!search && catFilter === 'all' && statusFilter === 'all' && (
                <button onClick={() => setShowNew(true)}
                  className="flex items-center gap-1.5 h-9 px-4 rounded-xl bg-cyan-600 text-white text-xs font-bold hover:bg-cyan-700 transition-all">
                  <Plus className="w-3.5 h-3.5" /> Create Agent
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs text-slate-500 font-medium">
                  {filtered.length} agent{filtered.length !== 1 ? 's' : ''}
                  {(search || catFilter !== 'all' || statusFilter !== 'all') ? ' matching filters' : ''}
                </p>
                {selectedId && (
                  <button onClick={() => setSelectedId(null)}
                    className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                    <X className="w-3 h-3" /> Deselect
                  </button>
                )}
              </div>

              <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                <AnimatePresence mode="popLayout">
                  {filtered.map(agent => (
                    <AgentTile
                      key={agent.id}
                      agent={agent}
                      selected={selectedId === agent.id}
                      onSelect={() => setSelectedId(id => id === agent.id ? null : agent.id)}
                      onDelete={() => deleteAgent(agent.id)}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
            </>
          )}
        </div>

        {/* Detail panel */}
        <AnimatePresence>
          {selectedAgent && (
            <DetailPanel
              key={selectedAgent.id}
              agent={selectedAgent}
              onUpdate={updateAgent}
              onClose={() => setSelectedId(null)}
            />
          )}
        </AnimatePresence>
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 px-6 py-2.5 bg-white border-t border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-4 text-[11px] text-slate-400">
          <span className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />{stats.active} active</span>
          <span>{stats.total - stats.active} inactive</span>
          <span>{stats.skills} skills total</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-400">
          <GripVertical className="w-3 h-3" />
          <span>Click a tile to inspect · Hover for actions · Add skills from detail panel</span>
        </div>
      </div>

      {/* ── Modals ── */}
      <AnimatePresence>
        {showNew && <NewAgentModal onClose={() => setShowNew(false)} onCreate={a => setAgents(prev => [a, ...prev])} />}
        {showImport && <ImportModal onClose={() => setShowImport(false)} onImport={imported => setAgents(prev => [...prev, ...imported])} />}
      </AnimatePresence>
    </div>
  )
}
