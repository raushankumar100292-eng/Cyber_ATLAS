// ─────────────────────────────────────────────────────────────────────────────
// InvestigationResult — structured output of a specialist agent execution.
//
// Design rules:
//   • Findings must be typed OBSERVED | INFERRED | UNKNOWN — never fabricated.
//   • assessment is the internal model (MALICIOUS/SUSPICIOUS/BENIGN/INCONCLUSIVE).
//   • verdict is derived from assessment for UI adapter compatibility.
//   • toolUnavailable findings explain external-system gaps (VirusTotal, EDR…).
//   • confidence is 0–1 float; toInsightAnalysis() converts to integer %.
//   • skillIds records which skills ran — input for multi-agent correlation.
// ─────────────────────────────────────────────────────────────────────────────
import type { AlertEntity, CapabilityId } from '../types'

// ── Finding taxonomy ──────────────────────────────────────────────────────────
/** OBSERVED  = directly present in the supplied alert/context.
 *  INFERRED  = logically derived via pattern matching or heuristics.
 *  UNKNOWN   = cannot be determined without an external tool/query.
 *  ENRICHED  = confirmed by an external threat-intelligence provider (Step 4+). */
export type FindingType = 'OBSERVED' | 'INFERRED' | 'UNKNOWN' | 'ENRICHED'

export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'

export interface Finding {
  id: string
  type: FindingType
  category: string
  finding: string
  confidence: number
  severity: FindingSeverity
  supportingEvidence: string[]
  mitreReference?: string
  toolRequired?: string
  toolUnavailable?: boolean
}

// ── Evidence collected during investigation ───────────────────────────────────
export type EvidenceSource = 'alert_field' | 'derived' | 'pattern_match'

export interface InvestigationEvidence {
  source: EvidenceSource
  type: AlertEntity['type'] | 'pattern'
  value: string
  description: string
}

// ── Assessment model (internal) ───────────────────────────────────────────────
// Richer than the binary True Positive / False Positive.
// Deterministic engine never auto-classifies BENIGN — only INCONCLUSIVE or
// SUSPICIOUS when evidence is ambiguous.
export type Assessment = 'MALICIOUS' | 'SUSPICIOUS' | 'BENIGN' | 'INCONCLUSIVE'

// ── Investigation result ──────────────────────────────────────────────────────
export type InvestigationStatus = 'COMPLETED' | 'FAILED'

export interface InvestigationResult {
  // Identity
  taskId:    string
  alertId:   string
  agentId:   string
  agentName: string

  // Lifecycle
  status:      InvestigationStatus
  startedAt:   number
  completedAt: number
  executionMs: number

  // Primary output
  summary:  string
  findings: Finding[]

  // Observables
  evidence:        InvestigationEvidence[]
  entities:        AlertEntity[]
  iocs:            string[]
  mitreTechniques: string[]

  // Assessment (internal model)
  assessment: Assessment
  // Verdict (UI adapter — derived from assessment)
  verdict:    'True Positive' | 'False Positive' | 'Needs Review'

  confidence: number   // 0–1
  riskScore:  number   // 0–100

  // Actions
  recommendations: string[]

  // Transparency — what could NOT be determined
  notInvestigated: string[]

  // Provenance — for multi-agent correlation (Step N)
  skillIds:         string[]       // IDs of skills that ran
  capabilitiesUsed: CapabilityId[]

  // Execution health
  errors?:   string[]
  warnings?: string[]
}
