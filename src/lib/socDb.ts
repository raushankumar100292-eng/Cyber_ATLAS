// ─────────────────────────────────────────────────────────────────────────────
// SOC persistence client — talks to the local MS Access service (db_service).
//
// Every call is fire-and-forget and fully guarded: if the Python service isn't
// running, the app keeps working and simply doesn't persist. Nothing here ever
// throws into the UI.
// ─────────────────────────────────────────────────────────────────────────────
import type { AlertQueueItem, ResolvedIncident } from './store'

const DB_BASE = 'http://127.0.0.1:8077'

let online: boolean | null = null // null = unknown, then cached true/false

async function post(path: string, body: unknown): Promise<void> {
  if (online === false) return // known offline — skip quietly
  try {
    const res = await fetch(`${DB_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    })
    online = res.ok
  } catch {
    online = false // service not running — stop hammering it
  }
}

// Sequential incident number, monotonic across sessions (persisted in localStorage).
const INC_KEY = 'atlas_incident_seq'
export function nextIncidentNo(): string {
  let seq = 0
  try { seq = parseInt(localStorage.getItem(INC_KEY) ?? '0', 10) || 0 } catch { seq = 0 }
  seq += 1
  try { localStorage.setItem(INC_KEY, String(seq)) } catch { /* ignore */ }
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `INC-${day}-${String(seq).padStart(5, '0')}`
}

/** Probe the service once; returns true if reachable. */
export async function dbHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${DB_BASE}/api/health`, { signal: AbortSignal.timeout(3000) })
    online = res.ok
    return res.ok
  } catch {
    online = false
    return false
  }
}

export function saveAlert(a: AlertQueueItem): void {
  void post('/api/alerts', {
    incidentNo: a.incidentNo ?? '', alertId: a.alertId, useCase: a.useCase,
    useCaseLabel: a.useCaseLabel, severity: a.severity, title: a.title,
    description: a.description, tactic: a.tactic, techniqueId: a.techniqueId,
    techniqueName: a.techniqueName, sourceIp: a.sourceIp, sourceHost: a.sourceHost,
    sourceUser: a.sourceUser, sourceProcess: a.sourceProcess ?? '', destIp: a.destIp,
    destHost: a.destHost, destPort: a.destPort, evidence: a.evidence, rawLog: a.rawLog,
    recommendedAction: a.recommendedAction, timestamp: a.timestamp, status: a.status,
  })
}

export function saveIncident(i: ResolvedIncident): void {
  void post('/api/incidents', {
    incidentNo: i.alert.incidentNo ?? '', procId: i.procId, alertId: i.alert.alertId,
    title: i.alert.title, severity: i.alert.severity, verdict: i.verdict,
    riskScore: i.riskScore, confidence: i.confidence, mttr: i.mttr,
    agentLabel: i.agentLabel, threatActorProfile: i.threatActorProfile,
    attackChain: i.attackChain, recommendations: i.recommendations,
    iocs: i.iocs, techniques: i.techniques,
  })
  // Also persist each IOC into the IOC table, tied to the incident number.
  i.iocs.forEach(v => saveIoc({
    incidentNo: i.alert.incidentNo ?? '', type: iocType(v), value: v,
    severity: i.alert.severity, source: i.agentLabel,
  }))
}

export function saveTriage(row: {
  incidentNo: string; alertId: string; decision: string; analyst?: string; priority?: string; notes?: string
}): void {
  void post('/api/triage', { analyst: 'auto', priority: '', notes: '', ...row })
}

export function saveAnalyticsSnapshot(row: {
  ingested: number; resolved: number; truePos: number; falsePos: number; escalated: number
  avgMttr: number; fpRate: number; agentsTrained: number; skillsReused: number; payload?: string
}): void {
  void post('/api/analytics', { payload: '', ...row })
}

export function saveCampaign(row: {
  campaignId: string; name: string; threatActor: string; severity: string
  incidentCount: number; techniques: string[]; incidents: string[]; summary?: string
}): void {
  void post('/api/campaigns', { summary: '', ...row })
}

export function saveIoc(row: {
  incidentNo: string; type: string; value: string; severity: string; source: string
}): void {
  void post('/api/iocs', row)
}

// crude IOC classifier for the IOC table
function iocType(v: string): string {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return 'ip'
  if (/^[a-f0-9]{32,64}$/i.test(v)) return 'hash'
  if (/@/.test(v)) return 'email'
  if (/\./.test(v) && /[a-z]/i.test(v)) return 'domain'
  return 'other'
}
