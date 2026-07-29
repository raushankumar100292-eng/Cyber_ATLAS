// Standalone entry point for the ACN Immersive experience opened in its own
// browser tab (see AcnAssistant's "Launch Immersive Mode" / "Tik Tik ON").
// It mounts only AcnImmersive — no globe, no nav — but shares the same
// Zustand store (localStorage-backed keys load immediately; the live alert
// queue / resolved incidents arrive via the cross-tab snapshot sync in store.ts).
import AcnImmersive from './components/AgenticSOC/AcnImmersive'

export default function AcnImmersiveTab() {
  const exit = () => {
    // This tab only exists to host the immersive experience, so exiting closes
    // it. window.close() only succeeds for script-opened tabs (the normal
    // path, via window.open); if a user navigated here directly it's denied
    // and execution continues, so fall back to the main dashboard.
    window.close()
    window.location.href = window.location.origin + window.location.pathname
  }
  return <AcnImmersive onExit={exit} />
}
