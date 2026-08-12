// ─────────────────────────────────────────────────────────────────────────────
// Enrichment Service — public async API (Step 4)
//
// Entry point for the SOC pipeline and executor.
// Orchestrates IOC extraction → routing → result aggregation.
// ─────────────────────────────────────────────────────────────────────────────
import type { AlertQueueItem } from '../../lib/store'
import type { InvestigationContext } from '../execution/engine-interface'
import { extractIocs, extractIocsFromContext } from './ioc-extractor'
import { routeEnrichment } from './tool-router'

export type { EnrichmentResult }    from './enrichment-types'
export type { SocIntegrationConfig } from './tool-router'
export { testProviderConnection }   from './tool-router'

// ── Enrich an alert (called before investigation) ─────────────────────────────
export async function enrichAlert(
  alert:        AlertQueueItem,
  existingIocs: string[],
  config:       import('./tool-router').SocIntegrationConfig,
  log?:         (msg: string) => void,
): Promise<import('./enrichment-types').EnrichmentResult[]> {
  const iocs = extractIocs(alert, existingIocs)
  if (iocs.length === 0) {
    log?.('[enrichment] no public IOCs found')
    return []
  }
  log?.(`[enrichment] ${iocs.length} IOC(s) extracted: ${iocs.map(i => `${i.type}:${i.normalized}`).join(', ')}`)

  const batches = await Promise.all(iocs.map(ioc => routeEnrichment(ioc, config, log)))
  return batches.flat()
}

// ── Enrich via InvestigationContext (called from executor) ────────────────────
export async function enrichContext(
  context: InvestigationContext,
  config:  import('./tool-router').SocIntegrationConfig,
  log?:    (msg: string) => void,
): Promise<import('./enrichment-types').EnrichmentResult[]> {
  const iocs = extractIocsFromContext(context)
  if (iocs.length === 0) return []
  const batches = await Promise.all(iocs.map(ioc => routeEnrichment(ioc, config, log)))
  return batches.flat()
}

// ── Utility helpers ───────────────────────────────────────────────────────────

/** Mask API key for safe display — shows only last 4 chars. */
export function maskApiKey(key: string): string {
  if (!key || key.length < 8) return '••••••••'
  return '••••••••' + key.slice(-4)
}

/** Returns the highest threat score across all enrichment results (0–1). */
export function highestThreatScore(results: import('./enrichment-types').EnrichmentResult[]): number {
  return results.reduce((max, r) => Math.max(max, r.score), 0)
}

export function hasMaliciousEnrichment(results: import('./enrichment-types').EnrichmentResult[]): boolean {
  return results.some(r => r.status === 'malicious')
}

export function hasSuspiciousOrWorse(results: import('./enrichment-types').EnrichmentResult[]): boolean {
  return results.some(r => r.status === 'malicious' || r.status === 'suspicious')
}

/** True if at least one provider is enabled (i.e. enrichment is configured). */
export function hasAnyProviderEnabled(config: import('./tool-router').SocIntegrationConfig): boolean {
  return config.virustotal.enabled || config.abuseipdb.enabled || config.mock.enabled
}
