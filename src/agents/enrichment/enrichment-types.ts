// ─────────────────────────────────────────────────────────────────────────────
// Enrichment Types — Step 4A
//
// EnrichmentResult is the normalized output from ANY provider.
// VT-specific raw counts live in `details`; top-level fields are provider-neutral.
// ─────────────────────────────────────────────────────────────────────────────
import type { IocType } from './ioc-types'

/** High-level threat assessment of the IOC. */
export type EnrichmentStatus = 'clean' | 'malicious' | 'suspicious' | 'unknown' | 'error'

/** Pipeline-level enrichment stage status. */
export type EnrichStage =
  | 'enriching'            // async in-flight
  | 'enriched'             // completed with results
  | 'no_public_ioc'        // no enrichable IOCs found
  | 'unavailable'          // no providers enabled / configured

export type EnrichmentProvider = 'virustotal' | 'abuseipdb' | 'mock'

export interface EnrichmentResult {
  ioc:       string            // normalized IOC value
  iocType:   IocType
  provider:  EnrichmentProvider
  status:    EnrichmentStatus  // threat-level assessment

  // Normalized 0–1 threat score
  //   virustotal: (malicious + suspicious) / total engines
  //   abuseipdb:  abuseConfidenceScore / 100
  score:      number
  confidence: number           // 0–1 provider reliability

  reportUrl?: string           // public report link — never contains API key

  details: {
    // ── VirusTotal raw counts (from last_analysis_stats) ──────────────────
    malicious?:      number    // engines that flagged as malicious
    suspicious?:     number    // engines that flagged as suspicious
    harmless?:       number    // engines that marked clean
    undetected?:     number    // engines with no opinion
    vtEngines?:      number    // total = malicious + suspicious + harmless + undetected
    vtDetections?:   number    // malicious + suspicious (kept for compat)
    vtCategories?:   string[]  // community categories
    vtLastAnalysis?: string    // ISO date of last analysis
    reputation?:     number    // VT community reputation (-100..100) for IPs/domains
    asOwner?:        string    // ASN owner for IPs
    // ── AbuseIPDB ─────────────────────────────────────────────────────────
    abuseScore?:     number    // 0–100 confidence score
    abuseReports?:   number
    abuseLastSeen?:  string
    // ── Shared geo / network ──────────────────────────────────────────────
    country?:        string
    isp?:            string
    tags?:           string[]
    summary?:        string    // human-readable one-liner for UI
  }

  cachedAt?:   number          // epoch ms — present when served from cache
  enrichedAt:  number          // epoch ms when the enrichment was obtained
  error?:      string          // present only when status === 'error'; never contains keys
}
