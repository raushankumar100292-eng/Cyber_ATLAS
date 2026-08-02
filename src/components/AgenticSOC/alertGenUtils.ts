import type { AlertQueueItem } from '../../lib/store'
import type { IndustryProfile, IndustryTechnique } from '../../data/industryKB'

export const GROQ_KEY_STORAGE = 'atlas_groq_key'

export const USE_CASES = [
  { id: 'recon',       label: 'Reconnaissance / Scanning',       tactic: 'Reconnaissance',       desc: 'Port scanning, service enumeration, OSINT gathering' },
  { id: 'resourcedev', label: 'Resource Development',            tactic: 'Resource Development', desc: 'Attacker infrastructure, domain registration, malware staging' },
  { id: 'phishing',    label: 'Phishing / Email Attack',         tactic: 'Initial Access',       desc: 'Spear-phishing, BEC, malicious attachment delivery' },
  { id: 'malware',     label: 'Endpoint Malware / Ransomware',   tactic: 'Execution',            desc: 'Ransomware drop, trojan execution, fileless malware' },
  { id: 'persistence', label: 'Persistence Mechanism',           tactic: 'Persistence',          desc: 'Scheduled task, registry run key, new service, startup folder' },
  { id: 'privesc',     label: 'Privilege Escalation',            tactic: 'Privilege Escalation', desc: 'Token impersonation, UAC bypass, sudo abuse' },
  { id: 'defevasion',  label: 'Defense Evasion',                 tactic: 'Defense Evasion',      desc: 'Log clearing, AMSI bypass, disabling security tools, obfuscation' },
  { id: 'brute',       label: 'Brute Force / Credential Access', tactic: 'Credential Access',    desc: 'Failed logins, password spray, account lockouts' },
  { id: 'cloud',       label: 'Cloud Resource Abuse / Discovery', tactic: 'Discovery',           desc: 'IAM enumeration, S3 bucket access, cryptomining spin-up' },
  { id: 'lateral',     label: 'Lateral Movement',                tactic: 'Lateral Movement',     desc: 'Pass-the-hash, RDP abuse, WMI remote execution' },
  { id: 'insider',     label: 'Insider Threat / Collection',     tactic: 'Collection',           desc: 'Mass file copy, after-hours access, DLP trigger' },
  { id: 'c2',          label: 'C2 Communication',                tactic: 'Command and Control',  desc: 'Beacon traffic, DNS C2, HTTPS C2 to suspicious domain' },
  { id: 'exfil',       label: 'Data Exfiltration',               tactic: 'Exfiltration',         desc: 'Large data transfer, DNS tunnelling, cloud upload' },
  { id: 'impact',      label: 'Impact / Data Destruction',       tactic: 'Impact',               desc: 'Ransomware encryption, data wiping, service disruption' },
  { id: 'supply',      label: 'Supply Chain Attack',             tactic: 'Initial Access',       desc: 'Compromised package, vendor MFA bypass, build-pipeline injection' },
] as const

export type UseCaseId = typeof USE_CASES[number]['id']
export type UseCase   = typeof USE_CASES[number]

export interface SiemAlert {
  alert_id:        string
  timestamp:       string
  severity:        'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'
  title:           string
  description:     string
  tactic:          string
  technique_id:    string
  technique_name:  string
  source: {
    ip:       string
    hostname: string
    user:     string
    process?: string
  }
  destination: {
    ip:        string
    hostname?: string
    port?:     number
  }
  evidence:           string[]
  raw_log:            string
  recommended_action: string
}

export async function groqGenerateAlert(apiKey: string, uc: UseCase): Promise<string> {
  const counter = String(Math.floor(Math.random() * 9000) + 1000)
  const dateStr  = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are a SIEM alert generator for security operations testing. Generate realistic, varied security alerts. Output ONLY valid JSON — no markdown, no code fences.',
        },
        {
          role: 'user',
          content: `Generate one realistic SIEM alert for: "${uc.label}" (${uc.desc}).\nMITRE tactic: ${uc.tactic}\n\nReturn EXACTLY this JSON:\n{\n  "alert_id": "ALT-${dateStr}-${counter}",\n  "timestamp": "${new Date().toISOString()}",\n  "severity": "<CRITICAL|HIGH|MEDIUM|LOW>",\n  "title": "<5-10 word title>",\n  "description": "<2-3 sentences>",\n  "tactic": "${uc.tactic}",\n  "technique_id": "<real MITRE ID e.g. T1566.001>",\n  "technique_name": "<name>",\n  "source": { "ip": "<RFC1918 or public IP>", "hostname": "<hostname>", "user": "<user@corp.com>", "process": "<name or null>" },\n  "destination": { "ip": "<IP>", "hostname": "<host or domain>", "port": <integer> },\n  "evidence": ["<item1>","<item2>","<item3>"],\n  "raw_log": "<one raw log line>",\n  "recommended_action": "<first-response action>"\n}\nMake it realistic, varied IPs/users/hosts each time.`,
        },
      ],
      temperature: 0.9,
      max_tokens: 800,
    }),
  })

  if (!res.ok) throw new Error(`Groq API error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

export function parseAlert(raw: string): SiemAlert {
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim()
  return JSON.parse(cleaned) as SiemAlert
}

// ── Local (no-API-key) synthetic alert generator ──────────────────────────────
// Produces realistic, varied alerts so the SOC pipeline works without a Groq key.
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const randIp = () => `${pick([10, 172, 192])}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`
const pubIp  = () => `${Math.floor(Math.random() * 223) + 1}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`

const HOSTS  = ['WKS-FIN-08', 'SRV-DC-01', 'corp-laptop-123', 'sales-laptop-23', 'WKS-HR-14', 'SRV-APP-02', 'DEV-BUILD-05', 'WKS-ENG-31']
const USERS  = ['jane.doe@corp.com', 'john.smith@corp.com', 'svc_backup', 'a.patel@corp.com', 'admin', 'r.chen@corp.com', 'm.garcia@corp.com']
const SEVS: SiemAlert['severity'][] = ['CRITICAL', 'HIGH', 'HIGH', 'MEDIUM', 'MEDIUM', 'LOW']

const UC_TEMPLATES: Record<string, {
  tech: [string, string][]; titles: string[]; procs: string[]; ports: number[];
  dests: string[]; evidence: string[]; action: string
}> = {
  phishing: {
    tech: [['T1566.001', 'Spearphishing Attachment'], ['T1566.002', 'Spearphishing Link']],
    titles: ['Spear Phishing Attack Detected', 'Malicious Attachment Delivered', 'Credential Harvest Link Clicked'],
    procs: ['outlook.exe', 'winword.exe', 'chrome.exe'], ports: [443, 587, 993],
    dests: ['mail.corp.com', 'login-secure-verify.com', 'account-update.net'],
    evidence: ['Sender domain registered < 24h ago', 'Attachment contains macro', 'URL redirects to credential form'],
    action: 'Quarantine message and reset affected credentials',
  },
  malware: {
    tech: [['T1059.001', 'PowerShell'], ['T1486', 'Data Encrypted for Impact']],
    titles: ['Ransomware Execution Detected', 'Suspicious Process Execution', 'Fileless Malware Activity'],
    procs: ['powershell.exe', 'cmd.exe', 'rundll32.exe'], ports: [445, 8080, 4444],
    dests: ['update-svc.ddns.net', 'cdn-delivery.xyz', '185.220.101.5'],
    evidence: ['Encoded PowerShell command', 'Mass file rename to .locked', 'Shadow copies deleted'],
    action: 'Isolate host and review process tree',
  },
  lateral: {
    tech: [['T1021.001', 'Remote Desktop Protocol'], ['T1550.002', 'Pass the Hash']],
    titles: ['Lateral Movement via RDP', 'Pass-the-Hash Detected', 'WMI Remote Execution'],
    procs: ['mstsc.exe', 'wmic.exe', 'psexec.exe'], ports: [3389, 445, 135],
    dests: ['SRV-DC-01', 'SRV-APP-02', 'WKS-FIN-08'],
    evidence: ['NTLM auth from unusual host', 'RDP session outside business hours', 'Admin share access'],
    action: 'Disable account and isolate source host',
  },
  exfil: {
    tech: [['T1041', 'Exfiltration Over C2 Channel'], ['T1048', 'Exfiltration Over Alternative Protocol']],
    titles: ['Large Data Transfer Detected', 'DNS Tunnelling Activity', 'Cloud Upload Anomaly'],
    procs: ['chrome.exe', 'curl.exe', 'rclone.exe'], ports: [443, 53, 21],
    dests: ['transfer-bucket.s3.amazonaws.com', 'dns.tunnel-c2.io', pubIp()],
    evidence: ['3.2 GB outbound in 5 min', 'High-entropy DNS queries', 'Access to unsanctioned cloud storage'],
    action: 'Block destination and preserve netflow evidence',
  },
  brute: {
    tech: [['T1110.001', 'Password Guessing'], ['T1110.003', 'Password Spraying']],
    titles: ['Brute Force Login Attempt', 'Password Spray Detected', 'Account Lockout Spike'],
    procs: ['—'], ports: [22, 3389, 443],
    dests: ['SRV-DC-01', 'vpn.corp.com', 'owa.corp.com'],
    evidence: ['142 failed logins in 3 min', 'Single password across 60 accounts', 'Source from Tor exit node'],
    action: 'Enforce MFA and block source IP',
  },
  privesc: {
    tech: [['T1548.002', 'Bypass UAC'], ['T1134', 'Access Token Manipulation']],
    titles: ['Privilege Escalation Attempt', 'UAC Bypass Detected', 'Token Impersonation'],
    procs: ['fodhelper.exe', 'cmd.exe', 'lsass.exe'], ports: [445, 135],
    dests: ['SRV-DC-01', 'WKS-ENG-31'],
    evidence: ['Non-admin spawned elevated process', 'SeDebugPrivilege enabled', 'Registry autostart modified'],
    action: 'Suspend session and audit local admin group',
  },
  c2: {
    tech: [['T1071.001', 'Web Protocols'], ['T1071.004', 'DNS']],
    titles: ['Suspicious HTTPS C2 Communication', 'Beacon Traffic Detected', 'DNS C2 Channel'],
    procs: ['svchost.exe', 'chrome.exe', 'rundll32.exe'], ports: [443, 53, 8443],
    dests: ['suspiciouscommand.com', 'beacon-node.ru', 'cdn-metrics.xyz'],
    evidence: ['Regular 60s beacon interval', 'JA3 hash matches known C2', 'Long-lived TLS to rare domain'],
    action: 'Block C2 domain and isolate host',
  },
  cloud: {
    tech: [['T1078.004', 'Cloud Accounts'], ['T1580', 'Cloud Infrastructure Discovery']],
    titles: ['Cloud Resource Abuse', 'IAM Enumeration Detected', 'Cryptomining Instance Spun Up'],
    procs: ['—'], ports: [443],
    dests: ['iam.amazonaws.com', 'ec2.amazonaws.com', 'management.azure.com'],
    evidence: ['ListRoles called 200x in 1 min', 'GPU instance launched in unused region', 'Access key used from new geo'],
    action: 'Revoke access key and review CloudTrail',
  },
  insider: {
    tech: [['T1530', 'Data from Cloud Storage'], ['T1074', 'Data Staged']],
    titles: ['Insider Threat — Mass File Copy', 'After-Hours Data Access', 'DLP Policy Triggered'],
    procs: ['explorer.exe', 'robocopy.exe', 'chrome.exe'], ports: [445, 443],
    dests: ['USB-DRIVE-E', 'personal-drive.example.com', 'SRV-FILE-01'],
    evidence: ['1,200 files copied to USB', 'Access to HR share outside role', 'Bulk download before resignation date'],
    action: 'Disable account and engage HR/legal',
  },
  supply: {
    tech: [['T1195.002', 'Compromise Software Supply Chain'], ['T1199', 'Trusted Relationship']],
    titles: ['Supply Chain Attack Detected', 'Compromised Package Installed', 'Vendor MFA Bypass'],
    procs: ['npm.exe', 'pip.exe', 'msiexec.exe'], ports: [443],
    dests: ['registry.npmjs.org', 'pypi.org', 'vendor-portal.com'],
    evidence: ['Package post-install script beacons out', 'Unsigned dependency update', 'Vendor cert mismatch'],
    action: 'Quarantine artifact and audit build pipeline',
  },
  recon: {
    tech: [['T1595.001', 'Scanning IP Blocks'], ['T1046', 'Network Service Discovery'], ['T1590', 'Gather Victim Network Information']],
    titles: ['Port Scan Detected', 'Network Service Enumeration', 'External Recon Sweep'],
    procs: ['nmap', 'masscan', '—'], ports: [22, 80, 443, 3389],
    dests: ['dmz-subnet', 'edge-fw-01', 'SRV-WEB-03'],
    evidence: ['SYN scan across 1,024 ports in 40s', 'Sequential host sweep of 10.0.0.0/24', 'User-agent matches known scanner'],
    action: 'Block source IP at perimeter and review exposed services',
  },
  resourcedev: {
    tech: [['T1583.001', 'Acquire Infrastructure: Domains'], ['T1587.001', 'Develop Capabilities: Malware'], ['T1608', 'Stage Capabilities']],
    titles: ['Suspicious Domain Registration', 'Attacker Infrastructure Detected', 'Malicious Payload Staged'],
    procs: ['—'], ports: [443, 53],
    dests: ['secure-login-verify.top', 'c2-staging.xyz', 'paste.ee'],
    evidence: ['Lookalike domain registered < 24h ago', 'TLS cert issued for typosquat domain', 'Payload staged on paste site'],
    action: 'Add indicators to blocklist and monitor for activation',
  },
  persistence: {
    tech: [['T1053.005', 'Scheduled Task'], ['T1547.001', 'Registry Run Keys'], ['T1543.003', 'Windows Service']],
    titles: ['Persistence via Scheduled Task', 'Registry Run Key Added', 'Malicious Service Installed'],
    procs: ['schtasks.exe', 'reg.exe', 'sc.exe'], ports: [445],
    dests: ['WKS-FIN-08', 'SRV-APP-02', 'WKS-ENG-31'],
    evidence: ['New scheduled task launches PowerShell at logon', 'Run key points to a %TEMP% binary', 'Auto-start service with unsigned binary'],
    action: 'Remove persistence artifact and image the host',
  },
  defevasion: {
    tech: [['T1070.001', 'Clear Windows Event Logs'], ['T1562.001', 'Disable or Modify Tools'], ['T1027', 'Obfuscated Files or Information']],
    titles: ['Security Event Log Cleared', 'Endpoint Protection Disabled', 'AMSI Bypass Detected'],
    procs: ['wevtutil.exe', 'powershell.exe', 'cmd.exe'], ports: [445],
    dests: ['WKS-HR-14', 'SRV-DC-01', 'WKS-FIN-08'],
    evidence: ['Security event log cleared (Event ID 1102)', 'Defender real-time protection disabled', 'Base64/XOR obfuscated command line'],
    action: 'Isolate host, restore logging, and hunt for related activity',
  },
  impact: {
    tech: [['T1486', 'Data Encrypted for Impact'], ['T1490', 'Inhibit System Recovery'], ['T1485', 'Data Destruction']],
    titles: ['Ransomware Encryption In Progress', 'Shadow Copies Deleted', 'Mass Data Destruction Detected'],
    procs: ['vssadmin.exe', 'powershell.exe', 'cmd.exe'], ports: [445, 3389],
    dests: ['FILE-SRV-01', 'SRV-DC-01', 'SRV-APP-02'],
    evidence: ['Mass file rename to .locked extension', 'vssadmin delete shadows /all executed', 'Ransom note dropped in every directory'],
    action: 'Isolate immediately, preserve evidence, and initiate IR/recovery',
  },
}

export function localGenerateAlert(uc: UseCase): SiemAlert {
  const t = UC_TEMPLATES[uc.id] ?? UC_TEMPLATES.malware
  const [techId, techName] = pick(t.tech)
  const proc = pick(t.procs)
  const counter = String(Math.floor(Math.random() * 9000) + 1000)
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const host = pick(HOSTS)
  const user = pick(USERS)
  const dst  = pick(t.dests)
  return {
    alert_id:       `ALT-${dateStr}-${counter}`,
    timestamp:      new Date().toISOString(),
    severity:       pick(SEVS),
    title:          pick(t.titles),
    description:    `${uc.label} activity detected on ${host} involving ${user}. ${uc.desc}.`,
    tactic:         uc.tactic,
    technique_id:   techId,
    technique_name: techName,
    source:      { ip: randIp(), hostname: host, user, process: proc === '—' ? undefined : proc },
    destination: { ip: /^\d/.test(dst) ? dst : pubIp(), hostname: dst, port: pick(t.ports) },
    evidence:    t.evidence,
    raw_log:     `${new Date().toISOString()} host=${host} user=${user} tech=${techId} action=detected proc=${proc}`,
    recommended_action: t.action,
  }
}

// ── Industry-targeted generation ──────────────────────────────────────────────
// Maps a MITRE tactic (as used in the KB) to the closest Alert-Generator use case,
// so an industry-baseline technique can reuse that use case's realistic template
// (procs/ports/dests/evidence) while the alert carries the KB's real technique.
const TACTIC_TO_UC: Record<string, UseCaseId> = {
  'Reconnaissance': 'recon',
  'Resource Development': 'resourcedev',
  'Initial Access': 'phishing',
  'Execution': 'malware',
  'Persistence': 'persistence',
  'Privilege Escalation': 'privesc',
  'Defense Evasion': 'defevasion',
  'Credential Access': 'brute',
  'Discovery': 'cloud',
  'Lateral Movement': 'lateral',
  'Collection': 'insider',
  'Command and Control': 'c2',
  'Exfiltration': 'exfil',
  'Impact': 'impact',
}

export function ucForTactic(tactic: string): UseCase {
  const id = TACTIC_TO_UC[tactic] ?? 'malware'
  return USE_CASES.find(u => u.id === id) ?? USE_CASES[3]
}

/** Pick a baseline technique for an industry (specific index for rotate, else random). */
export function pickIndustryTechnique(profile: IndustryProfile, index?: number): IndustryTechnique {
  const list = profile.techniques
  if (list.length === 0) return { id: 'T1566', name: 'Phishing', tactic: 'Initial Access', why: '' }
  if (typeof index === 'number') return list[index % list.length]
  return pick(list)
}

/**
 * Local (no-API-key) industry-targeted alert: draws a technique from the sector
 * baseline, reuses the tactic's template for realism, then overrides the technique
 * and context so the alert reflects the industry's real threat profile.
 */
export function localGenerateIndustryAlert(
  profile: IndustryProfile,
  tech?: IndustryTechnique,
): { alert: SiemAlert; uc: UseCase } {
  const kbTech = tech ?? pickIndustryTechnique(profile)
  const uc = ucForTactic(kbTech.tactic)
  const base = localGenerateAlert(uc)
  const alert: SiemAlert = {
    ...base,
    tactic: kbTech.tactic,
    technique_id: kbTech.id,
    technique_name: kbTech.name,
    description: `[${profile.label}] ${kbTech.name} activity detected on ${base.source.hostname} involving ${base.source.user}. ${kbTech.why}`,
  }
  return { alert, uc }
}

/** Groq industry-targeted alert — grounds the LLM in the sector + the chosen technique. */
export async function groqGenerateIndustryAlert(
  apiKey: string,
  profile: IndustryProfile,
  tech: IndustryTechnique,
): Promise<string> {
  const counter = String(Math.floor(Math.random() * 9000) + 1000)
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const actors = profile.topThreatActors.slice(0, 4).join(', ')

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are a SIEM alert generator for security operations testing. Generate realistic, varied security alerts grounded in the target industry. Output ONLY valid JSON — no markdown, no code fences.',
        },
        {
          role: 'user',
          content: `Generate one realistic SIEM alert for a ${profile.label} organisation.\nThreat context: ${profile.threatProfile}\nLikely threat actors: ${actors}\nThis alert MUST reflect MITRE technique ${tech.id} (${tech.name}), tactic ${tech.tactic}. Why it matters here: ${tech.why}\n\nReturn EXACTLY this JSON:\n{\n  "alert_id": "ALT-${dateStr}-${counter}",\n  "timestamp": "${new Date().toISOString()}",\n  "severity": "<CRITICAL|HIGH|MEDIUM|LOW>",\n  "title": "<5-10 word title>",\n  "description": "<2-3 sentences, sector-specific>",\n  "tactic": "${tech.tactic}",\n  "technique_id": "${tech.id}",\n  "technique_name": "${tech.name}",\n  "source": { "ip": "<RFC1918 or public IP>", "hostname": "<sector-appropriate hostname>", "user": "<user@corp.com>", "process": "<name or null>" },\n  "destination": { "ip": "<IP>", "hostname": "<host or domain>", "port": <integer> },\n  "evidence": ["<item1>","<item2>","<item3>"],\n  "raw_log": "<one raw log line>",\n  "recommended_action": "<first-response action>"\n}\nMake IPs/users/hosts realistic and varied each time.`,
        },
      ],
      temperature: 0.9,
      max_tokens: 800,
    }),
  })

  if (!res.ok) throw new Error(`Groq API error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

export function buildAlertQueueItem(data: SiemAlert, uc: UseCase): AlertQueueItem {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  return {
    id,
    useCase:           uc.id,
    useCaseLabel:      uc.label,
    severity:          data.severity,
    title:             data.title,
    description:       data.description,
    tactic:            data.tactic,
    techniqueId:       data.technique_id,
    techniqueName:     data.technique_name,
    sourceIp:          data.source.ip,
    sourceHost:        data.source.hostname,
    sourceUser:        data.source.user,
    sourceProcess:     data.source.process ?? null,
    destIp:            data.destination.ip,
    destHost:          data.destination.hostname ?? data.destination.ip,
    destPort:          data.destination.port ?? 0,
    evidence:          data.evidence,
    rawLog:            data.raw_log,
    recommendedAction: data.recommended_action,
    alertId:           data.alert_id,
    timestamp:         data.timestamp,
    createdAt:         Date.now(),
    status:            'new',
  }
}
