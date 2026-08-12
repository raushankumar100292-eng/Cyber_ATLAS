// ─────────────────────────────────────────────────────────────────────────────
// Deterministic Investigation Engine
//
// Implements InvestigationEngine using heuristic / pattern-matching specialists.
// No external API calls, no LLM, fully synchronous.
//
// Step 4 upgrade path: introduce LLMInvestigationEngine implementing the same
// interface, connected via Agent Pro's provider/API-key mechanism.
// ─────────────────────────────────────────────────────────────────────────────
import type { InvestigationEngine, InvestigationContext } from './engine-interface'
import type { InvestigationResult }  from './result-types'
import { runEndpointInvestigation }  from './specialists/endpoint'
import { runNetworkInvestigation }   from './specialists/network'
import { runIdentityInvestigation }  from './specialists/identity'
import { runGeneralInvestigation }   from './specialists/general'

type SpecialistRunner = (ctx: InvestigationContext, startedAt: number) => InvestigationResult

const RUNNERS: Record<string, SpecialistRunner> = {
  'endpoint-investigator': runEndpointInvestigation,
  'network-investigator':  runNetworkInvestigation,
  'identity-investigator': runIdentityInvestigation,
  // email-investigator and threat-intel-investigator → general until Step 4 LLM engine
}

export class DeterministicInvestigationEngine implements InvestigationEngine {
  readonly engineId   = 'deterministic-1.0'
  readonly engineType = 'deterministic' as const

  execute(context: InvestigationContext): InvestigationResult {
    const runner = RUNNERS[context.assignedAgent.id] ?? runGeneralInvestigation
    return runner(context, Date.now())
  }
}
