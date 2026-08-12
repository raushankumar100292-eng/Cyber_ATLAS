import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronDown, Plug, PlugZap, AlertTriangle,
  Loader2, ShieldCheck, Unplug,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAgentProStore, type AiProvider } from '../../lib/agentProStore'
import {
  connectToMasterAgent,
  disconnectFromMasterAgent,
  getMasterStatus,
} from '../../services/masterAgentService'

// ── Provider metadata ─────────────────────────────────────────────────────────
interface ProviderMeta {
  id: AiProvider
  label: string
  description: string
  activeColor: string
  dotColor: string
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: 'claude-cli',
    label: 'Claude Code CLI',
    description: 'Anthropic Claude via local CLI bridge',
    activeColor: 'bg-violet-500',
    dotColor: 'bg-violet-400',
  },
  {
    id: 'grok',
    label: 'Grok',
    description: 'Groq LLM API (llama-3.3-70b)',
    activeColor: 'bg-emerald-500',
    dotColor: 'bg-emerald-400',
  },
]

// ── Toggle switch ─────────────────────────────────────────────────────────────
function ProviderToggle({
  enabled,
  disabled,
  activeColor,
  onChange,
}: {
  enabled: boolean
  disabled: boolean
  activeColor: string
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={onChange}
      className={clsx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-1',
        enabled ? activeColor : 'bg-slate-200',
        disabled && 'opacity-40 cursor-not-allowed',
        !disabled && 'cursor-pointer',
      )}
    >
      <span
        className={clsx(
          'inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200',
          enabled ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function AgentProConnectionPanel() {
  const {
    masterAgentUrl, setMasterAgentUrl,
    masterAgentId, setMasterAgentId,
    connected, connectedAt, sessionId,
    connecting, disconnecting,
    error,
    enabledProvider, toggleProvider,
    claudeAvailable, setClaudeAvailable,
    setConnected, setDisconnected,
    setConnecting, setDisconnecting, setError,
  } = useAgentProStore()

  const [open, setOpen]         = useState(true)
  const [secretKey, setSecretKey] = useState('')
  const [showKey, setShowKey]   = useState(false)

  // ── Poll Claude CLI health while connected (distinct from session health) ──
  useEffect(() => {
    if (!connected || !sessionId) return
    let cancelled = false
    const check = async () => {
      const status = await getMasterStatus(masterAgentUrl, sessionId)
      if (!cancelled) setClaudeAvailable(status.claudeAvailable)
    }
    check()
    const iv = setInterval(check, 15000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [connected, sessionId, masterAgentUrl, setClaudeAvailable])

  // ── Connect ────────────────────────────────────────────────────────────────
  async function handleConnect() {
    if (!secretKey.trim()) {
      setError('Secret key is required.')
      return
    }
    setConnecting(true)
    setError(null)
    const result = await connectToMasterAgent(masterAgentUrl, {
      masterAgentId: masterAgentId.trim(),
      secretKey: secretKey.trim(),
    })
    if (result.connected && result.sessionId && result.connectedAt) {
      setConnected(result.sessionId, result.connectedAt)
    } else {
      setError(result.error ?? 'Authentication failed.')
    }
  }

  // ── Disconnect ─────────────────────────────────────────────────────────────
  async function handleDisconnect() {
    setDisconnecting(true)
    await disconnectFromMasterAgent(masterAgentUrl, sessionId ?? undefined)
    setDisconnected()
    setSecretKey('')
  }

  const canConnect = !!secretKey.trim() && !connecting && !connected
  const formattedAt = connectedAt
    ? new Date(connectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  return (
    <div
      className={clsx(
        'rounded-2xl border shadow-sm overflow-hidden',
        'bg-gradient-to-br from-white/90 via-violet-50/30 to-slate-50/60 backdrop-blur-sm',
        connected ? 'border-emerald-200/70' : 'border-violet-200/60',
      )}
    >
      {/* ── Header (collapsible toggle) ── */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left select-none hover:bg-white/40 transition-colors"
      >
        <div
          className={clsx(
            'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors',
            connected
              ? 'bg-emerald-100 border border-emerald-200'
              : 'bg-violet-100 border border-violet-200',
          )}
        >
          {connected
            ? <PlugZap className="w-3.5 h-3.5 text-emerald-600" />
            : <Plug className="w-3.5 h-3.5 text-violet-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-slate-800 leading-none">Agent Pro Connection</p>
          <p className={clsx(
            'text-[10px] mt-0.5 font-medium',
            connected ? 'text-emerald-600' : 'text-slate-400',
          )}>
            {connected ? `Connected · ${formattedAt}` : 'Not connected'}
          </p>
        </div>
        {/* Status dot */}
        <span className={clsx(
          'w-2 h-2 rounded-full shrink-0',
          connected ? 'bg-emerald-500 shadow-[0_0_6px_1px_rgba(52,211,153,0.5)]' : 'bg-red-400',
        )} />
        <ChevronDown
          className={clsx(
            'w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {/* ── Collapsible body ── */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4 border-t border-slate-100/80">

              {/* ── Section 1: Master Agent ── */}
              <div className="pt-3 space-y-3">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                  Master Agent
                </p>

                {/* URL */}
                <div>
                  <label className="text-[11px] font-medium text-slate-600 block mb-1">
                    Master Agent URL
                  </label>
                  <input
                    type="url"
                    value={masterAgentUrl}
                    onChange={e => setMasterAgentUrl(e.target.value)}
                    disabled={connected}
                    placeholder="http://localhost:3000"
                    className={clsx(
                      'w-full h-8 text-xs rounded-lg px-3 border transition-colors',
                      'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400',
                      'focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/10',
                      connected && 'opacity-50 cursor-not-allowed',
                    )}
                  />
                </div>

                {/* Master Agent ID (read-only reference) */}
                <div>
                  <label className="text-[11px] font-medium text-slate-600 block mb-1">
                    Master Agent ID
                    <span className="ml-1 text-slate-400 font-normal">(reference only)</span>
                  </label>
                  <input
                    type="text"
                    value={masterAgentId}
                    onChange={e => setMasterAgentId(e.target.value)}
                    readOnly={connected}
                    placeholder="e.g. agt_xxxxxxxx"
                    className={clsx(
                      'w-full h-8 text-xs rounded-lg px-3 border transition-colors',
                      'bg-slate-50 border-slate-200 text-slate-700 placeholder-slate-400 font-mono',
                      'focus:outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-500/10',
                      connected && 'opacity-60 cursor-default',
                    )}
                  />
                </div>

                {/* Secret Key */}
                <div>
                  <label className="text-[11px] font-medium text-slate-600 block mb-1">
                    Secret Key
                    <span className="text-red-400 ml-0.5">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={secretKey}
                      onChange={e => setSecretKey(e.target.value)}
                      disabled={connected}
                      placeholder="Enter your secret key"
                      className={clsx(
                        'w-full h-8 text-xs rounded-lg px-3 pr-14 border transition-colors',
                        'bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400',
                        'focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/10',
                        connected && 'opacity-50 cursor-not-allowed',
                        !connected && !secretKey && error && 'border-red-300',
                      )}
                      onKeyDown={e => { if (e.key === 'Enter' && canConnect) handleConnect() }}
                    />
                    {!connected && (
                      <button
                        type="button"
                        onClick={() => setShowKey(s => !s)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 hover:text-slate-600 transition-colors px-1"
                      >
                        {showKey ? 'hide' : 'show'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Error */}
                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-1.5 text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
                    >
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Buttons + Status */}
                <div className="flex items-center gap-2 flex-wrap">
                  {!connected ? (
                    <button
                      type="button"
                      onClick={handleConnect}
                      disabled={!canConnect}
                      className={clsx(
                        'flex items-center gap-1.5 h-8 px-4 rounded-lg text-xs font-semibold transition-all shadow-sm',
                        canConnect
                          ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-violet-200/60'
                          : 'bg-slate-100 text-slate-400 cursor-not-allowed',
                      )}
                    >
                      {connecting
                        ? <><Loader2 className="w-3 h-3 animate-spin" /> Connecting…</>
                        : <><Plug className="w-3 h-3" /> Connect</>}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleDisconnect}
                      disabled={disconnecting}
                      className="flex items-center gap-1.5 h-8 px-4 rounded-lg text-xs font-semibold bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition-colors"
                    >
                      {disconnecting
                        ? <><Loader2 className="w-3 h-3 animate-spin" /> Disconnecting…</>
                        : <><Unplug className="w-3 h-3" /> Disconnect</>}
                    </button>
                  )}

                  {/* Status badge */}
                  {connected ? (
                    <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1">
                      <ShieldCheck className="w-3 h-3" />
                      <span className="font-medium">Authenticated</span>
                      <span className="text-emerald-500">·</span>
                      <span className="text-emerald-600">Connected since {formattedAt}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                      Not Connected
                    </div>
                  )}
                </div>
              </div>

              {/* ── System status: Agent Pro vs Claude CLI (distinct signals) ── */}
              {connected && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-600">Agent Pro</span>
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_1px_rgba(52,211,153,0.5)]" /> Connected
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-600">Claude CLI</span>
                    {claudeAvailable === null ? (
                      <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                        <Loader2 className="w-3 h-3 animate-spin" /> Checking…
                      </span>
                    ) : claudeAvailable ? (
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_1px_rgba(52,211,153,0.5)]" /> Available
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-red-600">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_5px_1px_rgba(239,68,68,0.5)]" /> Unavailable
                      </span>
                    )}
                  </div>
                  {claudeAvailable === false && (
                    <p className="text-[10px] text-red-500 pt-0.5 flex items-center gap-1">
                      <AlertTriangle className="w-2.5 h-2.5 shrink-0" /> Request cannot be executed — Claude CLI is unavailable.
                    </p>
                  )}
                </div>
              )}

              {/* ── Divider ── */}
              <div className="border-t border-slate-100" />

              {/* ── Section 2: AI Providers ── */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                  AI Providers
                </p>

                {!connected && (
                  <div className="flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    Connect to Agent Pro before using AI providers.
                  </div>
                )}

                <div className="space-y-1.5">
                  {PROVIDERS.map(provider => {
                    const isOn = enabledProvider === provider.id
                    const isDisabled = !connected

                    return (
                      <div
                        key={provider.id}
                        className={clsx(
                          'flex items-center justify-between px-3 py-2.5 rounded-xl border transition-colors',
                          isOn && connected
                            ? 'border-slate-300 bg-white shadow-sm'
                            : 'border-slate-200 bg-slate-50/60',
                          isDisabled && 'opacity-60',
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {isOn && connected && (
                              <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0 animate-pulse', provider.dotColor)} />
                            )}
                            <p className="text-xs font-semibold text-slate-700">{provider.label}</p>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-0.5">{provider.description}</p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          <span className={clsx(
                            'text-[10px] font-bold',
                            isOn && connected ? 'text-emerald-600' : 'text-slate-400',
                          )}>
                            {isOn && connected ? 'ON' : 'OFF'}
                          </span>
                          <ProviderToggle
                            enabled={isOn && connected}
                            disabled={isDisabled}
                            activeColor={provider.activeColor}
                            onChange={() => {
                              if (!connected) return
                              toggleProvider(provider.id)
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
