import { useEffect, useRef } from 'react'
import { useStore, QUEUE_PRUNE_THRESHOLD } from '../../lib/store'
import {
  USE_CASES, groqGenerateAlert, localGenerateAlert, parseAlert, buildAlertQueueItem,
  localGenerateIndustryAlert, groqGenerateIndustryAlert, pickIndustryTechnique, ucForTactic,
} from './alertGenUtils'
import { getIndustryProfile } from '../../data/industryKB'

// Headless component — always mounted in App, keeps auto-gen running across tab switches.
//
// Behaviour (matches the manual controls):
//  • Auto OFF                 → never generates here (manual button generates one).
//  • Auto ON, rotate OFF      → generates the *selected* use case, one per interval.
//  • Auto ON, rotate ON       → cycles through the use cases ONE BY ONE (sequential),
//                               one per interval — never a burst of all at once.
// The timer only resets on mode/interval change; changing the selected use case or
// toggling rotate is read live at the next tick, so it never fires an extra alert.
export default function AlertGeneratorBackground() {
  const autoGenMode     = useStore(s => s.autoGenMode)
  const autoGenInterval = useStore(s => s.autoGenInterval)

  const inFlight  = useRef(false) // prevents overlapping in-flight Groq calls
  const rotateIdx = useRef(0)     // sequential cursor for rotate mode

  useEffect(() => {
    if (!autoGenMode) return
    let mounted = true

    const run = async () => {
      if (inFlight.current) return
      const st      = useStore.getState()
      const apiKey  = st.apiKey?.trim()
      const profile = getIndustryProfile(st.industryKey)
      const industryActive = st.autoGenIndustryMode && !!profile

      inFlight.current = true
      try {
        if (industryActive && profile) {
          // Industry mode: rotate = sequential through the sector baseline; else random.
          const tech = st.autoGenRotate
            ? pickIndustryTechnique(profile, rotateIdx.current++)
            : pickIndustryTechnique(profile)
          let data, uc
          if (apiKey) {
            data = parseAlert(await groqGenerateIndustryAlert(apiKey, profile, tech))
            uc = ucForTactic(tech.tactic)
          } else {
            const gen = localGenerateIndustryAlert(profile, tech)
            data = gen.alert; uc = gen.uc
          }
          if (!mounted) return
          st.pushAlert(buildAlertQueueItem(data, uc))
          st.setAutoGenLastFiredAt(Date.now())
        } else {
          // Standard mode: pick exactly ONE use case for this tick.
          let uc
          if (st.autoGenRotate) {
            uc = USE_CASES[rotateIdx.current % USE_CASES.length]
            rotateIdx.current = (rotateIdx.current + 1) % USE_CASES.length
          } else {
            uc = USE_CASES.find(u => u.id === st.autoGenUseCase) ?? USE_CASES[0]
          }
          const data = apiKey ? parseAlert(await groqGenerateAlert(apiKey, uc)) : localGenerateAlert(uc)
          if (!mounted) return
          st.pushAlert(buildAlertQueueItem(data, uc))
          st.setAutoGenLastFiredAt(Date.now())
        }
        // Keep the queue lean during long runs
        if (useStore.getState().alertQueue.length >= QUEUE_PRUNE_THRESHOLD) {
          useStore.getState().pruneProcessedAlerts()
        }
      } catch {
        // Groq failed — fall back to a local alert so generation never stalls
        try {
          if (!mounted) return
          if (industryActive && profile) {
            const { alert, uc } = localGenerateIndustryAlert(profile)
            st.pushAlert(buildAlertQueueItem(alert, uc))
          } else {
            const uc = USE_CASES.find(u => u.id === st.autoGenUseCase) ?? USE_CASES[0]
            st.pushAlert(buildAlertQueueItem(localGenerateAlert(uc), uc))
          }
          st.setAutoGenLastFiredAt(Date.now())
        } catch { /* give up this tick */ }
      } finally {
        inFlight.current = false
      }
    }

    // First alert fires ~50ms after mount, then one per interval.
    // Deferring the initial run via setTimeout (rather than calling run()
    // synchronously) makes it StrictMode-safe: dev-mode's mount → cleanup →
    // mount cycle cancels the first timer, so only the surviving mount fires it.
    const kick = setTimeout(run, 50)
    const timer = setInterval(run, autoGenInterval * 1000)

    return () => { mounted = false; clearTimeout(kick); clearInterval(timer) }
  }, [autoGenMode, autoGenInterval])

  return null
}
