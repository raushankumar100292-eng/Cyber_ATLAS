// ─────────────────────────────────────────────────────────────────────────────
// Tool Router — central IOC enrichment dispatch (Step 4)
//
// For each IOC, iterates over all enabled providers that support the IOC type,
// checks cache then rate-limit, calls the adapter, caches the result.
//
// API keys are consumed as ProviderConfig.apiKey and are NEVER logged.
// ─────────────────────────────────────────────────────────────────────────────
import type { Ioc } from './ioc-types'
import type { EnrichmentResult, EnrichmentProvider } from './enrichment-types'
import type { IEnrichmentProvider, ProviderConfig } from './providers/interface'
import { VirusTotalProvider } from './providers/virustotal'
import { AbuseIPDBProvider }  from './providers/abuseipdb'
import { MockProvider }       from './providers/mock'
import { checkRateLimit }     from './rate-limiter'
import { cacheGet, cacheSet } from './enrichment-cache'

// ── Integration config (held in Zustand store) ────────────────────────────────
export interface SocIntegrationConfig {
  virustotal: ProviderConfig
  abuseipdb:  ProviderConfig
  mock:       ProviderConfig
}

// ── Provider registry ─────────────────────────────────────────────────────────
const ALL_PROVIDERS: IEnrichmentProvider[] = [
  new VirusTotalProvider(),
  new AbuseIPDBProvider(),
  new MockProvider(),
]

const PROVIDER_MAP = new Map<EnrichmentProvider, IEnrichmentProvider>(
  ALL_PROVIDERS.map(p => [p.providerId, p]),
)

// ── Core routing ──────────────────────────────────────────────────────────────
export async function routeEnrichment(
  ioc:    Ioc,
  config: SocIntegrationConfig,
  log?:   (msg: string) => void,
): Promise<EnrichmentResult[]> {
  const results: EnrichmentResult[] = []

  for (const provider of ALL_PROVIDERS) {
    if (!provider.supports(ioc)) continue

    const provCfg: ProviderConfig | undefined =
      config[provider.providerId as keyof SocIntegrationConfig]
    if (!provCfg?.enabled) continue
    // Mock needs no key; real providers need a non-empty key
    if (provider.providerId !== 'mock' && !provCfg.apiKey?.trim()) continue

    // 1. Cache hit
    const cached = cacheGet(provider.providerId, ioc.normalized)
    if (cached) {
      log?.(`[enrichment] ${provider.providerId}:${ioc.normalized} → cache hit (${cached.status})`)
      results.push(cached)
      continue
    }

    // 2. Rate-limit check
    if (!checkRateLimit(provider.providerId)) {
      log?.(`[enrichment] ${provider.providerId}:${ioc.normalized} → rate limited`)
      results.push({
        ioc: ioc.normalized, iocType: ioc.type, provider: provider.providerId,
        status: 'error', score: 0, confidence: 0,
        details: { summary: 'Rate limited — request skipped' },
        enrichedAt: Date.now(),
        error: 'Rate limit exceeded',
      })
      continue
    }

    // 3. Invoke provider
    log?.(`[enrichment] ${provider.providerId}:${ioc.normalized} → querying`)
    try {
      const result = await provider.enrich(ioc, provCfg)
      cacheSet(provider.providerId, ioc.normalized, result)
      results.push(result)
      log?.(`[enrichment] ${provider.providerId}:${ioc.normalized} → ${result.status} (score ${Math.round(result.score * 100)}%)`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log?.(`[enrichment] ${provider.providerId}:${ioc.normalized} → error: ${msg.slice(0, 60)}`)
      results.push({
        ioc: ioc.normalized, iocType: ioc.type, provider: provider.providerId,
        status: 'error', score: 0, confidence: 0,
        details: { summary: `Provider threw: ${msg.slice(0, 80)}` },
        enrichedAt: Date.now(),
        error: msg,
      })
    }
  }

  return results
}

// ── Test connection ───────────────────────────────────────────────────────────
export async function testProviderConnection(
  providerId: EnrichmentProvider,
  config:     ProviderConfig,
): Promise<{ ok: boolean; message: string }> {
  const provider = PROVIDER_MAP.get(providerId)
  if (!provider) return { ok: false, message: `Unknown provider: ${providerId}` }
  return provider.testConnection(config)
}
