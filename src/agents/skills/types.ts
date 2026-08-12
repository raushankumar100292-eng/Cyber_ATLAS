// Skill definition — the atomic unit of investigation capability.
// Skills are declared by agents and selected at runtime based on
// the task's required capabilities.  Keeping definitions here (not
// inside execution code) makes them editable without touching the engine.
import type { CapabilityId } from '../types'

export interface SkillDefinition {
  /** Scoped id:  'endpoint:powershell-analysis' */
  id: string
  /** Agent that owns this skill: 'endpoint-investigator' */
  agentId: string
  name: string
  description: string
  /** Capabilities this skill can satisfy (used for skill selection). */
  capabilities: CapabilityId[]
  /** Concise guidance for the investigation.
   *  Used by the LLM engine (Step 4+) as a prompt fragment.
   *  Kept short on purpose — no multi-paragraph blocks here. */
  investigationGuidance: string
  /** Evidence text patterns that activate this skill's checks. */
  evidencePatterns: string[]
}
