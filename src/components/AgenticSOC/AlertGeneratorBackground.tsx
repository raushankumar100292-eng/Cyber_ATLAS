import { useEffect, useRef } from 'react'
import { useStore, QUEUE_PRUNE_THRESHOLD } from '../../lib/store'
import { USE_CASES, groqGenerateAlert, localGenerateAlert, parseAlert, buildAlertQueueItem } from './alertGenUtils'

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
      const st     = useStore.getState()
      const apiKey = st.apiKey?.trim()

      // Pick exactly ONE use case for this tick.
      let uc
      if (st.autoGenRotate) {
        uc = USE_CASES[rotateIdx.current % USE_CASES.length]
        rotateIdx.current = (rotateIdx.current + 1) % USE_CASES.length
      } else {
        uc = USE_CASES.find(u => u.id === st.autoGenUseCase) ?? USE_CASES[0]
      }

      inFlight.current = true
      try {
        let data
        if (apiKey) {
          const raw = await groqGenerateAlert(apiKey, uc)
          data = parseAlert(raw)
        } else {
          data = localGenerateAlert(uc) // no key → local synthetic alert
        }
        if (!mounted) return
        st.pushAlert(buildAlertQueueItem(data, uc))
        st.setAutoGenLastFiredAt(Date.now())
        // Keep the queue lean during long runs
        if (useStore.getState().alertQueue.length >= QUEUE_PRUNE_THRESHOLD) {
          useStore.getState().pruneProcessedAlerts()
        }
      } catch {
        // Groq failed — fall back to a local alert so generation never stalls
        try {
          if (!mounted) return
          const data = localGenerateAlert(uc)
          st.pushAlert(buildAlertQueueItem(data, uc))
          st.setAutoGenLastFiredAt(Date.now())
        } catch { /* give up this tick */ }
      } finally {
        inFlight.current = false
      }
    }

    run() // first alert immediately when auto is enabled, then one per interval
    const timer = setInterval(run, autoGenInterval * 1000)

    return () => { mounted = false; clearInterval(timer) }
  }, [autoGenMode, autoGenInterval])

  return null
}
