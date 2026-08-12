import type { SkillDefinition } from './types'

const AGENT = 'general-investigator'

export const generalSkills: SkillDefinition[] = [
  {
    id: 'general:triage',
    agentId: AGENT,
    name: 'General Triage',
    description: 'Basic alert parsing and observable fact extraction when no specialist agent is available.',
    capabilities: ['general_investigation'],
    investigationGuidance: 'Parse alert fields only. Report OBSERVED facts from alert metadata. Do not perform specialist analysis. Always mark as INCONCLUSIVE.',
    evidencePatterns: [],
  },
]
