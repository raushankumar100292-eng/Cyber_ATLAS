import { useState, useRef, useEffect, useCallback } from 'react'
import { useStore } from '../../lib/store'
import { askAcn, CAPABILITIES, type ChatTurn, type CapabilityId } from '../../lib/gemini'

// ── Accenture brand ───────────────────────────────────────────────────────────
const ACN = {
  purple:   '#A100FF', // Accenture signature purple
  purpleHi: '#C64AFF',
  purpleDk: '#6A00B0',
  ink:      '#0B0E17',
  panel:    '#121524',
  line:     '#2A2140',
  text:     '#ECE9F5',
  mut:      '#9A92B8',
}

// ── Minimal Web Speech typings (not in TS lib DOM) ────────────────────────────
interface SpeechRecognitionResultLike { transcript: string }
interface SpeechRecognitionEventLike { results: ArrayLike<ArrayLike<SpeechRecognitionResultLike> & { isFinal: boolean }> }
interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean
  start: () => void; stop: () => void
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}
function getSpeechRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}

interface Msg { role: 'user' | 'acn'; text: string; capability?: CapabilityId }

const GREETING = "Hello! I'm ACN, your AI SOC Assistant. How may I help you today, Sir?"

// Strip markdown-ish characters so TTS sounds natural
const forSpeech = (t: string) => t.replace(/[*_`#>|]/g, '').replace(/\n{2,}/g, '. ').slice(0, 700)

export default function AcnAssistant() {
  const geminiKey    = useStore(s => s.geminiKey)
  const setGeminiKey = useStore(s => s.setGeminiKey)

  const [open,       setOpen]       = useState(false)
  const [listening,  setListening]  = useState(false)
  const [thinking,   setThinking]   = useState(false)
  const [speaking,   setSpeaking]   = useState(false)
  const [interim,    setInterim]    = useState('')
  const [msgs,       setMsgs]       = useState<Msg[]>([])
  const [textInput,  setTextInput]  = useState('')
  const [keyDraft,   setKeyDraft]   = useState('')
  const [voiceOn,    setVoiceOn]    = useState(true)
  const [error,      setError]      = useState('')

  const recogRef  = useRef<SpeechRecognitionLike | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const historyRef = useRef<ChatTurn[]>([])

  const sttSupported = typeof window !== 'undefined' && !!(getSpeechRecognition())

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [msgs, interim, thinking])

  // ── Text-to-speech ──────────────────────────────────────────────────────────
  const speak = useCallback((text: string) => {
    if (!voiceOn || typeof window === 'undefined' || !window.speechSynthesis) return
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(forSpeech(text))
      u.rate = 1.02; u.pitch = 1.0
      const prefer = window.speechSynthesis.getVoices().find(v => /Google (UK|US) English|Microsoft|Natural/i.test(v.name))
      if (prefer) u.voice = prefer
      u.onstart = () => setSpeaking(true)
      u.onend   = () => setSpeaking(false)
      window.speechSynthesis.speak(u)
    } catch { /* speech synthesis unavailable */ }
  }, [voiceOn])

  const stopSpeaking = useCallback(() => {
    try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
    setSpeaking(false)
  }, [])

  // ── Send an utterance to ACN (voice or typed) ────────────────────────────────
  const send = useCallback(async (utterance: string) => {
    const text = utterance.trim()
    if (!text || thinking) return
    setError('')
    setMsgs(m => [...m, { role: 'user', text }])
    if (!geminiKey.trim()) { setError('Add your Gemini API key below to enable ACN.'); return }
    setThinking(true)
    try {
      const { alertQueue, resolvedIncidents, trainedAgents } = useStore.getState()
      const { text: reply, capability } = await askAcn(
        geminiKey.trim(), text,
        { alertQueue, resolvedIncidents, trainedAgents },
        historyRef.current,
      )
      historyRef.current = [...historyRef.current, { role: 'user' as const, text }, { role: 'model' as const, text: reply }].slice(-12)
      setMsgs(m => [...m, { role: 'acn', text: reply, capability }])
      speak(reply)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setMsgs(m => [...m, { role: 'acn', text: `I hit an error reaching my reasoning engine: ${msg}` }])
    } finally {
      setThinking(false)
    }
  }, [geminiKey, thinking, speak])

  // ── Speech-to-text ────────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    const recog = getSpeechRecognition()
    if (!recog) { setError('Voice input is not supported in this browser. Use Chrome, or type below.'); return }
    stopSpeaking()
    recog.lang = 'en-US'; recog.continuous = false; recog.interimResults = true
    let finalText = ''
    recog.onresult = (e) => {
      let interimText = ''
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        const txt = r[0].transcript
        if (r.isFinal) finalText += txt; else interimText += txt
      }
      setInterim(interimText)
    }
    recog.onerror = (e) => { setError(e.error === 'not-allowed' ? 'Microphone permission denied.' : `Voice error: ${e.error}`); setListening(false) }
    recog.onend = () => {
      setListening(false); setInterim('')
      if (finalText.trim()) send(finalText)
    }
    recogRef.current = recog
    setListening(true); setInterim('')
    recog.start()
  }, [send, stopSpeaking])

  const stopListening = useCallback(() => { try { recogRef.current?.stop() } catch { /* ignore */ } setListening(false) }, [])

  // ── Open / close ──────────────────────────────────────────────────────────────
  const launch = useCallback(() => {
    setOpen(true)
    if (msgs.length === 0) {
      setMsgs([{ role: 'acn', text: GREETING }])
      // Prime voices then greet aloud
      setTimeout(() => speak(GREETING), 250)
    }
  }, [msgs.length, speak])

  const close = useCallback(() => { stopListening(); stopSpeaking(); setOpen(false) }, [stopListening, stopSpeaking])

  useEffect(() => () => { stopListening(); stopSpeaking() }, [stopListening, stopSpeaking])

  const orbActive = listening || thinking || speaking
  const orbState  = listening ? 'listening' : thinking ? 'thinking' : speaking ? 'speaking' : 'idle'

  const QUICK = [
    { label: 'Shift report',   q: 'Give me a SOC shift report of the current situation.' },
    { label: 'Analyze threats', q: 'Analyze the current security events and highlight the top threats.' },
    { label: 'Summarize incidents', q: 'Summarize the current incidents by severity.' },
  ]

  return (
    <>
      <style>{`
        @keyframes acn-ring { 0%{transform:rotate(0)} 100%{transform:rotate(360deg)} }
        @keyframes acn-pulse { 0%,100%{transform:scale(1);opacity:.85} 50%{transform:scale(1.12);opacity:1} }
        @keyframes acn-wave { 0%,100%{transform:scaleY(.4)} 50%{transform:scaleY(1)} }
        @keyframes acn-in { from{opacity:0;transform:translateY(8px) scale(.98)} to{opacity:1;transform:none} }
        @keyframes acn-spin3d { 0%{transform:rotateY(0deg)} 100%{transform:rotateY(360deg)} }
        @keyframes acn-float3d { 0%,100%{transform:translateY(0) rotateY(-18deg)} 50%{transform:translateY(-2px) rotateY(18deg)} }
        .acn-bar { animation: acn-wave 0.9s ease-in-out infinite; transform-origin: center; }
        /* 3D extruded Accenture ">" mark */
        .acn-mark3d {
          color: #ffffff; font-weight: 900; line-height: 1; font-family: Arial, sans-serif;
          text-shadow:
            1px 1px 0 ${ACN.purpleHi}, 2px 2px 0 ${ACN.purple},
            3px 3px 0 ${ACN.purpleDk}, 4px 4px 1px rgba(60,0,110,0.9),
            5px 6px 6px rgba(0,0,0,0.55);
          transform: translateZ(0);
        }
      `}</style>

      {/* ── Floating ACN launcher (marked location) — 3D Accenture mark ── */}
      <button onClick={launch} title="ACN — AI SOC Assistant"
        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px) scale(1.06)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
        style={{
          position: 'relative', width: 42, height: 42, borderRadius: '50%', border: 'none', cursor: 'pointer',
          // spherical 3D body: bright top-left highlight → deep bottom-right
          background: `radial-gradient(circle at 32% 26%, #F4E0FF 0%, ${ACN.purpleHi} 26%, ${ACN.purple} 58%, ${ACN.purpleDk} 100%)`,
          boxShadow: `inset 0 2px 4px rgba(255,255,255,0.55), inset 0 -5px 9px rgba(40,0,80,0.7), 0 0 0 1px ${ACN.purple}55, 0 6px 16px ${ACN.purple}77, 0 2px 4px rgba(0,0,0,0.4)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          transition: 'transform 0.18s ease', perspective: 220,
        }}>
        {/* glossy top highlight */}
        <span style={{ position: 'absolute', top: 4, left: 8, right: 12, height: 12, borderRadius: '50%', background: 'linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0))', pointerEvents: 'none' }} />
        {/* Accenture ">" mark, extruded + gently rotating in 3D */}
        <span className="acn-mark3d" style={{ fontSize: 19, transform: 'translateX(-1px)', animation: 'acn-float3d 4s ease-in-out infinite' }}>&gt;</span>
        <span style={{ position: 'absolute', inset: -3, borderRadius: '50%', border: `2px solid ${ACN.purpleHi}`, borderTopColor: 'transparent', animation: 'acn-ring 3s linear infinite', opacity: 0.7 }} />
      </button>

      {/* ── Assistant panel ── */}
      {open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={close} style={{ position: 'absolute', inset: 0, background: 'rgba(4,6,15,0.55)', backdropFilter: 'blur(2px)' }} />
          <div style={{
            position: 'relative', width: 420, maxWidth: '92vw', height: '100%', background: ACN.ink,
            borderLeft: `1px solid ${ACN.line}`, display: 'flex', flexDirection: 'column',
            boxShadow: '-12px 0 40px rgba(0,0,0,0.5)', animation: 'acn-in .2s ease both',
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderBottom: `1px solid ${ACN.line}`, background: `linear-gradient(90deg, ${ACN.purple}14, transparent)` }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: `radial-gradient(circle at 32% 26%, #F4E0FF, ${ACN.purpleHi} 30%, ${ACN.purpleDk})`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `inset 0 1px 3px rgba(255,255,255,0.5), inset 0 -3px 6px rgba(40,0,80,0.6), 0 0 14px ${ACN.purple}77` }}>
                <span className="acn-mark3d" style={{ fontSize: 15 }}>&gt;</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: ACN.text, letterSpacing: 0.3 }}>ACN <span style={{ color: ACN.mut, fontWeight: 400, fontSize: 11 }}>· AI SOC Assistant</span></div>
                <div style={{ fontSize: 10, color: ACN.purpleHi, textTransform: 'uppercase', letterSpacing: 1 }}>Accenture · Agentic SOC</div>
              </div>
              <button onClick={() => setVoiceOn(v => !v)} title={voiceOn ? 'Mute voice' : 'Unmute voice'}
                style={{ background: 'transparent', border: `1px solid ${ACN.line}`, borderRadius: 8, color: voiceOn ? ACN.purpleHi : ACN.mut, cursor: 'pointer', padding: '5px 8px', fontSize: 11 }}>
                {voiceOn ? '🔊' : '🔇'}
              </button>
              <button onClick={close} style={{ background: 'transparent', border: 'none', color: ACN.mut, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>

            {/* Orb */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '18px 0 10px' }}>
              <div style={{ position: 'relative', width: 96, height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `conic-gradient(from 0deg, ${ACN.purple}, ${ACN.purpleHi}, ${ACN.purpleDk}, ${ACN.purple})`, filter: 'blur(6px)', opacity: orbActive ? 0.9 : 0.4, animation: orbActive ? 'acn-ring 2.4s linear infinite' : 'none' }} />
                <div style={{ position: 'relative', width: 74, height: 74, borderRadius: '50%', background: `radial-gradient(circle at 34% 28%, #F4E0FF 0%, ${ACN.purpleHi} 30%, ${ACN.purple} 62%, ${ACN.purpleDk} 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: orbActive ? 'acn-pulse 1.6s ease-in-out infinite' : 'none', boxShadow: `inset 0 3px 6px rgba(255,255,255,0.5), inset 0 -8px 16px rgba(40,0,80,0.7), 0 0 26px ${ACN.purple}88`, perspective: 300 }}>
                  {/* glossy top highlight */}
                  <span style={{ position: 'absolute', top: 8, left: 16, right: 22, height: 18, borderRadius: '50%', background: 'linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0))', pointerEvents: 'none' }} />
                  {listening ? (
                    <div style={{ display: 'flex', gap: 3, alignItems: 'center', height: 26 }}>
                      {[0, 1, 2, 3, 4].map(i => <span key={i} className="acn-bar" style={{ width: 3, height: 22, background: '#fff', borderRadius: 2, animationDelay: `${i * 0.12}s` }} />)}
                    </div>
                  ) : <span className="acn-mark3d" style={{ fontSize: 30, animation: 'acn-float3d 4s ease-in-out infinite' }}>&gt;</span>}
                </div>
              </div>
              <div style={{ fontSize: 11, color: ACN.mut, textTransform: 'uppercase', letterSpacing: 1 }}>
                {orbState === 'listening' ? 'Listening…' : orbState === 'thinking' ? 'Thinking…' : orbState === 'speaking' ? 'Speaking…' : 'Tap the mic to talk'}
              </div>
            </div>

            {/* Transcript */}
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {msgs.map((m, i) => (
                <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                  {m.role === 'acn' && m.capability && (
                    <div style={{ fontSize: 8.5, color: ACN.purpleHi, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>{CAPABILITIES[m.capability].label}</div>
                  )}
                  <div style={{
                    fontSize: 12.5, lineHeight: 1.5, padding: '9px 12px', borderRadius: 12, whiteSpace: 'pre-wrap',
                    background: m.role === 'user' ? `${ACN.purple}22` : ACN.panel,
                    border: `1px solid ${m.role === 'user' ? ACN.purple + '55' : ACN.line}`,
                    color: m.role === 'user' ? ACN.text : ACN.text,
                    borderBottomRightRadius: m.role === 'user' ? 3 : 12,
                    borderBottomLeftRadius: m.role === 'acn' ? 3 : 12,
                  }}>{m.text}</div>
                </div>
              ))}
              {interim && <div style={{ alignSelf: 'flex-end', fontSize: 12, color: ACN.mut, fontStyle: 'italic', padding: '4px 12px' }}>{interim}</div>}
              {thinking && <div style={{ alignSelf: 'flex-start', fontSize: 12, color: ACN.purpleHi, padding: '4px 12px' }}>ACN is analyzing…</div>}
              {error && <div style={{ fontSize: 11, color: '#ff6b6b', padding: '4px 12px' }}>{error}</div>}
            </div>

            {/* Gemini key prompt */}
            {!geminiKey.trim() && (
              <div style={{ padding: '10px 16px', borderTop: `1px solid ${ACN.line}`, background: `${ACN.purple}0C` }}>
                <div style={{ fontSize: 10.5, color: ACN.mut, marginBottom: 6 }}>Enter your Google Gemini API key to activate ACN:</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={keyDraft} onChange={e => setKeyDraft(e.target.value)} type="password" placeholder="AIza…"
                    style={{ flex: 1, height: 30, background: ACN.panel, border: `1px solid ${ACN.line}`, borderRadius: 8, padding: '0 10px', color: ACN.text, fontSize: 11, outline: 'none' }} />
                  <button onClick={() => { if (keyDraft.trim()) { setGeminiKey(keyDraft.trim()); setKeyDraft(''); setError('') } }}
                    style={{ height: 30, padding: '0 14px', borderRadius: 8, border: 'none', background: ACN.purple, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Save</button>
                </div>
              </div>
            )}

            {/* Quick actions */}
            <div style={{ display: 'flex', gap: 6, padding: '8px 16px 0', flexWrap: 'wrap' }}>
              {QUICK.map(q => (
                <button key={q.label} onClick={() => send(q.q)} disabled={thinking}
                  style={{ fontSize: 10.5, padding: '4px 10px', borderRadius: 20, border: `1px solid ${ACN.purple}44`, background: `${ACN.purple}14`, color: ACN.purpleHi, cursor: thinking ? 'default' : 'pointer' }}>
                  {q.label}
                </button>
              ))}
            </div>

            {/* Input row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 16px' }}>
              <button
                onClick={listening ? stopListening : startListening}
                disabled={thinking || !sttSupported}
                title={sttSupported ? 'Push to talk' : 'Voice not supported in this browser'}
                style={{
                  width: 44, height: 44, borderRadius: '50%', flexShrink: 0, cursor: sttSupported ? 'pointer' : 'not-allowed',
                  border: 'none', color: '#fff', fontSize: 18,
                  background: listening ? '#ff3b6b' : `radial-gradient(circle at 30% 30%, ${ACN.purpleHi}, ${ACN.purpleDk})`,
                  boxShadow: listening ? '0 0 18px #ff3b6b88' : `0 0 14px ${ACN.purple}66`,
                  opacity: sttSupported ? 1 : 0.4,
                  animation: listening ? 'acn-pulse 1.2s ease-in-out infinite' : 'none',
                }}>
                {listening ? '■' : '🎙'}
              </button>
              <input
                value={textInput} onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && textInput.trim()) { send(textInput); setTextInput('') } }}
                placeholder="Ask ACN, or tap the mic…"
                style={{ flex: 1, height: 40, background: ACN.panel, border: `1px solid ${ACN.line}`, borderRadius: 20, padding: '0 14px', color: ACN.text, fontSize: 12.5, outline: 'none' }} />
              <button onClick={() => { if (textInput.trim()) { send(textInput); setTextInput('') } }} disabled={thinking || !textInput.trim()}
                style={{ height: 40, padding: '0 16px', borderRadius: 20, border: 'none', background: textInput.trim() ? ACN.purple : ACN.line, color: '#fff', fontSize: 12, fontWeight: 700, cursor: textInput.trim() ? 'pointer' : 'default' }}>Send</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
