import { create } from 'zustand'
import type { Role, CoverageDataset, CoverageEntry, UseCaseEntry, UseCaseAnalysis } from './types'

export type ViewMode = 'globe' | 'matrix' | 'upload' | 'delta' | 'spl-kql' | 'soar' | 'architect' | 'agentic-soc' | 'alert-gen' | 'soc-triage' | 'soc-analytics' | 'soc-campaigns' | 'soc-ioc' | 'prompt-eng' | 'agent-hub'

export interface AlertQueueItem {
  id:                string
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
  apiKey: localStorage.getItem('atlas_groq_key') ?? '',

  coverage: null,
  coverageMap: new Map(),
  useCases: [],
  useCaseAnalysis: null,
  useCaseTacticMap: new Map(),

  uploadStep: 'idle',
  pendingFileInfo: null,
  pendingData: null,

  alertQueue: [],
  pushAlert: (item) => set(s => ({ alertQueue: [item, ...s.alertQueue].slice(0, 500) })),
  updateAlertStatus: (id, status) => set(s => ({
    alertQueue: s.alertQueue.map(a => a.id === id ? { ...a, status } : a),
  })),
  dismissAlert: (id) => set(s => ({ alertQueue: s.alertQueue.filter(a => a.id !== id) })),
  clearAlertQueue: () => set({ alertQueue: [] }),
  // Drop already-processed alerts (anything not still 'new') to keep the queue
  // from filling up during long auto-generation runs. Pending 'new' alerts are
  // always preserved so nothing un-ingested is lost.
  pruneProcessedAlerts: () => set(s => ({ alertQueue: s.alertQueue.filter(a => a.status === 'new') })),

  resolvedIncidents: [],
  pushResolvedIncident: (inc) => set(s => ({ resolvedIncidents: [inc, ...s.resolvedIncidents].slice(0, 1000) })),
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
  setApiKey: (key) => { localStorage.setItem('atlas_groq_key', key); set({ apiKey: key }) },
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
