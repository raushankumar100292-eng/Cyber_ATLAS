// ─────────────────────────────────────────────────────────────────────────────
// AI Agent Studio — Agent Registry
//
// The Studio sidebar is generated ENTIRELY from this registry — there is no
// hardcoded per-agent UI. Adding, removing, disabling or reordering an agent is
// a data change here (and, later, a dropped plugin folder that feeds this list),
// never an application-code change. This is the seed of the plug-in architecture.
// ─────────────────────────────────────────────────────────────────────────────
import type { LucideIcon } from 'lucide-react'
import {
  Inbox, Boxes, Server, UserRound, ScrollText,
  Fingerprint, Globe, Bug, Skull, ShieldAlert,
  Target, Crosshair, Share2, TrendingUp, Brain, GitBranch,
  Gauge, BadgeCheck, Microscope, Scale, BrainCircuit,
  Zap, Send,
  History, GraduationCap, Search, Database,
  Timer, Split, Repeat, Merge, GitFork, Rows3, UserCheck,
  Cloud, Plug,
} from 'lucide-react'

export interface StudioAgent {
  id: string
  name: string
  desc: string
  disabled?: boolean
}

export interface AgentCategory {
  id: string
  label: string
  icon: LucideIcon
  color: string      // accent (text / border)
  chipBg: string     // soft swatch background
  agents: StudioAgent[]
}

export const AGENT_REGISTRY: AgentCategory[] = [
  {
    id: 'investigation', label: 'Investigation', icon: Inbox, color: '#2563EB', chipBg: '#DBEAFE',
    agents: [
      { id: 'alert-intake', name: 'Alert Intake Agent',   desc: 'Normalize & enrich the incoming alert' },
      { id: 'context',      name: 'Context Agent',        desc: 'Gather surrounding context for the entity' },
      { id: 'asset',        name: 'Asset Agent',          desc: 'Resolve asset identity & criticality' },
      { id: 'user-profile', name: 'User Profile Agent',   desc: 'Pull user/identity profile & role' },
      { id: 'log-corr',     name: 'Log Correlation Agent',desc: 'Correlate related log events' },
    ],
  },
  {
    id: 'threat-intel', label: 'Threat Intelligence', icon: Globe, color: '#7C3AED', chipBg: '#EDE9FE',
    agents: [
      { id: 'ioc',          name: 'IOC Agent',            desc: 'Extract & correlate indicators' },
      { id: 'threat-intel', name: 'Threat Intel Agent',   desc: 'Reputation & feed lookups' },
      { id: 'malware',      name: 'Malware Agent',        desc: 'Classify sample / behavior' },
      { id: 'threat-actor', name: 'Threat Actor Agent',   desc: 'Attribute to known actors' },
      { id: 'vuln',         name: 'Vulnerability Agent',  desc: 'Map exposed CVEs' },
    ],
  },
  {
    id: 'prediction', label: 'Prediction', icon: Target, color: '#D97706', chipBg: '#FEF3C7',
    agents: [
      { id: 'mitre',        name: 'MITRE Agent',              desc: 'Map to ATT&CK techniques' },
      { id: 'kill-chain',   name: 'Cyber Kill Chain Agent',   desc: 'Place on the kill chain' },
      { id: 'attack-graph', name: 'Attack Graph Agent',       desc: 'Build the attack graph' },
      { id: 'attack-prog',  name: 'Attack Progression Agent', desc: 'Predict next techniques & alerts' },
      { id: 'ace',          name: 'Attacker Cognitive Engine (ACE)', desc: 'Infer attacker objectives & skill' },
      { id: 'next-step',    name: 'Next-Step Prediction Agent',desc: 'Forecast the likely next move' },
    ],
  },
  {
    id: 'decision', label: 'Decision', icon: Scale, color: '#059669', chipBg: '#D1FAE5',
    agents: [
      { id: 'risk',       name: 'Risk Scoring Agent',    desc: 'Compute risk & severity' },
      { id: 'confidence', name: 'Confidence Agent',      desc: 'Calibrate decision confidence' },
      { id: 'root-cause', name: 'Root Cause Agent',      desc: 'Determine root cause' },
      { id: 'tpfp',       name: 'TP/FP Prediction Agent',desc: 'Classify true / false positive' },
      { id: 'decision',   name: 'Decision Agent',        desc: 'Produce the final verdict' },
    ],
  },
  {
    id: 'response', label: 'Response', icon: Zap, color: '#DB2777', chipBg: '#FCE7F3',
    agents: [
      { id: 'playbook', name: 'Playbook Agent', desc: 'Select the matching playbook' },
      { id: 'soar',     name: 'SOAR Agent',     desc: 'Dispatch / execute the response' },
    ],
  },
  {
    id: 'knowledge', label: 'Knowledge', icon: Database, color: '#0891B2', chipBg: '#CFFAFE',
    agents: [
      { id: 'historical', name: 'Historical Incident Agent', desc: 'Recall similar past incidents' },
      { id: 'learning',   name: 'Learning Agent',            desc: 'Store outcomes & feedback' },
      { id: 'vector',     name: 'Vector Search Agent',       desc: 'Semantic recall over the KB' },
      { id: 'memory',     name: 'Memory Agent',              desc: 'Investigation working memory' },
    ],
  },
  {
    id: 'utilities', label: 'Utilities', icon: Rows3, color: '#6B7280', chipBg: '#F3F4F6',
    agents: [
      { id: 'delay',    name: 'Delay',          desc: 'Wait for a fixed interval' },
      { id: 'condition',name: 'Condition',      desc: 'Branch on a rule' },
      { id: 'loop',     name: 'Loop',           desc: 'Iterate over items' },
      { id: 'merge',    name: 'Merge',          desc: 'Join parallel branches' },
      { id: 'split',    name: 'Split',          desc: 'Fan out to branches' },
      { id: 'parallel', name: 'Parallel',       desc: 'Run branches concurrently' },
      { id: 'approval', name: 'Human Approval', desc: 'Pause for analyst sign-off' },
    ],
  },
  {
    id: 'connectors', label: 'Connectors', icon: Plug, color: '#9CA3AF', chipBg: '#E5E7EB',
    agents: [
      { id: 'sentinel',     name: 'Microsoft Sentinel',      desc: 'SIEM connector',  disabled: true },
      { id: 'splunk',       name: 'Splunk',                  desc: 'SIEM connector',  disabled: true },
      { id: 'chronicle',    name: 'Google Chronicle',        desc: 'SIEM connector',  disabled: true },
      { id: 'defender',     name: 'Microsoft Defender',      desc: 'EDR connector',   disabled: true },
      { id: 'crowdstrike',  name: 'CrowdStrike',             desc: 'EDR connector',   disabled: true },
      { id: 'defender-xdr', name: 'Microsoft Defender XDR',  desc: 'XDR connector',   disabled: true },
      { id: 'rest-api',     name: 'REST API',                desc: 'Generic connector', disabled: true },
    ],
  },
]

// Icon lookup per agent id (used by nodes on the canvas / properties panel).
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  investigation: Inbox, 'threat-intel': Globe, prediction: Target,
  decision: Scale, response: Zap, knowledge: Database, utilities: Rows3, connectors: Plug,
}

// Flat index for quick lookups by agent id.
export const AGENTS_BY_ID: Record<string, { agent: StudioAgent; category: AgentCategory }> = (() => {
  const m: Record<string, { agent: StudioAgent; category: AgentCategory }> = {}
  for (const cat of AGENT_REGISTRY) for (const a of cat.agents) m[a.id] = { agent: a, category: cat }
  return m
})()

// Per-agent glyphs (fall back to the category icon when unset) — keeps the
// canvas/nodes legible without bloating the registry above.
export const AGENT_GLYPHS: Record<string, LucideIcon> = {
  'alert-intake': Inbox, context: Boxes, asset: Server, 'user-profile': UserRound, 'log-corr': ScrollText,
  ioc: Fingerprint, 'threat-intel': Globe, malware: Bug, 'threat-actor': Skull, vuln: ShieldAlert,
  mitre: Target, 'kill-chain': Crosshair, 'attack-graph': Share2, 'attack-prog': TrendingUp, ace: Brain, 'next-step': GitBranch,
  risk: Gauge, confidence: BadgeCheck, 'root-cause': Microscope, tpfp: Scale, decision: BrainCircuit,
  playbook: GitBranch, soar: Send,
  historical: History, learning: GraduationCap, vector: Search, memory: Database,
  delay: Timer, condition: Split, loop: Repeat, merge: Merge, split: GitFork, parallel: Rows3, approval: UserCheck,
  sentinel: Cloud, splunk: Database, chronicle: Cloud, defender: Cloud, crowdstrike: Cloud, 'defender-xdr': Cloud, 'rest-api': Plug,
}
