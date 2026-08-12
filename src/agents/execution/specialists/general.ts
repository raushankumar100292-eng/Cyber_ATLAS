// ─────────────────────────────────────────────────────────────────────────────
// General Specialist — fallback investigation worker.
//
// Used when NO_CAPABLE_AGENT fires.  Reports only triage-level observables
// from basic alert fields and explicitly identifies all specialist gaps.
// Assessment is always INCONCLUSIVE — this agent cannot perform deep analysis.
// ─────────────────────────────────────────────────────────────────────────────
import type { InvestigationContext } from '../engine-interface'
import type { InvestigationResult, InvestigationEvidence } from '../result-types'
import { makeFindingId, finding, obs, severityBase } from './_shared'

export function runGeneralInvestigation(
  context: InvestigationContext,
  startedAt: number,
): InvestigationResult {
  const alert  = context._alertContext
  const prefix = 'gen'

  const findings: ReturnType<typeof finding>[] = []
  const evidence: InvestigationEvidence[] = []

  // ── 1. Triage-level observable facts ──────────────────────────────────────
  evidence.push(obs('hostname', alert.sourceHost, 'Affected host'))
  evidence.push(obs('ip',       alert.sourceIp,   'Source IP'))
  if (alert.sourceUser)    evidence.push(obs('user',      alert.sourceUser,    'User context'))
  if (alert.sourceProcess) evidence.push(obs('process',   alert.sourceProcess, 'Source process'))
  if (alert.destHost)      evidence.push(obs('hostname',  alert.destHost,      'Destination host'))
  if (alert.destIp)        evidence.push(obs('ip',        alert.destIp,        'Destination IP'))
  evidence.push(obs('technique', alert.techniqueId, `MITRE technique: ${alert.techniqueName}`))

  findings.push(finding(
    makeFindingId(prefix), 'OBSERVED', 'alert_triage',
    `${alert.severity} severity alert: ${alert.title}`,
    alert.severity as any, 0.85,
    [alert.title, `tactic: ${alert.tactic}`, `technique: ${alert.techniqueId} — ${alert.techniqueName}`],
    { mitreRef: alert.techniqueId },
  ))

  findings.push(finding(
    makeFindingId(prefix), 'OBSERVED', 'connection_metadata',
    `Activity from ${alert.sourceHost} (${alert.sourceIp}) toward ${alert.destHost || alert.destIp}`,
    'MEDIUM', 0.80,
    [
      `source: ${alert.sourceIp} / ${alert.sourceHost}`,
      `destination: ${alert.destIp}${alert.destHost ? ' / ' + alert.destHost : ''}:${alert.destPort}`,
    ],
  ))

  if (alert.evidence.length > 0) {
    alert.evidence.forEach(e => evidence.push(obs('pattern', e, 'Alert evidence', 'derived')))
    findings.push(finding(
      makeFindingId(prefix), 'OBSERVED', 'alert_evidence',
      `${alert.evidence.length} evidence item(s) provided: ${alert.evidence[0]}`,
      'MEDIUM', 0.78,
      alert.evidence,
    ))
  }

  findings.push(finding(
    makeFindingId(prefix), 'INFERRED', 'mitre_mapping',
    `MITRE ATT&CK: ${alert.tactic} › ${alert.techniqueName} (${alert.techniqueId})`,
    'MEDIUM', 0.70,
    [`technique: ${alert.techniqueId}`, `tactic: ${alert.tactic}`],
    {
      mitreRef: alert.techniqueId,
      toolRequired: 'Specialist agent with matching capabilities',
      toolUnavailable: true,
    },
  ))

  // Explicit capability gap — no fabrication
  findings.push(finding(
    makeFindingId(prefix), 'UNKNOWN', 'specialist_gap',
    `No specialist agent available for required capabilities: [${context.requiredCapabilities.join(', ')}]. Deep investigation not possible.`,
    'HIGH', 0.30,
    [`required: ${context.requiredCapabilities.join(', ')}`, 'general agent cannot perform specialist analysis'],
    {
      toolRequired: 'Specialist agent with matching capabilities',
      toolUnavailable: true,
    },
  ))

  const iocs = [...new Set([
    alert.sourceIp, alert.destIp, alert.destHost,
  ].filter(Boolean))]

  const riskScore = Math.min(98, severityBase(alert.severity) + 5)

  return {
    taskId:    context.taskId,
    alertId:   context.alertId,
    agentId:   context.assignedAgent.id,
    agentName: context.assignedAgent.name,
    status:    'COMPLETED',
    startedAt,
    completedAt:  Date.now(),
    executionMs:  Date.now() - startedAt,
    summary:      `General triage only — no specialist matched required capabilities [${context.requiredCapabilities.join(', ')}]. Alert fields parsed; deep investigation not performed.`,
    findings,
    evidence,
    entities:     context.entities,
    iocs,
    mitreTechniques: [alert.techniqueId].filter(Boolean),
    assessment:   'INCONCLUSIVE',
    verdict:      'Needs Review',
    confidence:   0.40,
    riskScore,
    recommendations: [
      alert.recommendedAction || 'Route to appropriate specialist for investigation',
      `Add a specialist agent covering: ${context.requiredCapabilities.slice(0, 3).join(', ')}`,
      'Perform manual triage using the alert evidence provided',
    ],
    notInvestigated: [
      `All specialist investigation — no agent covers: ${context.requiredCapabilities.join(', ')}`,
    ],
    skillIds:         context.selectedSkills.map(s => s.id),
    capabilitiesUsed: [],
    warnings: [
      'General investigation only — specialist capabilities were not available for this alert type',
    ],
  }
}
