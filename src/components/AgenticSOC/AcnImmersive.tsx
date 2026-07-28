import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useStore } from '../../lib/store'
import {
  AGENT_ROSTER, agentById, acnDecompose, acnRunAgent, acnSynthesize,
  type AgentFinding,
} from '../../lib/acnOrchestrator'
import type { ChatTurn } from '../../lib/gemini'

// ── Accenture brand ───────────────────────────────────────────────────────────
const ACN = {
  purple: '#A100FF', purpleHi: '#C64AFF', purpleDk: '#6A00B0',
  ink: '#05060D', text: '#ECE9F5', mut: '#8E86AC',
}

// ── Web Speech typings ──────────────────────────────────────────────────────────
interface SRResult { transcript: string }
interface SREvent { results: ArrayLike<ArrayLike<SRResult> & { isFinal: boolean }> }
interface SRLike {
  lang: string; continuous: boolean; interimResults: boolean
  start: () => void; stop: () => void; abort: () => void
  onresult: ((e: SREvent) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}
function newRecognition(): SRLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SRLike; webkitSpeechRecognition?: new () => SRLike }
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return C ? new C() : null
}

type Phase = 'idle' | 'listening' | 'decomposing' | 'agents' | 'debating' | 'synthesizing' | 'speaking'
type AgentState = 'idle' | 'assigned' | 'thinking' | 'reported'

const forSpeech = (t: string) => t.replace(/[*_`#>|•]/g, '').replace(/\n{2,}/g, '. ').slice(0, 900)
const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Ready', listening: 'Listening…', decomposing: 'Decomposing request…',
  agents: 'Agents analysing…', debating: 'Agents collaborating…',
  synthesizing: 'Synthesizing consensus…', speaking: 'Responding…',
}

export default function AcnImmersive({ onExit }: { onExit: () => void }) {
  const geminiKey = useStore(s => s.geminiKey)

  const [phase,      setPhase]      = useState<Phase>('idle')
  const [caption,    setCaption]    = useState('')          // what the user said
  const [reply,      setReply]      = useState('')          // ACN's spoken reply (text)
  const [intent,     setIntent]     = useState('')
  const [interim,    setInterim]    = useState('')
  const [error,      setError]      = useState('')
  const [agentState, setAgentState] = useState<Record<string, AgentState>>({})
  const [findings,   setFindings]   = useState<Record<string, string>>({})
  const [dims,       setDims]       = useState({ w: window.innerWidth, h: window.innerHeight })

  const recogRef   = useRef<SRLike | null>(null)
  const mountedRef = useRef(true)
  const phaseRef   = useRef<Phase>('idle')
  const historyRef = useRef<ChatTurn[]>([])
  const busyRef    = useRef(false)
  const setPhaseSafe = (p: Phase) => { phaseRef.current = p; if (mountedRef.current) setPhase(p) }

  useEffect(() => {
    const onResize = () => setDims({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ── Node geometry (constellation around ACN) ──────────────────────────────────
  const geo = useMemo(() => {
    const cx = dims.w / 2, cy = dims.h / 2
    const radius = Math.max(150, Math.min(dims.w, dims.h) * 0.33)
    const N = AGENT_ROSTER.length
    const nodes = AGENT_ROSTER.map((a, i) => {
      const ang = (-90 + i * (360 / N)) * (Math.PI / 180)
      return { agent: a, x: cx + radius * Math.cos(ang), y: cy + radius * Math.sin(ang) }
    })
    return { cx, cy, radius, nodes }
  }, [dims])

  // ── TTS ────────────────────────────────────────────────────────────────────────
  const speak = useCallback((text: string) => new Promise<void>((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return resolve()
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(forSpeech(text))
      u.rate = 1.03; u.pitch = 1.0
      const v = window.speechSynthesis.getVoices().find(x => /Google (UK|US) English|Natural|Microsoft/i.test(x.name))
      if (v) u.voice = v
      u.onend = () => resolve()
      u.onerror = () => resolve()
      window.speechSynthesis.speak(u)
    } catch { resolve() }
  }), [])

  // ── The core turn: decompose → agents → synthesize → speak ─────────────────────
  const runTurn = useCallback(async (utterance: string) => {
    if (busyRef.current) return
    busyRef.current = true
    setError(''); setReply(''); setCaption(utterance)
    setFindings({}); setAgentState({})
    try {
      const ctx = (() => { const s = useStore.getState(); return { alertQueue: s.alertQueue, resolvedIncidents: s.resolvedIncidents, trainedAgents: s.trainedAgents } })()

      // 1) Decompose
      setPhaseSafe('decomposing')
      const plan = await acnDecompose(geminiKey.trim(), utterance, ctx, historyRef.current)
      if (!mountedRef.current) return
      setIntent(plan.intent)

      // Ambiguous → ask a follow-up and listen again
      if (plan.clarify) {
        setReply(plan.clarify)
        setPhaseSafe('speaking')
        await speak(plan.clarify)
        historyRef.current = [...historyRef.current, { role: 'user' as const, text: utterance }, { role: 'model' as const, text: plan.clarify }].slice(-12)
        busyRef.current = false
        listen()
        return
      }
      if (plan.plan.length === 0) plan.plan.push({ agentId: 'investigation', task: utterance })

      // 2) Activate assigned agents
      const assigned = plan.plan.map(p => ({ agent: agentById(p.agentId)!, task: p.task })).filter(x => x.agent)
      setAgentState(Object.fromEntries(assigned.map(a => [a.agent.id, 'assigned' as AgentState])))
      await wait(500)
      setPhaseSafe('agents')

      // 3) Run agents in parallel, flipping state as each reports
      const results: AgentFinding[] = []
      await Promise.all(assigned.map(async ({ agent, task }) => {
        setAgentState(s => ({ ...s, [agent.id]: 'thinking' }))
        try {
          const finding = await acnRunAgent(geminiKey.trim(), agent, task, ctx)
          if (!mountedRef.current) return
          results.push({ agent, task, finding })
          setFindings(f => ({ ...f, [agent.id]: finding }))
        } catch {
          results.push({ agent, task, finding: `${agent.name} could not complete its analysis.` })
        }
        setAgentState(s => ({ ...s, [agent.id]: 'reported' }))
      }))
      if (!mountedRef.current) return

      // 4) Collaboration/debate beat, then synthesize
      setPhaseSafe('debating')
      await wait(1100)
      setPhaseSafe('synthesizing')
      const answer = await acnSynthesize(geminiKey.trim(), utterance, results, ctx, historyRef.current)
      if (!mountedRef.current) return
      historyRef.current = [...historyRef.current, { role: 'user' as const, text: utterance }, { role: 'model' as const, text: answer }].slice(-12)

      // 5) Speak, then loop back to listening
      setReply(answer)
      setPhaseSafe('speaking')
      await speak(answer)
      busyRef.current = false
      listen()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setPhaseSafe('speaking')
      await speak('I hit a problem reaching my reasoning engine.')
      busyRef.current = false
      listen()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geminiKey, speak])

  // ── Listen (STT) ─────────────────────────────────────────────────────────────
  const listen = useCallback(() => {
    if (!mountedRef.current || busyRef.current) return
    const recog = newRecognition()
    if (!recog) { setError('Voice input needs Chrome or Edge.'); return }
    recog.lang = 'en-US'; recog.continuous = false; recog.interimResults = true
    let finalText = ''
    recog.onresult = (e) => {
      let itr = ''
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText += r[0].transcript; else itr += r[0].transcript
      }
      setInterim(itr)
    }
    recog.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') setError(`Voice: ${e.error}`) }
    recog.onend = () => {
      setInterim('')
      if (!mountedRef.current) return
      const said = finalText.trim()
      // Voice exit
      if (/tik tik off|exit immersive|close acn|stand down/i.test(said)) { onExit(); return }
      if (said) runTurn(said)
      else if (phaseRef.current === 'listening') listen() // keep the mic open on silence
    }
    recogRef.current = recog
    setPhaseSafe('listening')
    try { recog.start() } catch { /* already started */ }
  }, [runTurn, onExit])

  // ── Boot: greet, then start listening ──────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true
    const greeting = geminiKey.trim()
      ? "I'm online. Speak your request and my agents will work on it together."
      : "Add your Gemini key to activate my agent team. Say tik tik off to exit."
    ;(async () => {
      setPhaseSafe('speaking'); setReply(greeting)
      await speak(greeting)
      if (mountedRef.current && geminiKey.trim()) listen()
      else setPhaseSafe('idle')
    })()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onExit() }
    window.addEventListener('keydown', onKey)
    return () => {
      mountedRef.current = false
      window.removeEventListener('keydown', onKey)
      try { recogRef.current?.abort() } catch { /* ignore */ }
      try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const busy = phase !== 'idle' && phase !== 'listening'
  const orbColor = phase === 'listening' ? '#33D6C4' : phase === 'speaking' ? ACN.purpleHi : phase === 'idle' ? ACN.mut : ACN.purple

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: `radial-gradient(circle at 50% 45%, #12081F 0%, ${ACN.ink} 70%)`, overflow: 'hidden', fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
      <style>{`
        @keyframes acnI-spin { to { transform: rotate(360deg) } }
        @keyframes acnI-spinR { to { transform: rotate(-360deg) } }
        @keyframes acnI-pulse { 0%,100%{ transform:scale(1); opacity:.9 } 50%{ transform:scale(1.06); opacity:1 } }
        @keyframes acnI-dash { to { stroke-dashoffset: -24 } }
        @keyframes acnI-fade { from{opacity:0} to{opacity:1} }
        @keyframes acnI-bars { 0%,100%{transform:scaleY(.35)} 50%{transform:scaleY(1)} }
        .acnI-node { transition: all .4s cubic-bezier(.4,0,.2,1); }
      `}</style>

      {/* connection lines */}
      <svg width={dims.w} height={dims.h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <defs>
          <radialGradient id="acnI-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={ACN.purpleHi} stopOpacity="0.5" />
            <stop offset="100%" stopColor={ACN.purpleHi} stopOpacity="0" />
          </radialGradient>
        </defs>
        {geo.nodes.map(({ agent, x, y }) => {
          const st = agentState[agent.id]
          const active = st === 'thinking' || st === 'reported' || st === 'assigned'
          if (!active) return null
          const flowing = st === 'thinking' || phase === 'debating'
          return (
            <line key={agent.id} x1={geo.cx} y1={geo.cy} x2={x} y2={y}
              stroke={agent.color} strokeOpacity={st === 'reported' ? 0.75 : 0.4}
              strokeWidth={st === 'reported' ? 2 : 1.4}
              strokeDasharray={flowing ? '4 6' : undefined}
              style={{ animation: flowing ? 'acnI-dash .6s linear infinite' : undefined }} />
          )
        })}
        {/* inter-agent debate lines */}
        {phase === 'debating' && geo.nodes.filter(n => agentState[n.agent.id] === 'reported').map((n, i, arr) => {
          const next = arr[(i + 1) % arr.length]
          if (arr.length < 2) return null
          return <line key={'d' + n.agent.id} x1={n.x} y1={n.y} x2={next.x} y2={next.y}
            stroke={ACN.purpleHi} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 5"
            style={{ animation: 'acnI-dash .5s linear infinite' }} />
        })}
      </svg>

      {/* agent nodes */}
      {geo.nodes.map(({ agent, x, y }) => {
        const st = agentState[agent.id] ?? 'idle'
        const on = st !== 'idle'
        const size = st === 'reported' ? 64 : st === 'thinking' ? 60 : 54
        return (
          <div key={agent.id} className="acnI-node" style={{
            position: 'absolute', left: x, top: y, transform: 'translate(-50%,-50%)',
            width: size, height: size, borderRadius: '50%',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: on ? `radial-gradient(circle at 35% 30%, ${agent.color}44, ${agent.color}10)` : 'rgba(255,255,255,0.02)',
            border: `1.5px solid ${on ? agent.color : 'rgba(255,255,255,0.10)'}`,
            boxShadow: on ? `0 0 ${st === 'thinking' ? 26 : 16}px ${agent.color}${st === 'thinking' ? '88' : '55'}` : 'none',
            opacity: on ? 1 : 0.45,
            animation: st === 'thinking' ? 'acnI-pulse 1.1s ease-in-out infinite' : undefined,
          }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: on ? '#fff' : ACN.mut, letterSpacing: 0.5 }}>{agent.short}</span>
            {st === 'reported' && <span style={{ fontSize: 8, color: agent.color }}>✓</span>}
            {st === 'thinking' && (
              <div style={{ display: 'flex', gap: 2, height: 8, alignItems: 'flex-end', marginTop: 1 }}>
                {[0,1,2].map(i => <span key={i} style={{ width: 2, height: 8, background: '#fff', borderRadius: 1, animation: 'acnI-bars .8s ease-in-out infinite', animationDelay: `${i*0.12}s` }} />)}
              </div>
            )}
            <div style={{ position: 'absolute', top: size + 4, whiteSpace: 'nowrap', fontSize: 8.5, color: on ? agent.color : 'transparent', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>{agent.name.replace(' Agent','')}</div>
          </div>
        )
      })}

      {/* central ACN orb */}
      <div style={{ position: 'absolute', left: geo.cx, top: geo.cy, transform: 'translate(-50%,-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ position: 'relative', width: 150, height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* rotating rings — per-side border colors (no shorthand/longhand mix) */}
          <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', borderWidth: 2, borderStyle: 'solid', borderTopColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: orbColor, borderLeftColor: orbColor, animation: 'acnI-spin 3.5s linear infinite', opacity: 0.8 }} />
          <span style={{ position: 'absolute', inset: 12, borderRadius: '50%', borderWidth: 1.5, borderStyle: 'solid', borderTopColor: orbColor, borderRightColor: orbColor, borderBottomColor: 'transparent', borderLeftColor: 'transparent', animation: 'acnI-spinR 5s linear infinite', opacity: 0.6 }} />
          <span style={{ position: 'absolute', inset: -18, borderRadius: '50%', boxShadow: `0 0 60px 10px ${orbColor}55` }} />
          {/* core */}
          <div style={{ width: 96, height: 96, borderRadius: '50%', background: `radial-gradient(circle at 34% 28%, #F4E0FF, ${ACN.purpleHi} 32%, ${ACN.purple} 64%, ${ACN.purpleDk})`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `inset 0 3px 8px rgba(255,255,255,.5), inset 0 -10px 18px rgba(40,0,80,.7), 0 0 40px ${orbColor}`, animation: busy ? 'acnI-pulse 1.5s ease-in-out infinite' : undefined }}>
            {phase === 'listening'
              ? <div style={{ display: 'flex', gap: 3, alignItems: 'center', height: 34 }}>{[0,1,2,3,4].map(i => <span key={i} style={{ width: 4, height: 30, background: '#fff', borderRadius: 2, animation: 'acnI-bars .9s ease-in-out infinite', animationDelay: `${i*0.1}s` }} />)}</div>
              : <span style={{ color: '#fff', fontWeight: 900, fontSize: 40, textShadow: '2px 2px 0 rgba(60,0,110,.6)' }}>&gt;</span>}
          </div>
        </div>
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: ACN.text, letterSpacing: 1 }}>ACN</div>
          <div style={{ fontSize: 10.5, color: orbColor, textTransform: 'uppercase', letterSpacing: 1.4, marginTop: 2 }}>{PHASE_LABEL[phase]}</div>
          {intent && busy && <div style={{ fontSize: 9.5, color: ACN.mut, marginTop: 2 }}>intent · {intent}</div>}
        </div>
      </div>

      {/* header */}
      <div style={{ position: 'absolute', top: 18, left: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: ACN.purpleHi, letterSpacing: 1 }}>&gt; ACN IMMERSIVE</span>
        <span style={{ fontSize: 10, color: ACN.mut }}>Accenture · Multi-Agent SOC</span>
      </div>
      <button onClick={onExit} title="Exit (Esc, or say 'tik tik off')"
        style={{ position: 'absolute', top: 16, right: 20, height: 34, padding: '0 14px', borderRadius: 18, border: `1px solid ${ACN.purple}55`, background: 'rgba(161,0,255,0.10)', color: ACN.text, fontSize: 12, cursor: 'pointer' }}>
        ✕ Exit
      </button>

      {/* captions */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 26, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '0 10%' }}>
        {(caption || interim) && (
          <div style={{ fontSize: 12.5, color: ACN.mut, animation: 'acnI-fade .3s ease' }}>
            <span style={{ color: '#33D6C4' }}>You:</span> {interim || caption}
          </div>
        )}
        {reply && (
          <div style={{ maxWidth: 760, textAlign: 'center', fontSize: 15, lineHeight: 1.55, color: ACN.text, animation: 'acnI-fade .3s ease' }}>
            <span style={{ color: ACN.purpleHi, fontWeight: 700 }}>ACN:</span> {reply}
          </div>
        )}
        {error && <div style={{ fontSize: 11, color: '#ff6b6b' }}>{error}</div>}
        <div style={{ fontSize: 10, color: ACN.mut, marginTop: 4 }}>Speak naturally · say <b style={{ color: ACN.purpleHi }}>“tik tik off”</b> to exit</div>
      </div>
    </div>
  )
}

function wait(ms: number) { return new Promise<void>(r => setTimeout(r, ms)) }
