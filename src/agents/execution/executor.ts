// ─────────────────────────────────────────────────────────────────────────────
// Specialist Execution Layer — Step 3
//
// Full pipeline:
//   InvestigationTask
//     → selectSkills  (capability → skill matching)
//     → buildContext  (compact InvestigationContext)
//     → DeterministicInvestigationEngine.execute()
//     → InvestigationResult
//
// toInsightAnalysis()  — adapter keeping the existing SOC UI contract intact.
//
// Step 4 upgrade path: swap DeterministicInvestigationEngine for
// LLMInvestigationEngine (connected via Agent Pro's provider/API-key mechanism)
// without changing any caller code.
// ─────────────────────────────────────────────────────────────────────────────
import type { InvestigationTask }                from '../types'
import type { InvestigationResult }              from './result-types'
import type { AlertQueueItem }                   from '../../lib/store'
import type { EnrichmentResult }                 from '../enrichment/enrichment-types'
import { selectSkills }                          from '../skills'
import { buildContext }                          from './context-builder'
import { DeterministicInvestigationEngine }      from './engine-deterministic'

export type { SkillDefinition } from '../skills'

// Singleton engine — stateless; safe to reuse across calls
const ENGINE = new DeterministicInvestigationEngine()

/**
 * Execute an investigation for the given task.
 *
 * Flow:
 *   1. Select agent skills matching required capabilities
 *   2. Build compact InvestigationContext
 *   3. Run DeterministicInvestigationEngine
 *   4. Return InvestigationResult (COMPLETED or FAILED — never throws)
 */
export function executeInvestigation(
  task:        InvestigationTask,
  enrichments?: EnrichmentResult[],
): InvestigationResult {
  const startedAt = Date.now()

  try {
    const selectedSkills = selectSkills(task.assignedAgent.id, task.requiredCapabilities)
    const context        = buildContext(task, selectedSkills, enrichments)
    return ENGINE.execute(context)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      taskId:          task.taskId,
      alertId:         task.alertId,
      agentId:         task.assignedAgent.id,
      agentName:       task.assignedAgent.name,
      status:          'FAILED',
      startedAt,
      completedAt:     Date.now(),
      executionMs:     Date.now() - startedAt,
      summary:         `Investigation execution failed: ${msg}`,
      findings:        [],
      evidence:        [],
      entities:        task.analysis.entities,
      iocs:            task.analysis.iocs,
      mitreTechniques: task.analysis.mitreTechniques,
      assessment:      'INCONCLUSIVE',
      verdict:         'Needs Review',
      confidence:      0,
      riskScore:       0,
      recommendations: ['Manual review required — automated investigation failed'],
      notInvestigated: ['All investigation due to execution failure'],
      skillIds:         [],
      capabilitiesUsed: [],
      errors:           [msg],
    }
  }
}

// ── UI adapter ────────────────────────────────────────────────────────────────
// Maps InvestigationResult → existing InsightAnalysis UI contract.
// The UI shape is unchanged; assessment → verdict conversion is done here.

export interface InsightAnalysis {
  threatActorProfile: string
  attackChain:        string[]
  iocs:               string[]
  riskScore:          number
  verdict:            'True Positive' | 'False Positive' | 'Needs Review'
  confidence:         number   // 0–100 integer for UI display
  reasoning:          string
  recommendations:    string[]
  sampleQueries:      { splunk: string[]; kql: string[] }
}

const SEV_ORDER: Record<string, number> = {
  CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0,
}

function buildThreatActorProfile(result: InvestigationResult, alert: AlertQueueItem): string {
  const crit = result.findings.find(
    f => f.type === 'OBSERVED' && (f.severity === 'CRITICAL' || f.severity === 'HIGH'),
  )
  if (!crit) {
    return `${alert.tactic} activity detected. Specific threat actor attribution requires external threat intelligence.`
  }
  return `${alert.tactic} — ${crit.category.replace(/_/g, ' ')} pattern consistent with ${alert.techniqueName} (${alert.techniqueId}). Attribution requires external intelligence platform.`
}

function buildAttackChain(result: InvestigationResult, alert: AlertQueueItem): string[] {
  const observed = result.findings
    .filter(f => f.type === 'OBSERVED')
    .sort((a, b) => (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0))
    .slice(0, 4)
    .map(f => f.finding)

  if (observed.length === 0) {
    return [
      alert.title,
      `${alert.techniqueId} (${alert.techniqueName}) mapped by analyzer`,
      'Full attack chain requires external tool enrichment',
    ]
  }
  observed.push(`${alert.techniqueId} (${alert.techniqueName}) — MITRE ATT&CK reference`)
  return observed
}

/**
 * Convert specialist InvestigationResult → UI InsightAnalysis.
 * verdict is read from result.verdict which is already derived from result.assessment.
 * sampleQueries intentionally empty — Step 4 will generate context-aware queries.
 */
export function toInsightAnalysis(
  result: InvestigationResult,
  alert: AlertQueueItem,
): InsightAnalysis {
  const gapNote = result.notInvestigated.length > 0
    ? ` | Gaps: ${result.notInvestigated.slice(0, 2).join('; ')}`
    : ''

  const skillNote = result.skillIds.length > 0
    ? ` [skills: ${result.skillIds.join(', ')}]`
    : ''

  // Enrichment note — shows when external TI confirmed or elevated findings
  const enrichedCount = result.findings.filter(f => f.type === 'ENRICHED').length
  const enrichNote = enrichedCount > 0
    ? ` | TI: ${enrichedCount} IOC(s) confirmed by threat intelligence`
    : ''

  return {
    threatActorProfile: buildThreatActorProfile(result, alert),
    attackChain:        buildAttackChain(result, alert),
    iocs:               result.iocs,
    riskScore:          result.riskScore,
    verdict:            result.verdict,
    confidence:         Math.round(result.confidence * 100),
    reasoning:          result.summary + gapNote + skillNote + enrichNote,
    recommendations:    result.recommendations,
    sampleQueries:      { splunk: [], kql: [] },
  }
}
