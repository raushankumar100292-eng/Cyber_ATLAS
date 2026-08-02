// ─────────────────────────────────────────────────────────────────────────────
// SOC persistence client — talks to the local MS Access service (db_service).
//
// Every call is fire-and-forget and fully guarded: if the Python service isn't
// running, the app keeps working and simply doesn't persist. Nothing here ever
// throws into the UI.
// ─────────────────────────────────────────────────────────────────────────────
import type { AlertQueueItem, ResolvedIncident } from './store'
import type { IndustryProfile, IndustryTechnique } from '../data/industryKB'

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

/**
 * Load persisted resolved incidents back from the DB service (system of record).
 * Returns [] if the service is unreachable so the caller can fall back to its
 * in-memory / localStorage copy. Never throws into the UI.
 */
export async function fetchIncidents(limit = 500): Promise<ResolvedIncident[]> {
  if (online === false) return []
  try {
    const res = await fetch(`${DB_BASE}/api/incidents?limit=${limit}`, {
      signal: AbortSignal.timeout(5000),
    })
    online = res.ok
    if (!res.ok) return []
    const data = await res.json() as { incidents?: ResolvedIncident[] }
    return data.incidents ?? []
  } catch {
    online = false
    return []
  }
}

/**
 * Mirror the curated Industry Knowledge Base into the DB (idempotent upsert), so
 * the sector baseline exists as queryable rows. Fire-and-forget; safe if offline.
 */
export function seedIndustryBaselines(profiles: IndustryProfile[]): void {
  void post('/api/industry-baselines/seed', {
    profiles: profiles.map(p => ({
      key: p.key, label: p.label, summary: p.summary, threatProfile: p.threatProfile,
      topThreatActors: p.topThreatActors, logSources: p.logSources,
      priorityTactics: p.priorityTactics,
      techniques: p.techniques.map(t => ({ id: t.id, name: t.name, tactic: t.tactic, why: t.why })),
    })),
  })
}

export interface IndustryBaselineRow extends IndustryTechnique {
  industryKey: string
  industryLabel: string
  rank: number
}

/** Read the sector baseline back from the DB. [] if the service is unreachable. */
export async function fetchIndustryBaselines(industry = ''): Promise<IndustryBaselineRow[]> {
  if (online === false) return []
  try {
    const qs = industry ? `?industry=${encodeURIComponent(industry)}` : ''
    const res = await fetch(`${DB_BASE}/api/industry-baselines${qs}`, { signal: AbortSignal.timeout(5000) })
    online = res.ok
    if (!res.ok) return []
    const data = await res.json() as { techniques?: IndustryBaselineRow[] }
    return data.techniques ?? []
  } catch {
    online = false
    return []
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
    agentLabel: i.agentLabel, agentColor: i.agentColor, isFirstRun: i.isFirstRun,
    threatActorProfile: i.threatActorProfile,
    attackChain: i.attackChain, recommendations: i.recommendations,
    iocs: i.iocs, techniques: i.techniques,
    reasoning: i.reasoning ?? '',
    splunkQueries: i.sampleQueries?.splunk ?? [], kqlQueries: i.sampleQueries?.kql ?? [],
    resolvedAt: i.resolvedAt,
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
