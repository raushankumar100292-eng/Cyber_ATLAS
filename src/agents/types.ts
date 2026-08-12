// ─────────────────────────────────────────────────────────────────────────────
// Core types for the Agentic SOC Master Agent / Orchestrator
//
// Design intent
// ─────────────────────────────────────────────────────────────────────────────
// Capability-based routing: the Master Agent selects a specialist by matching
// what an alert *requires* against what each agent *can do*, NOT by a hardcoded
// useCase→agent dictionary.
//
// The data model is intentionally multi-agent ready.  For Step 1 only the
// single-best-agent path is executed; `alternativeAgents` and `status` fields
// exist so parallel/sequential multi-agent orchestration can be added without a
// schema redesign.
// ─────────────────────────────────────────────────────────────────────────────
import type { AlertQueueItem } from '../lib/store'

// ── Capability IDs ────────────────────────────────────────────────────────────
// Every capability an agent can provide OR an alert can require is listed here.
// New capabilities (e.g. 'blockchain_analysis') are added here and in the
// relevant agent definition — no other code changes required.
export type CapabilityId =
  // Endpoint
  | 'process_analysis'
  | 'powershell_analysis'
  | 'script_analysis'
  | 'endpoint_investigation'
  | 'malware_classification'
  | 'persistence_detection'
  | 'privilege_escalation_detection'
  | 'defense_evasion_detection'
  // Network
  | 'network_traffic_analysis'
  | 'dns_analysis'
  | 'c2_detection'
  | 'exfiltration_detection'
  | 'lateral_movement_detection'
  | 'port_scan_detection'
  // Email / Phishing
  | 'email_analysis'
  | 'phishing_detection'
  // Identity / Cloud
  | 'credential_analysis'
  | 'brute_force_detection'
  | 'identity_investigation'
  | 'cloud_investigation'
  | 'iam_analysis'
  | 'insider_threat_detection'
  // Threat Intelligence
  | 'ioc_extraction'
  | 'attack_chain_analysis'
  | 'mitre_mapping'
  | 'threat_actor_attribution'
  | 'supply_chain_analysis'
  | 'resource_dev_detection'
  // General / Fallback
  | 'general_investigation'
  // Availability (not yet covered by any specialist — triggers NO_CAPABLE_AGENT)
  | 'availability_impact_analysis'

// ── Agent Capability entry ────────────────────────────────────────────────────
export interface AgentCapability {
  id: CapabilityId
  description: string
  /** 0–1: how well this agent performs this capability.  Used in scoring. */
  confidence: number
}

// ── Agent Definition ──────────────────────────────────────────────────────────
// Loaded once at start-up from src/agents/definitions/.
// Future: load from agent.yaml per-agent directory.
export interface AgentDefinition {
  id: string
  name: string
  description: string
  capabilities: AgentCapability[]
  /**
   * Soft hints — use-case IDs this agent *commonly* handles.
   * Used only as a tie-breaker score bonus; NOT primary routing logic.
   * Primary routing is always capability-based.
   */
  handlesUseCases: string[]
  /** System prompt used when an LLM executor runs this agent (Step 2+). */
  systemPrompt: string
  /** UI display config — consumed by the existing SOC incident board. */
  display: {
    label: string
    shortLabel: string
    color: string
    icon: string
  }
  version: string
  enabled: boolean
}

// ── Alert Analysis ────────────────────────────────────────────────────────────
// Output of analyzeAlert() — provider-independent in Step 1 (heuristic).
// When an LLM analyzer is wired in (Step 2), it replaces the heuristic but
// returns the same AlertAnalysis shape.
export interface AlertEntity {
  type: 'ip' | 'hostname' | 'user' | 'process' | 'domain' | 'hash' | 'email' | 'port' | 'technique'
  value: string
  role: 'source' | 'destination' | 'actor' | 'target' | 'indicator'
}

export interface AlertAnalysis {
  alertId: string
  alertType: string
  severity: string
  entities: AlertEntity[]
  iocs: string[]
  mitreTechniques: string[]
  requiredCapabilities: CapabilityId[]
  investigationObjective: string
  /** 0–1: confidence in this analysis. Low on partial data. */
  confidence: number
  analyzedAt: number
  /** 'heuristic-x.y.z' | 'llm-groq' | 'llm-claude' — tracks which analyzer ran. */
  analyzerVersion: string
}

// ── Capability Scoring ────────────────────────────────────────────────────────
export interface CapabilityScore {
  agentId: string
  agentName: string
  matchedCapabilities: CapabilityId[]
  missingCapabilities: CapabilityId[]
  /** 0–100 weighted score. */
  score: number
  /** matched.length / required.length */
  coverageRatio: number
}

// ── Investigation Task ────────────────────────────────────────────────────────
// Created by the orchestrator and handed to the SOC pipeline.
// Fields are designed to support multi-agent orchestration in future steps:
//   - `alternativeAgents` holds runner-up agents for parallel dispatch
//   - `status` tracks lifecycle across agents
export type TaskPriority = 'P1' | 'P2' | 'P3' | 'P4'
export type TaskStatus   = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed'

export interface InvestigationTask {
  taskId: string
  alertId: string
  incidentNo?: string
  /** Links back to the SOC pipeline ProcessingAgent procId. */
  procId: string
  assignedAgent: AgentDefinition
  analysis: AlertAnalysis
  objective: string
  requiredCapabilities: CapabilityId[]
  alertContext: AlertQueueItem
  priority: TaskPriority
  status: TaskStatus
  capabilityScore: number
  matchedCapabilities: CapabilityId[]
  /** Runner-up agent IDs — reserved for multi-agent orchestration (Step N). */
  alternativeAgents: string[]
  createdAt: number
  updatedAt: number
}

// ── Orchestrator Logs ─────────────────────────────────────────────────────────
export type OrchestratorLogLevel = 'info' | 'warn' | 'decision'

export interface OrchestratorLog {
  ts: number
  level: OrchestratorLogLevel
  phase: 'receive' | 'analyze' | 'discover' | 'score' | 'select' | 'assign'
  msg: string
}

// ── Orchestration Result ──────────────────────────────────────────────────────
// Discriminated union — callers must handle all three states.
export type OrchestrationResult =
  | {
      status: 'ASSIGNED'
      task: InvestigationTask
      logs: OrchestratorLog[]
    }
  | {
      status: 'NO_CAPABLE_AGENT'
      /** GENERAL_AGENT task — created for fallback execution. */
      task: InvestigationTask
      analysis: AlertAnalysis
      requiredCapabilities: CapabilityId[]
      /** Partial matches kept for diagnostics / future fallback routing. */
      candidates: CapabilityScore[]
      logs: OrchestratorLog[]
    }
  | {
      status: 'ERROR'
      error: string
      logs: OrchestratorLog[]
    }
