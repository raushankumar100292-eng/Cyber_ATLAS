// ─────────────────────────────────────────────────────────────────────────────
// IOC Extractor — Step 4
//
// Pulls IOC candidates from AlertQueueItem fields and an existing IOC list,
// deduplicates, classifies, and returns sorted by enrichment priority.
//
// Private IPs (RFC-1918 / loopback) are skipped — they add noise and cannot
// be enriched by VT or AbuseIPDB.
// ─────────────────────────────────────────────────────────────────────────────
import type { AlertQueueItem } from '../../lib/store'
import type { InvestigationContext } from '../execution/engine-interface'
import { normalizeIoc, IOC_PRIORITY } from './ioc-types'
import type { Ioc } from './ioc-types'

const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|::1|0\.0\.0\.0)/

function isPrivateOrBogon(ip: string): boolean {
  return PRIVATE_IP_RE.test(ip.trim())
}

// ── Extract candidates ────────────────────────────────────────────────────────
const HASH_RE = /\b([0-9a-f]{64}|[0-9a-f]{40}|[0-9a-f]{32})\b/gi

function extractCandidates(alert: AlertQueueItem, existingIocs: string[]): string[] {
  const candidates: string[] = []

  // Structured alert fields
  if (alert.sourceIp && !isPrivateOrBogon(alert.sourceIp)) candidates.push(alert.sourceIp)
  if (alert.destIp   && !isPrivateOrBogon(alert.destIp))   candidates.push(alert.destIp)
  if (alert.destHost) candidates.push(alert.destHost)

  // Pass-through from orchestrator's IOC analysis
  for (const ioc of existingIocs) {
    if (ioc && ioc.trim()) candidates.push(ioc)
  }

  // Scan evidence + description + rawLog for hashes
  const corpus = [
    ...alert.evidence,
    alert.description,
    alert.rawLog ?? '',
    alert.title,
  ].join(' ')

  for (const m of corpus.matchAll(HASH_RE)) {
    candidates.push(m[1])
  }

  return candidates
}

// ── Public API ────────────────────────────────────────────────────────────────

export function extractIocs(alert: AlertQueueItem, existingIocs: string[] = []): Ioc[] {
  const candidates = extractCandidates(alert, existingIocs)
  const seen = new Set<string>()
  const result: Ioc[] = []

  for (const raw of candidates) {
    if (!raw?.trim()) continue
    const ioc = normalizeIoc(raw.trim())
    // Skip unenrichable types
    if (ioc.type === 'unknown' || ioc.type === 'email') continue
    // Skip private IPs that made it through as domain-type after normalisation
    if (ioc.type === 'ipv4' && isPrivateOrBogon(ioc.normalized)) continue
    if (seen.has(ioc.normalized)) continue
    seen.add(ioc.normalized)
    result.push(ioc)
  }

  return result.sort((a, b) => (IOC_PRIORITY[a.type] ?? 99) - (IOC_PRIORITY[b.type] ?? 99))
}

export function extractIocsFromContext(context: InvestigationContext): Ioc[] {
  return extractIocs(context._alertContext, context.iocs)
}
