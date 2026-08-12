// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiter — provider-aware token bucket (Step 4)
//
// VT free tier:      4 req/min
// AbuseIPDB free:    1000 req/day
// Mock:              effectively unlimited (1000/s)
// ─────────────────────────────────────────────────────────────────────────────

interface Bucket {
  tokens:     number
  lastRefill: number
  maxTokens:  number
  refillRate: number  // tokens per ms
}

const CONFIGS: Record<string, { maxTokens: number; refillIntervalMs: number }> = {
  virustotal: { maxTokens: 4,    refillIntervalMs: 60_000 },        // 4/min
  abuseipdb:  { maxTokens: 1000, refillIntervalMs: 86_400_000 },   // 1000/day
  mock:       { maxTokens: 10000, refillIntervalMs: 1_000 },        // unlimited
}

const buckets = new Map<string, Bucket>()

function getBucket(provider: string): Bucket {
  if (!buckets.has(provider)) {
    const cfg = CONFIGS[provider] ?? { maxTokens: 10, refillIntervalMs: 60_000 }
    buckets.set(provider, {
      tokens:     cfg.maxTokens,
      lastRefill: Date.now(),
      maxTokens:  cfg.maxTokens,
      refillRate: cfg.maxTokens / cfg.refillIntervalMs,
    })
  }
  return buckets.get(provider)!
}

/** Returns true and consumes 1 token if the provider is not rate-limited. */
export function checkRateLimit(provider: string): boolean {
  const bucket = getBucket(provider)
  const now    = Date.now()
  const elapsed = now - bucket.lastRefill
  bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + elapsed * bucket.refillRate)
  bucket.lastRefill = now

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    return true
  }
  return false
}

export function getRateLimitStatus(provider: string): { remaining: number; maxTokens: number } {
  const bucket = getBucket(provider)
  return { remaining: Math.floor(bucket.tokens), maxTokens: bucket.maxTokens }
}
