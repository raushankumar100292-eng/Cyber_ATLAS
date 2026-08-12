import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wand2, Copy, Check, RefreshCw, ChevronDown, X,
  Loader2, Info, Sparkles,
  BookOpen, Trash2, Plus, Send,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useStore } from '../../lib/store'
import {
  streamRephrasePrompt,
  type RephraseStyle,
  REPHRASE_STYLE_META,
} from '../../lib/splKqlGroq'
import { useAgentProStore } from '../../lib/agentProStore'
import {
  executeOnMasterAgent,
  listTasks,
  getTaskThread,
  type TaskSummary,
  type ThreadMessage,
} from '../../services/masterAgentService'
import AgentProConnectionPanel from './AgentProConnectionPanel'
import ServerHealthWidget from './ServerHealthWidget'

const STYLE_COLORS: Record<RephraseStyle, string> = {
  'clearer':          'text-cyan-700 bg-cyan-50 border-cyan-200',
  'concise':          'text-violet-700 bg-violet-50 border-violet-200',
  'detailed':         'text-emerald-700 bg-emerald-50 border-emerald-200',
  'formal':           'text-slate-700 bg-slate-100 border-slate-300',
  'chain-of-thought': 'text-amber-700 bg-amber-50 border-amber-200',
  'few-shot':         'text-rose-700 bg-rose-50 border-rose-200',
}

// ── History entry ─────────────────────────────────────────────────────────────
interface HistoryEntry {
  id: string
  original: string
  rephrased: string
  style: RephraseStyle
  createdAt: number
}

// ── History sidebar entry ─────────────────────────────────────────────────────
function HistoryItem({
  entry, onRestore, onDelete,
}: { entry: HistoryEntry; onRestore: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={clsx('rounded-xl border transition-colors', open ? 'border-slate-300 bg-slate-50' : 'border-slate-200 bg-white')}>
      <div onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none">
        <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0', STYLE_COLORS[entry.style])}>
          {REPHRASE_STYLE_META[entry.style].label}
        </span>
        <p className="text-xs text-slate-700 truncate flex-1">{entry.original.slice(0, 60)}{entry.original.length > 60 ? '…' : ''}</p>
        <ChevronDown className={clsx('w-3 h-3 text-slate-400 shrink-0 transition-transform', open && 'rotate-180')} />
      </div>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div>
            <p className="text-[10px] text-slate-400 font-medium mb-1 uppercase tracking-wide">Original</p>
            <p className="text-xs text-slate-600 whitespace-pre-wrap">{entry.original}</p>
          </div>
          <div>
            <p className="text-[10px] text-slate-400 font-medium mb-1 uppercase tracking-wide">Rephrased</p>
            <p className="text-xs text-slate-800 whitespace-pre-wrap">{entry.rephrased}</p>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onRestore} className="flex-1 h-7 text-xs rounded-lg bg-cyan-50 border border-cyan-200 text-cyan-700 hover:bg-cyan-100 transition-colors flex items-center justify-center gap-1">
              <RefreshCw className="w-3 h-3" /> Restore
            </button>
            <button onClick={onDelete} className="h-7 px-3 text-xs rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition-colors">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function PromptEngineeringView() {
  const apiKey   = useStore(s => s.apiKey)
  const { connected, enabledProvider, sessionId, masterAgentUrl, claudeAvailable } = useAgentProStore()

  const [prompt, setPrompt]       = useState('')
  const [context, setContext]     = useState('')
  const [style, setStyle]         = useState<RephraseStyle>('clearer')
  const [rephrased, setRephrased] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError]         = useState('')
  const [copied, setCopied]       = useState(false)
  const [history, setHistory]     = useState<HistoryEntry[]>([])
  const [showContext, setShowContext] = useState(false)

  // ── Agent Pro execution state ──
  const [agentRunning, setAgentRunning]   = useState(false)
  const [agentError, setAgentError]       = useState('')
  const [taskId, setTaskId]               = useState<string | null>(null) // active conversation
  const [messages, setMessages]           = useState<ThreadMessage[]>([])  // active thread
  const [conversations, setConversations] = useState<TaskSummary[]>([])    // sidebar list
  const [sidebarTab, setSidebarTab]       = useState<'conversations' | 'history'>('conversations')

  const abortRef = useRef(false)

  // Load the conversation list whenever connected.
  const refreshConversations = async () => {
    if (!connected || !sessionId) return
    setConversations(await listTasks(masterAgentUrl, sessionId))
  }
  useEffect(() => { refreshConversations() }, [connected, sessionId, masterAgentUrl])

  const canRephrase  = !!apiKey && !!prompt.trim() && !streaming
  // Claude CLI must not be known-down (null = still checking, allow optimistically)
  const canSendViaAgentPro = connected && !!enabledProvider && !!prompt.trim() && claudeAvailable !== false

  async function handleSendViaAgentPro() {
    if (!canSendViaAgentPro || agentRunning) return
    if (!sessionId) { setAgentError('No active session — reconnect to Agent Pro.'); return }
    const sent = prompt.trim()
    setAgentRunning(true)
    setAgentError('')
    setMessages(prev => [...prev, { role: 'user', content: sent }]) // optimistic
    const result = await executeOnMasterAgent(masterAgentUrl, sessionId, sent, taskId ?? undefined)
    setAgentRunning(false)
    if (result.success) {
      setMessages(prev => [...prev, { role: 'assistant', content: result.response ?? '' }])
      if (result.taskId) setTaskId(result.taskId)  // keep / start the thread
      setPrompt('')
      refreshConversations()
    } else {
      setMessages(prev => prev.slice(0, -1))        // roll back the optimistic user turn
      setAgentError(result.error ?? 'Execution failed')
    }
  }

  function handleNewConversation() {
    setTaskId(null); setMessages([]); setAgentError('')
  }

  async function openConversation(id: string) {
    if (!sessionId) return
    setTaskId(id)
    setAgentError('')
    setMessages(await getTaskThread(masterAgentUrl, sessionId, id))
  }

  async function handleRephrase() {
    if (!canRephrase) return
    abortRef.current = false
    setStreaming(true)
    setRephrased('')
    setError('')

    let full = ''
    streamRephrasePrompt(apiKey, { prompt: prompt.trim(), style, context: context.trim() || undefined }, {
      onToken: t => { full += t; setRephrased(full) },
      onDone:  f => {
        setRephrased(f)
        setHistory(prev => [{
          id: Math.random().toString(36).slice(2),
          original: prompt.trim(),
          rephrased: f,
          style,
          createdAt: Date.now(),
        }, ...prev].slice(0, 20))
        setStreaming(false)
      },
      onError: e => { setError(e); setStreaming(false) },
    })
  }

  function handleCopy() {
    navigator.clipboard.writeText(rephrased).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function handleUseRephrased() {
    setPrompt(rephrased)
    setRephrased('')
  }

  function handleClear() {
    setPrompt(''); setRephrased(''); setError('')
  }

  return (
    <div className="h-full flex overflow-hidden bg-[#F8FAFC]">

      {/* ── Left: Main editor ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center gap-3 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-violet-100 border border-violet-200 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-violet-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">Prompt Engineering Studio</p>
            <p className="text-xs text-slate-500">Write, rephrase and refine AI prompts with style guidance</p>
          </div>
          <div className="ml-auto">
            <ServerHealthWidget />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-4">

          {/* ── Agent Pro connection panel ── */}
          <AgentProConnectionPanel />

          {/* ── Prompt input panel ── */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-xs font-semibold text-slate-700">Your Prompt</span>
                {prompt && (
                  <span className="text-[10px] text-slate-400 font-mono">{prompt.length} chars</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setShowContext(s => !s)}
                  className={clsx('flex items-center gap-1 h-6 px-2 rounded-md text-[11px] border transition-colors',
                    showContext ? 'bg-slate-100 border-slate-300 text-slate-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50')}>
                  <Info className="w-3 h-3" /> Context
                </button>
                {prompt && (
                  <button onClick={handleClear}
                    className="h-6 px-2 rounded-md text-[11px] border border-slate-200 text-slate-500 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors">
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Optional context field */}
            <AnimatePresence>
              {showContext && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                  className="overflow-hidden border-b border-slate-100">
                  <div className="px-4 py-2">
                    <p className="text-[10px] text-slate-400 mb-1">What is this prompt for? (optional — helps guide the rephrase)</p>
                    <input value={context} onChange={e => setContext(e.target.value)}
                      placeholder="e.g. A SOC analyst asking an AI assistant to triage alerts…"
                      className="w-full h-8 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/10" />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={8}
              placeholder={`Write your prompt here…\n\nExample:\n"Analyze the following security alert and determine if it is a true positive or false positive. Provide your reasoning and recommended action."`}
              className="w-full font-mono text-sm text-slate-800 placeholder-slate-400 bg-white px-4 py-3 resize-none focus:outline-none leading-relaxed"
            />
          </div>

          {/* ── Style selector + Rephrase button ── */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <p className="text-xs font-semibold text-slate-700 mb-3">Rephrase Style</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
              {(Object.keys(REPHRASE_STYLE_META) as RephraseStyle[]).map(s => (
                <button key={s} onClick={() => setStyle(s)}
                  className={clsx('flex flex-col gap-0.5 text-left p-2.5 rounded-xl border transition-all',
                    style === s
                      ? `${STYLE_COLORS[s]} ring-2 ring-offset-1 ring-current/30 shadow-sm`
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50')}>
                  <span className="text-xs font-semibold">{REPHRASE_STYLE_META[s].label}</span>
                  <span className="text-[10px] opacity-70 leading-tight">{REPHRASE_STYLE_META[s].description}</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={handleRephrase} disabled={!canRephrase}
                className={clsx(
                  'flex items-center gap-2 h-10 px-6 rounded-xl font-semibold text-sm transition-all shadow-sm',
                  canRephrase
                    ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-violet-200'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed',
                )}>
                {streaming
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Rephrasing…</>
                  : <><Wand2 className="w-4 h-4" /> Rephrase</>}
              </button>

              {/* Send via Agent Pro — runs the prompt on the connected agent */}
              <button
                onClick={handleSendViaAgentPro}
                disabled={!canSendViaAgentPro || agentRunning}
                title={
                  !connected
                    ? 'Connect to Agent Pro before using AI providers.'
                    : claudeAvailable === false
                      ? 'Claude CLI is unavailable — request cannot be executed.'
                      : !enabledProvider
                        ? 'Enable a provider (Claude Code CLI) first.'
                        : 'Run this prompt on the connected agent'
                }
                className={clsx(
                  'flex items-center gap-2 h-10 px-5 rounded-xl font-semibold text-sm transition-all border',
                  canSendViaAgentPro && !agentRunning
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm shadow-emerald-200 hover:bg-emerald-700'
                    : 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed',
                )}
              >
                {agentRunning
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Running…</>
                  : <><Send className="w-4 h-4" /> Send via Agent Pro</>}
              </button>

              {apiKey
                ? <span className={clsx('text-[11px] px-2 py-0.5 rounded-full border font-medium', STYLE_COLORS[style])}>
                    {REPHRASE_STYLE_META[style].label}
                  </span>
                : <span className="text-xs text-slate-400">Set your Groq API key in the top bar to enable rephrasing</span>
              }
            </div>
          </div>

          {/* ── Error ── */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
              <X className="w-3.5 h-3.5 shrink-0 mt-0.5" />{error}
            </div>
          )}

          {/* ── Rephrased output ── */}
          <AnimatePresence>
            {(rephrased || streaming) && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="bg-white rounded-2xl border border-violet-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-violet-100 bg-violet-50/60 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-violet-600" />
                    <span className="text-xs font-semibold text-violet-800">Rephrased Prompt</span>
                    <span className={clsx('text-[10px] px-1.5 py-0.5 rounded border font-semibold', STYLE_COLORS[style])}>
                      {REPHRASE_STYLE_META[style].label}
                    </span>
                  </div>
                  {rephrased && !streaming && (
                    <div className="flex items-center gap-1.5">
                      <button onClick={handleUseRephrased}
                        className="flex items-center gap-1 h-6 px-2.5 rounded-md text-[11px] bg-violet-100 border border-violet-200 text-violet-700 hover:bg-violet-200 transition-colors font-medium">
                        <Plus className="w-3 h-3" /> Use as prompt
                      </button>
                      <button onClick={handleCopy}
                        className={clsx('flex items-center gap-1 h-6 px-2.5 rounded-md text-[11px] border transition-colors',
                          copied ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50')}>
                        {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                      </button>
                    </div>
                  )}
                </div>

                <div className="px-4 py-4 min-h-[80px] relative">
                  {streaming && !rephrased && (
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…
                    </div>
                  )}
                  <p className="font-mono text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                    {rephrased}
                    {streaming && <span className="inline-block w-0.5 h-4 bg-violet-500 animate-pulse ml-0.5 align-middle" />}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Agent Pro conversation (thread) ── */}
          {(messages.length > 0 || agentRunning || agentError) && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-emerald-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-emerald-100 bg-emerald-50/60 flex items-center gap-2">
                <Send className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-xs font-semibold text-emerald-800">Agent Pro Conversation</span>
                {taskId && (
                  <span className="text-[10px] font-medium text-violet-600 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5" title={taskId}>
                    {messages.length} message{messages.length === 1 ? '' : 's'}
                  </span>
                )}
                {agentRunning && <span className="text-[10px] text-slate-400">running…</span>}
                {(taskId || messages.length > 0) && !agentRunning && (
                  <button onClick={handleNewConversation}
                    className="ml-auto flex items-center gap-1 h-6 px-2.5 rounded-md text-[11px] bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                    <Plus className="w-3 h-3" /> New
                  </button>
                )}
              </div>
              <div className="px-4 py-4 space-y-3 max-h-[440px] overflow-auto">
                {messages.map((m, i) => (
                  <div key={i} className={clsx('flex flex-col gap-1', m.role === 'user' ? 'items-end' : 'items-start')}>
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                      {m.role === 'user' ? 'You' : 'Agent'}
                    </span>
                    <div className={clsx('max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed',
                      m.role === 'user'
                        ? 'bg-violet-50 border border-violet-100 text-slate-800'
                        : 'bg-slate-50 border border-slate-200 text-slate-800 font-mono')}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {agentRunning && (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Waiting for the agent… (Claude CLI can take ~20–30s)
                  </div>
                )}
                {agentError && (
                  <div className="flex items-start gap-2 text-xs text-red-700">
                    <X className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {agentError}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ── Tips ── */}
          {!prompt && !rephrased && messages.length === 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { icon: '🎯', title: 'Be specific', tip: 'Describe the exact output format, length, and constraints you need.' },
                { icon: '🔗', title: 'Add context', tip: 'Use the Context field to tell the rephraser what the prompt is for.' },
                { icon: '🔄', title: 'Iterate', tip: 'Rephrase multiple times with different styles, then use "Use as prompt" to chain.' },
              ].map(t => (
                <div key={t.title} className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="text-lg mb-1">{t.icon}</div>
                  <p className="text-xs font-semibold text-slate-700">{t.title}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{t.tip}</p>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>

      {/* ── Right sidebar: Conversations + Rephrase History ── */}
      <div className="w-72 shrink-0 border-l border-slate-200 bg-white flex flex-col overflow-hidden">
        {/* Tabs */}
        <div className="flex items-center gap-1 px-3 pt-3 shrink-0">
          {(['conversations', 'history'] as const).map(tab => (
            <button key={tab} onClick={() => setSidebarTab(tab)}
              className={clsx('flex-1 h-7 rounded-lg text-[11px] font-semibold transition-colors',
                sidebarTab === tab ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:text-slate-600')}>
              {tab === 'conversations' ? 'Conversations' : 'History'}
            </button>
          ))}
        </div>

        {sidebarTab === 'conversations' ? (
          <>
            <div className="px-3 pt-2 pb-2 shrink-0">
              <button onClick={handleNewConversation} disabled={!connected}
                className={clsx('w-full h-8 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 border transition-colors',
                  connected ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed')}>
                <Plus className="w-3 h-3" /> New conversation
              </button>
            </div>
            <div className="flex-1 overflow-auto px-3 pb-3 space-y-1.5">
              {!connected ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2 text-center">
                  <BookOpen className="w-6 h-6 text-slate-200" />
                  <p className="text-xs text-slate-400">Connect to Agent Pro to see conversations</p>
                </div>
              ) : conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2 text-center">
                  <BookOpen className="w-6 h-6 text-slate-200" />
                  <p className="text-xs text-slate-400">No conversations yet</p>
                </div>
              ) : (
                conversations.map(c => (
                  <button key={c.taskId} onClick={() => openConversation(c.taskId)}
                    className={clsx('w-full text-left rounded-xl border px-3 py-2 transition-colors',
                      taskId === c.taskId ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-white hover:bg-slate-50')}>
                    <p className="text-xs font-medium text-slate-700 truncate">{c.title || 'Untitled conversation'}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{c.turns} message{c.turns === 1 ? '' : 's'}</p>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between shrink-0">
              <span className="text-[11px] font-semibold text-slate-500">Rephrase history</span>
              {history.length > 0 && (
                <button onClick={() => setHistory([])}
                  className="text-[11px] text-slate-400 hover:text-red-500 transition-colors">Clear all</button>
              )}
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2 text-center">
                  <BookOpen className="w-6 h-6 text-slate-200" />
                  <p className="text-xs text-slate-400">Rephrased prompts appear here</p>
                </div>
              ) : (
                history.map(entry => (
                  <HistoryItem
                    key={entry.id}
                    entry={entry}
                    onRestore={() => { setPrompt(entry.rephrased); setRephrased('') }}
                    onDelete={() => setHistory(prev => prev.filter(e => e.id !== entry.id))}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>

    </div>
  )
}
