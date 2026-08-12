// ─────────────────────────────────────────────────────────────────────────────
// Agent definition registry — aggregates all specialist definitions.
//
// To add a new specialist:
//   1. Create src/agents/definitions/<id>.ts
//   2. Import and add it to SPECIALIST_AGENTS below
//   The registry and orchestrator require no other changes.
//
// Future: replace static imports with a dynamic loader that reads agent.yaml
// files from each subdirectory, enabling plugin-style agent installation.
// ─────────────────────────────────────────────────────────────────────────────
import type { AgentDefinition } from '../types'

import endpointInvestigator  from './endpoint-investigator'
import networkInvestigator   from './network-investigator'
import identityInvestigator  from './identity-investigator'
import threatIntelInvestigator from './threat-intel-investigator'
import emailInvestigator     from './email-investigator'
import generalInvestigator   from './general-investigator'

/** All specialist agents (ordered by routing priority — higher-specialised first). */
export const SPECIALIST_AGENTS: AgentDefinition[] = [
  endpointInvestigator,
  networkInvestigator,
  identityInvestigator,
  threatIntelInvestigator,
  emailInvestigator,
]

/**
 * General-purpose fallback agent.
 * Assigned when no specialist meets the capability-coverage threshold AND the
 * alert still needs investigation (non-empty capability set).
 *
 * Note: the general agent is intentionally NOT in SPECIALIST_AGENTS so it is
 * never selected via capability scoring.  It is only assigned explicitly by the
 * orchestrator on a NO_CAPABLE_AGENT result.
 */
export const GENERAL_AGENT: AgentDefinition = generalInvestigator

/** All agents including the general fallback — used by the registry. */
export const ALL_AGENTS: AgentDefinition[] = [...SPECIALIST_AGENTS, GENERAL_AGENT]
