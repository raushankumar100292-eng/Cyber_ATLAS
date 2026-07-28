import { create } from 'zustand'
import type { Role, CoverageDataset, CoverageEntry, UseCaseEntry, UseCaseAnalysis } from './types'
import { saveAlert, saveIncident, nextIncidentNo } from './socDb'

export type ViewMode = 'globe' | 'matrix' | 'upload' | 'delta' | 'spl-kql' | 'soar' | 'architect' | 'agentic-soc' | 'alert-gen' | 'soc-triage' | 'soc-analytics' | 'soc-campaigns' | 'soc-ioc' | 'prompt-eng' | 'agent-hub'

// ── Build marker — bump on each SOC change so we can confirm the browser is
// running fresh code (shown in the SOC header + logged to console) ────────────
export const ATLAS_BUILD = 'soc-2026-07-28-a'

// ── Alert-queue capacity (shared so UI + background runner stay in sync) ───────
export const ALERT_QUEUE_CAP = 500        // hard cap; oldest dropped beyond this
export const QUEUE_PRUNE_THRESHOLD = 30   // auto-prune processed alerts at/above this

export interface AlertQueueItem {
  id:                string
  incidentNo?:       string   // assigned on ingest into the queue; DB primary reference
  useCase:           string
  useCaseLabel:      string
  severity:          'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'
  title:             string
  description:       string
  tactic:            string
  techniqueId:       string
  techniqueName:     string
  sourceIp:          string
  sourceHost:        string
  sourceUser:        string
  sourceProcess:     string | null
  destIp:            string
  destHost:          string
  destPort:          number
  evidence:          string[]
  rawLog:            string
  recommendedAction: string
  alertId:           string
  timestamp:         string
  createdAt:         number
  status:            'new' | 'acknowledged' | 'dispatched' | 'dismissed'
}
export interface ResolvedIncident {
  procId:             string
  alert:              AlertQueueItem
  iocs:               string[]
  techniques:         string[]
  verdict:            'True Positive' | 'False Positive' | 'Needs Review'
  riskScore:          number
  confidence:         number
  mttr:               number
  resolvedAt:         number
  agentLabel:         string
  agentColor:         string
  isFirstRun:         boolean
  attackChain:        string[]
  recommendations:    string[]
  threatActorProfile: string
}

// Skills learned by a specialized SOC agent — mirrored into the Agent Hub.
// This is the shared "agent skill directory": the Master Agent writes here on
// train/reuse, the Agent Hub reads from it to render live trained-agent cards.
export interface TrainedAgentSkill {
  alertType:          string   // use-case id, e.g. 'phishing' (the registry key)
  label:              string   // human label, e.g. 'Phishing Agent'
  color:              string
  trainedAt:          number
  lastRunAt:          number
  runCount:           number   // total incidents handled (first train + reuses)
  investigationSteps: string[]
  iocPatterns:        string[]
  remediationSteps:   string[]
  commonTechniques:   string[]
}

export type UploadStep = 'idle' | 'file-selected' | 'submitting' | 'ready' | 'analyzing' | 'done'

export interface PendingFileInfo {
  name: string
  size: number
  format: 'usecases' | 'coverage' | 'json' | 'unknown'
}

interface AppState {
  // client context (set after upload analysis)
  clientName: string
  industryLabel: string

  // selection / drill-down
  selectedTacticId: string | null
  selectedTechniqueId: string | null
  hoveredTacticId: string | null
  pinnedTacticId: string | null

  // ui
  view: ViewMode
  role: Role
  uploadOpen: boolean
  apiKey: string
  setApiKey: (key: string) => void
  // Gemini key powers the ACN voice assistant (separate from the Groq key)
  geminiKey: string
  setGeminiKey: (key: string) => void

  // live coverage data (applied to dashboard)
  coverage: CoverageDataset | null
  coverageMap: Map<string, CoverageEntry>
  useCases: UseCaseEntry[]
  useCaseAnalysis: UseCaseAnalysis | null
  // tactic name (lowercase) → use case count; populated for ATT&CK-format uploads
  useCaseTacticMap: Map<string, number>

  // upload workflow
  uploadStep: UploadStep
  pendingFileInfo: PendingFileInfo | null
  pendingData: { coverage: CoverageDataset; useCases: UseCaseEntry[] } | null

  // actions
  setClientInfo: (name: string, industryLabel: string) => void
  selectTactic: (id: string | null) => void
  selectTechnique: (id: string | null) => void
  hoverTactic: (id: string | null) => void
  pinTactic: (id: string | null) => void
  setView: (v: ViewMode) => void
  setRole: (r: Role) => void
  setUploadOpen: (o: boolean) => void
  setCoverage: (data: CoverageDataset | null) => void
  setUseCases: (useCases: UseCaseEntry[], analysis: UseCaseAnalysis | null) => void
  clearSelection: () => void

  // alert queue (shared between Alert Generator and SOC Triage)
  alertQueue: AlertQueueItem[]
  pushAlert: (item: AlertQueueItem) => void
  updateAlertStatus: (id: string, status: AlertQueueItem['status']) => void
  dismissAlert: (id: string) => void
  clearAlertQueue: () => void
  pruneProcessedAlerts: () => void

  // resolved incident history (feeds Analytics, IOC Watchlist)
  resolvedIncidents: ResolvedIncident[]
  pushResolvedIncident: (inc: ResolvedIncident) => void
  clearResolvedIncidents: () => void

  // trained-agent skill directory (SOC Master Agent → Agent Hub)
  trainedAgents: TrainedAgentSkill[]
  syncTrainedAgent: (agent: TrainedAgentSkill) => void
  clearTrainedAgents: () => void

  // background auto-generation (persists across view changes)
  autoGenMode: boolean
  autoGenInterval: number     // seconds
  autoGenUseCase: string
  autoGenRotate: boolean      // cycle through all use cases randomly on each tick
  autoGenLastFiredAt: number  // Date.now() of last successful generation
  setAutoGenMode: (v: boolean) => void
  setAutoGenInterval: (v: number) => void
  setAutoGenUseCase: (v: string) => void
  setAutoGenRotate: (v: boolean) => void
  setAutoGenLastFiredAt: (v: number) => void

  // upload workflow actions
  setUploadStep: (step: UploadStep) => void
  setPendingFileInfo: (info: PendingFileInfo | null) => void
  setPendingData: (data: { coverage: CoverageDataset; useCases: UseCaseEntry[] } | null) => void
  applyAnalysis: (analysis: UseCaseAnalysis | null) => void
  resetUpload: () => void
}

function buildMap(data: CoverageDataset | null): Map<string, CoverageEntry> {
  if (!data) return new Map()
  return new Map(data.entries.map(e => [e.techniqueId, e]))
}

const TRAINED_AGENTS_KEY = 'atlas_trained_agents'
function loadTrainedAgents(): TrainedAgentSkill[] {
  try {
    const raw = localStorage.getItem(TRAINED_AGENTS_KEY)
    return raw ? (JSON.parse(raw) as TrainedAgentSkill[]) : []
  } catch { return [] }
}
function saveTrainedAgents(agents: TrainedAgentSkill[]) {
  try { localStorage.setItem(TRAINED_AGENTS_KEY, JSON.stringify(agents)) } catch { /* ignore quota */ }
}

// ── Cross-tab sync ──────────────────────────────────────────────────────────
// Zustand state is per-tab (in-memory), so opening the Alert Generator and the
// Agentic SOC in separate browser tabs would give each its own alert queue.
// A BroadcastChannel mirrors alert-queue + resolved-incident actions to all
// tabs so alerts generated anywhere reach the SOC wherever it's open.
// `remoteApply` guards against re-broadcasting / duplicate DB writes when we're
// applying a message that came from another tab.
type SyncMsg =
  | { type: 'pushAlert'; item: AlertQueueItem }
  | { type: 'status'; id: string; status: AlertQueueItem['status'] }
  | { type: 'resolved'; inc: ResolvedIncident }
  | { type: 'dismiss'; id: string }
  | { type: 'clearQueue' }
  | { type: 'prune' }
// `remoteApply` guards DB writes only (so a remote-applied item isn't written to
// Access twice). Broadcasts are instead gated on whether state actually changed,
// which naturally terminates echo loops (re-applying an already-applied change is
// a no-op and re-broadcasts nothing) — and, unlike a flag, it isn't defeated by
// the synchronous subscriber cascade that runs during a remote apply.
let remoteApply = false
const syncChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('atlas-soc-sync') : null
function broadcast(msg: SyncMsg) { try { syncChannel?.postMessage(msg) } catch { /* ignore */ } }

export const useStore = create<AppState>((set, get) => ({
  clientName: '',
  industryLabel: '',

  selectedTacticId: null,
  selectedTechniqueId: null,
  hoveredTacticId: null,
  pinnedTacticId: null,

  view: 'globe',
  role: 'soc',
  uploadOpen: false,
  apiKey: (localStorage.getItem('atlas_groq_key') ?? '').trim(),
  geminiKey: (localStorage.getItem('atlas_gemini_key') ?? '').trim(),

  coverage: null,
  coverageMap: new Map(),
  useCases: [],
  useCaseAnalysis: null,
  useCaseTacticMap: new Map(),

  uploadStep: 'idle',
  pendingFileInfo: null,
  pendingData: null,

  alertQueue: [],
  pushAlert: (item) => {
    const withNo = item.incidentNo ? item : { ...item, incidentNo: nextIncidentNo() }
    let added = false
    set(s => {
      if (s.alertQueue.some(a => a.id === withNo.id)) return s
      added = true
      return { alertQueue: [withNo, ...s.alertQueue].slice(0, ALERT_QUEUE_CAP) }
    })
    if (!added) return                       // already have it → no DB write, no echo
    if (!remoteApply) saveAlert(withNo)       // only the originating tab writes to the DB
    broadcast({ type: 'pushAlert', item: withNo })
  },
  updateAlertStatus: (id, status) => {
    let changed = false
    set(s => ({ alertQueue: s.alertQueue.map(a => {
      if (a.id === id && a.status !== status) { changed = true; return { ...a, status } }
      return a
    }) }))
    if (changed) broadcast({ type: 'status', id, status })
  },
  dismissAlert: (id) => {
    let removed = false
    set(s => { const next = s.alertQueue.filter(a => a.id !== id); removed = next.length !== s.alertQueue.length; return { alertQueue: next } })
    if (removed) broadcast({ type: 'dismiss', id })
  },
  clearAlertQueue: () => {
    let had = false
    set(s => { had = s.alertQueue.length > 0; return { alertQueue: [] } })
    if (had) broadcast({ type: 'clearQueue' })
  },
  // Drop already-processed alerts (anything not still 'new') to keep the queue
  // from filling up during long auto-generation runs. Pending 'new' alerts are
  // always preserved so nothing un-ingested is lost.
  pruneProcessedAlerts: () => {
    let pruned = false
    set(s => { const next = s.alertQueue.filter(a => a.status === 'new'); pruned = next.length !== s.alertQueue.length; return { alertQueue: next } })
    if (pruned) broadcast({ type: 'prune' })
  },

  resolvedIncidents: [],
  pushResolvedIncident: (inc) => {
    let added = false
    set(s => {
      if (s.resolvedIncidents.some(r => r.procId === inc.procId)) return s
      added = true
      return { resolvedIncidents: [inc, ...s.resolvedIncidents].slice(0, 1000) }
    })
    if (!added) return
    if (!remoteApply) saveIncident(inc)       // only the originating tab writes to the DB
    broadcast({ type: 'resolved', inc })
  },
  clearResolvedIncidents: () => set({ resolvedIncidents: [] }),

  trainedAgents: loadTrainedAgents(),
  syncTrainedAgent: (agent) => set(s => {
    const idx = s.trainedAgents.findIndex(a => a.alertType === agent.alertType)
    const next = idx >= 0
      ? s.trainedAgents.map(a => a.alertType === agent.alertType ? agent : a)
      : [agent, ...s.trainedAgents]
    saveTrainedAgents(next)
    return { trainedAgents: next }
  }),
  clearTrainedAgents: () => { saveTrainedAgents([]); set({ trainedAgents: [] }) },

  autoGenMode: false,
  autoGenInterval: 60,
  autoGenUseCase: 'phishing',
  autoGenRotate: false,
  autoGenLastFiredAt: 0,
  setAutoGenMode: (v) => set({ autoGenMode: v }),
  setAutoGenInterval: (v) => set({ autoGenInterval: v }),
  setAutoGenUseCase: (v) => set({ autoGenUseCase: v }),
  setAutoGenRotate: (v) => set({ autoGenRotate: v }),
  setAutoGenLastFiredAt: (v) => set({ autoGenLastFiredAt: v }),

  setClientInfo: (name, industryLabel) => set({ clientName: name, industryLabel }),
  selectTactic: (id) => set({ selectedTacticId: id, selectedTechniqueId: null }),
  selectTechnique: (id) => set({ selectedTechniqueId: id }),
  hoverTactic: (id) => set({ hoveredTacticId: id }),
  pinTactic: (id) => set({ pinnedTacticId: id }),
  setView: (v) => set({ view: v }),
  setRole: (r) => set({ role: r }),
  setUploadOpen: (o) => set({ uploadOpen: o }),
  // Trim once at the single source so every reader (store subscribers + direct
  // localStorage reads) sees the same canonical, whitespace-free key.
  setApiKey: (key) => { const k = key.trim(); localStorage.setItem('atlas_groq_key', k); set({ apiKey: k }) },
  setGeminiKey: (key) => { const k = key.trim(); localStorage.setItem('atlas_gemini_key', k); set({ geminiKey: k }) },
  setCoverage: (data) => set({ coverage: data, coverageMap: buildMap(data), useCaseTacticMap: new Map() }),
  setUseCases: (useCases, analysis) => set({ useCases, useCaseAnalysis: analysis }),
  clearSelection: () => set({ selectedTacticId: null, selectedTechniqueId: null }),

  setUploadStep: (step) => set({ uploadStep: step }),
  setPendingFileInfo: (info) => set({ pendingFileInfo: info }),
  setPendingData: (data) => set({ pendingData: data }),
  applyAnalysis: (analysis) => {
    const { pendingData } = get()
    if (!pendingData) return
    // Build tactic name map for ATT&CK-format data (name-based matching)
    const useCaseTacticMap = new Map<string, number>()
    if (analysis) {
      for (const { tacticName, count } of analysis.tacticBreakdown) {
        useCaseTacticMap.set(tacticName.toLowerCase().trim(), count)
      }
    }
    set({
      coverage: pendingData.coverage,
      coverageMap: buildMap(pendingData.coverage),
      useCases: pendingData.useCases,
      useCaseAnalysis: analysis,
      useCaseTacticMap,
      // uploadStep is intentionally NOT set here — handleAnalyze manages it
      // so the Analyzing panel stays visible during Groq streaming
    })
  },
  resetUpload: () => set({
    uploadStep: 'idle',
    pendingFileInfo: null,
    pendingData: null,
  }),
}))

// Apply messages from other tabs to this tab's store. Guarded by `remoteApply`
// so these applications don't re-broadcast (no echo loops) or re-write the DB.
if (syncChannel) {
  syncChannel.onmessage = (e: MessageEvent<SyncMsg>) => {
    const msg = e.data
    remoteApply = true
    try {
      const st = useStore.getState()
      switch (msg.type) {
        case 'pushAlert':  st.pushAlert(msg.item); break
        case 'status':     st.updateAlertStatus(msg.id, msg.status); break
        case 'resolved':   st.pushResolvedIncident(msg.inc); break
        case 'dismiss':    st.dismissAlert(msg.id); break
        case 'clearQueue': st.clearAlertQueue(); break
        case 'prune':      st.pruneProcessedAlerts(); break
      }
    } finally {
      remoteApply = false
    }
  }
}
