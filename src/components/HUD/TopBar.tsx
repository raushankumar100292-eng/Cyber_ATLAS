import {
  Globe, Grid3x3, Shield, ChevronDown, Search,
  Upload as UploadIcon, ArrowRightLeft, Code2, Zap,
  Inbox, BarChart3, Layers, Eye, Sparkles, Network,
  KeyRound, CheckCircle2, EyeOff, Check,
} from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { useStore } from '../../lib/store'
import { search } from '../../lib/atlas'
import type { Role } from '../../lib/types'
import type { ViewMode } from '../../lib/store'
import { clsx } from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'

// ── Read URL params on mount and apply to store ───────────────────────────────
function useUrlParams() {
  const setView = useStore(s => s.setView)
  const setRole = useStore(s => s.setRole)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const v = p.get('view') as ViewMode | null
    const r = p.get('role') as Role | null
    if (r) setRole(r)
    if (v) setView(v)
    if (v || r) window.history.replaceState({}, '', window.location.pathname)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

// ── Open a view in a new tab via URL params ───────────────────────────────────
function openInNewTab(view: ViewMode, role?: Role) {
  const params = new URLSearchParams()
  params.set('view', view)
  if (role) params.set('role', role)
  window.open(`${window.location.pathname}?${params.toString()}`, '_blank')
}

// ── Nav button — Ctrl/Cmd+Click opens new tab ─────────────────────────────────
interface NavBtnProps {
  label: string
  icon: React.ReactNode
  active: boolean
  viewTarget: ViewMode
  roleTarget?: Role
  badge?: React.ReactNode
  onClick: () => void
}
function NavBtn({ label, icon, active, viewTarget, roleTarget, badge, onClick }: NavBtnProps) {
  function handleClick(e: React.MouseEvent) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      openInNewTab(viewTarget, roleTarget)
    } else {
      onClick()
    }
  }
  return (
    <button
      onClick={handleClick}
      title={`${label} · Ctrl+Click to open in new tab`}
      className={`nav-tab relative ${active ? 'active' : ''}`}
    >
      {icon}{label}{badge}
    </button>
  )
}

// ── Alert queue tab ───────────────────────────────────────────────────────────
function AlertQueueTab() {
  const view       = useStore(s => s.view)
  const setView    = useStore(s => s.setView)
  const alertQueue = useStore(s => s.alertQueue)
  const newCount   = alertQueue.filter(a => a.status === 'new').length
  return (
    <NavBtn
      label="SOC Triage"
      icon={<Inbox className="w-3.5 h-3.5" />}
      active={view === 'soc-triage'}
      viewTarget="soc-triage"
      onClick={() => setView('soc-triage')}
      badge={newCount > 0 ? (
        <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold"
          style={{ background: 'rgba(239,68,68,0.85)', color: '#fff' }}>
          {newCount > 99 ? '99+' : newCount}
        </span>
      ) : undefined}
    />
  )
}

// ── Role + Groq combined menu ─────────────────────────────────────────────────
const ROLES: { id: Role; label: string; description: string }[] = [
  { id: 'soc',        label: 'SOC Analyst',           description: 'Globe, matrix, triage & analytics' },
  { id: 'detection',  label: 'Detection Engineer',     description: 'Query translator & rule generation' },
  { id: 'soar',       label: 'SOAR Engineer',          description: 'Playbook builder & automation' },
  { id: 'purple',     label: 'Agentic SOC Operation',  description: 'Live pipeline & agent management' },
  { id: 'architect',  label: 'Security Architect',     description: 'Strategy tasks & AI guidance' },
  { id: 'alert-gen',  label: 'Alert Generator',        description: 'Synthetic SIEM alert generation' },
  { id: 'prompt-eng', label: 'Prompt Engineering',     description: 'Prompt studio & rephrase tools' },
]

// Landing view for each role — used for Ctrl+Click new-tab
const ROLE_VIEW: Record<Role, ViewMode> = {
  soc:          'globe',
  detection:    'spl-kql',
  soar:         'soar',
  purple:       'agentic-soc',
  architect:    'architect',
  'alert-gen':  'alert-gen',
  'prompt-eng': 'prompt-eng',
}

function RoleMenu({ role, onRoleChange }: { role: Role; onRoleChange: (r: Role) => void }) {
  const apiKey    = useStore(s => s.apiKey)
  const setApiKey = useStore(s => s.setApiKey)

  const [open,    setOpen]    = useState(false)
  const [draft,   setDraft]   = useState(apiKey)
  const [showKey, setShowKey] = useState(false)
  const [saved,   setSaved]   = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Keep draft in sync when key changes externally
  useEffect(() => { setDraft(apiKey) }, [apiKey])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function saveKey() {
    setApiKey(draft.trim())
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const connected = !!apiKey.trim()
  const currentRole = ROLES.find(r => r.id === role)

  return (
    <div ref={menuRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-lg border text-xs font-medium transition-all',
          'bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.07] hover:border-white/[0.14]',
          open && 'bg-white/[0.08] border-white/[0.15]',
        )}
      >
        <span className="truncate max-w-[140px]">{currentRole?.label ?? 'Select role'}</span>
        {/* Groq status dot */}
        <span
          className={clsx('w-1.5 h-1.5 rounded-full shrink-0 transition-colors', connected ? 'bg-emerald-400' : 'bg-slate-600')}
          title={connected ? 'Groq connected' : 'Groq not set'}
        />
        <ChevronDown className={clsx('w-3 h-3 text-slate-500 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-72 z-50 rounded-xl border border-slate-200 shadow-2xl overflow-hidden"
            style={{ background: '#ffffff' }}
          >
            {/* ── Role list ── */}
            <div className="pt-1.5 pb-1">
              <p className="px-3.5 pt-1 pb-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Role</p>
              {ROLES.map(r => (
                <button
                  key={r.id}
                  title={`${r.label} · Ctrl+Click to open in new tab`}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                      e.preventDefault()
                      openInNewTab(ROLE_VIEW[r.id], r.id)
                    } else {
                      onRoleChange(r.id); setOpen(false)
                    }
                  }}
                  className={clsx(
                    'w-full flex items-center gap-3 px-3.5 py-2 text-left transition-colors',
                    role === r.id
                      ? 'bg-cyan-50'
                      : 'hover:bg-slate-50',
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <p className={clsx('text-[12px] font-semibold leading-none', role === r.id ? 'text-cyan-700' : 'text-slate-800')}>
                      {r.label}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5 leading-tight truncate">{r.description}</p>
                  </div>
                  {role === r.id && <Check className="w-3.5 h-3.5 text-cyan-600 shrink-0" />}
                </button>
              ))}
            </div>

            {/* ── Divider ── */}
            <div className="mx-3.5 border-t border-slate-200" />

            {/* ── Groq API Key section ── */}
            <div className="px-3.5 pt-3 pb-3.5">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <KeyRound className="w-3 h-3 text-slate-400" />
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Groq API Key</span>
                </div>
                {connected
                  ? <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                      <CheckCircle2 className="w-2.5 h-2.5" /> Connected
                    </span>
                  : <span className="text-[10px] text-slate-400">Not set</span>}
              </div>

              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveKey()}
                  placeholder="gsk_…"
                  className="w-full h-8 bg-slate-50 border border-slate-200 rounded-lg pl-2.5 pr-8 text-[11px] font-mono text-slate-800 placeholder-slate-400 focus:outline-none focus:border-cyan-500/60 focus:bg-white transition-all"
                />
                <button
                  onClick={() => setShowKey(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </div>

              <div className="flex items-center justify-between mt-2">
                <p className="text-[10px] text-slate-400">
                  Stored locally ·{' '}
                  <a href="https://console.groq.com" target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="text-slate-500 hover:text-cyan-600 underline underline-offset-2 transition-colors">
                    console.groq.com
                  </a>
                </p>
                <div className="flex items-center gap-1.5">
                  {connected && (
                    <button
                      onClick={() => { setDraft(''); setApiKey('') }}
                      className="text-[10px] text-slate-400 hover:text-red-500 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    onClick={saveKey}
                    className={clsx(
                      'h-6 px-2.5 text-[10px] rounded-md font-semibold transition-all flex items-center gap-1',
                      saved
                        ? 'bg-emerald-600 text-white'
                        : 'bg-cyan-600 hover:bg-cyan-700 text-white',
                    )}
                  >
                    {saved ? <><Check className="w-2.5 h-2.5" /> Saved</> : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── TopBar ────────────────────────────────────────────────────────────────────
export default function TopBar() {
  useUrlParams()

  const view            = useStore(s => s.view)
  const role            = useStore(s => s.role)
  const coverage        = useStore(s => s.coverage)
  const setView         = useStore(s => s.setView)
  const setRole         = useStore(s => s.setRole)
  const selectTactic    = useStore(s => s.selectTactic)
  const selectTechnique = useStore(s => s.selectTechnique)

  const [query, setQuery] = useState('')
  const hits = query.trim().length > 1 ? search(query, 8) : []

  function handleHit(kind: string, id: string) {
    if (kind === 'tactic') { selectTactic(id); setView('globe') }
    else if (kind === 'technique') { selectTechnique(id); setView('matrix') }
    setQuery('')
  }

  function handleRoleChange(newRole: Role) {
    setRole(newRole)
    if      (newRole === 'detection')  setView('spl-kql')
    else if (newRole === 'purple')     setView('agentic-soc')
    else if (newRole === 'soar')       setView('soar')
    else if (newRole === 'architect')  setView('architect')
    else if (newRole === 'alert-gen')  setView('alert-gen')
    else if (newRole === 'prompt-eng') setView('prompt-eng')
    else if (['spl-kql','soar','architect','agentic-soc','prompt-eng','agent-hub'].includes(view))
      setView('globe')
  }

  return (
    <header className="topbar h-14 flex items-center px-5 gap-4 shrink-0 z-30">
      {/* Logo */}
      <div className="flex items-center gap-2.5 shrink-0 select-none">
        <div className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center">
          <Shield className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[11px] font-bold tracking-[0.2em] text-white">ATLAS</span>
          <span className="text-[11px] text-slate-600 font-medium tracking-wide">Coverage Navigator</span>
        </div>
      </div>

      <div className="h-5 w-px bg-white/[0.08] shrink-0" />

      {/* Navigation */}
      <nav className="flex items-center gap-0.5 shrink-0">
        {role !== 'purple' && (
          <>
            <NavBtn label="Globe View"    icon={<Globe          className="w-3.5 h-3.5" />} active={view==='globe'}  viewTarget="globe"  onClick={() => setView('globe')} />
            <NavBtn label="Matrix View"   icon={<Grid3x3        className="w-3.5 h-3.5" />} active={view==='matrix'} viewTarget="matrix" onClick={() => setView('matrix')} />
            <NavBtn label="Data Upload"   icon={<UploadIcon     className="w-3.5 h-3.5" />} active={view==='upload'} viewTarget="upload" onClick={() => setView('upload')} />
            <NavBtn label="Data Analyzer" icon={<ArrowRightLeft className="w-3.5 h-3.5" />} active={view==='delta'}  viewTarget="delta"  onClick={() => setView('delta')} />
          </>
        )}

        <NavBtn label="Alert Generator" icon={<Zap className="w-3.5 h-3.5" />} active={view==='alert-gen'} viewTarget="alert-gen" onClick={() => setView('alert-gen')} />
        <AlertQueueTab />

        {/* Agentic SOC sub-tabs */}
        {role === 'purple' && (
          <>
            <div className="h-4 w-px bg-white/[0.08] mx-0.5" />
            <NavBtn label="Analytics"     icon={<BarChart3 className="w-3.5 h-3.5" />} active={view==='soc-analytics'} viewTarget="soc-analytics" roleTarget="purple" onClick={() => setView('soc-analytics')} />
            <NavBtn label="Campaigns"     icon={<Layers    className="w-3.5 h-3.5" />} active={view==='soc-campaigns'} viewTarget="soc-campaigns" roleTarget="purple" onClick={() => setView('soc-campaigns')} />
            <NavBtn label="IOC Watchlist" icon={<Eye       className="w-3.5 h-3.5" />} active={view==='soc-ioc'}       viewTarget="soc-ioc"       roleTarget="purple" onClick={() => setView('soc-ioc')} />
            <NavBtn label="Agent Hub"     icon={<Network   className="w-3.5 h-3.5" />} active={view==='agent-hub'}     viewTarget="agent-hub"     roleTarget="purple" onClick={() => setView('agent-hub')} />
          </>
        )}

        {/* Prompt Engineering tab */}
        {role === 'prompt-eng' && (
          <>
            <div className="h-4 w-px bg-white/[0.08] mx-0.5" />
            <NavBtn label="Studio" icon={<Sparkles className="w-3.5 h-3.5" />} active={view==='prompt-eng'} viewTarget="prompt-eng" roleTarget="prompt-eng" onClick={() => setView('prompt-eng')} />
          </>
        )}

        {/* Detection Engineer exclusive */}
        {role === 'detection' && (
          <>
            <div className="h-4 w-px bg-black/[0.10] mx-1" />
            <NavBtn
              label="Query Translator"
              icon={<Code2 className="w-3.5 h-3.5" />}
              active={view==='spl-kql'}
              viewTarget="spl-kql"
              roleTarget="detection"
              onClick={() => setView('spl-kql')}
              badge={
                <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-100 border border-cyan-200 text-cyan-700 leading-none">
                  DE
                </span>
              }
            />
          </>
        )}
      </nav>

      {/* Search */}
      <div className="relative flex-1 max-w-sm mx-auto">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600 pointer-events-none" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search tactics & techniques…"
          className="w-full h-9 bg-white/[0.04] border border-white/[0.08] rounded-lg pl-9 pr-3 text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500/40 focus:bg-white/[0.06] transition-all"
        />
        {hits.length > 0 && (
          <div className="absolute top-full mt-1.5 w-full panel-elevated rounded-xl border border-white/[0.08] z-50 overflow-hidden shadow-2xl">
            {hits.map(h => (
              <button
                key={h.id}
                onClick={() => handleHit(h.kind, h.id)}
                className="w-full text-left px-4 py-2.5 hover:bg-white/[0.04] transition-colors border-b border-white/[0.05] last:border-0"
              >
                <div className="text-sm text-slate-200 font-medium">{h.title}</div>
                <div className="text-[11px] font-mono text-slate-500 mt-0.5">{h.kind} · {h.subtitle}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3 ml-auto shrink-0">
        {coverage && (
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.07]">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse-soft shrink-0" />
            <span className="text-xs text-slate-400 font-medium truncate max-w-[130px]">{coverage.name}</span>
          </div>
        )}

        {/* Combined role + Groq menu */}
        <RoleMenu role={role} onRoleChange={handleRoleChange} />
      </div>
    </header>
  )
}
