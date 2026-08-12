// Internal utilities shared by all specialist execution modules.
import type { AlertQueueItem } from '../../../lib/store'
import type { Assessment, Finding, FindingSeverity, FindingType, InvestigationEvidence } from '../result-types'
import type { EnrichmentResult } from '../../enrichment/enrichment-types'

let _findingSeq = 0
export function makeFindingId(agentPrefix: string): string {
  return `${agentPrefix}-f${++_findingSeq}-${Date.now().toString(36).slice(-4)}`
}

// ── Text helpers ──────────────────────────────────────────────────────────────
export function allText(alert: AlertQueueItem): string {
  return [alert.title, alert.description, ...alert.evidence, alert.rawLog]
    .join(' ').toLowerCase()
}

export function hasKeyword(text: string, ...keywords: string[]): boolean {
  return keywords.some(kw => text.includes(kw.toLowerCase()))
}

export function matchingKeywords(text: string, keywords: string[]): string[] {
  return keywords.filter(kw => text.includes(kw.toLowerCase()))
}

// ── Finding builder ───────────────────────────────────────────────────────────
export function finding(
  id: string,
  type: FindingType,
  category: string,
  text: string,
  severity: FindingSeverity,
  conf: number,
  supporting: string[],
  opts: {
    mitreRef?: string
    toolRequired?: string
    toolUnavailable?: boolean
  } = {},
): Finding {
  return {
    id, type, category, finding: text, severity, confidence: conf,
    supportingEvidence: supporting,
    mitreReference:  opts.mitreRef,
    toolRequired:    opts.toolRequired,
    toolUnavailable: opts.toolUnavailable,
  }
}

// ── Evidence builder ──────────────────────────────────────────────────────────
export function obs(
  type: InvestigationEvidence['type'],
  value: string,
  description: string,
  source: InvestigationEvidence['source'] = 'alert_field',
): InvestigationEvidence {
  return { source, type, value, description }
}

// ── Risk helpers ──────────────────────────────────────────────────────────────
export function severityBase(sev: string): number {
  switch (sev?.toUpperCase()) {
    case 'CRITICAL': return 88
    case 'HIGH':     return 72
    case 'MEDIUM':   return 52
    case 'LOW':      return 28
    default:         return 40
  }
}

export function computeConfidence(findings: Finding[]): number {
  if (findings.length === 0) return 0.35
  // ENRICHED findings carry the same weight as OBSERVED (confirmed by external TI)
  const observed = findings.filter(f => f.type === 'OBSERVED' || f.type === 'ENRICHED').length
  const inferred = findings.filter(f => f.type === 'INFERRED').length
  const total    = findings.length
  const score    = (observed * 3 + inferred * 1.5) / (total * 3)
  return Math.min(0.92, Math.max(0.35, score))
}

export function computeRiskScore(findings: Finding[], severity: string): number {
  let score = severityBase(severity)
  for (const f of findings) {
    if (f.type !== 'OBSERVED') continue
    if (f.severity === 'CRITICAL') score += 4
    else if (f.severity === 'HIGH') score += 3
    else if (f.severity === 'MEDIUM') score += 1
  }
  return Math.min(98, score)
}

// ── Assessment model ──────────────────────────────────────────────────────────
/**
 * Derive internal assessment from findings.
 * More conservative than the old binary verdict:
 *   MALICIOUS    — 2+ OBSERVED HIGH/CRITICAL, or 1 CRITICAL/HIGH with matching alert severity
 *   SUSPICIOUS   — any OBSERVED findings, or INFERRED indicators
 *   INCONCLUSIVE — only UNKNOWN findings or no findings at all
 *   BENIGN       — never set by deterministic engine (requires confirmed FP from external source)
 */
export function deriveAssessment(findings: Finding[], severity: string): Assessment {
  const observed    = findings.filter(f => f.type === 'OBSERVED')
  const critOrHigh  = observed.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH')

  if (critOrHigh.length >= 2) return 'MALICIOUS'
  if (critOrHigh.length >= 1 && (severity === 'CRITICAL' || severity === 'HIGH')) return 'MALICIOUS'

  const medOrAbove = observed.filter(f => f.severity !== 'LOW' && f.severity !== 'INFO')
  if (medOrAbove.length >= 2) return 'SUSPICIOUS'
  if (observed.length >= 1)   return 'SUSPICIOUS'
  if (findings.some(f => f.type === 'INFERRED')) return 'SUSPICIOUS'

  return 'INCONCLUSIVE'
}

export function assessmentToVerdict(
  assessment: Assessment,
): 'True Positive' | 'False Positive' | 'Needs Review' {
  if (assessment === 'MALICIOUS') return 'True Positive'
  if (assessment === 'BENIGN')    return 'False Positive'
  return 'Needs Review'
}

/** @deprecated Use deriveAssessment + assessmentToVerdict instead. Kept for transition. */
export function deriveVerdict(
  findings: Finding[],
  severity: string,
): 'True Positive' | 'False Positive' | 'Needs Review' {
  return assessmentToVerdict(deriveAssessment(findings, severity))
}

// ── Suspicious process list ───────────────────────────────────────────────────
export const SUSPICIOUS_PROCESSES = new Set([
  'lsass.exe', 'mimikatz.exe', 'procdump.exe',
  'mshta.exe', 'regsvr32.exe', 'rundll32.exe', 'regsvcs.exe',
  'certutil.exe', 'wscript.exe', 'cscript.exe', 'msiexec.exe',
  'wmic.exe', 'psexec.exe', 'psexec64.exe',
  'net.exe', 'net1.exe', 'at.exe', 'schtasks.exe',
  'vssadmin.exe', 'bcdedit.exe', 'wevtutil.exe',
  'nmap', 'masscan',
])

export const BENIGN_PARENT_PROCESSES = new Set([
  'explorer.exe', 'services.exe', 'svchost.exe', 'lsm.exe', 'winlogon.exe',
])

// ── Enrichment integration ────────────────────────────────────────────────────

/**
 * Convert EnrichmentResult[] into ENRICHED Finding[] for the specialist report.
 * Only malicious/suspicious results produce findings; clean/unknown/error are skipped.
 * Uses FindingType 'ENRICHED' — confirmed by external threat-intelligence provider.
 */
export function enrichmentToFindings(
  enrichments: EnrichmentResult[],
  agentPrefix: string,
): Finding[] {
  const findings: Finding[] = []

  for (const r of enrichments) {
    if (r.status === 'clean' || r.status === 'unknown' || r.status === 'error') continue

    const providerLabel = r.provider === 'virustotal' ? 'VirusTotal' :
                          r.provider === 'abuseipdb'  ? 'AbuseIPDB'  : 'Mock'
    const severity: FindingSeverity = r.status === 'malicious' ? 'CRITICAL' : 'HIGH'
    const label      = r.status === 'malicious' ? 'CONFIRMED MALICIOUS' : 'SUSPICIOUS'
    const scoreLabel = `${Math.round(r.score * 100)}%`

    const details: string[] = [`source: ${providerLabel}`, `threat score: ${scoreLabel}`]

    // Prefer granular VT raw counts when available
    if (r.details.malicious !== undefined && r.details.vtEngines !== undefined) {
      details.push(`${r.details.malicious} malicious / ${r.details.suspicious ?? 0} suspicious / ${r.details.vtEngines} engines`)
    } else if (r.details.vtDetections !== undefined && r.details.vtEngines) {
      details.push(`${r.details.vtDetections}/${r.details.vtEngines} AV engines flagged`)
    }

    if (r.details.abuseScore !== undefined) {
      details.push(`abuse confidence: ${r.details.abuseScore}/100`)
    }
    if (r.details.reputation !== undefined) {
      details.push(`community reputation: ${r.details.reputation}`)
    }
    if (r.details.asOwner)  details.push(`ASN: ${r.details.asOwner}`)
    if (r.details.country)  details.push(`country: ${r.details.country}`)
    if (r.details.summary)  details.push(r.details.summary)

    findings.push(finding(
      makeFindingId(agentPrefix), 'ENRICHED', 'threat_intelligence',
      `${providerLabel}: ${r.iocType.toUpperCase()} '${r.ioc}' is ${label} (score ${scoreLabel})`,
      severity, r.confidence,
      details,
      { toolRequired: providerLabel },
    ))
  }

  return findings
}

/**
 * If enrichments contain confirmed malicious IOCs, upgrade the assessment to MALICIOUS.
 * If suspicious, upgrade INCONCLUSIVE → SUSPICIOUS.
 */
export function upgradeAssessmentWithEnrichments(
  assessment: Assessment,
  enrichments: EnrichmentResult[],
): Assessment {
  if (!enrichments?.length) return assessment
  const hasMalicious  = enrichments.some(r => r.status === 'malicious')
  const hasSuspicious = enrichments.some(r => r.status === 'suspicious')

  if (hasMalicious)  return 'MALICIOUS'
  if (hasSuspicious && assessment === 'INCONCLUSIVE') return 'SUSPICIOUS'
  return assessment
}
