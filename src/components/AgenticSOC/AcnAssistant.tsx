import { useState, useRef, useEffect, useCallback } from 'react'
import { useStore } from '../../lib/store'
import AcnImmersive from './AcnImmersive'
import AcnChat from './AcnChat'

// ── Accenture brand ───────────────────────────────────────────────────────────
const ACN = {
  purple: '#A100FF', purpleHi: '#C64AFF', purpleDk: '#6A00B0',
  ink: '#0B0E17', panel: '#141024', line: '#2A2140', text: '#ECE9F5', mut: '#9A92B8',
}

// ── Web Speech (wake word) typings ─────────────────────────────────────────────
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

const WAKE = /tik tik on|tick tick on|tik tok on|tiktik on/i

export default function AcnAssistant() {
  const geminiKey    = useStore(s => s.geminiKey)
  const setGeminiKey = useStore(s => s.setGeminiKey)

  const [immersive, setImmersive] = useState(false)
  const [chat,      setChat]      = useState(false)   // text chat mode
  const [open,      setOpen]      = useState(false)   // launcher popover
  const [armed,     setArmed]     = useState(false)   // wake-word listening
  const [keyDraft,  setKeyDraft]  = useState('')
  const [heard,     setHeard]     = useState('')

  const wakeRef    = useRef<SRLike | null>(null)
  const armedRef   = useRef(false)
  const immersRef  = useRef(false)
  const popRef     = useRef<HTMLDivElement>(null)

  useEffect(() => { armedRef.current = armed }, [armed])
  useEffect(() => { immersRef.current = immersive }, [immersive])

  // close popover on outside click
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  // ── Wake-word listener (continuous) ────────────────────────────────────────────
  const stopWake = useCallback(() => {
    try { wakeRef.current?.abort() } catch { /* ignore */ }
    wakeRef.current = null
  }, [])

  const startWake = useCallback(() => {
    const recog = newRecognition()
    if (!recog) return
    recog.lang = 'en-US'; recog.continuous = true; recog.interimResults = true
    recog.onresult = (e) => {
      let txt = ''
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript
      setHeard(txt.trim().slice(-40))
      if (WAKE.test(txt)) {
        setHeard(''); setOpen(false)
        stopWake()
        setImmersive(true)
      }
    }
    recog.onerror = () => { /* keep armed; onend will restart */ }
    recog.onend = () => {
      // auto-restart while armed and not in immersive mode
      if (armedRef.current && !immersRef.current) { try { recog.start() } catch { /* ignore */ } }
    }
    wakeRef.current = recog
    try { recog.start() } catch { /* ignore */ }
  }, [stopWake])

  const toggleArm = useCallback(() => {
    setArmed(a => {
      const next = !a
      if (next) startWake(); else stopWake()
      return next
    })
  }, [startWake, stopWake])

  useEffect(() => () => stopWake(), [stopWake])

  // When entering immersive, pause the wake listener; resume on exit if still armed.
  const exitImmersive = useCallback(() => {
    setImmersive(false)
    if (armedRef.current) setTimeout(startWake, 400)
  }, [startWake])

  const launchNow = () => { setOpen(false); stopWake(); setImmersive(true) }
  const openChat  = () => { setOpen(false); setChat(true) }

  return (
    <>
      <style>{`
        @keyframes acn-ring { to { transform: rotate(360deg) } }
        @keyframes acn-float3d { 0%,100%{ transform: translateY(0) rotateY(-18deg) } 50%{ transform: translateY(-2px) rotateY(18deg) } }
        @keyframes acn-in { from{opacity:0;transform:translateY(-8px) scale(.97)} to{opacity:1;transform:none} }
        @keyframes acn-livepulse { 0%,100%{ box-shadow:0 0 0 0 rgba(51,214,196,.5) } 50%{ box-shadow:0 0 0 6px rgba(51,214,196,0) } }
        .acn-mark3d { color:#fff; font-weight:900; line-height:1; font-family:Arial,sans-serif;
          text-shadow: 1px 1px 0 ${ACN.purpleHi}, 2px 2px 0 ${ACN.purple}, 3px 3px 0 ${ACN.purpleDk}, 4px 4px 1px rgba(60,0,110,.9), 5px 6px 6px rgba(0,0,0,.55); }
      `}</style>

      {/* ── Floating 3D launcher ── */}
      <div ref={popRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <button onClick={() => setOpen(o => !o)} title="ACN — AI SOC Assistant"
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px) scale(1.06)' }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
          style={{
            position: 'relative', width: 42, height: 42, borderRadius: '50%', border: 'none', cursor: 'pointer',
            background: `radial-gradient(circle at 32% 26%, #F4E0FF 0%, ${ACN.purpleHi} 26%, ${ACN.purple} 58%, ${ACN.purpleDk} 100%)`,
            boxShadow: `inset 0 2px 4px rgba(255,255,255,.55), inset 0 -5px 9px rgba(40,0,80,.7), 0 0 0 1px ${ACN.purple}55, 0 6px 16px ${ACN.purple}77`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'transform .18s ease', perspective: 220,
          }}>
          <span style={{ position: 'absolute', top: 4, left: 8, right: 12, height: 12, borderRadius: '50%', background: 'linear-gradient(180deg, rgba(255,255,255,.6), rgba(255,255,255,0))', pointerEvents: 'none' }} />
          <span className="acn-mark3d" style={{ fontSize: 19, transform: 'translateX(-1px)', animation: 'acn-float3d 4s ease-in-out infinite' }}>&gt;</span>
          <span style={{ position: 'absolute', inset: -3, borderRadius: '50%', borderWidth: 2, borderStyle: 'solid', borderTopColor: 'transparent', borderRightColor: ACN.purpleHi, borderBottomColor: ACN.purpleHi, borderLeftColor: ACN.purpleHi, animation: 'acn-ring 3s linear infinite', opacity: 0.7 }} />
        </button>
        {/* armed indicator */}
        {armed && !immersive && (
          <span title="Listening for 'Tik Tik ON'" style={{ position: 'absolute', top: -2, right: -2, width: 10, height: 10, borderRadius: '50%', background: '#33D6C4', border: '2px solid ' + ACN.ink, animation: 'acn-livepulse 1.6s infinite' }} />
        )}

        {/* ── Launcher popover ── */}
        {open && !immersive && (
          <div style={{ position: 'absolute', top: 'calc(100% + 10px)', left: '50%', transform: 'translateX(-50%)', width: 268, background: ACN.panel, border: `1px solid ${ACN.line}`, borderRadius: 14, padding: 14, zIndex: 1000, boxShadow: '0 16px 44px rgba(0,0,0,.55)', animation: 'acn-in .16s ease both', fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: `radial-gradient(circle at 32% 26%, #F4E0FF, ${ACN.purpleHi} 30%, ${ACN.purpleDk})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="acn-mark3d" style={{ fontSize: 14 }}>&gt;</span>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: ACN.text }}>ACN Assistant</div>
                <div style={{ fontSize: 9.5, color: ACN.purpleHi, textTransform: 'uppercase', letterSpacing: 1 }}>Voice-first · Multi-agent</div>
              </div>
            </div>

            <p style={{ fontSize: 11, color: ACN.mut, lineHeight: 1.5, margin: '0 0 12px' }}>
              Say <b style={{ color: ACN.purpleHi }}>“Tik Tik ON”</b> to launch the immersive voice experience — or launch it directly below.
            </p>

            <button onClick={launchNow}
              style={{ width: '100%', height: 38, borderRadius: 9, border: 'none', background: `linear-gradient(90deg, ${ACN.purple}, ${ACN.purpleHi})`, color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', marginBottom: 8 }}>
              ▶ Launch Immersive Mode
            </button>

            <button onClick={openChat}
              style={{ width: '100%', height: 36, borderRadius: 9, border: `1px solid ${ACN.purple}55`, background: `${ACN.purple}12`, color: ACN.text, fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              💬 Chat Mode
            </button>

            <button onClick={toggleArm}
              style={{ width: '100%', height: 34, borderRadius: 9, border: `1px solid ${armed ? '#33D6C4' : ACN.line}`, background: armed ? 'rgba(51,214,196,0.10)' : 'transparent', color: armed ? '#33D6C4' : ACN.mut, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              🎙 {armed ? 'Listening for “Tik Tik ON”' : 'Arm hands-free wake word'}
            </button>
            {armed && heard && <div style={{ fontSize: 9, color: ACN.mut, marginTop: 6, textAlign: 'center', fontStyle: 'italic' }}>…{heard}</div>}

            {!geminiKey.trim() && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${ACN.line}` }}>
                <div style={{ fontSize: 10, color: ACN.mut, marginBottom: 6 }}>Gemini API key (powers ACN):</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={keyDraft} onChange={e => setKeyDraft(e.target.value)} type="password" placeholder="AIza…"
                    style={{ flex: 1, height: 30, background: ACN.ink, border: `1px solid ${ACN.line}`, borderRadius: 7, padding: '0 9px', color: ACN.text, fontSize: 11, outline: 'none' }} />
                  <button onClick={() => { if (keyDraft.trim()) { setGeminiKey(keyDraft.trim()); setKeyDraft('') } }}
                    style={{ height: 30, padding: '0 12px', borderRadius: 7, border: 'none', background: ACN.purple, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Save</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Immersive full-screen mode ── */}
      {immersive && <AcnImmersive onExit={exitImmersive} />}

      {/* ── Text chat mode ── */}
      {chat && <AcnChat onClose={() => setChat(false)} />}
    </>
  )
}
