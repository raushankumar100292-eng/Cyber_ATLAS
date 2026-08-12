// ─────────────────────────────────────────────────────────────────────────────
// Master Agent Orchestrator — Step 1
//
// Entry point called by the SOC pipeline on every new alert.
// Composes: analyzeAlert → selectBestAgent → InvestigationTask.
//
// Provider-independent in Step 1: no LLM calls, no external APIs.
// Step 2 replaces analyzeAlert() with an async LLM call returning the same
// AlertAnalysis shape; this file's logic and the OrchestrationResult contract
// remain unchanged.
// ─────────────────────────────────────────────────────────────────────────────
import type { AlertQueueItem }         from '../../lib/store'
import type {
  InvestigationTask,
  OrchestrationResult,
  OrchestratorLog,
  TaskPriority,
} from '../types'
import { GENERAL_AGENT }              from '../definitions'
import { analyzeAlert }               from './analyzer'
import { selectBestAgent }            from './matcher'

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function log(
  logs: OrchestratorLog[],
  level: OrchestratorLog['level'],
  phase: OrchestratorLog['phase'],
  msg: string,
): void {
  logs.push({ ts: Date.now(), level, phase, msg })
}

function priorityFromSeverity(severity: string): TaskPriority {
  switch (severity?.toUpperCase()) {
    case 'CRITICAL': return 'P1'
    case 'HIGH':     return 'P2'
    case 'MEDIUM':   return 'P3'
    default:         return 'P4'
  }
}

// ── Main orchestration function ───────────────────────────────────────────────
/**
 * Orchestrate a single alert:
 *   1. Analyse the alert → AlertAnalysis (heuristic in Step 1)
 *   2. Score all specialist agents → select best match
 *   3a. ASSIGNED         — best specialist meets threshold → create InvestigationTask
 *   3b. NO_CAPABLE_AGENT — no specialist qualifies → create task with GENERAL_AGENT fallback
 *                          (also returns the failed candidates for diagnostics)
 *   3c. ERROR            — unexpected exception → return error state
 *
 * @param alert  Raw alert from the SOC pipeline queue
 * @param procId ProcessingAgent.procId from AgenticSOCOperationView — used to
 *               link the task back to the SOC pipeline entry
 */
export function orchestrate(
  alert: AlertQueueItem,
  procId: string,
): OrchestrationResult {
  const logs: OrchestratorLog[] = []

  try {
    // ── 1. Receive ──────────────────────────────────────────────────────────
    log(logs, 'info', 'receive',
      `Received alert ${alert.alertId || alert.id} (${alert.severity}) — ${alert.useCaseLabel || alert.useCase}`)

    // ── 2. Analyse ──────────────────────────────────────────────────────────
    const analysis = analyzeAlert(alert)

    log(logs, 'info', 'analyze',
      `Analysis complete: ${analysis.requiredCapabilities.length} required capabilities [${analysis.requiredCapabilities.join(', ')}] (confidence ${analysis.confidence.toFixed(2)}, analyzer: ${analysis.analyzerVersion})`)

    if (!analysis.requiredCapabilities.length) {
      // Should not happen — analyzeAlert guarantees at least general_investigation
      log(logs, 'warn', 'analyze', 'Analysis produced zero capabilities — treating as general investigation')
    }

    // ── 3. Discover & Score ─────────────────────────────────────────────────
    const { best, all: candidates } = selectBestAgent(analysis)

    log(logs, 'info', 'discover',
      `Scored ${candidates.length} candidate agent(s): ${candidates.map(c => `${c.agentId}(${c.score.toFixed(0)},cov=${(c.coverageRatio * 100).toFixed(0)}%)`).join(' | ')}`)

    // ── 4a. Assigned — specialist won ───────────────────────────────────────
    if (best) {
      const alternativeAgents = candidates
        .filter(c => c.agentId !== best.agent.id)
        .slice(0, 3)
        .map(c => c.agentId)

      log(logs, 'decision', 'select',
        `Selected ${best.agent.name} (id: ${best.agent.id}, score: ${best.score.score.toFixed(1)}, coverage: ${(best.score.coverageRatio * 100).toFixed(0)}%, matched: [${best.score.matchedCapabilities.join(', ')}])`)

      const task: InvestigationTask = {
        taskId:               makeTaskId(),
        alertId:              analysis.alertId,
        procId,
        assignedAgent:        best.agent,
        analysis,
        objective:            analysis.investigationObjective,
        requiredCapabilities: analysis.requiredCapabilities,
        alertContext:         alert,
        priority:             priorityFromSeverity(alert.severity),
        status:               'assigned',
        capabilityScore:      best.score.score,
        matchedCapabilities:  best.score.matchedCapabilities,
        alternativeAgents,
        createdAt:            Date.now(),
        updatedAt:            Date.now(),
      }

      log(logs, 'info', 'assign',
        `Task ${task.taskId} created — priority ${task.priority}, agent: ${best.agent.name}`)

      return { status: 'ASSIGNED', task, logs }
    }

    // ── 4b. No specialist qualifies — fall back to GENERAL_AGENT ───────────
    log(logs, 'warn', 'select',
      `No specialist met the threshold (minCoverage=20%, minScore=10). Required: [${analysis.requiredCapabilities.join(', ')}]. Routing to General Agent.`)

    const fallbackTask: InvestigationTask = {
      taskId:               makeTaskId(),
      alertId:              analysis.alertId,
      procId,
      assignedAgent:        GENERAL_AGENT,
      analysis,
      objective:            analysis.investigationObjective,
      requiredCapabilities: analysis.requiredCapabilities,
      alertContext:         alert,
      priority:             priorityFromSeverity(alert.severity),
      status:               'assigned',
      capabilityScore:      0,
      matchedCapabilities:  [],
      alternativeAgents:    [],
      createdAt:            Date.now(),
      updatedAt:            Date.now(),
    }

    log(logs, 'info', 'assign',
      `Task ${fallbackTask.taskId} created — GENERAL fallback (no specialist for: [${analysis.requiredCapabilities.join(', ')}]), priority ${fallbackTask.priority}`)

    return {
      status:               'NO_CAPABLE_AGENT',
      task:                 fallbackTask,
      analysis,
      requiredCapabilities: analysis.requiredCapabilities,
      candidates,
      logs,
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log(logs, 'warn', 'receive', `Orchestrator error: ${message}`)
    return { status: 'ERROR', error: message, logs }
  }
}
