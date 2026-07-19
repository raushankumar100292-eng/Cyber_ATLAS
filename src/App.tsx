import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from './lib/store'
import TopBar from './components/HUD/TopBar'
import GlobeScene from './components/Globe/GlobeScene'
import MatrixView from './components/Matrix/MatrixView'
import DetailPanel from './components/Panel/DetailPanel'
import HoverIntelPanel from './components/Panel/HoverIntelPanel'
import Sidebar from './components/Dashboard/Sidebar'
import SidebarStrip from './components/Dashboard/SidebarStrip'
import UploadPanel from './components/Upload/UploadPanel'
import DeltaView from './components/Delta/DeltaView'
import QueryTranslatorView from './components/QueryTranslator/QueryTranslatorView'
import SoarView from './components/SOAR/SoarView'
import ArchitectView from './components/Architect/ArchitectView'
import AlertGeneratorView from './components/AgenticSOC/AlertGeneratorView'
import AlertGeneratorBackground from './components/AgenticSOC/AlertGeneratorBackground'
import SocTriageView from './components/AgenticSOC/SocTriageView'
import AgenticSOCOperationView from './components/AgenticSOC/AgenticSOCOperationView'
import SocAnalyticsView from './components/AgenticSOC/SocAnalyticsView'
import CampaignDetectionView from './components/AgenticSOC/CampaignDetectionView'
import IocWatchlistView from './components/AgenticSOC/IocWatchlistView'
import PromptEngineeringView from './components/PromptEngineering/PromptEngineeringView'
import AgentHubView from './components/AgentHub/AgentHubView'

const STRIP_W   = 52    // collapsed width in px
const EXPAND_W  = '50%' // expanded: 50% of the flex row container

export default function App() {
  const view               = useStore(s => s.view)
  const coverage           = useStore(s => s.coverage)
  const selectedTacticId   = useStore(s => s.selectedTacticId)
  const selectedTechniqueId = useStore(s => s.selectedTechniqueId)

  const isUploadView      = view === 'upload'
  const isDeltaView       = view === 'delta'
  const isSplKqlView      = view === 'spl-kql'
  const isSoarView        = view === 'soar'
  const isArchitectView   = view === 'architect'
  const isAgenticSOCView  = view === 'agentic-soc'
  const isAlertGenView    = view === 'alert-gen'
  const isSocTriageView   = view === 'soc-triage'
  const isSocAnalyticsView  = view === 'soc-analytics'
  const isCampaignsView     = view === 'soc-campaigns'
  const isIocView           = view === 'soc-ioc'
  const isPromptEngView     = view === 'prompt-eng'
  const isAgentHubView      = view === 'agent-hub'
  const isFullPageView    = isUploadView || isDeltaView || isSplKqlView || isSoarView || isArchitectView || isAgenticSOCView || isAlertGenView || isSocTriageView || isSocAnalyticsView || isCampaignsView || isIocView || isPromptEngView || isAgentHubView

  const hasDetail    = (selectedTacticId !== null || selectedTechniqueId !== null) && view !== 'globe'
  const hasCoverage  = coverage !== null
  const showLeft     = hasCoverage && !isFullPageView

  // ── Left panel expand / collapse ─────────────────────────────────────────
  const [leftOpen,   setLeftOpen]   = useState(false)
  const [leftPinned, setLeftPinned] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const handlePanelEnter = useCallback(() => {
    clearCloseTimer()
    setLeftOpen(true)
  }, [clearCloseTimer])

  const handlePanelLeave = useCallback(() => {
    if (leftPinned) return
    clearCloseTimer()
    closeTimer.current = setTimeout(() => {
      setLeftOpen(false)
      closeTimer.current = null
    }, 260)
  }, [leftPinned, clearCloseTimer])

  const forceCollapse = useCallback(() => {
    setLeftPinned(false)
    setLeftOpen(false)
  }, [])

  const togglePin = useCallback(() => {
    setLeftPinned(p => {
      if (p) {
        // unpinning: start close timer
        closeTimer.current = setTimeout(() => {
          setLeftOpen(false)
          closeTimer.current = null
        }, 260)
      }
      return !p
    })
  }, [])

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-app bg-grid">
      <AlertGeneratorBackground />
      <TopBar />

      <div className="flex flex-1 min-h-0 relative">

        {/* ── Left Intelligence Panel ── */}
        <AnimatePresence initial={false}>
          {showLeft && (
            <motion.div
              key="left-panel"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.22 }}
              onMouseEnter={handlePanelEnter}
              onMouseLeave={handlePanelLeave}
              style={{
                /* Width is driven by CSS transition for px→% interpolation */
                width: leftOpen ? EXPAND_W : STRIP_W,
                transition: 'width 0.44s cubic-bezier(0.4, 0, 0.2, 1)',
                flexShrink: 0,
                position: 'relative',
                overflow: 'hidden',
                zIndex: 30,
              }}
            >
              {/* Collapsed strip — fades out when panel opens */}
              <motion.div
                animate={{ opacity: leftOpen ? 0 : 1 }}
                transition={{ duration: 0.15 }}
                style={{
                  position: 'absolute',
                  left: 0, top: 0, bottom: 0,
                  width: STRIP_W,
                  pointerEvents: leftOpen ? 'none' : 'auto',
                }}
              >
                <SidebarStrip />
              </motion.div>

              {/* Expanded full panel — fades in after width starts growing */}
              <motion.div
                animate={{ opacity: leftOpen ? 1 : 0 }}
                transition={{ duration: 0.2, delay: leftOpen ? 0.12 : 0 }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: leftOpen ? 'auto' : 'none',
                  minWidth: 360,
                }}
              >
                <Sidebar
                  onCollapse={forceCollapse}
                  pinned={leftPinned}
                  onTogglePin={togglePin}
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Main content ── */}
        <main className="flex-1 relative overflow-hidden">

          {/* Always-mounted outside AnimatePresence so the queue subscription never drops */}
          <div style={{
            position: 'absolute', inset: 0,
            visibility: isAgenticSOCView ? 'visible' : 'hidden',
            pointerEvents: isAgenticSOCView ? 'auto' : 'none',
            zIndex: isAgenticSOCView ? 1 : 0,
          }}>
            <AgenticSOCOperationView />
          </div>

          <AnimatePresence mode="wait">

            {isUploadView && (
              <motion.div key="upload" style={{ width: '100%', height: '100%' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}>
                <UploadPanel />
              </motion.div>
            )}

            {isDeltaView && (
              <motion.div key="delta" style={{ width: '100%', height: '100%' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}>
                <DeltaView />
              </motion.div>
            )}

            {isSplKqlView && (
              <motion.div key="spl-kql" style={{ width: '100%', height: '100%' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}>
                <QueryTranslatorView />
              </motion.div>
            )}

            {isSoarView && (
              <motion.div key="soar" style={{ width: '100%', height: '100%' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}>
                <SoarView />
              </motion.div>
            )}

            {isArchitectView && (
              <motion.div key="architect" style={{ width: '100%', height: '100%' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}>
                <ArchitectView />
              </motion.div>
            )}

            {isAlertGenView && (
              <motion.div key="alert-gen" style={{ width: '100%', height: '100%' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}>
                <AlertGeneratorView />
              </motion.div>
            )}

            {isSocTriageView && (
              <motion.div key="soc-triage" style={{ width: '100%', height: '100%' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}>
                <SocTriageView />
              </motion.div>
            )}

            {isSocAnalyticsView && (
              <motion.div key="soc-analytics" style={{ width: '100%', height: '100%' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}>
                <SocAnalyticsView />
              </motion.div>
            )}

            {isCampaignsView && (
              <motion.div key="soc-campaigns" style={{ width: '100%', height: '100%' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}>
                <CampaignDetectionView />
              </motion.div>
            )}

            {isIocView && (
              <motion.div key="soc-ioc" style={{ width: '100%', height: '100%' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}>
                <IocWatchlistView />
              </motion.div>
            )}

            {isPromptEngView && (
              <motion.div key="prompt-eng" style={{ width: '100%', height: '100%' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}>
                <PromptEngineeringView />
              </motion.div>
            )}

            {isAgentHubView && (
              <motion.div key="agent-hub" style={{ width: '100%', height: '100%' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}>
                <AgentHubView />
              </motion.div>
            )}

            {view === 'globe' && (
              <motion.div key="globe" style={{ width: '100%', height: '100%' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}>
                <GlobeScene />
              </motion.div>
            )}

            {view === 'matrix' && (
              <motion.div key="matrix" style={{ width: '100%', height: '100%' }}
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}>
                <MatrixView />
              </motion.div>
            )}

          </AnimatePresence>

          {/* Detail panel */}
          <AnimatePresence>
            {hasDetail && !isFullPageView && (
              <motion.div
                key="detail"
                style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: 340, zIndex: 20 }}
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', stiffness: 340, damping: 34 }}
              >
                <DetailPanel />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Hover Intel Panel (right side) */}
        {!isFullPageView && <HoverIntelPanel />}
      </div>
    </div>
  )
}
