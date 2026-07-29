import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import AcnImmersiveTab from './AcnImmersiveTab'
import { ATLAS_BUILD } from './lib/store'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          position: 'fixed', inset: 0, background: '#04060f',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', fontFamily: 'monospace', color: '#ff2d55', gap: 16, padding: 32
        }}>
          <div style={{ fontSize: 18, color: '#00e5ff' }}>ATLAS CC — Startup Error</div>
          <pre style={{ fontSize: 12, color: '#ff2d55', maxWidth: 800, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {(this.state.error as Error).message}
            {'\n\n'}
            {(this.state.error as Error).stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

// Build marker (defined in store) — confirms the browser is running fresh code.
console.log(`%c[ATLAS build] ${ATLAS_BUILD}`, 'color:#00e5ff;font-weight:bold')

// A tab opened via "Launch Immersive Mode" / "Tik Tik ON" carries ?acn=immersive
// so it renders only the immersive experience instead of the full dashboard.
const isImmersiveTab = new URLSearchParams(window.location.search).get('acn') === 'immersive'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isImmersiveTab ? <AcnImmersiveTab /> : <App />}
    </ErrorBoundary>
  </StrictMode>
)
