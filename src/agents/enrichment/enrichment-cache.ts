// ─────────────────────────────────────────────────────────────────────────────
// Enrichment Cache — TTL-keyed in-memory cache (Step 4)
//
// Key: "${provider}:${normalizedIOC}"
// Default TTL: 30 minutes (configurable per set call).
// ─────────────────────────────────────────────────────────────────────────────
import type { EnrichmentResult } from './enrichment-types'

interface CacheEntry {
  result:    EnrichmentResult
  expiresAt: number
}

const DEFAULT_TTL_MS = 30 * 60 * 1000  // 30 min

const store = new Map<string, CacheEntry>()

function key(provider: string, ioc: string): string {
  return `${provider}:${ioc}`
}

export function cacheGet(provider: string, ioc: string): EnrichmentResult | null {
  const entry = store.get(key(provider, ioc))
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    store.delete(key(provider, ioc))
    return null
  }
  return { ...entry.result, cachedAt: entry.result.cachedAt ?? entry.result.enrichedAt }
}

export function cacheSet(
  provider: string,
  ioc: string,
  result: EnrichmentResult,
  ttlMs = DEFAULT_TTL_MS,
): void {
  store.set(key(provider, ioc), { result, expiresAt: Date.now() + ttlMs })
}

export function cacheClear(): void {
  store.clear()
}

export function cacheSize(): number {
  return store.size
}
