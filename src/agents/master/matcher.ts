// ─────────────────────────────────────────────────────────────────────────────
// Capability Matcher
//
// Scores every specialist agent against the required capabilities from an
// AlertAnalysis and selects the best fit.
//
// Scoring model (per agent):
//   base    = sum(capabilityWeight × agentConfidence) for each matched capability
//   bonus   = +3 per handlesUseCases match (tie-breaker only, NOT primary signal)
//   score   = base + bonus
//   cutoffs = minCoverageRatio (0.20) AND minScore (10) must both be met
//
// Per-capability weight:
//   Tier A (15 pts) — capabilities that are core and precise (e.g. powershell_analysis)
//   Tier B (12 pts) — broad but meaningful (e.g. network_traffic_analysis)
//   Tier C (10 pts) — supporting / enrichment capabilities
// ─────────────────────────────────────────────────────────────────────────────
import type { AlertAnalysis, AgentDefinition, CapabilityId, CapabilityScore } from '../types'
import { masterAgentRegistry } from '../registry'

// ── Per-capability weight tier ────────────────────────────────────────────────
const TIER_A: Set<CapabilityId> = new Set([
  'powershell_analysis',
  'malware_classification',
  'c2_detection',
  'dns_analysis',
  'brute_force_detection',
  'credential_analysis',
  'phishing_detection',
  'email_analysis',
  'exfiltration_detection',
  'privilege_escalation_detection',
  'supply_chain_analysis',
  'threat_actor_attribution',
])

const TIER_B: Set<CapabilityId> = new Set([
  'process_analysis',
  'script_analysis',
  'endpoint_investigation',
  'network_traffic_analysis',
  'lateral_movement_detection',
  'port_scan_detection',
  'identity_investigation',
  'iam_analysis',
  'cloud_investigation',
  'insider_threat_detection',
  'persistence_detection',
  'defense_evasion_detection',
  'ioc_extraction',
  'resource_dev_detection',
])

function capabilityWeight(cap: CapabilityId): number {
  if (TIER_A.has(cap)) return 15
  if (TIER_B.has(cap)) return 12
  return 10  // Tier C: attack_chain_analysis, mitre_mapping, general_investigation, availability_impact_analysis
}

export const MIN_COVERAGE_RATIO = 0.20
export const MIN_SCORE          = 10
const USE_CASE_BONUS            = 3

// ── Score a single agent against the required capabilities ───────────────────
export function scoreAgent(agent: AgentDefinition, analysis: AlertAnalysis): CapabilityScore {
  const required = new Set(analysis.requiredCapabilities)
  const agentCaps = new Map(agent.capabilities.map(c => [c.id, c.confidence]))

  const matched: CapabilityId[] = []
  const missing: CapabilityId[] = []

  for (const cap of required) {
    if (agentCaps.has(cap)) matched.push(cap)
    else missing.push(cap)
  }

  // Base score: weight × agent confidence for each matched capability
  const baseScore = matched.reduce((sum, cap) => {
    const agentConf = agentCaps.get(cap) ?? 0
    return sum + capabilityWeight(cap) * agentConf
  }, 0)

  // Tie-breaker: +3 per use-case label match
  const useCaseBonus = agent.handlesUseCases.some(uc =>
    analysis.alertType?.toLowerCase().includes(uc.toLowerCase()) ||
    uc.toLowerCase().includes(analysis.alertType?.toLowerCase() ?? ''),
  )
    ? USE_CASE_BONUS
    : 0

  const score = baseScore + useCaseBonus
  const coverageRatio = required.size > 0 ? matched.length / required.size : 0

  return {
    agentId:              agent.id,
    agentName:            agent.name,
    matchedCapabilities:  matched,
    missingCapabilities:  missing,
    score:                Math.round(score * 100) / 100,
    coverageRatio,
  }
}

// ── Score ALL specialist agents ───────────────────────────────────────────────
export function scoreAllAgents(analysis: AlertAnalysis): CapabilityScore[] {
  const candidates = masterAgentRegistry
    .withAnyCapability(analysis.requiredCapabilities)

  return candidates
    .map(agent => scoreAgent(agent, analysis))
    .sort((a, b) => b.score - a.score)
}

// ── Select the best agent (or null if none qualify) ───────────────────────────
export interface MatchResult {
  best: { agent: AgentDefinition; score: CapabilityScore } | null
  /** All candidates, sorted score desc, regardless of threshold. */
  all: CapabilityScore[]
}

export function selectBestAgent(analysis: AlertAnalysis): MatchResult {
  const all = scoreAllAgents(analysis)

  // Apply threshold cutoffs
  const qualifying = all.filter(
    s => s.coverageRatio >= MIN_COVERAGE_RATIO && s.score >= MIN_SCORE,
  )

  if (!qualifying.length) {
    return { best: null, all }
  }

  const topScore = qualifying[0]
  const agent = masterAgentRegistry.byId(topScore.agentId)

  if (!agent) {
    // Should never happen — registry is the source of truth
    return { best: null, all }
  }

  return { best: { agent, score: topScore }, all }
}
