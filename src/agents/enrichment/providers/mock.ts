// ─────────────────────────────────────────────────────────────────────────────
// Mock Provider — 11 test scenarios (Step 4)
//
// No API key required. Simulates ~80ms latency.
// Used for local development and testing without real credentials.
// ─────────────────────────────────────────────────────────────────────────────
import type { Ioc, IocType } from '../ioc-types'
import type { EnrichmentResult } from '../enrichment-types'
import type { IEnrichmentProvider, ProviderConfig } from './interface'

type ScenarioEntry = Pick<EnrichmentResult, 'status' | 'score'> & {
  details: EnrichmentResult['details']
  error?: string
}

const SCENARIOS: Record<string, ScenarioEntry> = {
  // ── IPv4 ──────────────────────────────────────────────────────────────────
  '185.220.101.5': {
    status: 'malicious', score: 0.95,
    details: { vtDetections: 38, vtEngines: 40, abuseScore: 90, abuseReports: 42,
      country: 'NL', tags: ['tor-exit', 'c2'], summary: 'Known Tor exit node, C2 associated' },
  },
  '1.2.3.4': {
    status: 'suspicious', score: 0.30,
    details: { vtDetections: 4, vtEngines: 40, abuseScore: 30, abuseReports: 3,
      summary: '4 detections — unconfirmed suspicious' },
  },
  '8.8.8.8': {
    status: 'clean', score: 0.00,
    details: { vtDetections: 0, vtEngines: 40, abuseScore: 0, abuseReports: 0,
      country: 'US', isp: 'Google LLC', summary: 'Google DNS — known benign' },
  },
  '192.0.2.1': {
    status: 'unknown', score: 0,
    details: { vtEngines: 0, vtDetections: 0, summary: 'RFC-5737 documentation IP — no data' },
  },
  // ── Domains ───────────────────────────────────────────────────────────────
  'evil-c2.xyz': {
    status: 'malicious', score: 0.88,
    details: { vtDetections: 22, vtEngines: 25, vtCategories: ['malware', 'c2', 'phishing'],
      tags: ['c2', 'malware'], summary: 'Active C2 domain — confirmed malicious' },
  },
  'google.com': {
    status: 'clean', score: 0.00,
    details: { vtDetections: 0, vtEngines: 70, vtCategories: ['search engine'],
      summary: 'Known-good domain' },
  },
  'update-checker.net': {
    status: 'suspicious', score: 0.25,
    details: { vtDetections: 3, vtEngines: 70, summary: 'Low-signal detections — monitor' },
  },
  // ── SHA256 hashes ─────────────────────────────────────────────────────────
  // WannaCry-like — all 'a' chars for easy test entry
  ['a'.repeat(64)]: {
    status: 'malicious', score: 1.0,
    details: { vtDetections: 62, vtEngines: 62, vtCategories: ['ransomware', 'worm'],
      tags: ['wannacry', 'ransomware'], summary: 'Known ransomware sample (62/62 engines)' },
  },
  ['0'.repeat(64)]: {
    status: 'clean', score: 0.0,
    details: { vtDetections: 0, vtEngines: 60, summary: 'No detections' },
  },
  // ── Error + unknown ───────────────────────────────────────────────────────
  'error-trigger.com': {
    status: 'error', score: 0,
    details: { summary: 'Mock error scenario' },
    error:   'Simulated provider error for testing',
  },
  '5.5.5.5': {
    status: 'unknown', score: 0,
    details: { vtEngines: 0, vtDetections: 0, summary: 'No analysis data yet' },
  },
}

const SUPPORTED: IocType[] = ['sha256', 'sha1', 'md5', 'ipv4', 'domain']

export class MockProvider implements IEnrichmentProvider {
  readonly providerId    = 'mock' as const
  readonly supportedTypes = SUPPORTED

  supports(ioc: Ioc): boolean {
    return SUPPORTED.includes(ioc.type)
  }

  async enrich(ioc: Ioc, _config: ProviderConfig): Promise<EnrichmentResult> {
    await new Promise(r => setTimeout(r, 75 + Math.random() * 50))  // simulate latency
    const enrichedAt = Date.now()

    const scenario: ScenarioEntry = SCENARIOS[ioc.normalized] ?? {
      status:  'unknown',
      score:   0,
      details: { summary: `Mock: no scenario for '${ioc.normalized}'` },
    }

    return {
      ioc:       ioc.normalized,
      iocType:   ioc.type,
      provider:  'mock',
      status:    scenario.status,
      score:     scenario.score,
      confidence: scenario.status === 'error' ? 0 : scenario.status === 'unknown' ? 0.20 : 0.90,
      details:    scenario.details,
      enrichedAt,
      error:      scenario.error,
    }
  }

  async testConnection(_config: ProviderConfig): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'Mock provider — always available' }
  }
}
