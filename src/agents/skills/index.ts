import type { CapabilityId } from '../types'
import type { SkillDefinition } from './types'
import { endpointSkills }  from './endpoint-skills'
import { networkSkills }   from './network-skills'
import { identitySkills }  from './identity-skills'
import { generalSkills }   from './general-skills'

export type { SkillDefinition } from './types'

const ALL_SKILLS: SkillDefinition[] = [
  ...endpointSkills,
  ...networkSkills,
  ...identitySkills,
  ...generalSkills,
]

const SKILL_BY_ID  = new Map(ALL_SKILLS.map(s => [s.id, s]))
const BY_AGENT     = new Map<string, SkillDefinition[]>()
for (const skill of ALL_SKILLS) {
  const list = BY_AGENT.get(skill.agentId) ?? []
  list.push(skill)
  BY_AGENT.set(skill.agentId, list)
}

export function getSkillById(id: string): SkillDefinition | undefined {
  return SKILL_BY_ID.get(id)
}

export function getAgentSkills(agentId: string): SkillDefinition[] {
  return BY_AGENT.get(agentId) ?? []
}

/**
 * Return the subset of an agent's skills that cover at least one required capability.
 * If none match (e.g. general agent with general_investigation required),
 * returns all agent skills as a fallback.
 */
export function selectSkills(
  agentId: string,
  requiredCapabilities: CapabilityId[],
): SkillDefinition[] {
  const agentSkills = getAgentSkills(agentId)
  if (agentSkills.length === 0) return []

  const required = new Set(requiredCapabilities)
  const matched  = agentSkills.filter(skill =>
    skill.capabilities.some(cap => required.has(cap)),
  )
  return matched.length > 0 ? matched : agentSkills
}
