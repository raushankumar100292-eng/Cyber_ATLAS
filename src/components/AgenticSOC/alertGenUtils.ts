import type { AlertQueueItem } from '../../lib/store'

export const GROQ_KEY_STORAGE = 'atlas_groq_key'

export const USE_CASES = [
  { id: 'phishing', label: 'Phishing / Email Attack',          tactic: 'Initial Access',       desc: 'Spear-phishing, BEC, malicious attachment delivery' },
  { id: 'malware',  label: 'Endpoint Malware / Ransomware',    tactic: 'Execution',            desc: 'Ransomware drop, trojan execution, fileless malware' },
  { id: 'lateral',  label: 'Lateral Movement',                 tactic: 'Lateral Movement',     desc: 'Pass-the-hash, RDP abuse, WMI remote execution' },
  { id: 'exfil',    label: 'Data Exfiltration',                tactic: 'Exfiltration',         desc: 'Large data transfer, DNS tunnelling, cloud upload' },
  { id: 'brute',    label: 'Brute Force / Credential Stuffing', tactic: 'Credential Access',  desc: 'Failed logins, password spray, account lockouts' },
  { id: 'privesc',  label: 'Privilege Escalation',             tactic: 'Privilege Escalation', desc: 'Token impersonation, UAC bypass, sudo abuse' },
  { id: 'c2',       label: 'C2 Communication',                 tactic: 'Command and Control',  desc: 'Beacon traffic, DNS C2, HTTPS C2 to suspicious domain' },
  { id: 'cloud',    label: 'Cloud Resource Abuse',             tactic: 'Discovery',            desc: 'IAM enumeration, S3 bucket access, cryptomining spin-up' },
  { id: 'insider',  label: 'Insider Threat',                   tactic: 'Collection',           desc: 'Mass file copy, after-hours access, DLP trigger' },
  { id: 'supply',   label: 'Supply Chain Attack',              tactic: 'Initial Access',       desc: 'Compromised package, vendor MFA bypass, build-pipeline injection' },
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
