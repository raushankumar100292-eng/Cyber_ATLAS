// ─────────────────────────────────────────────────────────────────────────────
// Identity Specialist — investigation worker for credential / identity threats.
// ─────────────────────────────────────────────────────────────────────────────
import type { InvestigationContext } from '../engine-interface'
import type { InvestigationResult, InvestigationEvidence } from '../result-types'
import {
  allText, hasKeyword, makeFindingId, finding, obs,
  computeConfidence, deriveAssessment, assessmentToVerdict, computeRiskScore,
  enrichmentToFindings, upgradeAssessmentWithEnrichments,
} from './_shared'

const SVC_PREFIXES   = ['svc_', 'svc-', 'service_', 'sa_', 'sa-']
const ADMIN_KEYWORDS = ['admin', 'administrator', 'root', 'domain admin', 'enterprise admin']
const CLOUD_ENDPOINTS = ['amazonaws.com', 'azure.com', 'googleapis.com',
  'iam.aws', 'management.azure', 'ec2.amazonaws']

function classifyAccount(user: string): { type: string; isPrivileged: boolean; isService: boolean } {
  const u = user.toLowerCase()
  const isService   = SVC_PREFIXES.some(p => u.startsWith(p))
  const isPrivileged = ADMIN_KEYWORDS.some(kw => u.includes(kw))
  const type = isService ? 'service account' : isPrivileged ? 'privileged account' : 'standard user account'
  return { type, isPrivileged, isService }
}

function parseDomain(user: string): string | null {
  const atIdx = user.indexOf('@')
  if (atIdx > 0) return user.slice(atIdx + 1)
  const bsIdx = user.indexOf('\\')
  if (bsIdx > 0) return user.slice(0, bsIdx)
  return null
}

function parseLoginCount(text: string): number | null {
  const m = text.match(/(\d+)\s*(failed|attempt|lockout|account|login)/i)
  return m ? parseInt(m[1], 10) : null
}

export function runIdentityInvestigation(
  context: InvestigationContext,
  startedAt: number,
): InvestigationResult {
  const alert  = context._alertContext
  const caps   = new Set(context.selectedSkills.flatMap(s => s.capabilities))
  const text   = allText(alert)
  const prefix = 'idn'

  const findings: ReturnType<typeof finding>[] = []
  const evidence: InvestigationEvidence[] = []
  const notInvestigated: string[] = []

  // ── 1. Account context (always OBSERVED when user is present) ─────────────
  const user = alert.sourceUser
  if (user) {
    evidence.push(obs('user', user, 'Source user account'))
    const acct   = classifyAccount(user)
    const domain = parseDomain(user)
    if (domain) evidence.push(obs('domain', domain, 'User domain', 'derived'))

    findings.push(finding(
      makeFindingId(prefix), 'OBSERVED', 'account_context',
      `${acct.type} '${user}'${domain ? ` on domain '${domain}'` : ''} involved in incident`,
      acct.isPrivileged ? 'HIGH' : acct.isService ? 'MEDIUM' : 'LOW',
      0.90,
      [`account: ${user}`, `type: ${acct.type}`, `host: ${alert.sourceHost}`],
    ))

    if (acct.isPrivileged) {
      findings.push(finding(
        makeFindingId(prefix), 'INFERRED', 'privileged_access',
        `Privileged account '${user}' — blast radius is significantly elevated`,
        'HIGH', 0.80,
        [`account name contains admin/root keyword`, `privileges allow domain-wide impact`],
        { toolRequired: 'Active Directory group membership query', toolUnavailable: true },
      ))
    }
    if (acct.isService) {
      findings.push(finding(
        makeFindingId(prefix), 'INFERRED', 'account_context',
        `Service account '${user}' — interactive activity may indicate compromise or credential theft`,
        'HIGH', 0.75,
        [`service accounts should not authenticate interactively`, `host: ${alert.sourceHost}`],
      ))
    }

    notInvestigated.push('Account creation date, last password change, MFA status (requires Active Directory / IdP)')
    notInvestigated.push('Account group memberships and role assignments (requires AD / IAM query)')
  } else {
    findings.push(finding(
      makeFindingId(prefix), 'UNKNOWN', 'account_context',
      'Source user account not available in alert data',
      'INFO', 0.30, [],
      { toolRequired: 'Authentication log correlation via SIEM', toolUnavailable: true },
    ))
  }

  // ── 2. Brute force detection ───────────────────────────────────────────────
  if (caps.has('brute_force_detection')) {
    const bruteKeywords = ['failed login', 'failed logins', 'lockout', 'spray',
      'password spray', 'credential stuffing', 'brute force', 'invalid password',
      'authentication failure', 'multiple account']
    const found = bruteKeywords.filter(kw => text.includes(kw))
    const loginCount = parseLoginCount(text)

    if (found.length > 0 || (loginCount !== null && loginCount > 10)) {
      const highVolume = loginCount !== null && loginCount > 50
      findings.push(finding(
        makeFindingId(prefix), 'OBSERVED', 'authentication_failure',
        highVolume
          ? `High-volume authentication failure: ${loginCount} events — consistent with automated brute force or spray`
          : `Brute force / credential attack pattern observed: ${found.slice(0, 2).join(', ')}`,
        highVolume ? 'CRITICAL' : 'HIGH',
        highVolume ? 0.90 : 0.83,
        [
          ...(loginCount !== null ? [`login failure count: ${loginCount}`] : []),
          ...found.map(m => `indicator: '${m}'`),
          `source: ${alert.sourceIp}`,
        ],
        { mitreRef: alert.techniqueId },
      ))
    } else {
      findings.push(finding(
        makeFindingId(prefix), 'UNKNOWN', 'authentication_failure',
        'Authentication failure volume not quantifiable from alert data',
        'INFO', 0.30, [],
        { toolRequired: 'Authentication log count query via SIEM', toolUnavailable: true },
      ))
    }
    notInvestigated.push('Full authentication log for affected accounts (requires SIEM / Windows Security Events)')
    notInvestigated.push('Source IP geolocation and reputation (requires GeoIP / AbuseIPDB)')
  }

  // ── 3. Credential abuse (PtH, Kerberos, NTLM) ────────────────────────────
  if (caps.has('credential_analysis')) {
    const credKeywords = ['pass-the-hash', 'pth', 'kerberoast', 'as-rep roast',
      'ntlm', 'ticket', 'golden ticket', 'silver ticket', 'credential dump',
      'lsass', 'mimikatz', 'hash']
    const found = credKeywords.filter(kw => text.includes(kw))

    if (found.length > 0) {
      findings.push(finding(
        makeFindingId(prefix), 'OBSERVED', 'credential_abuse',
        `Credential-based attack technique observed: ${found.slice(0, 3).join(', ')}`,
        'CRITICAL', 0.88,
        found.map(m => `indicator: '${m}'`),
        { mitreRef: alert.techniqueId },
      ))
    } else if (context.mitreTechnique.startsWith('T1078') || context.mitreTechnique.startsWith('T1110')) {
      findings.push(finding(
        makeFindingId(prefix), 'INFERRED', 'credential_abuse',
        `Technique ${context.mitreTechnique} (${alert.techniqueName}) indicates credential abuse — no specific artefact in alert text`,
        'HIGH', 0.65,
        [`MITRE technique: ${context.mitreTechnique}`, `technique class: credential access`],
        { toolRequired: 'Windows Security Event Log 4624/4625/4648 via SIEM', toolUnavailable: true },
      ))
    }
    notInvestigated.push('Credential dump artefacts on source host (requires EDR / memory analysis)')
  }

  // ── 4. Identity investigation ─────────────────────────────────────────────
  if (caps.has('identity_investigation')) {
    const destHost = alert.destHost || ''
    const destIsKnownDc = ['srvdc', 'srv-dc', 'dc01', 'dc1'].some(
      kw => destHost.toLowerCase().includes(kw),
    )
    if (destIsKnownDc) {
      findings.push(finding(
        makeFindingId(prefix), 'OBSERVED', 'identity_investigation',
        `Activity directed at probable domain controller: ${destHost}`,
        'HIGH', 0.82,
        [`destination host: ${destHost}`, `naming pattern matches common DC hostname`],
        { toolRequired: 'Active Directory LDAP query to confirm DC role', toolUnavailable: true },
      ))
    }
    notInvestigated.push('Impossible travel / geolocation anomaly (requires IdP sign-in logs)')
    notInvestigated.push('UEBA peer-group baseline comparison (requires UEBA platform)')
  }

  // ── 5. Cloud / IAM ────────────────────────────────────────────────────────
  if (caps.has('cloud_investigation') || caps.has('iam_analysis')) {
    const destHost  = (alert.destHost || '').toLowerCase()
    const cloudDest = CLOUD_ENDPOINTS.some(ep => destHost.includes(ep))
    const cloudKeywords = ['iam', 'listroles', 'listusers', 'createuser',
      'assumerolesession', 'cloudtrail', 's3', 'bucket', 'ec2', 'lambda']
    const found = cloudKeywords.filter(kw => text.includes(kw))

    if (cloudDest || found.length > 0) {
      findings.push(finding(
        makeFindingId(prefix), 'OBSERVED', 'cloud_access',
        cloudDest
          ? `Traffic destined for cloud management endpoint: ${alert.destHost}`
          : `Cloud IAM activity indicators: ${found.slice(0, 3).join(', ')}`,
        'HIGH', cloudDest ? 0.85 : 0.80,
        [
          ...(cloudDest ? [`destination: ${alert.destHost}`] : []),
          ...found.map(m => `keyword: '${m}'`),
        ],
        { mitreRef: alert.techniqueId },
      ))
      notInvestigated.push('CloudTrail / AWS Config API call details (requires cloud logging integration)')
      notInvestigated.push('IAM role permissions and resource access scope (requires cloud IAM API)')
    }
  }

  // ── 6. Insider threat ─────────────────────────────────────────────────────
  if (caps.has('insider_threat_detection')) {
    const insiderKeywords = ['after-hours', 'off-hours', 'bulk', 'mass',
      'usb', 'dlp', 'resignation', 'personal drive', 'unusual volume']
    const found = insiderKeywords.filter(kw => text.includes(kw))

    if (found.length > 0) {
      findings.push(finding(
        makeFindingId(prefix), 'OBSERVED', 'insider_threat',
        `Insider threat indicator: ${found.slice(0, 2).join(', ')}`,
        'HIGH', 0.80,
        found.map(m => `indicator: '${m}'`),
        { mitreRef: alert.techniqueId },
      ))
      notInvestigated.push('DLP policy details and data classification (requires DLP platform)')
    }
  }

  // ── 7. Evidence / IOCs ────────────────────────────────────────────────────
  evidence.push(obs('ip', alert.sourceIp, 'Source IP of authentication attempt'))
  if (alert.destHost) evidence.push(obs('hostname', alert.destHost, 'Authentication target'))
  alert.evidence.forEach(e => evidence.push(obs('pattern', e, 'Alert evidence item', 'derived')))

  const iocs = [...new Set([
    alert.sourceIp, alert.sourceUser, alert.sourceHost, alert.destIp,
  ].filter(Boolean))]

  // ── 8. Enrichment findings ─────────────────────────────────────────────────
  const enrichFindings = enrichmentToFindings(context.enrichments ?? [], prefix)
  findings.push(...enrichFindings)

  // ── 9. Assessment / scoring ────────────────────────────────────────────────
  const baseAssessment = deriveAssessment(findings, alert.severity)
  const assessment     = upgradeAssessmentWithEnrichments(baseAssessment, context.enrichments ?? [])
  const confidence     = computeConfidence(findings)
  const verdict        = assessmentToVerdict(assessment)
  const riskScore  = computeRiskScore(findings, alert.severity)

  const high = findings.filter(f => f.type === 'OBSERVED' && (f.severity === 'CRITICAL' || f.severity === 'HIGH'))
  const summary = [
    high.length > 0
      ? `${high.length} confirmed identity threat indicator(s)`
      : 'Identity investigation complete — external enrichment required',
    user ? `Account '${user}' on ${alert.sourceHost}` : `Source: ${alert.sourceHost}`,
    `Technique: ${alert.techniqueId} (${alert.techniqueName})`,
  ].join('. ')

  const recommendations: string[] = [alert.recommendedAction || 'Lock the affected account immediately']
  if (hasKeyword(text, 'spray', 'brute', 'lockout')) {
    recommendations.push('Enforce MFA for all affected accounts')
    recommendations.push('Block source IP at perimeter and review for Tor/VPN exit node')
  }
  if (hasKeyword(text, 'pth', 'pass-the-hash', 'ntlm')) {
    recommendations.push('Rotate Kerberos service account passwords (krbtgt twice)')
  }
  if (hasKeyword(text, 'admin', 'privileged')) {
    recommendations.push('Audit privileged account usage and remove unnecessary admin rights')
  }
  recommendations.push('Correlate source IP across all authentication events in SIEM')

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
