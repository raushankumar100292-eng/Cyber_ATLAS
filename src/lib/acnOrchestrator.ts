// ─────────────────────────────────────────────────────────────────────────────
// ACN multi-agent orchestrator
//
// ACN is not a single assistant — it is the orchestrator of a collaborative
// multi-agent system. For each user request it:
//   1. DECOMPOSES the request into subtasks assigned to specialist agents
//      (and asks a clarifying question first if the request is ambiguous).
//   2. Runs each specialist agent IN PARALLEL to produce its own finding.
//   3. Runs a COLLABORATION/DEBATE pass where agents cross-examine, validate,
//      and resolve conflicts.
//   4. SYNTHESIZES all perspectives into one coherent spoken answer.
//
// Every phase is a real Gemini call, so the reasoning is genuine — the UI simply
// visualizes the phases. The whole thing runs on the Gemini key.
// ─────────────────────────────────────────────────────────────────────────────

import { geminiGenerate, buildContextBlock, type SocContext, type ChatTurn } from './gemini'

// ── Specialist agent roster (the "digital workforce") ─────────────────────────
export interface AgentDef {
  id:      string
  name:    string
  short:   string
  color:   string
  persona: string
}

export const AGENT_ROSTER: AgentDef[] = [
  { id: 'detection',      name: 'Detection Agent',        short: 'DET', color: '#22d3ee',
    persona: 'a detection engineer — you reason about signatures, correlation rules, and anomalous behaviour, and judge whether activity is truly malicious.' },
  { id: 'threatintel',    name: 'Threat Intel Agent',     short: 'TI',  color: '#a78bfa',
    persona: 'a threat-intelligence analyst — you assess IOC reputation, likely threat-actor attribution, campaigns, and TTP overlap.' },
  { id: 'investigation',  name: 'Investigation Agent',    short: 'INV', color: '#38bdf8',
    persona: 'an incident investigator — you build the timeline, scope affected assets/users, and trace the attack path.' },
  { id: 'malware',        name: 'Malware Analysis Agent', short: 'MAL', color: '#fb923c',
    persona: 'a malware analyst — you reason about binary/behavioural indicators, capabilities, and payload intent.' },
  { id: 'hunting',        name: 'Threat Hunting Agent',   short: 'HNT', color: '#fbbf24',
    persona: 'a threat hunter — you look for related, stealthy, or lateral activity the alert may have missed.' },
  { id: 'compliance',     name: 'Compliance Agent',       short: 'CMP', color: '#34d399',
    persona: 'a compliance analyst — you assess regulatory/notification impact (GDPR, PCI, HIPAA) and evidence-handling needs.' },
  { id: 'rca',            name: 'Root Cause Agent',       short: 'RCA', color: '#f472b6',
    persona: 'a root-cause analyst — you determine the underlying cause and the control gap that allowed it.' },
  { id: 'recommendation', name: 'Recommendation Agent',   short: 'REC', color: '#4ade80',
    persona: 'a response strategist — you produce prioritized, concrete remediation and containment actions.' },
  { id: 'reporting',      name: 'Reporting Agent',        short: 'RPT', color: '#e879f9',
    persona: 'a reporting specialist — you distill findings into clear, executive-ready language.' },
]

export function agentById(id: string): AgentDef | undefined {
  return AGENT_ROSTER.find(a => a.id === id)
}

// ── Phase 1: decompose ─────────────────────────────────────────────────────────
export interface PlanItem { agentId: string; task: string }
export interface AcnPlan { clarify: string | null; plan: PlanItem[]; intent: string }

const ORCHESTRATOR_PERSONA =
  'You are ACN, the orchestrator of an AI SOC (Security Operations Center) multi-agent system built by Accenture. ' +
  'You coordinate a team of specialist agents. You are decisive, precise, and speak like a calm senior SOC lead.'

export async function acnDecompose(
  apiKey: string, utterance: string, ctx: SocContext, history: ChatTurn[] = [],
): Promise<AcnPlan> {
  const roster = AGENT_ROSTER.map(a => `- ${a.id}: ${a.name} (${a.persona})`).join('\n')
  const system =
    `${ORCHESTRATOR_PERSONA}\n\n` +
    `Available specialist agents:\n${roster}\n\n${buildContextBlock(ctx)}\n\n` +
    `The user just spoke a request. Decide how to handle it.\n` +
    `- If the request is ambiguous or missing key detail, set "clarify" to ONE short spoken follow-up question and leave "plan" empty.\n` +
    `- Otherwise select 3 to 5 of the MOST relevant agents and give each a specific, self-contained subtask grounded in the live SOC state.\n` +
    `Return ONLY valid JSON, no markdown:\n` +
    `{ "intent": "<3-6 word label>", "clarify": "<question or null>", "plan": [ { "agentId": "<id>", "task": "<subtask>" } ] }`
  const convo: ChatTurn[] = [...history.slice(-6), { role: 'user', text: utterance }]
  const raw = await geminiGenerate(apiKey, system, convo, { temperature: 0.3, maxTokens: 700 })
  const parsed = safeJson(raw)
  const plan: PlanItem[] = Array.isArray(parsed?.plan)
    ? parsed.plan.filter((p: PlanItem) => p && agentById(p.agentId)).slice(0, 5)
    : []
  return {
    intent:  typeof parsed?.intent === 'string' ? parsed.intent : 'Analysis',
    clarify: typeof parsed?.clarify === 'string' && parsed.clarify.trim() ? parsed.clarify.trim() : null,
    plan,
  }
}

// ── Phase 2: run one specialist agent ──────────────────────────────────────────
export async function acnRunAgent(
  apiKey: string, agent: AgentDef, task: string, ctx: SocContext,
): Promise<string> {
  const system =
    `You are the ${agent.name} in an AI SOC multi-agent team. You are ${agent.persona}\n\n` +
    `${buildContextBlock(ctx)}\n\n` +
    `Focus ONLY on your specialty. Produce a tight finding (max 3 sentences) with your assessment, ` +
    `confidence, and the single most important point for the team. No preamble.`
  return geminiGenerate(apiKey, system, [{ role: 'user', text: task }], { temperature: 0.4, maxTokens: 300 })
}

// ── Phase 3 + 4: collaborate/debate then synthesize ─────────────────────────────
export interface AgentFinding { agent: AgentDef; task: string; finding: string }

export async function acnSynthesize(
  apiKey: string, utterance: string, findings: AgentFinding[], ctx: SocContext, history: ChatTurn[] = [],
): Promise<string> {
  const board = findings.map(f => `[${f.agent.name}] ${f.finding}`).join('\n')
  const system =
    `${ORCHESTRATOR_PERSONA}\n\n${buildContextBlock(ctx)}\n\n` +
    `Your specialist agents have each reported. First reconcile them: note where they agree, resolve any ` +
    `conflicts, and discard weak claims. Then synthesize ONE coherent answer to the user's request.\n` +
    `This will be spoken aloud, so: natural sentences, no markdown, no bullet symbols, under 130 words, ` +
    `lead with the bottom line, then the key reasoning, then the top recommended action.\n\n` +
    `AGENT REPORTS:\n${board}`
  const convo: ChatTurn[] = [...history.slice(-4), { role: 'user', text: utterance }]
  return geminiGenerate(apiKey, system, convo, { temperature: 0.45, maxTokens: 500 })
}

// ── helper ──────────────────────────────────────────────────────────────────
function safeJson(raw: string): { intent?: string; clarify?: string; plan?: PlanItem[] } | null {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim()
    return JSON.parse(cleaned)
  } catch { return null }
}
