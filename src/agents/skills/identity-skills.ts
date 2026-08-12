import type { SkillDefinition } from './types'

const AGENT = 'identity-investigator'

export const identitySkills: SkillDefinition[] = [
  {
    id: 'identity:brute-force-analysis',
    agentId: AGENT,
    name: 'Brute Force / Spray Detection',
    description: 'Detect high-volume authentication failures, credential stuffing, and password spraying.',
    capabilities: ['brute_force_detection', 'credential_analysis'],
    investigationGuidance: 'Parse failure counts from evidence. >50 failures = automated attack. Spray = multiple accounts from one source. Count from SIEM needed for confirmation.',
    evidencePatterns: ['failed login', 'failed logins', 'lockout', 'spray', 'password spray', 'credential stuffing', 'brute force', 'invalid password', 'authentication failure', 'multiple account'],
  },
  {
    id: 'identity:credential-analysis',
    agentId: AGENT,
    name: 'Credential Abuse Analysis',
    description: 'Detect pass-the-hash, Kerberoasting, LSASS dumping, and Mimikatz activity.',
    capabilities: ['credential_analysis', 'identity_investigation'],
    investigationGuidance: 'PtH/NTLM, Kerberoast/AS-REP roast, LSASS access, Mimikatz. T1078/T1110 technique IDs indicate credential abuse even without keywords.',
    evidencePatterns: ['pass-the-hash', 'pth', 'kerberoast', 'as-rep roast', 'ntlm', 'ticket', 'golden ticket', 'silver ticket', 'credential dump', 'lsass', 'mimikatz', 'hash'],
  },
  {
    id: 'identity:account-investigation',
    agentId: AGENT,
    name: 'Account Context Investigation',
    description: 'Classify account type (privileged/service/standard) and assess blast radius.',
    capabilities: ['identity_investigation'],
    investigationGuidance: 'Service accounts with interactive logins = likely compromise. Privileged accounts = highest blast radius. Extract domain from user@domain or DOMAIN\\user format.',
    evidencePatterns: ['admin', 'administrator', 'root', 'service account', 'svc_', 'domain admin', 'enterprise admin', 'privileged'],
  },
  {
    id: 'identity:cloud-iam-analysis',
    agentId: AGENT,
    name: 'Cloud / IAM Analysis',
    description: 'Detect cloud console access, IAM enumeration, and suspicious API calls (AWS/Azure/GCP).',
    capabilities: ['cloud_investigation', 'iam_analysis', 'identity_investigation'],
    investigationGuidance: 'Check destHost for cloud endpoints. IAM enum keywords: ListRoles, CreateUser, AssumeRole. Correlate with CloudTrail for confirmation.',
    evidencePatterns: ['iam', 'listroles', 'listusers', 'createuser', 'assumerolesession', 'cloudtrail', 's3', 'bucket', 'ec2', 'lambda', 'amazonaws.com', 'azure.com', 'googleapis.com'],
  },
  {
    id: 'identity:insider-threat-analysis',
    agentId: AGENT,
    name: 'Insider Threat Detection',
    description: 'Detect after-hours data access, bulk downloads, USB exfiltration, and DLP violations.',
    capabilities: ['insider_threat_detection'],
    investigationGuidance: 'Flag after-hours/off-hours access, USB usage, mass file access, DLP alert context. Correlate with HR data if available.',
    evidencePatterns: ['after-hours', 'off-hours', 'bulk', 'mass', 'usb', 'dlp', 'resignation', 'personal drive', 'unusual volume'],
  },
]
