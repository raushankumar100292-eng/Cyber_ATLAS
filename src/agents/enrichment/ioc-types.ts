// ─────────────────────────────────────────────────────────────────────────────
// IOC Model — Step 4 (enrichment foundation)
//
// Supported types (ordered by enrichment priority):
//   sha256 > sha1 > md5 > ipv4 > domain > email > unknown
//
// Defanging: normalises hxxp://, [.], [dot], [:] before classification.
// Private IPs are extracted but callers may opt out of enriching them.
// ─────────────────────────────────────────────────────────────────────────────

export type IocType = 'ipv4' | 'domain' | 'sha256' | 'sha1' | 'md5' | 'email' | 'unknown'

export interface Ioc {
  raw:        string   // original string from alert data
  normalized: string   // lowercase, defanged
  type:       IocType
}

// Defang: hxxp:// → http://, [.] → ., [dot] → ., [:] → :
export function defang(raw: string): string {
  return raw
    .replace(/hxxps?:\/\//gi, m => m.replace(/hxxp/i, 'http'))
    .replace(/\[\.\]/g, '.')
    .replace(/\[dot\]/gi, '.')
    .replace(/\[\:\]/g, ':')
    .trim()
}

// ── Classification regexes ────────────────────────────────────────────────────
const IPV4_RE   = /^(\d{1,3}\.){3}\d{1,3}$/
const SHA256_RE = /^[0-9a-f]{64}$/i
const SHA1_RE   = /^[0-9a-f]{40}$/i
const MD5_RE    = /^[0-9a-f]{32}$/i
const EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
// Domain: labels separated by dots, no leading/trailing hyphens per label
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i

export function classifyIoc(value: string): IocType {
  const v = value.trim()
  if (IPV4_RE.test(v))   return 'ipv4'
  if (SHA256_RE.test(v)) return 'sha256'
  if (SHA1_RE.test(v))   return 'sha1'
  if (MD5_RE.test(v))    return 'md5'
  if (EMAIL_RE.test(v))  return 'email'
  if (DOMAIN_RE.test(v)) return 'domain'
  return 'unknown'
}

export function normalizeIoc(raw: string): Ioc {
  const defanged   = defang(raw)
  const normalized = defanged.toLowerCase().trim()
  const type       = classifyIoc(normalized)
  return { raw, normalized, type }
}

export const IOC_PRIORITY: Record<IocType, number> = {
  sha256: 0, sha1: 1, md5: 2, ipv4: 3, domain: 4, email: 5, unknown: 99,
}
