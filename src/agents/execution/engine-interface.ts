// ─────────────────────────────────────────────────────────────────────────────
// Investigation Engine Interface
//
// InvestigationEngine — the contract all engines must satisfy:
//   Deterministic (Step 3, current)
//   LLM           (Step 4+, connected via Agent Pro's provider mechanism)
//   Hybrid        (Step N, combines both)
//
// InvestigationContext — compact input built from InvestigationTask + selected
//   skills.  Contains ONLY what the specialist needs.
//   _alertContext: full alert kept for deterministic engine, excluded from LLM.
//
// ToolRequest / ToolResult — future external-tool boundary.
//   Specialists report toolUnavailable=true until Step 4 wires real providers.
// ─────────────────────────────────────────────────────────────────────────────
import type { AgentDefinition, AlertEntity, CapabilityId } from '../types'
import type { SkillDefinition }  from '../skills/types'
import type { InvestigationResult } from './result-types'
import type { AlertQueueItem }   from '../../lib/store'
import type { EnrichmentResult } from '../enrichment/enrichment-types'

// ── Investigation Context ─────────────────────────────────────────────────────
export interface InvestigationContext {
  // Identity
  taskId:    string
  alertId:   string
  alertType: string
  severity:  string
  objective: string

  // Routing
  assignedAgent:        Pick<AgentDefinition, 'id' | 'name' | 'systemPrompt'>
  requiredCapabilities: CapabilityId[]
  selectedSkills:       SkillDefinition[]

  // Observables (deduplicated, max 20 evidence items)
  entities:        AlertEntity[]
  iocs:            string[]
  evidenceSummary: string[]

  // MITRE
  mitreTechnique: string
  mitreTactic:    string

  // Key alert fields — avoids bloating LLM context with the full alert object
  relevantFields: {
    title:          string
    description:    string
    sourceIp?:      string
    sourceHost?:    string
    sourceUser?:    string
    sourceProcess?: string
    destIp?:        string
    destHost?:      string
    destPort?:      number
    rawLog?:        string
  }

  // Full alert — for the deterministic engine; NOT included in LLM payloads
  _alertContext: AlertQueueItem

  // IOC enrichment results from Step 4 providers (optional — absent if no providers configured)
  enrichments?: EnrichmentResult[]
}

// ── Investigation Engine ──────────────────────────────────────────────────────
export interface InvestigationEngine {
  readonly engineId:   string
  readonly engineType: 'deterministic' | 'llm' | 'hybrid'
  execute(context: InvestigationContext): InvestigationResult
}

// ── Future Tool Interface ─────────────────────────────────────────────────────
// Boundary for Step 4 external tools (VirusTotal, SIEM, EDR, AbuseIPDB).
// Defined here so specialists can reference the contract even before
// concrete providers are implemented.
export interface ToolRequest {
  toolId:             string
  capabilityRequired: string
  targetEntity:       string
  reason:             string
}

export interface ToolResult {
  toolId: string
  status: 'available' | 'unavailable' | 'error'
  data?:  unknown
  error?: string
}
