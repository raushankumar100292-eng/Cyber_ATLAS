// ─────────────────────────────────────────────────────────────────────────────
// Provider Interface — Step 4
//
// All enrichment providers implement IEnrichmentProvider.
// ProviderConfig carries runtime credentials (never committed, never logged).
// ─────────────────────────────────────────────────────────────────────────────
import type { Ioc, IocType } from '../ioc-types'
import type { EnrichmentResult, EnrichmentProvider } from '../enrichment-types'

export interface ProviderConfig {
  enabled: boolean
  apiKey:  string    // runtime only — never hardcode, never commit, never log
}

export interface IEnrichmentProvider {
  readonly providerId:     EnrichmentProvider
  readonly supportedTypes: readonly IocType[]

  supports(ioc: Ioc): boolean
  enrich(ioc: Ioc, config: ProviderConfig): Promise<EnrichmentResult>
  testConnection(config: ProviderConfig): Promise<{ ok: boolean; message: string }>
}
