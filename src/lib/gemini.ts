// ─────────────────────────────────────────────────────────────────────────────
// Gemini client — the intelligence layer behind the ACN SOC voice assistant.
//
// Designed to be modular so Phase 2 can layer specialized agents on top without
// refactoring: every capability is expressed as an "agent" with a role + system
// prompt, routed through a single `runAgent()` call. Today they all run on
// Gemini; tomorrow each could be backed by its own model, tools, DB, or RAG
// retriever while keeping the same interface.
// ─────────────────────────────────────────────────────────────────────────────

import type { AlertQueueItem, ResolvedIncident, TrainedAgentSkill } from './store'

const GEMINI_MODEL = 'gemini-2.0-flash'
const GEMINI_URL = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`

export interface ChatTurn { role: 'user' | 'model'; text: string }

// ── Low-level call ────────────────────────────────────────────────────────────
export async function geminiGenerate(
  apiKey: string,
  systemPrompt: string,
  history: ChatTurn[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const res = await fetch(GEMINI_URL(GEMINI_MODEL, apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: history.map(t => ({ role: t.role, parts: [{ text: t.text }] })),
      generationConfig: {
        temperature: opts.temperature ?? 0.6,
        maxOutputTokens: opts.maxTokens ?? 1024,
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 160)}`)
  }
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
  if (!text) throw new Error('Gemini returned an empty response')
  return text.trim()
}

// ── SOC context snapshot (the shared knowledge the assistant reasons over) ────
export interface SocContext {
  alertQueue:        AlertQueueItem[]
  resolvedIncidents: ResolvedIncident[]
  trainedAgents:     TrainedAgentSkill[]
}

export function buildContextBlock(ctx: SocContext): string {
  const pending = ctx.alertQueue.filter(a => a.status === 'new').length
  const sevCounts = ctx.alertQueue.reduce<Record<string, number>>((m, a) => {
    m[a.severity] = (m[a.severity] ?? 0) + 1; return m
  }, {})
  const recentAlerts = ctx.alertQueue.slice(0, 12).map(a =>
    `- [${a.severity}] ${a.title} · ${a.techniqueId} ${a.techniqueName} · ${a.sourceHost}(${a.sourceIp}) → ${a.destHost || a.destIp}:${a.destPort} · user=${a.sourceUser} · status=${a.status}`,
  ).join('\n')
  const recentResolved = ctx.resolvedIncidents.slice(0, 10).map(r =>
    `- ${r.procId} ${r.alert.title} · verdict=${r.verdict} risk=${r.riskScore} conf=${r.confidence}% mttr=${r.mttr}s agent=${r.agentLabel}`,
  ).join('\n')
  const agents = ctx.trainedAgents.map(a =>
    `- ${a.label} (${a.alertType}) · runs=${a.runCount} · techniques=[${a.commonTechniques.join(', ')}]`,
  ).join('\n')

  const verdicts = ctx.resolvedIncidents.reduce<Record<string, number>>((m, r) => {
    m[r.verdict] = (m[r.verdict] ?? 0) + 1; return m
  }, {})

  return [
    '=== LIVE SOC STATE ===',
    `Alert queue: ${ctx.alertQueue.length} total, ${pending} pending. Severity mix: ${JSON.stringify(sevCounts)}`,
    `Resolved incidents: ${ctx.resolvedIncidents.length}. Verdicts: ${JSON.stringify(verdicts)}`,
    `Trained specialist agents: ${ctx.trainedAgents.length}`,
    '',
    'RECENT ALERTS:', recentAlerts || '(none)',
    '',
    'RECENT RESOLVED INCIDENTS:', recentResolved || '(none)',
    '',
    'AGENT REGISTRY:', agents || '(none trained yet)',
    '=== END SOC STATE ===',
  ].join('\n')
}

// ── Capability registry (Phase-2-ready agent definitions) ─────────────────────
// Each capability = a focused "agent". Add new ones here (Detection, Threat Intel,
// Malware Analysis, Compliance, RCA, …) and they become routable with no other
// wiring. The orchestrator picks one per request today; in Phase 2 it can fan out
// to several and consolidate.
export type CapabilityId =
  | 'converse' | 'report' | 'analyze' | 'summarize' | 'explain'

export interface Capability {
  id:          CapabilityId
  label:       string
  system:      string
  temperature: number
}

const ACN_PERSONA =
  'You are ACN, an enterprise AI SOC (Security Operations Center) assistant built by Accenture. ' +
  'You are professional, concise, and conversational — you speak like a calm senior SOC analyst. ' +
  'You are talking through a voice interface, so keep spoken answers natural and not too long; ' +
  'use short paragraphs, avoid markdown symbols, tables, and code fences in spoken replies. ' +
  'Always ground your answer in the LIVE SOC STATE provided. If data is missing, say so plainly. ' +
  'Address the user politely.'

export const CAPABILITIES: Record<CapabilityId, Capability> = {
  converse: {
    id: 'converse', label: 'Conversation', temperature: 0.6,
    system: `${ACN_PERSONA}\nAnswer the user's SOC-related question directly and helpfully using the live state.`,
  },
  report: {
    id: 'report', label: 'SOC Report', temperature: 0.4,
    system: `${ACN_PERSONA}\nGenerate a concise SOC shift/situation report from the live state: overall posture, notable incidents, verdict breakdown, and 2-3 recommended actions. Speak it as a briefing.`,
  },
  analyze: {
    id: 'analyze', label: 'Security Analysis', temperature: 0.4,
    system: `${ACN_PERSONA}\nPerform security-event analysis over the live alerts/incidents: identify the most significant threats, likely attack patterns (map to MITRE ATT&CK where possible), and risk. Be specific and actionable.`,
  },
  summarize: {
    id: 'summarize', label: 'Incident Summary', temperature: 0.35,
    system: `${ACN_PERSONA}\nSummarize the current incidents crisply: what happened, affected assets/users, verdicts, and current status. Prioritize by severity.`,
  },
  explain: {
    id: 'explain', label: 'Explain Alert', temperature: 0.4,
    system: `${ACN_PERSONA}\nExplain the alert/detection the user is asking about in plain language: what the technique means, why it fired, how serious it is, and what a analyst should check next.`,
  },
}

// Lightweight intent router — keyword heuristic now, LLM-classifiable later.
export function routeCapability(utterance: string): CapabilityId {
  const t = utterance.toLowerCase()
  if (/\breport\b|briefing|shift|posture|status report/.test(t)) return 'report'
  if (/summar/.test(t)) return 'summarize'
  if (/explain|what (is|does)|meaning|why did/.test(t)) return 'explain'
  if (/analy|threat|attack|investigat|risk|assess/.test(t)) return 'analyze'
  return 'converse'
}

// ── Orchestrator entry point ──────────────────────────────────────────────────
// Routes a user utterance to a capability, injects live SOC context, and returns
// ACN's response. This is the seam Phase 2 multi-agent orchestration plugs into.
export async function askAcn(
  apiKey: string,
  utterance: string,
  ctx: SocContext,
  history: ChatTurn[] = [],
): Promise<{ text: string; capability: CapabilityId }> {
  const capId = routeCapability(utterance)
  const cap = CAPABILITIES[capId]
  const contextBlock = buildContextBlock(ctx)
  const system = `${cap.system}\n\n${contextBlock}`
  const convo: ChatTurn[] = [...history.slice(-6), { role: 'user', text: utterance }]
  const text = await geminiGenerate(apiKey, system, convo, { temperature: cap.temperature, maxTokens: 1024 })
  return { text, capability: capId }
}
