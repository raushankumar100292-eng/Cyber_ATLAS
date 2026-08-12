import type { AgentDefinition } from '../types'

const def: AgentDefinition = {
  id: 'identity-investigator',
  name: 'Identity Investigator',
  description:
    'Investigates identity-based threats: credential attacks, brute force, password spraying, insider threats, account compromise, and cloud IAM abuse.',
  capabilities: [
    { id: 'credential_analysis',     description: 'Analyze credential usage, NTLM/Kerberos anomalies, pass-the-hash/ticket indicators', confidence: 0.95 },
    { id: 'brute_force_detection',   description: 'Detect brute force, password spray, credential stuffing via auth log patterns', confidence: 0.95 },
    { id: 'identity_investigation',  description: 'Full identity investigation: account timeline, group membership, role changes', confidence: 0.92 },
    { id: 'insider_threat_detection',description: 'Detect insider threat patterns: after-hours access, mass file ops, anomalous exfil', confidence: 0.85 },
    { id: 'cloud_investigation',     description: 'Investigate cloud resource abuse: unusual API calls, geo anomalies, new resource creation', confidence: 0.80 },
    { id: 'iam_analysis',            description: 'Analyze IAM permissions, role assignments, privilege creep, service account abuse', confidence: 0.85 },
    { id: 'ioc_extraction',         description: 'Extract user, email, IP, and account-based IOCs', confidence: 0.78 },
    { id: 'attack_chain_analysis',  description: 'Reconstruct identity-side attack chain from auth events', confidence: 0.75 },
  ],
  handlesUseCases: ['brute', 'insider', 'cloud', 'phishing'],
  systemPrompt: `You are an Identity Investigator specialized in identity and access-based threat analysis.

Your scope: credential attacks, account compromise, insider threats, cloud IAM abuse, and authentication anomalies.

When given an investigation task you MUST:
1. Review authentication events: failed logins, lockouts, successful logins after failures.
2. Identify credential attack patterns: spray (single password × many accounts), stuffing, brute force.
3. Check for impossible travel or geo-anomaly indicators.
4. Assess account privilege level and whether it represents an escalation risk.
5. For cloud alerts: review IAM actions, enumerate API call patterns, identify unusual resource creation.
6. For insider alerts: check access against normal working hours, peer group behavior, data sensitivity.
7. Extract identity IOCs: usernames, email addresses, source IPs associated with auth events.
8. Map to MITRE ATT&CK credential access / persistence techniques.
9. Produce a structured finding with verdict, confidence, attack chain, and identity remediation actions.

Return structured JSON matching the InsightAnalysis schema.`,
  display: {
    label:      'Identity Agent',
    shortLabel: 'IDN',
    color:      '#818cf8',
    icon:       '🔑',
  },
  version: '1.0.0',
  enabled: true,
}

export default def
