import { useEffect, useRef } from 'react'
import { useStore } from '../../lib/store'
import { USE_CASES, groqGenerateAlert, parseAlert, buildAlertQueueItem, GROQ_KEY_STORAGE } from './alertGenUtils'

// Headless component — always mounted in App, keeps auto-gen running across tab switches.
export default function AlertGeneratorBackground() {
  const autoGenMode           = useStore(s => s.autoGenMode)
  const autoGenInterval       = useStore(s => s.autoGenInterval)
  const autoGenUseCase        = useStore(s => s.autoGenUseCase)
  const autoGenRotate         = useStore(s => s.autoGenRotate)
  const pushAlert             = useStore(s => s.pushAlert)
  const setAutoGenLastFiredAt = useStore(s => s.setAutoGenLastFiredAt)

  // Auto-clear threshold: once the queue holds this many processed alerts,
  // prune them so long auto runs don't balloon the queue.
  const QUEUE_PRUNE_THRESHOLD = 60

  // Prevent overlapping in-flight Groq calls
  const inFlight = useRef(false)

  useEffect(() => {
    if (!autoGenMode) return

    let mounted = true

    const run = async () => {
      if (inFlight.current) return
      const apiKey = localStorage.getItem(GROQ_KEY_STORAGE)?.trim()
      if (!apiKey) return

      // When rotate is on, pick a random use case each tick
      const uc = autoGenRotate
        ? USE_CASES[Math.floor(Math.random() * USE_CASES.length)]
        : (USE_CASES.find(u => u.id === autoGenUseCase) ?? USE_CASES[0])

      inFlight.current = true
      try {
        const raw  = await groqGenerateAlert(apiKey, uc)
        if (!mounted) return
        const data = parseAlert(raw)
        const qi   = buildAlertQueueItem(data, uc)
        pushAlert(qi)
        setAutoGenLastFiredAt(Date.now())

        // Auto-clear processed alerts when the queue gets full
        const queue = useStore.getState().alertQueue
        if (queue.length >= QUEUE_PRUNE_THRESHOLD) {
          useStore.getState().pruneProcessedAlerts()
        }
      } catch {
        // silent — errors visible in Alert Generator tab if user is watching
      } finally {
        inFlight.current = false
      }
    }

    // Fire immediately, then on interval
    run()
    const timer = setInterval(run, autoGenInterval * 1000)

    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [autoGenMode, autoGenInterval, autoGenUseCase, autoGenRotate, pushAlert, setAutoGenLastFiredAt])

  return null
}
