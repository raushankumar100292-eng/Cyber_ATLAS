// ─────────────────────────────────────────────────────────────────────────────
// Network Specialist — investigation worker for network-layer threats.
// ─────────────────────────────────────────────────────────────────────────────
import type { InvestigationContext } from '../engine-interface'
import type { InvestigationResult, InvestigationEvidence } from '../result-types'
import {
  allText, hasKeyword, makeFindingId, finding, obs,
  computeConfidence, deriveAssessment, assessmentToVerdict, computeRiskScore,
  enrichmentToFindings, upgradeAssessmentWithEnrichments,
} from './_shared'

const C2_PORTS  = new Set([4444, 4445, 1337, 31337, 8888, 9999, 6666, 6667, 2222])
const ALT_HTTPS = new Set([8443, 8080, 8888])

const SUSPICIOUS_TLDS = ['.xyz', '.tk', '.ml', '.ga', '.cf', '.gq', '.cc',
  '.top', '.online', '.site', '.pw', '.ru', '.cn', '.io']

function extractTld(host: string): string {
  const parts = host.toLowerCase().split('.')
  return parts.length >= 2 ? `.${parts[parts.length - 1]}` : ''
}

function hasLongLabel(host: string): boolean {
  return host.split('.').some(label => label.length > 20)
}

function isPublicIp(ip: string): boolean {
  return !/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|::1)/.test(ip)
}

export function runNetworkInvestigation(
  context: InvestigationContext,
  startedAt: number,
): InvestigationResult {
  const alert  = context._alertContext
  const caps   = new Set(context.selectedSkills.flatMap(s => s.capabilities))
  const text   = allText(alert)
  const prefix = 'net'

  const findings: ReturnType<typeof finding>[] = []
  const evidence: InvestigationEvidence[] = []
  const notInvestigated: string[] = []

  // ── 1. Connection metadata (always OBSERVED) ───────────────────────────────
  evidence.push(obs('ip',       alert.sourceIp,  'Source IP'))
  evidence.push(obs('hostname', alert.sourceHost, 'Source host'))
  evidence.push(obs('ip',       alert.destIp,    'Destination IP'))
  if (alert.destHost) evidence.push(obs('hostname', alert.destHost, 'Destination host/domain'))
  if (alert.destPort) evidence.push(obs('port', String(alert.destPort), 'Destination port'))

  const destIsPublic = alert.destIp ? isPublicIp(alert.destIp) : false

  findings.push(finding(
    makeFindingId(prefix), 'OBSERVED', 'connection_metadata',
    `Outbound connection: ${alert.sourceHost} (${alert.sourceIp}) → ${alert.destHost || alert.destIp}:${alert.destPort}`,
    destIsPublic ? 'MEDIUM' : 'LOW', 0.95,
    [
      `src: ${alert.sourceIp} (${alert.sourceHost})`,
      `dst: ${alert.destIp}${alert.destHost ? ' / ' + alert.destHost : ''}:${alert.destPort}`,
    ],
  ))

  notInvestigated.push('IP reputation (requires VirusTotal / AbuseIPDB)')
  notInvestigated.push('Domain reputation / Passive DNS history (requires Threat Intel feed)')
  notInvestigated.push('Full packet capture / TLS fingerprint details (requires NDR)')

  // ── 2. C2 detection ────────────────────────────────────────────────────────
  if (caps.has('c2_detection')) {
    const c2Keywords = ['beacon', 'jitter', 'interval', 'c2', 'ja3', 'command and control',
      'long-lived', 'keep-alive', 'heartbeat', 'callback']
    const found = c2Keywords.filter(kw => text.includes(kw))

    const isC2Port  = C2_PORTS.has(alert.destPort)
    const isAltHttps = ALT_HTTPS.has(alert.destPort)

    if (found.length >= 2 || (found.length >= 1 && isC2Port)) {
      findings.push(finding(
        makeFindingId(prefix), 'OBSERVED', 'c2_communication',
        `C2 communication pattern confirmed: ${found.slice(0, 3).join(', ')}`,
        'CRITICAL', 0.88,
        [
          ...found.map(m => `indicator: '${m}'`),
          ...(isC2Port ? [`port ${alert.destPort} is a known C2 port`] : []),
        ],
        { mitreRef: alert.techniqueId },
      ))
    } else if (found.length === 1 || isAltHttps) {
      findings.push(finding(
        makeFindingId(prefix), 'INFERRED', 'c2_communication',
        isAltHttps
          ? `Suspicious HTTPS on non-standard port ${alert.destPort} — possible C2 tunnel`
          : `Single C2 keyword observed ('${found[0]}') — insufficient for confirmation`,
        'HIGH', 0.62,
        [
          ...(isAltHttps ? [`destination port ${alert.destPort} (non-standard HTTPS)`] : []),
          ...found.map(m => `keyword: '${m}'`),
        ],
        {
          mitreRef: alert.techniqueId,
          toolRequired: 'NetFlow / JA3 fingerprint matching via NDR',
          toolUnavailable: true,
        },
      ))
    } else {
      findings.push(finding(
        makeFindingId(prefix), 'UNKNOWN', 'c2_communication',
        'C2 beaconing cannot be confirmed from static alert data',
        'MEDIUM', 0.30, [],
        { toolRequired: 'NetFlow / NDR beacon detection', toolUnavailable: true },
      ))
    }
    notInvestigated.push('JA3/JA3S fingerprint matching (requires full TLS session data)')
    notInvestigated.push('Beacon interval analysis (requires NetFlow time series)')
  }

  // ── 3. DNS analysis ────────────────────────────────────────────────────────
  if (caps.has('dns_analysis')) {
    const dnsKeywords = ['dns', 'nxdomain', 'tunnel', 'high entropy', 'dga',
      'subdomain', 'base64 query', 'long query']
    const found = dnsKeywords.filter(kw => text.includes(kw))

    const destHost = alert.destHost || ''
    const tld = extractTld(destHost)
    const suspiciousTld = SUSPICIOUS_TLDS.includes(tld)
    const longLabel = destHost ? hasLongLabel(destHost) : false

    if (found.length > 0) {
      findings.push(finding(
        makeFindingId(prefix), 'OBSERVED', 'dns_activity',
        `DNS anomaly indicators present: ${found.slice(0, 3).join(', ')}`,
        'HIGH', 0.83,
        found.map(m => `indicator: '${m}'`),
        { mitreRef: 'T1071.004' },
      ))
    }

    if (suspiciousTld || longLabel) {
      findings.push(finding(
        makeFindingId(prefix), 'INFERRED', 'dns_activity',
        suspiciousTld
          ? `Destination TLD '${tld}' is associated with abuse-prone registrars`
          : 'Destination hostname has an unusually long label — possible DGA domain',
        'MEDIUM', 0.58,
        [
          `destination: ${destHost}`,
          suspiciousTld ? `suspicious TLD: ${tld}` : 'long hostname label detected',
        ],
        {
          mitreRef: 'T1071.004',
          toolRequired: 'Passive DNS / domain reputation check',
          toolUnavailable: true,
        },
      ))
    }

    if (found.length === 0 && !suspiciousTld && !longLabel) {
      findings.push(finding(
        makeFindingId(prefix), 'UNKNOWN', 'dns_activity',
        'DNS query content and patterns not available in alert data',
        'INFO', 0.30, [],
        { toolRequired: 'DNS query logs / SIEM', toolUnavailable: true },
      ))
    }
    notInvestigated.push('DNS query history and response codes (requires SIEM / DNS log source)')
  }

  // ── 4. Exfiltration detection ──────────────────────────────────────────────
  if (caps.has('exfiltration_detection')) {
    const exfilKeywords = ['exfil', 'gb', 'mb transferred', 'large', 'outbound',
      'upload', 'bulk', '3.2 gb', 'data transfer']
    const found = exfilKeywords.filter(kw => text.includes(kw))

    if (found.length > 0) {
      findings.push(finding(
        makeFindingId(prefix), 'OBSERVED', 'data_transfer',
        `Potential data exfiltration: ${found.slice(0, 2).join(', ')}`,
        'HIGH', 0.80,
        found.map(m => `indicator: '${m}'`),
        { mitreRef: alert.techniqueId },
      ))
      notInvestigated.push('Total bytes transferred / destination contents (requires SIEM / CASB)')
    } else {
      findings.push(finding(
        makeFindingId(prefix), 'UNKNOWN', 'data_transfer',
        'Exfiltration volume cannot be determined from alert data',
        'INFO', 0.30, [],
        { toolRequired: 'NetFlow byte-count / DLP logs', toolUnavailable: true },
      ))
    }
  }

  // ── 5. Lateral movement ────────────────────────────────────────────────────
  if (caps.has('lateral_movement_detection')) {
    const latKeywords = ['rdp', '3389', 'pass-the-hash', 'pth', 'lateral',
      'psexec', 'wmic', 'smb', 'admin share', 'ipc$']
    const found = latKeywords.filter(kw => text.includes(kw))

    if (found.length > 0) {
      findings.push(finding(
        makeFindingId(prefix), 'OBSERVED', 'lateral_movement',
        `Lateral movement indicator: ${found.slice(0, 2).join(', ')}`,
        'HIGH', 0.82,
        found.map(m => `indicator: '${m}'`),
        { mitreRef: alert.techniqueId },
      ))
      notInvestigated.push('Full lateral movement chain (requires SIEM auth log correlation)')
    } else {
      findings.push(finding(
        makeFindingId(prefix), 'UNKNOWN', 'lateral_movement',
        'Lateral movement path not derivable from alert data alone',
        'INFO', 0.30, [],
        { toolRequired: 'Authentication log correlation / SIEM', toolUnavailable: true },
      ))
    }
  }

  // ── 6. Port scan detection ─────────────────────────────────────────────────
  if (caps.has('port_scan_detection')) {
    const scanKeywords = ['scan', 'sweep', 'enumerate', 'discovery', 'masscan', 'nmap', '1,024 port']
    const found = scanKeywords.filter(kw => text.includes(kw))

    if (found.length > 0) {
      findings.push(finding(
        makeFindingId(prefix), 'OBSERVED', 'reconnaissance',
        `Network reconnaissance activity: ${found.slice(0, 2).join(', ')}`,
        'MEDIUM', 0.80,
        found.map(m => `indicator: '${m}'`),
        { mitreRef: alert.techniqueId },
      ))
    }
  }

  // ── 7. IOCs ────────────────────────────────────────────────────────────────
  const iocs = [...new Set([
    alert.destIp, alert.destHost, alert.sourceIp,
  ].filter(Boolean))]

  alert.evidence.forEach(e => evidence.push(obs('pattern', e, 'Alert evidence item', 'derived')))

  // ── 8. Enrichment findings ─────────────────────────────────────────────────
  const enrichFindings = enrichmentToFindings(context.enrichments ?? [], prefix)
  findings.push(...enrichFindings)

  // ── 9. Assessment / scoring ────────────────────────────────────────────────
  const baseAssessment = deriveAssessment(findings, alert.severity)
  const assessment     = upgradeAssessmentWithEnrichments(baseAssessment, context.enrichments ?? [])
  const confidence     = computeConfidence(findings)
  const verdict        = assessmentToVerdict(assessment)
  const riskScore      = computeRiskScore(findings, alert.severity)

  const observedHigh = findings.filter(f => f.type === 'OBSERVED' && (f.severity === 'CRITICAL' || f.severity === 'HIGH'))
  const summary = [
    observedHigh.length > 0
      ? `${observedHigh.length} confirmed network threat indicator(s)`
      : 'Network activity analyzed — confirmation requires external tools',
    `Connection ${alert.sourceHost} → ${alert.destHost || alert.destIp}:${alert.destPort}`,
    `Technique: ${alert.techniqueId} (${alert.techniqueName})`,
  ].join('. ')

  const recommendations: string[] = [alert.recommendedAction || 'Block destination and preserve NetFlow data']
  if (hasKeyword(text, 'beacon', 'c2', 'jitter')) {
    recommendations.push('Isolate source host from network immediately')
    recommendations.push('Submit destination domain/IP to threat intelligence platform')
  }
  if (hasKeyword(text, 'dns', 'tunnel')) {
    recommendations.push('Enable DNS logging and inspect query patterns')
  }
  recommendations.push('Enrich destination IP/domain with reputation data (VirusTotal, AbuseIPDB)')

  return {
    taskId:    context.taskId,
    alertId:   context.alertId,
    agentId:   context.assignedAgent.id,
    agentName: context.assignedAgent.name,
    status:    'COMPLETED',
    startedAt,
    completedAt:  Date.now(),
    executionMs:  Date.now() - startedAt,
    summary,
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
  }
}
