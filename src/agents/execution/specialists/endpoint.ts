// ─────────────────────────────────────────────────────────────────────────────
// Endpoint Specialist — investigation worker for host-based threats.
//
// Receives InvestigationContext; uses only _alertContext + selectedSkills.
// Nothing is fabricated; external-tool gaps are reported via notInvestigated.
// ─────────────────────────────────────────────────────────────────────────────
import type { InvestigationContext } from '../engine-interface'
import type { InvestigationResult, InvestigationEvidence } from '../result-types'
import {
  allText, hasKeyword, makeFindingId, finding, obs,
  computeConfidence, deriveAssessment, assessmentToVerdict,
  computeRiskScore, SUSPICIOUS_PROCESSES,
  enrichmentToFindings, upgradeAssessmentWithEnrichments,
} from './_shared'

export function runEndpointInvestigation(
  context: InvestigationContext,
  startedAt: number,
): InvestigationResult {
  const alert  = context._alertContext
  const caps   = new Set(context.selectedSkills.flatMap(s => s.capabilities))
  const text   = allText(alert)
  const prefix = 'ept'

  const findings: ReturnType<typeof finding>[] = []
  const evidence: InvestigationEvidence[] = []
  const notInvestigated: string[] = []
  const warnings: string[] = []

  // ── 1. Process context ─────────────────────────────────────────────────────
  const proc = alert.sourceProcess
  if (proc && proc !== '—') {
    evidence.push(obs('process', proc, 'Source process observed in alert'))
    const procLower = proc.toLowerCase()

    if (SUSPICIOUS_PROCESSES.has(procLower)) {
      findings.push(finding(
        makeFindingId(prefix), 'OBSERVED', 'process_execution',
        `Suspicious process '${proc}' observed as source on ${alert.sourceHost}`,
        'HIGH', 0.88,
        [`source process: ${proc}`, `host: ${alert.sourceHost}`],
        { mitreRef: alert.techniqueId },
      ))
    } else {
      findings.push(finding(
        makeFindingId(prefix), 'OBSERVED', 'process_execution',
        `Process '${proc}' initiated activity on ${alert.sourceHost}`,
        'MEDIUM', 0.80,
        [`source process: ${proc}`, alert.title],
      ))
    }
    notInvestigated.push('Process memory dump / parent-child tree (requires EDR)')
  } else {
    findings.push(finding(
      makeFindingId(prefix), 'UNKNOWN', 'process_execution',
      'Source process not available in alert data',
      'INFO', 0.30, [],
      { toolRequired: 'EDR process-tree query', toolUnavailable: true },
    ))
  }

  // ── 2. PowerShell / script analysis ───────────────────────────────────────
  if (caps.has('powershell_analysis') || caps.has('script_analysis')) {
    const psIndicators = ['powershell', '-enc', '-encodedcommand', 'invoke-expression',
      'iex', 'bypass', 'downloadstring', 'frombase64string', 'amsi', 'reflection']
    const matched = psIndicators.filter(kw => text.includes(kw))

    if (matched.length > 0) {
      const encoded = hasKeyword(text, '-enc', '-encodedcommand', 'frombase64string')
      findings.push(finding(
        makeFindingId(prefix), 'OBSERVED', 'powershell_activity',
        encoded
          ? 'Encoded PowerShell command detected — potential AMSI/AV evasion'
          : `PowerShell scripting activity observed with suspicious flags: ${matched.slice(0, 3).join(', ')}`,
        encoded ? 'HIGH' : 'MEDIUM',
        encoded ? 0.87 : 0.75,
        matched.map(m => `keyword matched: '${m}'`),
        { mitreRef: 'T1059.001' },
      ))
      notInvestigated.push('Full PowerShell command decode / ScriptBlock logging (requires EDR or WEF)')
    } else {
      findings.push(finding(
        makeFindingId(prefix), 'UNKNOWN', 'powershell_activity',
        'No PowerShell command text available for analysis',
        'INFO', 0.30, [],
        { toolRequired: 'PowerShell ScriptBlock logs / EDR', toolUnavailable: true },
      ))
    }
  }

  // ── 3. Malware / ransomware classification ─────────────────────────────────
  if (caps.has('malware_classification')) {
    const ransomIndicators = ['.locked', '.encrypted', 'shadow cop', 'vssadmin',
      'bcdedit', 'ransom', 'decrypt', 'wbadmin']
    const fileExecIndicators = ['dll injection', 'reflective', 'shellcode',
      'hollowing', 'process injection']
    const foundRansom   = ransomIndicators.filter(kw => text.includes(kw))
    const foundFileExec = fileExecIndicators.filter(kw => text.includes(kw))

    if (foundRansom.length > 0) {
      const hasRecoveryDestruction = hasKeyword(text, 'vssadmin', 'bcdedit', 'wbadmin')
      findings.push(finding(
        makeFindingId(prefix), 'OBSERVED', 'malware_behavior',
        hasRecoveryDestruction
          ? 'Ransomware behavior confirmed: file encryption + recovery destruction observed'
          : `Ransomware indicators present: ${foundRansom.slice(0, 3).join(', ')}`,
        'CRITICAL', 0.90,
        foundRansom.map(m => `indicator: '${m}'`),
        { mitreRef: 'T1486' },
      ))
    } else if (foundFileExec.length > 0) {
      findings.push(finding(
        makeFindingId(prefix), 'OBSERVED', 'malware_behavior',
        `Code injection / fileless execution pattern: ${foundFileExec[0]}`,
        'HIGH', 0.78,
        foundFileExec.map(m => `pattern: '${m}'`),
        { mitreRef: alert.techniqueId },
      ))
    } else {
      findings.push(finding(
        makeFindingId(prefix), 'INFERRED', 'malware_behavior',
        'Malware classification inconclusive from alert data alone',
        'MEDIUM', 0.45, [`alert severity: ${alert.severity}`, `technique: ${alert.techniqueId}`],
        { toolRequired: 'File hash reputation / sandbox detonation', toolUnavailable: true },
      ))
      notInvestigated.push('File hash reputation check (requires VirusTotal / sandbox)')
    }
  }

  // ── 4. Persistence detection ───────────────────────────────────────────────
  if (caps.has('persistence_detection')) {
    const persIndicators = ['scheduled task', 'schtasks', 'run key', 'hklm', 'hkcu',
      'autostart', 'startup folder', 'new service', 'sc create', 'at.exe']
    const found = persIndicators.filter(kw => text.includes(kw))

    if (found.length > 0) {
      findings.push(finding(
        makeFindingId(prefix), 'OBSERVED', 'persistence_artifact',
        `Persistence mechanism detected: ${found.slice(0, 2).join(', ')}`,
        'HIGH', 0.84,
        found.map(m => `indicator: '${m}'`),
        { mitreRef: alert.techniqueId },
      ))
      notInvestigated.push('Persistence artifact contents / payload hash (requires EDR or registry query)')
    } else {
      findings.push(finding(
        makeFindingId(prefix), 'UNKNOWN', 'persistence_artifact',
        'Persistence artifacts not directly observable in alert data',
        'INFO', 0.30, [],
        { toolRequired: 'Registry / scheduled-task query via EDR', toolUnavailable: true },
      ))
    }
  }

  // ── 5. Privilege escalation ────────────────────────────────────────────────
  if (caps.has('privilege_escalation_detection')) {
    const privIndicators = ['uac bypass', 'fodhelper', 'eventvwr', 'sdclt',
      'token impersonation', 'sedebugprivilege', 'seimpersonateprivilege',
      'elevated', 'bypassuac']
    const found = privIndicators.filter(kw => text.includes(kw))

    if (found.length > 0) {
      findings.push(finding(
        makeFindingId(prefix), 'OBSERVED', 'privilege_escalation',
        `Privilege escalation indicator observed: ${found.slice(0, 2).join(', ')}`,
        'HIGH', 0.82,
        found.map(m => `indicator: '${m}'`),
        { mitreRef: alert.techniqueId },
      ))
    } else {
      findings.push(finding(
        makeFindingId(prefix), 'UNKNOWN', 'privilege_escalation',
        'Privilege escalation cannot be confirmed from alert data alone',
        'INFO', 0.30, [],
        { toolRequired: 'Windows Security Event Log (Event 4688) via SIEM', toolUnavailable: true },
      ))
    }
  }

  // ── 6. Defense evasion ─────────────────────────────────────────────────────
  if (caps.has('defense_evasion_detection')) {
    const evasionIndicators = ['log cleared', 'wevtutil', 'event id 1102',
      'amsi bypass', 'defender disabled', 'real-time protection',
      'obfuscat', 'base64', 'xor encoded']
    const found = evasionIndicators.filter(kw => text.includes(kw))

    if (found.length > 0) {
      findings.push(finding(
        makeFindingId(prefix), 'OBSERVED', 'defense_evasion',
        `Defense evasion activity detected: ${found.slice(0, 2).join(', ')}`,
        'HIGH', 0.85,
        found.map(m => `indicator: '${m}'`),
        { mitreRef: alert.techniqueId },
      ))
    }
  }

  // ── 7. Evidence from alert fields ─────────────────────────────────────────
  evidence.push(obs('hostname', alert.sourceHost, 'Affected host'))
  evidence.push(obs('ip', alert.sourceIp, 'Source IP address'))
  if (alert.sourceUser) evidence.push(obs('user', alert.sourceUser, 'User context'))
  alert.evidence.forEach(e => evidence.push(obs('pattern', e, 'Alert evidence item', 'derived')))

  // ── 8. IOCs ────────────────────────────────────────────────────────────────
  const iocs = [...new Set([
    alert.sourceIp, alert.sourceHost, alert.destIp,
    ...(proc && proc !== '—' ? [proc] : []),
  ].filter(Boolean))]

  notInvestigated.push('File hash / binary reputation (requires VirusTotal)')
  notInvestigated.push('Full process tree (requires EDR integration)')

  // ── 9. Enrichment findings (VirusTotal / AbuseIPDB / Mock) ────────────────
  const enrichFindings = enrichmentToFindings(context.enrichments ?? [], prefix)
  findings.push(...enrichFindings)

  // ── 10. Assessment / scoring ───────────────────────────────────────────────
  const baseAssessment = deriveAssessment(findings, alert.severity)
  const assessment     = upgradeAssessmentWithEnrichments(baseAssessment, context.enrichments ?? [])
  const confidence     = computeConfidence(findings)
  const verdict        = assessmentToVerdict(assessment)
  const riskScore      = computeRiskScore(findings, alert.severity)

  const tpFindings = findings.filter(f => f.type === 'OBSERVED' && (f.severity === 'CRITICAL' || f.severity === 'HIGH'))
  const summaryParts: string[] = []
  if (tpFindings.length > 0) summaryParts.push(`${tpFindings.length} high-confidence indicator(s) observed`)
  summaryParts.push(`MITRE ${alert.techniqueId} (${alert.techniqueName}) on ${alert.sourceHost}`)
  if (findings.some(f => f.type === 'UNKNOWN')) {
    summaryParts.push(`${findings.filter(f => f.type === 'UNKNOWN').length} gap(s) require external tools`)
  }

  const recommendations: string[] = [alert.recommendedAction || 'Isolate the affected host immediately']
  if (hasKeyword(text, 'ransom', '.locked', 'encrypted')) {
    recommendations.push('Suspend network access and preserve disk image before remediation')
    recommendations.push('Do not pay ransom — restore from verified backup')
  }
  if (hasKeyword(text, 'powershell', '-enc', 'bypass')) {
    recommendations.push('Review PowerShell execution policy and enable ScriptBlock logging')
  }
  recommendations.push('Collect full process tree, memory, and event logs via EDR')

  if (warnings.length === 0 && findings.filter(f => f.type === 'UNKNOWN').length > 2) {
    warnings.push('Multiple investigation gaps — external tool integration required for definitive analysis')
  }

  return {
    taskId:    context.taskId,
    alertId:   context.alertId,
    agentId:   context.assignedAgent.id,
    agentName: context.assignedAgent.name,
    status:    'COMPLETED',
    startedAt,
    completedAt:  Date.now(),
    executionMs:  Date.now() - startedAt,
    summary:      summaryParts.join('. '),
    findings,
    evidence,
    entities:     context.entities,
    iocs,
    mitreTechniques: [alert.techniqueId].filter(Boolean),
    assessment,
    verdict,
    confidence,
    riskScore,
    recommendations,
    notInvestigated: [...new Set(notInvestigated)],
    skillIds:         context.selectedSkills.map(s => s.id),
    capabilitiesUsed: [...caps],
    warnings:         warnings.length ? warnings : undefined,
  }
}
