// ─────────────────────────────────────────────────────────────────────────────
// Master Agent Registry
//
// Singleton that indexes all agent definitions loaded at start-up.
// The orchestrator queries this registry — never the raw definition arrays.
//
// Future extension points:
//   • register(def) — runtime agent registration (plugin/hot-load)
//   • unregister(id) — disable an agent without restart
//   • fromYaml(path) — load definition from an agent.yaml manifest
// ─────────────────────────────────────────────────────────────────────────────
import { SPECIALIST_AGENTS, ALL_AGENTS } from './definitions'
import type { AgentDefinition, CapabilityId } from './types'

class AgentRegistry {
  private readonly agents: Map<string, AgentDefinition>

  constructor(definitions: AgentDefinition[]) {
    this.agents = new Map()
    for (const def of definitions) {
      if (def.enabled) this.agents.set(def.id, def)
    }
  }

  /** All enabled agents (specialists only — general fallback excluded). */
  specialists(): AgentDefinition[] {
    return SPECIALIST_AGENTS.filter(a => this.agents.has(a.id))
  }

  /** All enabled agents including the general fallback. */
  all(): AgentDefinition[] {
    return Array.from(this.agents.values())
  }

  byId(id: string): AgentDefinition | undefined {
    return this.agents.get(id)
  }

  /** Agents that declare at least one of the given capabilities. */
  withAnyCapability(capIds: CapabilityId[]): AgentDefinition[] {
    if (!capIds.length) return this.specialists()
    const needed = new Set(capIds)
    return this.specialists().filter(a =>
      a.capabilities.some(c => needed.has(c.id)),
    )
  }

  size(): number {
    return this.agents.size
  }
}

/** Module-level singleton — import this everywhere instead of constructing a new registry. */
export const masterAgentRegistry = new AgentRegistry(ALL_AGENTS)
