import { useState, useRef, useEffect, useCallback } from 'react'
import { useStore } from '../../lib/store'
import { askAcn, CAPABILITIES, type ChatTurn, type CapabilityId } from '../../lib/gemini'

// ── Accenture brand ───────────────────────────────────────────────────────────
const ACN = {
  purple: '#A100FF', purpleHi: '#C64AFF', purpleDk: '#6A00B0',
  ink: '#0B0E17', panel: '#141024', line: '#2A2140', text: '#ECE9F5', mut: '#9A92B8',
}

interface Msg { role: 'user' | 'acn'; text: string; capability?: CapabilityId }

const GREETING = "Hello! I'm ACN. Ask me about the live SOC — reports, analysis, incident summaries, or alert explanations."

// ── Web Speech (optional voice input) ──────────────────────────────────────────
interface SRLike {
  lang: string; continuous: boolean; interimResults: boolean
  start: () => void; stop: () => void
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null
}
function newRecognition(): SRLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SRLike; webkitSpeechRecognition?: new () => SRLike }
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return C ? new C() : null
}

export default function AcnChat({ onClose }: { onClose: () => void }) {
  const geminiKey    = useStore(s => s.geminiKey)
  const setGeminiKey = useStore(s => s.setGeminiKey)

  const [msgs,     setMsgs]     = useState<Msg[]>([{ role: 'acn', text: GREETING }])
  const [input,    setInput]    = useState('')
  const [thinking, setThinking] = useState(false)
  const [listening,setListening]= useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [error,    setError]    = useState('')

  const scrollRef  = useRef<HTMLDivElement>(null)
  const historyRef = useRef<ChatTurn[]>([])
  const recogRef   = useRef<SRLike | null>(null)
  const sttSupported = typeof window !== 'undefined' && !!newRecognition()

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [msgs, thinking])
  useEffect(() => () => { try { recogRef.current?.stop() } catch { /* ignore */ } }, [])

  const send = useCallback(async (utterance: string) => {
    const text = utterance.trim()
    if (!text || thinking) return
    setError(''); setInput('')
    setMsgs(m => [...m, { role: 'user', text }])
    if (!geminiKey.trim()) { setError('Add your Gemini API key below to enable ACN.'); return }
    setThinking(true)
    try {
      const { alertQueue, resolvedIncidents, trainedAgents } = useStore.getState()
      const { text: reply, capability } = await askAcn(geminiKey.trim(), text, { alertQueue, resolvedIncidents, trainedAgents }, historyRef.current)
      historyRef.current = [...historyRef.current, { role: 'user' as const, text }, { role: 'model' as const, text: reply }].slice(-12)
      setMsgs(m => [...m, { role: 'acn', text: reply, capability }])
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setMsgs(m => [...m, { role: 'acn', text: `I hit an error reaching my reasoning engine: ${msg}` }])
    } finally { setThinking(false) }
  }, [geminiKey, thinking])

  const toggleMic = useCallback(() => {
    if (listening) { try { recogRef.current?.stop() } catch { /* ignore */ } setListening(false); return }
    const recog = newRecognition()
    if (!recog) { setError('Voice input needs Chrome or Edge.'); return }
    recog.lang = 'en-US'; recog.continuous = false; recog.interimResults = true
    let finalText = ''
    recog.onresult = (e) => { for (let i = 0; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript; else setInput(r[0].transcript) } }
    recog.onerror = (e) => { if (e.error !== 'no-speech') setError(`Voice: ${e.error}`); setListening(false) }
    recog.onend = () => { setListening(false); if (finalText.trim()) send(finalText) }
    recogRef.current = recog; setListening(true); try { recog.start() } catch { /* ignore */ }
  }, [listening, send])

  const QUICK = [
    { label: 'Shift report', q: 'Give me a SOC shift report of the current situation.' },
    { label: 'Analyze threats', q: 'Analyze the current security events and highlight the top threats.' },
    { label: 'Summarize incidents', q: 'Summarize the current incidents by severity.' },
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1500, display: 'flex', justifyContent: 'flex-end' }}>
      <style>{`@keyframes acnc-in { from{opacity:0;transform:translateX(20px)} to{opacity:1;transform:none} }
        .acnc-mark { color:#fff;font-weight:900;font-family:Arial,sans-serif;text-shadow:1px 1px 0 ${ACN.purpleHi},2px 2px 0 ${ACN.purpleDk} }`}</style>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(4,6,15,0.5)', backdropFilter: 'blur(2px)' }} />
      <div style={{ position: 'relative', width: 420, maxWidth: '92vw', height: '100%', background: ACN.ink, borderLeft: `1px solid ${ACN.line}`, display: 'flex', flexDirection: 'column', boxShadow: '-12px 0 40px rgba(0,0,0,.5)', animation: 'acnc-in .2s ease both', fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '15px 18px', borderBottom: `1px solid ${ACN.line}`, background: `linear-gradient(90deg, ${ACN.purple}14, transparent)` }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: `radial-gradient(circle at 32% 26%, #F4E0FF, ${ACN.purpleHi} 30%, ${ACN.purpleDk})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="acnc-mark" style={{ fontSize: 15 }}>&gt;</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: ACN.text }}>ACN Chat</div>
            <div style={{ fontSize: 9.5, color: ACN.purpleHi, textTransform: 'uppercase', letterSpacing: 1 }}>Text mode · grounded in live SOC</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: ACN.mut, cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        {/* transcript */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {msgs.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '86%' }}>
              {m.role === 'acn' && m.capability && <div style={{ fontSize: 8.5, color: ACN.purpleHi, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 }}>{CAPABILITIES[m.capability].label}</div>}
              <div style={{ fontSize: 12.5, lineHeight: 1.5, padding: '9px 12px', borderRadius: 12, whiteSpace: 'pre-wrap', color: ACN.text,
                background: m.role === 'user' ? `${ACN.purple}22` : ACN.panel, border: `1px solid ${m.role === 'user' ? ACN.purple + '55' : ACN.line}`,
                borderBottomRightRadius: m.role === 'user' ? 3 : 12, borderBottomLeftRadius: m.role === 'acn' ? 3 : 12 }}>{m.text}</div>
            </div>
          ))}
          {thinking && <div style={{ alignSelf: 'flex-start', fontSize: 12, color: ACN.purpleHi, padding: '4px 12px' }}>ACN is analysing…</div>}
          {error && <div style={{ fontSize: 11, color: '#ff6b6b', padding: '4px 12px' }}>{error}</div>}
        </div>

        {/* gemini key */}
        {!geminiKey.trim() && (
          <div style={{ padding: '10px 16px', borderTop: `1px solid ${ACN.line}`, background: `${ACN.purple}0C` }}>
            <div style={{ fontSize: 10.5, color: ACN.mut, marginBottom: 6 }}>Enter your Gemini API key to enable ACN:</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={keyDraft} onChange={e => setKeyDraft(e.target.value)} type="password" placeholder="AIza…" style={{ flex: 1, height: 30, background: ACN.panel, border: `1px solid ${ACN.line}`, borderRadius: 8, padding: '0 10px', color: ACN.text, fontSize: 11, outline: 'none' }} />
              <button onClick={() => { if (keyDraft.trim()) { setGeminiKey(keyDraft.trim()); setKeyDraft(''); setError('') } }} style={{ height: 30, padding: '0 14px', borderRadius: 8, border: 'none', background: ACN.purple, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Save</button>
            </div>
          </div>
        )}

        {/* quick actions */}
        <div style={{ display: 'flex', gap: 6, padding: '8px 16px 0', flexWrap: 'wrap' }}>
          {QUICK.map(q => (
            <button key={q.label} onClick={() => send(q.q)} disabled={thinking}
              style={{ fontSize: 10.5, padding: '4px 10px', borderRadius: 20, border: `1px solid ${ACN.purple}44`, background: `${ACN.purple}14`, color: ACN.purpleHi, cursor: thinking ? 'default' : 'pointer' }}>{q.label}</button>
          ))}
        </div>

        {/* input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 16px' }}>
          {sttSupported && (
            <button onClick={toggleMic} disabled={thinking} title="Voice input"
              style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, cursor: 'pointer', border: 'none', color: '#fff', fontSize: 16,
                background: listening ? '#ff3b6b' : `radial-gradient(circle at 30% 30%, ${ACN.purpleHi}, ${ACN.purpleDk})` }}>{listening ? '■' : '🎙'}</button>
          )}
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && input.trim()) send(input) }}
            placeholder="Ask ACN…" style={{ flex: 1, height: 40, background: ACN.panel, border: `1px solid ${ACN.line}`, borderRadius: 20, padding: '0 14px', color: ACN.text, fontSize: 12.5, outline: 'none' }} />
          <button onClick={() => send(input)} disabled={thinking || !input.trim()}
            style={{ height: 40, padding: '0 16px', borderRadius: 20, border: 'none', background: input.trim() ? ACN.purple : ACN.line, color: '#fff', fontSize: 12, fontWeight: 700, cursor: input.trim() ? 'pointer' : 'default' }}>Send</button>
        </div>
      </div>
    </div>
  )
}
