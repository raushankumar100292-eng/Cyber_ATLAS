import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import AcnImmersiveTab from './AcnImmersiveTab'
import AgentStudioTab from './AgentStudioTab'
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

// Standalone tabs carry a query flag so they render only their own experience
// instead of the full dashboard:
//   ?acn=immersive → ACN immersive mode
//   ?studio=1      → AI Agent Studio (light-themed plug-and-play editor)
const params = new URLSearchParams(window.location.search)
const isImmersiveTab = params.get('acn') === 'immersive'
const isStudioTab    = params.get('studio') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isImmersiveTab ? <AcnImmersiveTab /> : isStudioTab ? <AgentStudioTab /> : <App />}
    </ErrorBoundary>
  </StrictMode>
)
