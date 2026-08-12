// ─────────────────────────────────────────────────────────────────────────────
// Context Builder
//
// buildContext(task, selectedSkills) → InvestigationContext
//
// Produces a compact, token-efficient context containing only what the
// assigned specialist needs.  The full AlertQueueItem is preserved under
// _alertContext for the deterministic engine but excluded from LLM payloads.
// ─────────────────────────────────────────────────────────────────────────────
import type { InvestigationTask } from '../types'
import type { SkillDefinition }   from '../skills/types'
import type { InvestigationContext } from './engine-interface'
import type { EnrichmentResult }  from '../enrichment/enrichment-types'

export function buildContext(
  task:          InvestigationTask,
  selectedSkills: SkillDefinition[],
  enrichments?:  EnrichmentResult[],
): InvestigationContext {
  const alert = task.alertContext

  // Deduplicate evidence — trim blanks, cap at 20 items
  const evidenceSummary = [...new Set(
    alert.evidence.filter(e => e && e.trim().length > 0).map(e => e.trim()),
  )].slice(0, 20)

  return {
    taskId:    task.taskId,
    alertId:   task.alertId,
    alertType: task.analysis.alertType,
    severity:  alert.severity,
    objective: task.objective,

    assignedAgent: {
      id:           task.assignedAgent.id,
      name:         task.assignedAgent.name,
      systemPrompt: task.assignedAgent.systemPrompt,
    },

    requiredCapabilities: task.requiredCapabilities,
    selectedSkills,

    entities:        task.analysis.entities,
    iocs:            [...new Set(task.analysis.iocs)],
    evidenceSummary,

    mitreTechnique: alert.techniqueId ?? '',
    mitreTactic:    alert.tactic      ?? '',

    relevantFields: {
      title:         alert.title,
      description:   alert.description,
      sourceIp:      alert.sourceIp      || undefined,
      sourceHost:    alert.sourceHost    || undefined,
      sourceUser:    alert.sourceUser    || undefined,
      sourceProcess: alert.sourceProcess || undefined,
      destIp:        alert.destIp        || undefined,
      destHost:      alert.destHost      || undefined,
      destPort:      alert.destPort      || undefined,
      rawLog:        alert.rawLog        || undefined,
    },

    _alertContext: alert,
    enrichments,
  }
}
