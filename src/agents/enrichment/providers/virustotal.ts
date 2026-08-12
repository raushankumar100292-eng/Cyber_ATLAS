// ─────────────────────────────────────────────────────────────────────────────
// VirusTotal Provider — API v3 (Step 4A)
//
// Supports: sha256 | sha1 | md5 | ipv4 | domain
// Endpoints:
//   /files/{hash}         (SHA256, SHA1, MD5)
//   /ip_addresses/{ip}    (IPv4)
//   /domains/{domain}     (domain)
//
// API key is passed via 'x-apikey' header and NEVER logged or stored in results.
//
// Error handling:
//   404  → status 'unknown'   (IOC not in VT database — not a threat)
//   429  → status 'error'     (rate limited — pipeline continues)
//   401  → status 'error'     (invalid API key — pipeline continues)
//   timeout (10s) → 'error'   (network unreachable — pipeline continues)
//   any other HTTP / parse → 'error'
//
// The enrich() method NEVER throws — it always returns a valid EnrichmentResult.
// ─────────────────────────────────────────────────────────────────────────────
import type { Ioc, IocType } from '../ioc-types'
import type { EnrichmentResult } from '../enrichment-types'
import type { IEnrichmentProvider, ProviderConfig } from './interface'

const VT_BASE    = 'https://www.virustotal.com/api/v3'
const TIMEOUT_MS = 10_000   // 10 seconds
const TEST_TIMEOUT_MS = 5_000

const SUPPORTED: IocType[] = ['sha256', 'sha1', 'md5', 'ipv4', 'domain']

function vtEndpoint(ioc: Ioc): string {
  switch (ioc.type) {
    case 'sha256':
    case 'sha1':
    case 'md5':    return `${VT_BASE}/files/${ioc.normalized}`
    case 'ipv4':   return `${VT_BASE}/ip_addresses/${ioc.normalized}`
    case 'domain': return `${VT_BASE}/domains/${ioc.normalized}`
    default: throw new Error(`VT: unsupported IOC type '${ioc.type}'`)
  }
}

function vtReportUrl(ioc: Ioc): string {
  const path =
    ioc.type === 'ipv4'   ? `ip-address/${ioc.normalized}` :
    ioc.type === 'domain' ? `domain/${ioc.normalized}`     :
    `file/${ioc.normalized}`
  return `https://www.virustotal.com/gui/${path}`
}

function errorResult(
  ioc: Ioc,
  summary: string,
  error: string,
  enrichedAt: number,
): EnrichmentResult {
  return {
    ioc: ioc.normalized, iocType: ioc.type, provider: 'virustotal',
    status: 'error', score: 0, confidence: 0,
    details: { summary },
    enrichedAt, error,
  }
}

export class VirusTotalProvider implements IEnrichmentProvider {
  readonly providerId     = 'virustotal' as const
  readonly supportedTypes = SUPPORTED

  supports(ioc: Ioc): boolean {
    return SUPPORTED.includes(ioc.type)
  }

  async enrich(ioc: Ioc, config: ProviderConfig): Promise<EnrichmentResult> {
    const enrichedAt = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    // ── Fetch ──────────────────────────────────────────────────────────────
    let resp: Response
    try {
      resp = await fetch(vtEndpoint(ioc), {
        headers: { 'x-apikey': config.apiKey },
        signal: controller.signal,
      })
      clearTimeout(timer)
    } catch (err) {
      clearTimeout(timer)
      const isAbort = err instanceof Error && err.name === 'AbortError'
      return errorResult(
        ioc,
        isAbort ? `Request timed out (${TIMEOUT_MS / 1000}s)` : 'Network error — VirusTotal unreachable',
        isAbort ? `Timeout after ${TIMEOUT_MS / 1000}s` : (err instanceof Error ? err.message : String(err)),
        enrichedAt,
      )
    }

    // ── HTTP error codes ────────────────────────────────────────────────────
    if (resp.status === 404) {
      // Not in VT database — informational, not an error
      return {
        ioc: ioc.normalized, iocType: ioc.type, provider: 'virustotal',
        status: 'unknown', score: 0, confidence: 0.20,
        details: { summary: 'Not found in VirusTotal database' },
        enrichedAt,
      }
    }
    if (resp.status === 429) {
      return errorResult(ioc, 'Rate limited — wait 60s', 'Rate limited (429)', enrichedAt)
    }
    if (resp.status === 401) {
      return errorResult(ioc, 'Invalid API key (401)', 'Unauthorized (401) — check your API key', enrichedAt)
    }
    if (!resp.ok) {
      return errorResult(ioc, `VirusTotal HTTP ${resp.status}`, `HTTP ${resp.status}`, enrichedAt)
    }

    // ── Parse response ──────────────────────────────────────────────────────
    let json: Record<string, unknown>
    try {
      json = await resp.json() as Record<string, unknown>
    } catch {
      return errorResult(ioc, 'Invalid JSON response from VirusTotal', 'JSON parse error', enrichedAt)
    }

    const data  = json?.data as Record<string, unknown> | undefined
    const attrs = (data?.attributes ?? {}) as Record<string, unknown>

    // ── Raw detection counts (last_analysis_stats) ──────────────────────────
    const stats     = (attrs.last_analysis_stats ?? {}) as Record<string, number>
    const malicious  = stats.malicious   ?? 0
    const suspicious = stats.suspicious  ?? 0
    const harmless   = stats.harmless    ?? 0
    const undetected = stats.undetected  ?? 0
    const vtEngines  = malicious + suspicious + harmless + undetected
    const detections = malicious + suspicious
    const score      = vtEngines > 0 ? detections / vtEngines : 0

    // ── Categories (community labels) ───────────────────────────────────────
    let categories: string[] | undefined
    if (attrs.categories && typeof attrs.categories === 'object') {
      const cats = Object.values(attrs.categories as Record<string, unknown>)
        .map(c => String(c))
        .slice(0, 5)
      if (cats.length > 0) categories = cats
    }

    // ── Last analysis date ──────────────────────────────────────────────────
    const vtLastAnalysis = typeof attrs.last_analysis_date === 'number'
      ? new Date(attrs.last_analysis_date * 1000).toISOString()
      : undefined

    // ── Reputation (-100..100) — only for IP/domain ─────────────────────────
    const reputation: number | undefined =
      (ioc.type === 'ipv4' || ioc.type === 'domain') && typeof attrs.reputation === 'number'
        ? attrs.reputation
        : undefined

    // ── ASN owner — IPv4 only ───────────────────────────────────────────────
    const asOwner: string | undefined =
      ioc.type === 'ipv4' && typeof attrs.as_owner === 'string'
        ? attrs.as_owner
        : undefined

    // ── Country — IPv4 only ─────────────────────────────────────────────────
    const country: string | undefined =
      ioc.type === 'ipv4' && typeof attrs.country === 'string'
        ? attrs.country
        : undefined

    // ── Threat assessment ────────────────────────────────────────────────────
    const status: EnrichmentResult['status'] =
      malicious > 2    ? 'malicious'  :
      detections > 0   ? 'suspicious' :
      vtEngines  > 0   ? 'clean'      : 'unknown'

    // Summary line for UI rendering
    const summary = vtEngines > 0
      ? `${malicious} malicious · ${suspicious} suspicious · ${harmless} clean (${vtEngines} engines)`
      : 'No analysis data available from VirusTotal'

    return {
      ioc:       ioc.normalized,
      iocType:   ioc.type,
      provider:  'virustotal',
      status,
      score,
      confidence: vtEngines > 0 ? 0.90 : 0.35,
      reportUrl:  vtReportUrl(ioc),
      details: {
        malicious,
        suspicious,
        harmless,
        undetected,
        vtEngines,
        vtDetections:   detections,
        vtCategories:   categories,
        vtLastAnalysis,
        reputation,
        asOwner,
        country,
        summary,
      },
      enrichedAt,
    }
  }

  async testConnection(config: ProviderConfig): Promise<{ ok: boolean; message: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)
    try {
      const resp = await fetch(`${VT_BASE}/ip_addresses/8.8.8.8`, {
        headers: { 'x-apikey': config.apiKey },
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (resp.ok)             return { ok: true,  message: 'VirusTotal API key is valid' }
      if (resp.status === 401) return { ok: false, message: 'Invalid API key (401 Unauthorized)' }
      if (resp.status === 429) return { ok: false, message: 'Rate limited — wait 60 seconds' }
      return { ok: false, message: `HTTP ${resp.status}` }
    } catch (err) {
      clearTimeout(timer)
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, message: `Connection timed out (${TEST_TIMEOUT_MS / 1000}s)` }
      }
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  }
}
