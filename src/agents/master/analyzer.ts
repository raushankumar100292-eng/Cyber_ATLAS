// ─────────────────────────────────────────────────────────────────────────────
// Alert Analyzer — Step 1: heuristic (provider-independent)
//
// Converts an AlertQueueItem into an AlertAnalysis containing:
//   • structured entities / IOCs
//   • required investigation capabilities (derived from MITRE technique,
//     tactic, and evidence keywords — NOT from alert.useCase)
//   • investigation objective
//
// Replacement strategy (Step 2):
//   Replace analyzeAlert() with an async version that sends the alert to an
//   LLM (Groq, Claude, etc.) and parses the response into the same
//   AlertAnalysis shape.  Nothing outside this file needs to change.
// ─────────────────────────────────────────────────────────────────────────────
import type { AlertQueueItem } from '../../lib/store'
import type { AlertAnalysis, AlertEntity, CapabilityId } from '../types'

export const ANALYZER_VERSION = 'heuristic-1.0.0'

// ── MITRE technique → required capabilities ───────────────────────────────────
// Keyed by both exact sub-technique (T1059.001) and parent (T1059).
// Primary routing signal — more specific than tactic or use-case.
const TECHNIQUE_CAPS: Record<string, CapabilityId[]> = {
  // ── Reconnaissance ───────────────────────────────────────────────────────
  T1595:     ['port_scan_detection', 'network_traffic_analysis'],
  'T1595.001': ['port_scan_detection', 'network_traffic_analysis'],
  T1592:     ['network_traffic_analysis', 'ioc_extraction'],
  T1590:     ['network_traffic_analysis', 'ioc_extraction'],
  T1046:     ['port_scan_detection', 'network_traffic_analysis'],
  // ── Resource Development ─────────────────────────────────────────────────
  T1583:     ['resource_dev_detection', 'ioc_extraction'],
  'T1583.001': ['resource_dev_detection', 'ioc_extraction'],
  T1587:     ['resource_dev_detection', 'threat_actor_attribution'],
  'T1587.001': ['resource_dev_detection', 'threat_actor_attribution'],
  T1608:     ['resource_dev_detection', 'ioc_extraction'],
  // ── Initial Access — Phishing ────────────────────────────────────────────
  T1566:     ['email_analysis', 'phishing_detection', 'ioc_extraction'],
  'T1566.001': ['email_analysis', 'phishing_detection', 'ioc_extraction'],
  'T1566.002': ['email_analysis', 'phishing_detection', 'ioc_extraction'],
  T1199:     ['supply_chain_analysis', 'identity_investigation'],
  // ── Execution ────────────────────────────────────────────────────────────
  T1059:     ['process_analysis', 'script_analysis', 'endpoint_investigation'],
  'T1059.001': ['powershell_analysis', 'process_analysis', 'endpoint_investigation'],
  'T1059.003': ['process_analysis', 'script_analysis', 'endpoint_investigation'],
  'T1059.005': ['process_analysis', 'script_analysis', 'endpoint_investigation'],
  T1204:     ['process_analysis', 'endpoint_investigation'],
  'T1204.002': ['process_analysis', 'malware_classification', 'endpoint_investigation'],
  // ── Persistence ──────────────────────────────────────────────────────────
  T1053:     ['persistence_detection', 'endpoint_investigation'],
  'T1053.005': ['persistence_detection', 'endpoint_investigation', 'process_analysis'],
  T1547:     ['persistence_detection', 'endpoint_investigation'],
  'T1547.001': ['persistence_detection', 'endpoint_investigation'],
  T1543:     ['persistence_detection', 'endpoint_investigation'],
  'T1543.003': ['persistence_detection', 'endpoint_investigation'],
  // ── Privilege Escalation ─────────────────────────────────────────────────
  T1548:     ['privilege_escalation_detection', 'endpoint_investigation'],
  'T1548.002': ['privilege_escalation_detection', 'process_analysis'],
  T1134:     ['privilege_escalation_detection', 'endpoint_investigation', 'process_analysis'],
  T1068:     ['privilege_escalation_detection', 'endpoint_investigation'],
  // ── Defense Evasion ──────────────────────────────────────────────────────
  T1070:     ['defense_evasion_detection', 'endpoint_investigation'],
  'T1070.001': ['defense_evasion_detection', 'endpoint_investigation'],
  T1562:     ['defense_evasion_detection', 'endpoint_investigation'],
  'T1562.001': ['defense_evasion_detection', 'endpoint_investigation'],
  T1027:     ['defense_evasion_detection', 'script_analysis', 'endpoint_investigation'],
  // ── Credential Access ────────────────────────────────────────────────────
  T1110:     ['credential_analysis', 'brute_force_detection', 'identity_investigation'],
  'T1110.001': ['credential_analysis', 'brute_force_detection'],
  'T1110.003': ['credential_analysis', 'brute_force_detection', 'identity_investigation'],
  T1078:     ['credential_analysis', 'identity_investigation'],
  'T1078.004': ['credential_analysis', 'cloud_investigation', 'iam_analysis'],
  T1003:     ['credential_analysis', 'endpoint_investigation', 'process_analysis'],
  'T1003.001': ['credential_analysis', 'process_analysis', 'endpoint_investigation'],
  // ── Discovery / Cloud ────────────────────────────────────────────────────
  T1580:     ['cloud_investigation', 'iam_analysis', 'network_traffic_analysis'],
  T1087:     ['identity_investigation', 'credential_analysis'],
  T1530:     ['cloud_investigation', 'insider_threat_detection', 'iam_analysis'],
  // ── Lateral Movement ────────────────────────────────────────────────────
  T1021:     ['lateral_movement_detection', 'network_traffic_analysis'],
  'T1021.001': ['lateral_movement_detection', 'network_traffic_analysis', 'credential_analysis'],
  'T1021.002': ['lateral_movement_detection', 'network_traffic_analysis'],
  T1550:     ['lateral_movement_detection', 'credential_analysis'],
  'T1550.002': ['lateral_movement_detection', 'credential_analysis', 'identity_investigation'],
  // ── Collection ──────────────────────────────────────────────────────────
  T1074:     ['insider_threat_detection', 'endpoint_investigation'],
  // ── C2 ──────────────────────────────────────────────────────────────────
  T1071:     ['c2_detection', 'network_traffic_analysis'],
  'T1071.001': ['c2_detection', 'network_traffic_analysis'],
  'T1071.004': ['c2_detection', 'dns_analysis'],
  // ── Exfiltration ────────────────────────────────────────────────────────
  T1041:     ['exfiltration_detection', 'c2_detection', 'network_traffic_analysis'],
  T1048:     ['exfiltration_detection', 'dns_analysis', 'network_traffic_analysis'],
  'T1048.003': ['exfiltration_detection', 'network_traffic_analysis'],
  T1567:     ['exfiltration_detection', 'network_traffic_analysis', 'cloud_investigation'],
  // ── Impact ──────────────────────────────────────────────────────────────
  T1486:     ['process_analysis', 'endpoint_investigation', 'malware_classification'],
  T1490:     ['persistence_detection', 'endpoint_investigation', 'process_analysis'],
  T1485:     ['endpoint_investigation', 'process_analysis'],
  // ── Supply Chain ────────────────────────────────────────────────────────
  T1195:     ['supply_chain_analysis', 'ioc_extraction', 'threat_actor_attribution'],
  'T1195.002': ['supply_chain_analysis', 'ioc_extraction'],
  // ── Availability / DoS — no specialist yet → triggers NO_CAPABLE_AGENT ──
  T1499:     ['availability_impact_analysis'],
  'T1499.001': ['availability_impact_analysis'],
  'T1499.002': ['availability_impact_analysis'],
}

// ── Tactic → fallback capabilities (when technique is absent or unmapped) ─────
const TACTIC_CAPS: Record<string, CapabilityId[]> = {
  'Reconnaissance':       ['port_scan_detection', 'network_traffic_analysis'],
  'Resource Development': ['resource_dev_detection', 'ioc_extraction'],
  'Initial Access':       ['email_analysis', 'phishing_detection'],
  'Execution':            ['process_analysis', 'script_analysis', 'endpoint_investigation'],
  'Persistence':          ['persistence_detection', 'endpoint_investigation'],
  'Privilege Escalation': ['privilege_escalation_detection', 'endpoint_investigation'],
  'Defense Evasion':      ['defense_evasion_detection', 'endpoint_investigation'],
  'Credential Access':    ['credential_analysis', 'brute_force_detection'],
  'Discovery':            ['network_traffic_analysis', 'cloud_investigation'],
  'Lateral Movement':     ['lateral_movement_detection', 'network_traffic_analysis'],
  'Collection':           ['insider_threat_detection', 'endpoint_investigation'],
  'Command and Control':  ['c2_detection', 'network_traffic_analysis', 'dns_analysis'],
  'Exfiltration':         ['exfiltration_detection', 'network_traffic_analysis'],
  'Impact':               ['malware_classification', 'endpoint_investigation', 'process_analysis'],
}

// ── Evidence keyword → additional capabilities (additive to technique/tactic) ─
const EVIDENCE_CAPS: Array<{ keywords: string[]; capabilities: CapabilityId[] }> = [
  { keywords: ['powershell', 'ps1', 'encoded', '-enc', 'amsi', 'bypass'],
    capabilities: ['powershell_analysis', 'script_analysis'] },
  { keywords: ['dns', 'tunnel', 'nxdomain', 'base64 query', 'high entropy'],
    capabilities: ['dns_analysis', 'c2_detection'] },
  { keywords: ['beacon', 'c2', 'command and control', 'ja3', 'jitter'],
    capabilities: ['c2_detection', 'network_traffic_analysis'] },
  { keywords: ['credential', 'password', 'hash', 'lsass', 'mimikatz', 'ntlm', 'kerberos'],
    capabilities: ['credential_analysis'] },
  { keywords: ['ransomware', '.locked', '.encrypted', 'shadow cop', 'vssadmin', 'bcdedit'],
    capabilities: ['malware_classification', 'endpoint_investigation'] },
  { keywords: ['phishing', 'attachment', 'macro', 'spear', 'harvest', 'credential form'],
    capabilities: ['email_analysis', 'phishing_detection'] },
  { keywords: ['rdp', '3389', 'pass-the-hash', 'pth', 'lateral', 'psexec', 'wmic'],
    capabilities: ['lateral_movement_detection', 'credential_analysis'] },
  { keywords: ['s3', 'iam', 'aws', 'azure', 'gcp', 'cloud', 'ec2', 'role', 'bucket'],
    capabilities: ['cloud_investigation', 'iam_analysis'] },
  { keywords: ['usb', 'dlp', 'exfil', 'bulk download', 'after-hours', 'mass file'],
    capabilities: ['exfiltration_detection', 'insider_threat_detection'] },
  { keywords: ['supply chain', 'npm', 'pip', 'package', 'vendor', 'build pipeline'],
    capabilities: ['supply_chain_analysis', 'ioc_extraction'] },
  { keywords: ['scheduled task', 'run key', 'autostart', 'startup folder', 'new service'],
    capabilities: ['persistence_detection'] },
  { keywords: ['wevtutil', 'log cleared', 'amsi bypass', 'defender disabled', 'obfuscat'],
    capabilities: ['defense_evasion_detection'] },
]

// ── Entity extraction ─────────────────────────────────────────────────────────
function extractEntities(alert: AlertQueueItem): AlertEntity[] {
  const entities: AlertEntity[] = []
  if (alert.sourceIp)      entities.push({ type: 'ip',        value: alert.sourceIp,        role: 'source'      })
  if (alert.sourceHost)    entities.push({ type: 'hostname',  value: alert.sourceHost,      role: 'source'      })
  if (alert.sourceUser)    entities.push({ type: 'user',      value: alert.sourceUser,      role: 'actor'       })
  if (alert.sourceProcess) entities.push({ type: 'process',   value: alert.sourceProcess,   role: 'indicator'   })
  if (alert.destIp)        entities.push({ type: 'ip',        value: alert.destIp,          role: 'destination' })
  if (alert.destHost && alert.destHost !== alert.destIp)
                           entities.push({ type: 'hostname',  value: alert.destHost,        role: 'destination' })
  if (alert.destPort)      entities.push({ type: 'port',      value: String(alert.destPort),role: 'destination' })
  if (alert.techniqueId)   entities.push({ type: 'technique', value: alert.techniqueId,     role: 'indicator'   })
  return entities
}

// ── IOC extraction ────────────────────────────────────────────────────────────
function extractIocs(alert: AlertQueueItem): string[] {
  const iocs: string[] = []
  // Treat public source IPs as IOCs
  if (alert.sourceIp && !/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(alert.sourceIp)) {
    iocs.push(alert.sourceIp)
  }
  if (alert.destIp)                                iocs.push(alert.destIp)
  if (alert.destHost && alert.destHost !== alert.destIp) iocs.push(alert.destHost)
  return [...new Set(iocs)].filter(Boolean)
}

// ── Capability derivation ─────────────────────────────────────────────────────
function deriveCapabilities(alert: AlertQueueItem): CapabilityId[] {
  const caps = new Set<CapabilityId>()

  // 1. MITRE technique (most authoritative signal)
  if (alert.techniqueId) {
    const exact  = TECHNIQUE_CAPS[alert.techniqueId]
    const parent = TECHNIQUE_CAPS[alert.techniqueId.split('.')[0]]
    ;(exact ?? parent ?? []).forEach(c => caps.add(c))
  }

  // 2. Tactic fallback (when technique gave nothing)
  if (caps.size === 0 && alert.tactic) {
    ;(TACTIC_CAPS[alert.tactic] ?? []).forEach(c => caps.add(c))
  }

  // 3. Evidence keywords (additive — refine even when technique matched)
  const evidenceText = [
    alert.title,
    alert.description,
    ...alert.evidence,
    alert.rawLog,
  ].join(' ').toLowerCase()

  for (const { keywords, capabilities } of EVIDENCE_CAPS) {
    if (keywords.some(kw => evidenceText.includes(kw))) {
      capabilities.forEach(c => caps.add(c))
    }
  }

  // 4. Safety net — if nothing could be derived (malformed/minimal alert),
  //    request general_investigation so the general agent catches it.
  //    Alerts with recognised (but unserviced) capabilities, e.g. T1499 →
  //    'availability_impact_analysis', correctly reach NO_CAPABLE_AGENT.
  if (caps.size === 0) {
    caps.add('general_investigation')
  }

  return Array.from(caps)
}

// ── Objective string ──────────────────────────────────────────────────────────
function buildObjective(alert: AlertQueueItem, caps: CapabilityId[]): string {
  const urgency = (alert.severity === 'CRITICAL' || alert.severity === 'HIGH')
    ? 'Urgently investigate'
    : 'Investigate'
  const tech = alert.techniqueId
    ? ` (${alert.techniqueId}${alert.techniqueName ? ' — ' + alert.techniqueName : ''})`
    : ''
  const capSummary = caps.slice(0, 3).join(', ')
  const host = alert.sourceHost || alert.sourceIp || 'unknown host'
  return `${urgency} ${alert.tactic || alert.useCaseLabel} on ${host}${tech}. Required: ${capSummary}.`
}

// ── Public entry point ────────────────────────────────────────────────────────
export function analyzeAlert(alert: AlertQueueItem): AlertAnalysis {
  const entities    = extractEntities(alert)
  const iocs        = extractIocs(alert)
  const requiredCapabilities = deriveCapabilities(alert)
  const objective   = buildObjective(alert, requiredCapabilities)

  // Confidence: higher when a specific technique is known and mapped
  const confidence = alert.techniqueId && TECHNIQUE_CAPS[alert.techniqueId]
    ? 0.88
    : alert.tactic && TACTIC_CAPS[alert.tactic]
      ? 0.70
      : 0.50

  return {
    alertId:               alert.alertId || alert.id,
    alertType:             alert.useCaseLabel || alert.useCase,
    severity:              alert.severity,
    entities,
    iocs,
    mitreTechniques:       alert.techniqueId ? [alert.techniqueId] : [],
    requiredCapabilities,
    investigationObjective: objective,
    confidence,
    analyzedAt:            Date.now(),
    analyzerVersion:       ANALYZER_VERSION,
  }
}
