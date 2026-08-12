// ─────────────────────────────────────────────────────────────────────────────
// AbuseIPDB Provider — API v2 (Step 4)
//
// Supports: ipv4 only
// Endpoint: GET /api/v2/check?ipAddress=...&maxAgeInDays=90
//
// API key passed via 'Key' header and NEVER logged.
// ─────────────────────────────────────────────────────────────────────────────
import type { Ioc } from '../ioc-types'
import type { EnrichmentResult } from '../enrichment-types'
import type { IEnrichmentProvider, ProviderConfig } from './interface'

const ABUSE_BASE = 'https://api.abuseipdb.com/api/v2'

export class AbuseIPDBProvider implements IEnrichmentProvider {
  readonly providerId    = 'abuseipdb' as const
  readonly supportedTypes = ['ipv4'] as const

  supports(ioc: Ioc): boolean {
    return ioc.type === 'ipv4'
  }

  async enrich(ioc: Ioc, config: ProviderConfig): Promise<EnrichmentResult> {
    const enrichedAt = Date.now()

    const url = `${ABUSE_BASE}/check?ipAddress=${encodeURIComponent(ioc.normalized)}&maxAgeInDays=90`

    let resp: Response
    try {
      resp = await fetch(url, {
        headers: { 'Key': config.apiKey, 'Accept': 'application/json' },
      })
    } catch (err) {
      return {
        ioc: ioc.normalized, iocType: ioc.type, provider: 'abuseipdb',
        status: 'error', score: 0, confidence: 0,
        details: { summary: 'Network error' },
        enrichedAt,
        error: err instanceof Error ? err.message : String(err),
      }
    }

    if (!resp.ok) {
      let body = ''
      try { body = await resp.text() } catch { /* ignore */ }
      return {
        ioc: ioc.normalized, iocType: ioc.type, provider: 'abuseipdb',
        status: 'error', score: 0, confidence: 0,
        details: { summary: `AbuseIPDB HTTP ${resp.status}` },
        enrichedAt,
        error: `HTTP ${resp.status}: ${body.slice(0, 120)}`,
      }
    }

    let json: any
    try { json = await resp.json() } catch {
      return {
        ioc: ioc.normalized, iocType: ioc.type, provider: 'abuseipdb',
        status: 'error', score: 0, confidence: 0,
        details: { summary: 'Invalid JSON response' },
        enrichedAt, error: 'JSON parse error',
      }
    }

    const data          = json?.data ?? {}
    const abuseScore    = (data.abuseConfidenceScore as number) ?? 0
    const totalReports  = (data.totalReports as number) ?? 0
    const score         = abuseScore / 100

    const status: EnrichmentResult['status'] =
      abuseScore >= 80 ? 'malicious'  :
      abuseScore >= 25 ? 'suspicious' :
      'clean'

    return {
      ioc:       ioc.normalized,
      iocType:   ioc.type,
      provider:  'abuseipdb',
      status,
      score,
      confidence: totalReports > 0 ? 0.85 : 0.45,
      reportUrl:  `https://www.abuseipdb.com/check/${ioc.normalized}`,
      details: {
        abuseScore,
        abuseReports:  totalReports,
        abuseLastSeen: (data.lastReportedAt as string | null) ?? undefined,
        country:       (data.countryCode   as string | null) ?? undefined,
        isp:           (data.isp           as string | null) ?? undefined,
        summary:       `Abuse score: ${abuseScore}/100 (${totalReports} report${totalReports !== 1 ? 's' : ''})`,
      },
      enrichedAt,
    }
  }

  async testConnection(config: ProviderConfig): Promise<{ ok: boolean; message: string }> {
    try {
      const resp = await fetch(`${ABUSE_BASE}/check?ipAddress=8.8.8.8&maxAgeInDays=1`, {
        headers: { 'Key': config.apiKey, 'Accept': 'application/json' },
      })
      if (resp.ok)                               return { ok: true,  message: 'AbuseIPDB API key is valid' }
      if (resp.status === 401 || resp.status === 422) return { ok: false, message: 'Invalid API key' }
      if (resp.status === 429)                   return { ok: false, message: 'Daily quota exceeded' }
      return { ok: false, message: `HTTP ${resp.status}` }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }
}
