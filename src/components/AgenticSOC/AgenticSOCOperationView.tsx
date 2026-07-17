import { useState, useEffect, useRef, useCallback } from "react";
import { useStore } from "../../lib/store";
import type { AlertQueueItem, ResolvedIncident } from "../../lib/store";

// ── Palette ───────────────────────────────────────────────────────────────────
const FONT = `@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500;700&display=swap');`;
const C = {
  bg: "#0C111B", bg2: "#111827", panel: "#161F2E", panelHi: "#1C2738",
  line: "#26324A", lineHi: "#33425F", text: "#E5EAF3",
  mut: "#8593AC", mut2: "#6B7A96",
  live: "#33D6C4", liveDim: "#1C6E67",
  crit: "#F1665A", high: "#EFA23C", med: "#5AA6F1", low: "#6E9CAC", ok: "#4FC98A",
  purple: "#A78BFA", amber: "#FBBF24",
};
const SEV_COLOR: Record<string, string> = {
  CRITICAL: C.crit, HIGH: C.high, MEDIUM: C.med, LOW: C.low, INFO: C.mut2,
};

// ── Pipeline stages ───────────────────────────────────────────────────────────
const STAGES = ["Triage", "Investigate", "Enrich", "Insight", "Respond", "Resolved"];
const STAGE_NOTES: Record<string, string[]> = {
  Triage:      ["reading alert context", "correlating signals", "scoping affected assets"],
  Investigate: ["pulling process tree", "querying auth logs", "mapping to MITRE ATT&CK"],
  Enrich:      ["hash lookup vs threat intel", "domain reputation check", "resolving host owner"],
  Insight:     ["calling specialized agent…", "applying learned skills…", "generating deep analysis…"],
  Respond:     ["executing containment", "requesting SOAR playbook", "validating action scope"],
  Resolved:    ["closing incident", "writing case summary"],
};
const GROQ_KEY = "atlas_groq_key";

// ── Specialized agent config per use case ─────────────────────────────────────
interface AgentConf { label: string; shortLabel: string; color: string; icon: string }
const AGENT_CONFIG: Record<string, AgentConf> = {
  phishing: { label: "Phishing Agent",        shortLabel: "PHI", color: "#f87171", icon: "✉" },
  malware:  { label: "Malware Agent",         shortLabel: "MAL", color: "#fb923c", icon: "⚠" },
  lateral:  { label: "Lateral Mvmt Agent",    shortLabel: "LAT", color: "#fbbf24", icon: "→" },
  exfil:    { label: "Exfil Agent",           shortLabel: "EXF", color: "#a78bfa", icon: "⬆" },
  brute:    { label: "Brute Force Agent",     shortLabel: "BRF", color: "#818cf8", icon: "🔑" },
  privesc:  { label: "PrivEsc Agent",         shortLabel: "PRV", color: "#34d399", icon: "▲" },
  c2:       { label: "C2 Comms Agent",        shortLabel: "C2",  color: "#00e5ff", icon: "◎" },
  cloud:    { label: "Cloud Abuse Agent",     shortLabel: "CLD", color: "#38bdf8", icon: "☁" },
  insider:  { label: "Insider Threat Agent",  shortLabel: "INS", color: "#fb7185", icon: "👤" },
  supply:   { label: "Supply Chain Agent",    shortLabel: "SCH", color: "#e879f9", icon: "⛓" },
  unknown:  { label: "General Agent",         shortLabel: "GEN", color: "#6B7A96", icon: "◇" },
};

// ── Module-level agent registry (persists across view re-mounts) ──────────────
interface AgentSkills {
  alertType:          string;
  label:              string;
  color:              string;
  trainedAt:          number;
  reuseCount:         number;
  investigationSteps: string[];
  iocPatterns:        string[];
  remediationSteps:   string[];
  commonTechniques:   string[];
  sampleQueries:      { splunk: string[]; kql: string[] };
}
const AGENT_REGISTRY = new Map<string, AgentSkills>();

// ── Types ─────────────────────────────────────────────────────────────────────
interface InsightAnalysis {
  threatActorProfile: string;
  attackChain:        string[];
  iocs:               string[];
  riskScore:          number;
  verdict:            "True Positive" | "False Positive" | "Needs Review";
  confidence:         number;
  reasoning:          string;
  recommendations:    string[];
  sampleQueries:      { splunk: string[]; kql: string[] };
}

// Sub-stages within Insight analysis (simulate 5-min deep work)
const INSIGHT_SUBSTAGES = [
  "initializing specialized agent…",
  "loading historical TTPs for this actor…",
  "correlating alert context with threat intel…",
  "building attack timeline…",
  "mapping techniques to MITRE ATT&CK…",
  "analyzing IOC reputation…",
  "scoring lateral movement risk…",
  "computing confidence metric…",
  "generating investigation queries…",
  "finalizing insight report…",
];

interface ProcessingAgent {
  procId:          string;
  alert:           AlertQueueItem;
  source:          "alert-gen" | "paste" | "upload" | "webhook";
  childAgent:      AgentConf;
  isFirstRun:      boolean;
  stageIdx:        number;
  note:            string;
  insights:        InsightAnalysis | null;
  approval:        "pending" | "approved" | "rejected" | null;
  spawnAt:         number;
  done:            boolean;
  mttr:            number | null;
  analyzing:       boolean;
  analyzeProgress: number;   // 0-100 progress within Insight stage
  analyzeSubstage: string;   // current sub-stage label
  showInsights:    boolean;
  insightTab:      "analysis" | "mindmap" | "queries";
}
interface LogEntry { t: number; procId: string; sev: string; msg: string; }
interface Metrics  { tp: number; fp: number; escalated: number; totalMttr: number; resolved: number; }

// ── Ingestion source config ───────────────────────────────────────────────────
type SourceId = "gen" | "paste" | "upload" | "siem";
const SOURCE_OPTIONS: { id: SourceId; label: string; icon: string; desc: string; color: string }[] = [
  { id: "gen",    label: "Alert Generator", icon: "⚡", desc: "Auto-picks from shared queue",        color: C.amber  },
  { id: "paste",  label: "Paste JSON",      icon: "{}", desc: "Any SIEM JSON — native or custom",    color: C.purple },
  { id: "upload", label: "File Upload",     icon: "↑",  desc: ".json file — single or array",        color: C.med    },
  { id: "siem",   label: "SIEM Connect",    icon: "⊕",  desc: "Splunk · Sentinel · Elastic guides",  color: C.live   },
];

// ── Groq: train agent + deep insight analysis ─────────────────────────────────
async function groqTrainAndAnalyze(apiKey: string, a: AlertQueueItem): Promise<{
  insight: InsightAnalysis;
  skills: Pick<AgentSkills, "investigationSteps" | "iocPatterns" | "remediationSteps" | "commonTechniques">;
}> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "You are a specialized SOC analyst AI. Perform deep incident analysis and extract reusable investigation skills. Return ONLY valid JSON, no markdown." },
        {
          role: "user",
          content: `Deep SOC analysis for this ${a.useCaseLabel} security incident:\n\nTitle: ${a.title}\nSeverity: ${a.severity}\nTactic: ${a.tactic}\nTechnique: ${a.techniqueId} – ${a.techniqueName}\nSource Host: ${a.sourceHost} | User: ${a.sourceUser} | IP: ${a.sourceIp}\nProcess: ${a.sourceProcess ?? "N/A"}\nDestination: ${a.destHost}:${a.destPort} (${a.destIp})\nEvidence:\n${a.evidence.map(e => "  - " + e).join("\n")}\nRaw Log: ${a.rawLog}\n\nReturn ONLY this JSON (no extra text, no markdown):\n{\n  "insight": {\n    "threatActorProfile": "<suspected actor type or behavior pattern, 1-2 sentences>",\n    "attackChain": ["<attack step 1>", "<attack step 2>", "<attack step 3>", "<attack step 4>"],\n    "iocs": ["<ioc 1>", "<ioc 2>", "<ioc 3>"],\n    "riskScore": <integer 0-100>,\n    "verdict": "<True Positive|False Positive|Needs Review>",\n    "confidence": <integer 0-100>,\n    "reasoning": "<one clear sentence explaining the verdict>",\n    "recommendations": ["<action 1>", "<action 2>", "<action 3>"],\n    "sampleQueries": {\n      "splunk": ["<Splunk SPL query 1 using actual IPs/hosts from alert>", "<Splunk SPL query 2>", "<Splunk SPL query 3>"],\n      "kql":    ["<KQL Sentinel query 1 using actual IPs/hosts>", "<KQL query 2>", "<KQL query 3>"]\n    }\n  },\n  "skills": {\n    "investigationSteps": ["<reusable step 1>", "<reusable step 2>", "<reusable step 3>"],\n    "iocPatterns": ["<pattern/indicator type 1>", "<pattern/indicator type 2>"],\n    "remediationSteps": ["<remediation 1>", "<remediation 2>", "<remediation 3>"],\n    "commonTechniques": ["<MITRE T-ID: name>", "<MITRE T-ID: name>"],\n    "sampleQueries": {\n      "splunk": ["<generic SPL template for ${a.useCaseLabel}>", "<generic SPL template 2>"],\n      "kql":    ["<generic KQL template for ${a.useCaseLabel}>", "<generic KQL template 2>"]\n    }\n  }\n}`,
        },
      ],
      temperature: 0.25,
      max_tokens: 800,
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const data = await res.json();
  const raw = (data.choices?.[0]?.message?.content ?? "{}")
    .replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
  return JSON.parse(raw);
}

// ── Apply cached agent skills — zero AI token usage ───────────────────────────
function applySkills(skills: AgentSkills, alert: AlertQueueItem): InsightAnalysis {
  const isFP  = alert.severity === "LOW" && Math.random() < 0.28;
  const conf  = 76 + Math.floor(Math.random() * 20);
  const score = isFP ? 10 + Math.floor(Math.random() * 20) : 52 + Math.floor(Math.random() * 43);
  // Parameterise cached query templates with live alert values
  const paramSplunk = skills.sampleQueries?.splunk?.map(q =>
    q.replace(/{host}/g, alert.sourceHost).replace(/{ip}/g, alert.sourceIp).replace(/{user}/g, alert.sourceUser)
  ) ?? [
    `index=* src_ip="${alert.sourceIp}" OR src_host="${alert.sourceHost}" | stats count by _time, src_ip, dest_ip, action | sort -_time`,
    `index=* (EventCode=4625 OR EventCode=4624) user="${alert.sourceUser}" | eval status=if(EventCode==4624,"success","fail") | timechart span=5m count by status`,
  ];
  const paramKql = skills.sampleQueries?.kql?.map(q =>
    q.replace(/{host}/g, alert.sourceHost).replace(/{ip}/g, alert.sourceIp).replace(/{user}/g, alert.sourceUser)
  ) ?? [
    `SecurityEvent | where Computer == "${alert.sourceHost}" or IpAddress == "${alert.sourceIp}" | where TimeGenerated >= ago(24h) | summarize count() by Activity, Computer | order by count_ desc`,
    `SigninLogs | where UserPrincipalName contains "${alert.sourceUser}" | where TimeGenerated >= ago(4h) | project TimeGenerated, Location, IPAddress, ResultType, AppDisplayName`,
  ];

  return {
    threatActorProfile: `Pattern match via ${skills.label} cached skills — ${alert.tactic} behavior on ${alert.sourceHost}.`,
    attackChain: [
      `${alert.sourceUser} initiated from ${alert.sourceHost} (${alert.sourceIp})`,
      `Technique ${alert.techniqueId} — ${alert.techniqueName} observed`,
      `Lateral target: ${alert.destHost}:${alert.destPort}`,
      skills.investigationSteps[0] ?? "No further steps recorded",
    ],
    iocs: [alert.sourceIp, alert.destIp, ...skills.iocPatterns].filter(Boolean).slice(0, 4),
    riskScore: score,
    verdict:   isFP ? "False Positive" : (alert.severity === "CRITICAL" || alert.severity === "HIGH") ? "True Positive" : "Needs Review",
    confidence: conf,
    reasoning: `${skills.label} applied cached skills from ${new Date(skills.trainedAt).toLocaleTimeString()} — ${skills.reuseCount} prior incidents. No AI tokens used.`,
    recommendations: skills.remediationSteps.slice(0, 3),
    sampleQueries: { splunk: paramSplunk.slice(0, 3), kql: paramKql.slice(0, 3) },
  };
}

// ── Generate heuristic queries (no-API-key path) ──────────────────────────────
function heuristicQueries(alert: AlertQueueItem): InsightAnalysis["sampleQueries"] {
  return {
    splunk: [
      `index=* src_ip="${alert.sourceIp}" OR src_host="${alert.sourceHost}" earliest=-24h | stats count by _time, action | timechart span=1h count`,
      `index=* user="${alert.sourceUser}" EventCode=4625 earliest=-4h | stats count by src_ip, dest_host | sort -count`,
      `index=* dest_ip="${alert.destIp}" dest_port=${alert.destPort} earliest=-6h | table _time, src_ip, src_host, user, bytes_out | sort -_time`,
    ],
    kql: [
      `SecurityEvent | where (Computer == "${alert.sourceHost}" or IpAddress == "${alert.sourceIp}") and TimeGenerated >= ago(24h) | summarize count() by Activity, bin(TimeGenerated, 1h) | order by TimeGenerated desc`,
      `SigninLogs | where UserPrincipalName contains "${alert.sourceUser}" and TimeGenerated >= ago(4h) | project TimeGenerated, Location, IPAddress, ResultType, AppDisplayName | order by TimeGenerated desc`,
      `NetworkCommunicationEvents | where RemoteIP == "${alert.destIp}" and RemotePort == ${alert.destPort} and TimeGenerated >= ago(6h) | summarize count() by DeviceName, InitiatingProcessName`,
    ],
  };
}

// ── Alert normaliser ──────────────────────────────────────────────────────────
function normalise(raw: unknown, source: ProcessingAgent["source"]): AlertQueueItem | null {
  try {
    const o   = raw as Record<string, unknown>;
    const src = (o.source as Record<string, unknown>) ?? {};
    const dst = (o.destination as Record<string, unknown>) ?? {};
    return {
      id:                `imported-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      useCase:           String(o.type ?? o.category ?? source),
      useCaseLabel:      String(o.type ?? o.category ?? source),
      severity:          (["CRITICAL","HIGH","MEDIUM","LOW","INFO"].includes(String(o.severity).toUpperCase())
                           ? String(o.severity).toUpperCase() : "MEDIUM") as AlertQueueItem["severity"],
      title:             String(o.title ?? o.rule ?? o.name ?? o.alert_name ?? "Imported Alert"),
      description:       String(o.description ?? o.summary ?? ""),
      tactic:            String(o.tactic ?? o.mitre_tactic ?? ""),
      techniqueId:       String(o.technique_id ?? o.mitre_technique ?? ""),
      techniqueName:     String(o.technique_name ?? ""),
      sourceIp:          String(src.ip ?? o.src_ip ?? o.source_ip ?? ""),
      sourceHost:        String(src.hostname ?? o.src_host ?? o.hostname ?? ""),
      sourceUser:        String(src.user ?? o.user ?? o.username ?? ""),
      sourceProcess:     String(src.process ?? o.process ?? "") || null,
      destIp:            String(dst.ip ?? o.dest_ip ?? o.destination_ip ?? ""),
      destHost:          String(dst.hostname ?? o.dest_host ?? ""),
      destPort:          Number(dst.port ?? o.dest_port ?? 0),
      evidence:          Array.isArray(o.evidence) ? o.evidence.map(String) : [],
      rawLog:            String(o.raw_log ?? o.raw_event ?? o.log ?? ""),
      recommendedAction: String(o.recommended_action ?? o.action ?? ""),
      alertId:           String(o.alert_id ?? o.id ?? ""),
      timestamp:         String(o.timestamp ?? new Date().toISOString()),
      createdAt:         Date.now(), status: "new",
    };
  } catch { return null; }
}

// ── Utility sub-components ────────────────────────────────────────────────────
function Stat({ label, value, color, blink }: { label: string; value: number | string; color: string; blink?: boolean }) {
  return (
    <div style={{ textAlign: "right", minWidth: 58 }}>
      <div className="soc-mono" style={{ fontSize: 19, fontWeight: 700, color, lineHeight: 1.1, animation: blink ? "soc-blink 1.1s ease-in-out infinite" : "none" }}>{value}</div>
      <div style={{ fontSize: 9, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 }}>{label}</div>
    </div>
  );
}
function Chip({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ padding: "4px 10px", borderRadius: 8, background: `${color}12`, border: `1px solid ${color}28`, textAlign: "center", minWidth: 56 }}>
      <div className="soc-mono" style={{ fontSize: 14, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 8.5, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 1, whiteSpace: "nowrap" }}>{label}</div>
    </div>
  );
}
function SourceBadge({ source }: { source: ProcessingAgent["source"] }) {
  const map: Record<ProcessingAgent["source"], { label: string; color: string }> = {
    "alert-gen": { label: "ALERT GEN", color: C.amber },
    paste:       { label: "PASTED",    color: C.purple },
    upload:      { label: "UPLOAD",    color: C.med },
    webhook:     { label: "WEBHOOK",   color: C.live },
  };
  const m = map[source];
  return <span className="soc-mono" style={{ fontSize: 8, color: m.color, border: `1px solid ${m.color}40`, borderRadius: 4, padding: "1px 5px", background: `${m.color}10` }}>{m.label}</span>;
}
function PipelineFunnel({ agents }: { agents: ProcessingAgent[] }) {
  const counts = STAGES.map((_, i) => agents.filter(a => a.stageIdx === i && !a.done).length);
  const max = Math.max(...counts, 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {STAGES.map((s, i) => (
        <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="soc-mono" style={{ fontSize: 9, color: C.mut2, width: 60, textAlign: "right", textTransform: "uppercase", letterSpacing: 0.4 }}>{s}</div>
          <div style={{ flex: 1, height: 8, borderRadius: 3, background: C.line, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(counts[i] / max) * 100}%`, background: i === 5 ? C.ok : i === 3 ? C.purple : C.live, borderRadius: 3, transition: "width 0.5s ease" }} />
          </div>
          <div className="soc-mono" style={{ fontSize: 9, color: counts[i] ? C.text : C.mut2, width: 14, textAlign: "right" }}>{counts[i]}</div>
        </div>
      ))}
    </div>
  );
}

// ── Master Agent status bar ───────────────────────────────────────────────────
function MasterAgentBar({ processing, registrySize, totalReuses, tokensaved }:
  { processing: ProcessingAgent[]; registrySize: number; totalReuses: number; tokensaved: number }) {
  const active   = processing.filter(a => !a.done);
  const pending  = processing.filter(a => a.approval === "pending").length;

  return (
    <div style={{ background: `${C.purple}0A`, borderBottom: `1px solid ${C.purple}28`, padding: "8px 20px", display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
      {/* Master agent identity */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: `${C.purple}18`, border: `1px solid ${C.purple}40`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 13, color: C.purple }}>◈</span>
        </div>
        <div>
          <div className="soc-mono" style={{ fontSize: 10, fontWeight: 700, color: C.purple, textTransform: "uppercase", letterSpacing: 0.8 }}>Master Agent</div>
          <div className="soc-mono" style={{ fontSize: 9, color: C.mut2 }}>routing &amp; orchestration</div>
        </div>
      </div>

      <div style={{ width: 1, height: 28, background: `${C.purple}30`, flexShrink: 0 }} />

      {/* Active routing */}
      {active.length > 0 ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
          {active.slice(0, 5).map(a => (
            <div key={a.procId} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 6, background: `${a.childAgent.color}10`, border: `1px solid ${a.childAgent.color}30` }}>
              <span style={{ fontSize: 10, color: a.childAgent.color }}>{a.childAgent.icon}</span>
              <span className="soc-mono" style={{ fontSize: 9, color: a.childAgent.color, fontWeight: 700 }}>{a.childAgent.shortLabel}</span>
              <span className="soc-mono" style={{ fontSize: 9, color: C.mut2 }}>← {a.procId}</span>
              {a.isFirstRun && <span style={{ fontSize: 8, color: C.purple, background: `${C.purple}18`, border: `1px solid ${C.purple}30`, borderRadius: 3, padding: "0 4px" }}>AI</span>}
              {!a.isFirstRun && <span style={{ fontSize: 8, color: C.ok, background: `${C.ok}12`, border: `1px solid ${C.ok}28`, borderRadius: 3, padding: "0 4px" }}>REUSE</span>}
            </div>
          ))}
          {active.length > 5 && <span className="soc-mono" style={{ fontSize: 9, color: C.mut2, alignSelf: "center" }}>+{active.length - 5} more</span>}
        </div>
      ) : (
        <div className="soc-mono" style={{ fontSize: 10, color: C.mut2, flex: 1 }}>idle — waiting for alerts</div>
      )}

      {/* Stats */}
      <div style={{ display: "flex", gap: 14, flexShrink: 0 }}>
        <div style={{ textAlign: "center" }}>
          <div className="soc-mono" style={{ fontSize: 16, fontWeight: 700, color: C.purple }}>{registrySize}</div>
          <div style={{ fontSize: 8.5, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.4 }}>Agents Trained</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div className="soc-mono" style={{ fontSize: 16, fontWeight: 700, color: C.ok }}>{totalReuses}</div>
          <div style={{ fontSize: 8.5, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.4 }}>Skills Reused</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div className="soc-mono" style={{ fontSize: 16, fontWeight: 700, color: C.live }}>{tokensaved}</div>
          <div style={{ fontSize: 8.5, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.4 }}>Tokens Saved</div>
        </div>
        {pending > 0 && (
          <div style={{ textAlign: "center" }}>
            <div className="soc-mono" style={{ fontSize: 16, fontWeight: 700, color: C.high, animation: "soc-blink 1s infinite" }}>{pending}</div>
            <div style={{ fontSize: 8.5, color: C.high, textTransform: "uppercase", letterSpacing: 0.4 }}>Approval</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Agent Registry panel (left sidebar) ──────────────────────────────────────
function AgentRegistryPanel({ registryVersion }: { registryVersion: number }) {
  void registryVersion; // used only to trigger re-render
  const agents = Array.from(AGENT_REGISTRY.values()).sort((a, b) => b.trainedAt - a.trainedAt);

  return (
    <div style={{ width: 210, flexShrink: 0, borderRight: `1px solid ${C.line}`, display: "flex", flexDirection: "column", background: C.bg2, overflow: "hidden" }}>
      <div style={{ padding: "10px 12px 8px", borderBottom: `1px solid ${C.line}`, flexShrink: 0 }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.8 }}>Agent Registry</div>
        <div className="soc-mono" style={{ fontSize: 9, color: C.mut2, marginTop: 1 }}>{agents.length} specialized agent{agents.length !== 1 ? "s" : ""}</div>
      </div>

      <div className="soc-scroll" style={{ flex: 1, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        {agents.length === 0 && (
          <div style={{ padding: "24px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 22, marginBottom: 8, opacity: 0.3 }}>◈</div>
            <div className="soc-mono" style={{ fontSize: 10, color: C.mut2, lineHeight: 1.5 }}>No agents trained yet.<br />Ingest alerts to start.</div>
          </div>
        )}
        {agents.map(a => (
          <div key={a.alertType} style={{ padding: "10px 10px", borderRadius: 9, background: C.panel, border: `1px solid ${a.color}28` }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
              <div style={{ width: 24, height: 24, borderRadius: 6, background: `${a.color}18`, border: `1px solid ${a.color}35`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span className="soc-mono" style={{ fontSize: 10, color: a.color, fontWeight: 700 }}>{AGENT_CONFIG[a.alertType]?.icon ?? "◇"}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: a.color, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.label}</div>
                <div className="soc-mono" style={{ fontSize: 8.5, color: C.mut2 }}>trained {new Date(a.trainedAt).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit" })}</div>
              </div>
            </div>

            {/* Reuse count */}
            <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
              <span style={{ padding: "2px 7px", borderRadius: 20, background: `${C.ok}12`, border: `1px solid ${C.ok}28`, fontSize: 9.5, color: C.ok, fontWeight: 700 }}>
                {a.reuseCount}× reused
              </span>
              <span style={{ padding: "2px 7px", borderRadius: 20, background: `${C.purple}10`, border: `1px solid ${C.purple}28`, fontSize: 9, color: C.purple }}>
                AI trained
              </span>
            </div>

            {/* Skills preview */}
            <div style={{ fontSize: 9.5, color: C.mut2, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Skills</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
              {a.investigationSteps.slice(0, 2).map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
                  <span style={{ color: a.color, fontSize: 9, flexShrink: 0, marginTop: 1 }}>›</span>
                  <span style={{ fontSize: 9.5, color: C.mut, lineHeight: 1.4 }}>{s}</span>
                </div>
              ))}
            </div>
            {/* Techniques */}
            {a.commonTechniques.length > 0 && (
              <div style={{ display: "flex", gap: 3, marginTop: 6, flexWrap: "wrap" }}>
                {a.commonTechniques.slice(0, 2).map(t => (
                  <span key={t} className="soc-mono" style={{ fontSize: 8, color: C.med, background: `${C.med}10`, border: `1px solid ${C.med}25`, borderRadius: 4, padding: "1px 4px" }}>
                    {t.split(":")[0]?.trim()}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Mind Map SVG ──────────────────────────────────────────────────────────────
function MindMapGraph({ ins, alert, agentColor }: { ins: InsightAnalysis; alert: AlertQueueItem; agentColor: string }) {
  const W = 700, H = 320;
  const cx = 280, cy = 160; // center of incident node

  type Cat = { label: string; color: string; nx: number; ny: number; children: string[] };
  const cats: Cat[] = [
    {
      label: "Threat Actor", color: "#f87171", nx: cx - 15, ny: 38,
      children: [ins.threatActorProfile.slice(0, 45) + (ins.threatActorProfile.length > 45 ? "…" : "")],
    },
    {
      label: "Attack Chain", color: "#fbbf24", nx: cx + 195, ny: 58,
      children: ins.attackChain.slice(0, 3).map(s => (s.length > 32 ? s.slice(0, 32) + "…" : s)),
    },
    {
      label: "IOCs", color: "#a78bfa", nx: cx + 215, ny: 162,
      children: ins.iocs.slice(0, 3),
    },
    {
      label: "Remediation", color: "#34d399", nx: cx + 180, ny: 268,
      children: ins.recommendations.slice(0, 2).map(s => (s.length > 30 ? s.slice(0, 30) + "…" : s)),
    },
    {
      label: "Assets", color: "#38bdf8", nx: cx - 205, ny: 162,
      children: [alert.sourceHost, alert.sourceUser, `${alert.destHost || alert.destIp}:${alert.destPort}`].filter(Boolean).slice(0, 3),
    },
  ];

  // Node sizing helpers
  const nodeW = 90, nodeH = 26;
  const leafW = 140, leafH = 20;

  // Line from center to category node
  function centerLine(cat: Cat) {
    const ex = cat.nx + nodeW / 2, ey = cat.ny + nodeH / 2;
    return `M ${cx} ${cy} Q ${(cx + ex) / 2} ${(cy + ey) / 2 + (ey < cy ? -20 : 20)} ${ex} ${ey}`;
  }

  // Leaf node positions spread from category
  function leafPos(cat: Cat, i: number, total: number): [number, number] {
    const isRight = cat.nx > cx;
    const isTop   = cat.ny < cy - 40;
    const isLeft  = cat.nx < cx;
    const lx = isRight ? cat.nx + nodeW + 14
      : isLeft ? cat.nx - leafW - 14
      : cat.nx - leafW / 2 + 5;
    const spacing = 26;
    const totalH  = (total - 1) * spacing;
    const startY  = cat.ny + nodeH / 2 - totalH / 2 + i * spacing;
    const ly = isTop ? cat.ny - leafH - 8 + i * (leafH + 4) : startY;
    return [lx, ly - leafH / 2];
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", minWidth: 400 }}>
        <defs>
          <filter id="mm-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Category curves + nodes + leaves */}
        {cats.map((cat) => {
          const catCx = cat.nx + nodeW / 2;
          const catCy = cat.ny + nodeH / 2;
          return (
            <g key={cat.label}>
              {/* Line: center → category */}
              <path d={centerLine(cat)} fill="none" stroke={cat.color} strokeWidth={1.5} strokeOpacity={0.5} strokeDasharray="4 3" />

              {/* Category node */}
              <rect x={cat.nx} y={cat.ny} width={nodeW} height={nodeH} rx={6} fill={`${cat.color}18`} stroke={cat.color} strokeWidth={1} strokeOpacity={0.6} />
              <text x={catCx} y={cat.ny + nodeH / 2 + 4} textAnchor="middle" fill={cat.color} fontSize={9} fontWeight="700" fontFamily="'Space Grotesk',sans-serif" style={{ textTransform: "uppercase", letterSpacing: 0.4 }}>
                {cat.label}
              </text>

              {/* Leaf nodes */}
              {cat.children.map((child, i) => {
                const [lx, ly] = leafPos(cat, i, cat.children.length);
                const lcx = lx + leafW / 2, lcy = ly + leafH / 2;
                return (
                  <g key={i}>
                    {/* Line: category → leaf */}
                    <line x1={catCx} y1={catCy} x2={lcx} y2={lcy} stroke={cat.color} strokeWidth={1} strokeOpacity={0.3} />
                    {/* Leaf node */}
                    <rect x={lx} y={ly} width={leafW} height={leafH} rx={4} fill={`${cat.color}0C`} stroke={cat.color} strokeWidth={0.75} strokeOpacity={0.35} />
                    <text x={lcx} y={ly + leafH / 2 + 3.5} textAnchor="middle" fill={C.mut} fontSize={8} fontFamily="'JetBrains Mono',monospace">
                      {child}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Center: incident node */}
        <ellipse cx={cx} cy={cy} rx={54} ry={30} fill={`${agentColor}15`} stroke={agentColor} strokeWidth={2} filter="url(#mm-glow)" />
        <text x={cx} y={cy - 6} textAnchor="middle" fill={agentColor} fontSize={8.5} fontWeight="700" fontFamily="'Space Grotesk',sans-serif" style={{ textTransform: "uppercase" }}>INCIDENT</text>
        <text x={cx} y={cy + 7} textAnchor="middle" fill={C.text} fontSize={7.5} fontFamily="'JetBrains Mono',monospace">
          {alert.techniqueId || "—"}
        </text>
        <text x={cx} y={cy + 17} textAnchor="middle" fill={C.mut2} fontSize={7} fontFamily="'Space Grotesk',sans-serif">
          risk {ins.riskScore}
        </text>

        {/* Legend */}
        <text x={W - 10} y={H - 8} textAnchor="end" fill={C.mut2} fontSize={7.5} fontFamily="'Space Grotesk',sans-serif">
          {ins.verdict} · {ins.confidence}% confidence
        </text>
      </svg>
    </div>
  );
}

// ── Sample Queries panel ──────────────────────────────────────────────────────
function SampleQueriesPanel({ queries, agentColor }: { queries: InsightAnalysis["sampleQueries"]; agentColor: string }) {
  const [tab, setTab] = useState<"splunk" | "kql">("splunk");
  const [copied, setCopied] = useState<number | null>(null);

  const list = tab === "splunk" ? queries.splunk : queries.kql;

  function copyQ(i: number, q: string) {
    navigator.clipboard.writeText(q).catch(() => {});
    setCopied(i);
    setTimeout(() => setCopied(null), 1800);
  }

  return (
    <div>
      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {(["splunk", "kql"] as const).map(t => (
          <button key={t} className="soc-btn" onClick={() => setTab(t)}
            style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${tab === t ? agentColor + "60" : C.line}`, background: tab === t ? `${agentColor}12` : "transparent", color: tab === t ? agentColor : C.mut2, fontSize: 10, fontFamily: "'Space Grotesk',sans-serif", fontWeight: tab === t ? 700 : 400, cursor: "pointer", textTransform: "uppercase", letterSpacing: 0.5 }}>
            {t === "splunk" ? "Splunk SPL" : "KQL / Sentinel"}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 9, color: C.mut2, alignSelf: "center" }}>click query to copy</span>
      </div>

      {/* Query cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {list.map((q, i) => (
          <div key={i} className="soc-btn" onClick={() => copyQ(i, q)}
            style={{ position: "relative", background: C.bg2, border: `1px solid ${copied === i ? agentColor + "70" : C.line}`, borderRadius: 7, padding: "8px 36px 8px 10px", cursor: "pointer", transition: "border-color 0.2s" }}
            onMouseOver={e => (e.currentTarget.style.borderColor = agentColor + "50")}
            onMouseOut={e => (e.currentTarget.style.borderColor = copied === i ? agentColor + "70" : C.line)}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              <span className="soc-mono" style={{ fontSize: 8.5, color: agentColor, minWidth: 18, paddingTop: 1 }}>Q{i + 1}</span>
              <pre className="soc-mono" style={{ margin: 0, fontSize: 9.5, color: C.text, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-all", flex: 1 }}>{q}</pre>
            </div>
            <div style={{ position: "absolute", top: 7, right: 9, fontSize: 10, color: copied === i ? agentColor : C.mut2 }}>
              {copied === i ? "✓" : "⎘"}
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <div className="soc-mono" style={{ fontSize: 10, color: C.mut2 }}>No queries available for this alert type.</div>
        )}
      </div>
    </div>
  );
}

// ── Insight block ─────────────────────────────────────────────────────────────
function InsightBlock({ ins, alert, agentColor, isFirstRun, tab, onTabChange }: {
  ins: InsightAnalysis; alert: AlertQueueItem; agentColor: string; isFirstRun: boolean;
  tab: "analysis" | "mindmap" | "queries"; onTabChange: (t: "analysis" | "mindmap" | "queries") => void;
}) {
  const verdictColor = ins.verdict === "False Positive" ? C.mut : ins.verdict === "True Positive" ? C.crit : C.high;
  const TABS: { id: "analysis" | "mindmap" | "queries"; label: string; icon: string }[] = [
    { id: "analysis", label: "Analysis",  icon: "◎" },
    { id: "mindmap",  label: "Mind Map",  icon: "⬡" },
    { id: "queries",  label: "Queries",   icon: ">" },
  ];
  return (
    <div style={{ marginTop: 10, borderRadius: 9, border: `1px solid ${agentColor}25`, overflow: "hidden", background: `${agentColor}06` }}>
      {/* Header row */}
      <div style={{ padding: "7px 11px", borderBottom: `1px solid ${agentColor}18`, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: agentColor, textTransform: "uppercase", letterSpacing: 0.6 }}>
          {isFirstRun ? "AI Deep Analysis" : "Skills-Based Analysis"}
        </span>
        <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 10, background: isFirstRun ? `${C.purple}18` : `${C.ok}12`, border: `1px solid ${isFirstRun ? C.purple : C.ok}30`, color: isFirstRun ? C.purple : C.ok }}>
          {isFirstRun ? "GROQ AI" : "CACHED — 0 TOKENS"}
        </span>
        {/* Tab switcher */}
        <div style={{ display: "flex", gap: 3, marginLeft: 8 }}>
          {TABS.map(t => (
            <button key={t.id} className="soc-btn" onClick={() => onTabChange(t.id)}
              style={{ display: "flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 5, border: `1px solid ${tab === t.id ? agentColor + "55" : C.line}`, background: tab === t.id ? `${agentColor}15` : "transparent", color: tab === t.id ? agentColor : C.mut2, fontSize: 8.5, fontFamily: "'Space Grotesk',sans-serif", cursor: "pointer" }}>
              <span style={{ fontSize: 9 }}>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
        <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, color: verdictColor }}>{ins.verdict}</span>
        <span className="soc-mono" style={{ fontSize: 9, color: C.mut2 }}>{ins.confidence}% conf</span>
        <div style={{ padding: "1px 6px", borderRadius: 4, background: `${verdictColor}15`, border: `1px solid ${verdictColor}30` }}>
          <span className="soc-mono" style={{ fontSize: 9, color: verdictColor }}>risk {ins.riskScore}</span>
        </div>
      </div>

      <div style={{ padding: "9px 11px" }}>
        {/* ── Analysis tab ── */}
        {tab === "analysis" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <div style={{ fontSize: 8.5, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3, fontWeight: 600 }}>Threat Actor Profile</div>
              <div style={{ fontSize: 10.5, color: C.mut, lineHeight: 1.5 }}>{ins.threatActorProfile}</div>
            </div>
            <div>
              <div style={{ fontSize: 8.5, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, fontWeight: 600 }}>Attack Chain</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {ins.attackChain.map((step, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <div style={{ width: 14, height: 14, borderRadius: 3, background: `${agentColor}18`, border: `1px solid ${agentColor}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>
                      <span className="soc-mono" style={{ fontSize: 8, color: agentColor, fontWeight: 700 }}>{i + 1}</span>
                    </div>
                    <span style={{ fontSize: 10, color: C.mut, lineHeight: 1.4 }}>{step}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 8.5, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, fontWeight: 600 }}>IOCs</div>
                {ins.iocs.map((ioc, i) => (
                  <div key={i} className="soc-mono" style={{ fontSize: 9.5, color: C.high, marginBottom: 2, wordBreak: "break-all" }}>› {ioc}</div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 8.5, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, fontWeight: 600 }}>Recommendations</div>
                {ins.recommendations.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 4, marginBottom: 2 }}>
                    <span style={{ color: C.live, fontSize: 9 }}>✓</span>
                    <span style={{ fontSize: 9.5, color: C.live, lineHeight: 1.4 }}>{r}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: "6px 8px", borderRadius: 6, background: `${C.purple}08`, border: `1px solid ${C.purple}18` }}>
              <span className="soc-mono" style={{ fontSize: 9, color: C.purple }}>reasoning </span>
              <span style={{ fontSize: 9.5, color: C.mut, lineHeight: 1.4 }}>{ins.reasoning}</span>
            </div>
          </div>
        )}

        {/* ── Mind Map tab ── */}
        {tab === "mindmap" && (
          <div>
            <div style={{ fontSize: 9, color: C.mut2, marginBottom: 8 }}>Investigation graph — attack path, IOCs, and affected assets.</div>
            <MindMapGraph ins={ins} alert={alert} agentColor={agentColor} />
          </div>
        )}

        {/* ── Queries tab ── */}
        {tab === "queries" && (
          <div>
            <div style={{ fontSize: 9, color: C.mut2, marginBottom: 8 }}>Ready-to-run investigation queries populated with this alert's values.</div>
            <SampleQueriesPanel queries={ins.sampleQueries ?? { splunk: [], kql: [] }} agentColor={agentColor} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Incident card ─────────────────────────────────────────────────────────────
function IncidentCard({ a, reduced, onDecide, onToggleInsights, onTabChange }: {
  a: ProcessingAgent; reduced: boolean;
  onDecide: (id: string, ok: boolean) => void;
  onToggleInsights: (id: string) => void;
  onTabChange: (id: string, tab: "analysis" | "mindmap" | "queries") => void;
}) {
  const al        = a.alert;
  const sevColor  = SEV_COLOR[al.severity] ?? C.mut2;
  const stage     = STAGES[a.stageIdx];
  const working   = !a.done && a.approval !== "pending" && !a.analyzing;
  const acColor   = a.childAgent.color;

  return (
    <div className="soc-card" style={{
      background: C.panel, borderRadius: 12, padding: 14, position: "relative", overflow: "hidden",
      border: `1px solid ${a.approval === "pending" ? C.high : a.analyzing ? C.purple : a.done ? C.liveDim : C.line}`,
      opacity: a.done ? 0.65 : 1, transition: "opacity 0.4s, border-color 0.3s",
    }}>
      {/* Active shimmer */}
      {(working || a.analyzing) && !reduced && (
        <div style={{ position: "absolute", top: 0, left: 0, height: 2, width: "30%", background: `linear-gradient(90deg, transparent, ${a.analyzing ? C.purple : acColor}, transparent)`, animation: "soc-sweep 2s linear infinite" }} />
      )}

      {/* Row 1: severity + procId + agent badge + source + sev chip */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7, flexWrap: "wrap" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: sevColor, boxShadow: `0 0 6px ${sevColor}`, flexShrink: 0 }} />
        <span className="soc-mono" style={{ fontSize: 10.5, fontWeight: 700, color: C.text }}>{a.procId}</span>

        {/* Child agent badge */}
        <span style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 7px", borderRadius: 5, background: `${acColor}12`, border: `1px solid ${acColor}35` }}>
          <span style={{ fontSize: 9.5, color: acColor }}>{a.childAgent.icon}</span>
          <span className="soc-mono" style={{ fontSize: 8.5, color: acColor, fontWeight: 700 }}>{a.childAgent.shortLabel}</span>
          {a.isFirstRun
            ? <span style={{ fontSize: 7.5, color: C.purple, background: `${C.purple}18`, borderRadius: 3, padding: "0 3px" }}>AI</span>
            : <span style={{ fontSize: 7.5, color: C.ok, background: `${C.ok}12`, borderRadius: 3, padding: "0 3px" }}>REUSE</span>
          }
        </span>

        <span style={{ flex: 1 }} />
        <SourceBadge source={a.source} />
        <span className="soc-mono" style={{ fontSize: 8.5, color: sevColor, border: `1px solid ${sevColor}40`, borderRadius: 20, padding: "1px 7px", background: `${sevColor}12`, textTransform: "uppercase" }}>{al.severity}</span>
      </div>

      {/* Row 2: Alert title */}
      <div style={{ fontSize: 12, fontWeight: 600, color: C.text, lineHeight: 1.3, marginBottom: 5 }}>{al.title}</div>

      {/* Row 3: Tags */}
      <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
        {al.techniqueId && <span className="soc-mono" style={{ fontSize: 8.5, color: C.med, background: `${C.med}12`, border: `1px solid ${C.med}28`, borderRadius: 4, padding: "1px 5px" }}>{al.techniqueId}</span>}
        {al.tactic      && <span className="soc-mono" style={{ fontSize: 8.5, color: C.purple, background: `${C.purple}12`, border: `1px solid ${C.purple}28`, borderRadius: 4, padding: "1px 5px" }}>{al.tactic}</span>}
        <span className="soc-mono" style={{ fontSize: 8.5, color: C.mut2 }}>{al.sourceHost || al.sourceIp}</span>
      </div>

      {/* Pipeline bar */}
      <div style={{ marginBottom: 6 }}>
        <div style={{ display: "flex", gap: 2, marginBottom: 2 }}>
          {STAGES.map((s, i) => {
            const done = i < a.stageIdx || a.done;
            const cur  = i === a.stageIdx && !a.done;
            const isInsight = s === "Insight";
            return (
              <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, transition: "background 0.3s",
                background: done ? C.live : cur ? (a.analyzing ? C.purple : isInsight ? `${C.purple}80` : C.liveDim) : C.line,
                animation: cur && !reduced ? "soc-blink 1.3s ease-in-out infinite" : "none" }} title={s} />
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {STAGES.map(s => (
            <div key={s} style={{ flex: 1, fontSize: 7, color: C.mut2, textAlign: "center", textTransform: "uppercase", letterSpacing: 0.2 }}>{s[0]}</div>
          ))}
        </div>
      </div>

      {/* Status note */}
      <div className="soc-mono" style={{ fontSize: 10, color: a.analyzing ? C.purple : working ? acColor : C.mut, minHeight: 15, display: "flex", alignItems: "center", gap: 5 }}>
        {(working || a.analyzing) && !reduced && <span style={{ width: 5, height: 5, borderRadius: "50%", background: a.analyzing ? C.purple : acColor, animation: "soc-pulse 1s ease-in-out infinite", flexShrink: 0 }} />}
        {stage} · {a.note}
      </div>

      {/* 5-min analysis progress bar */}
      {a.analyzing && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <div className="soc-mono" style={{ fontSize: 8.5, color: C.purple }}>{a.analyzeSubstage || "analyzing…"}</div>
            <div className="soc-mono" style={{ fontSize: 8.5, color: C.purple }}>{a.analyzeProgress}%</div>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: C.line, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${a.analyzeProgress}%`, background: `linear-gradient(90deg, ${C.purple}, ${C.live})`, borderRadius: 3, transition: "width 0.8s ease" }} />
          </div>
          <div className="soc-mono" style={{ fontSize: 8, color: C.mut2, marginTop: 3 }}>
            {a.childAgent.label} · deep investigation mode · ~5 min
          </div>
        </div>
      )}

      {/* Show insights button */}
      {a.insights && (
        <button className="soc-btn" onClick={() => onToggleInsights(a.procId)}
          style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 5, background: "transparent", border: `1px solid ${acColor}30`, borderRadius: 6, padding: "4px 10px", color: acColor, fontSize: 10, fontFamily: "inherit", cursor: "pointer", width: "100%" }}>
          <span style={{ fontSize: 11 }}>{a.showInsights ? "▲" : "▼"}</span>
          {a.showInsights ? "Hide" : "Show"} {a.isFirstRun ? "AI" : "Cached"} Analysis · Mind Map · Queries
          {!a.isFirstRun && <span style={{ marginLeft: "auto", fontSize: 8.5, color: C.ok }}>0 tokens used</span>}
        </button>
      )}

      {/* Insight block — with tab support */}
      {a.insights && a.showInsights && (
        <InsightBlock ins={a.insights} alert={a.alert} agentColor={acColor} isFirstRun={a.isFirstRun}
          tab={a.insightTab} onTabChange={(t) => onTabChange(a.procId, t)} />
      )}

      {/* Approval gate */}
      {a.approval === "pending" && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${C.high}40`, paddingTop: 10 }}>
          <div style={{ fontSize: 10, color: C.high, marginBottom: 8, display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.high, animation: reduced ? "none" : "soc-blink 1s infinite", flexShrink: 0 }} />
            Destructive containment — analyst approval required
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="soc-btn" onClick={() => onDecide(a.procId, true)}
              style={{ flex: 1, fontFamily: "inherit", fontSize: 11, fontWeight: 600, color: C.bg, background: C.live, border: "none", borderRadius: 7, padding: "8px 0", cursor: "pointer" }}>Approve</button>
            <button className="soc-btn" onClick={() => onDecide(a.procId, false)}
              style={{ flex: 1, fontFamily: "inherit", fontSize: 11, fontWeight: 600, color: C.text, background: "transparent", border: `1px solid ${C.lineHi}`, borderRadius: 7, padding: "8px 0", cursor: "pointer" }}>Escalate</button>
          </div>
        </div>
      )}

      {/* Resolved verdict footer */}
      {a.done && a.insights && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, borderTop: `1px solid ${C.line}`, paddingTop: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: a.insights.verdict === "False Positive" ? C.mut : C.ok }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: a.insights.verdict === "False Positive" ? C.mut : C.ok }}>{a.insights.verdict}</span>
          {a.mttr != null && <span className="soc-mono" style={{ fontSize: 9.5, color: C.mut2, marginLeft: "auto" }}>{a.mttr}s MTTR</span>}
        </div>
      )}
    </div>
  );
}

// ── Ingestion dropdown ────────────────────────────────────────────────────────
function IngestionDropdown({ active, onSelect }: { active: SourceId | null; onSelect: (id: SourceId | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const selected = SOURCE_OPTIONS.find(s => s.id === active);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="soc-btn" onClick={() => setOpen(o => !o)} style={{
        display: "flex", alignItems: "center", gap: 8, height: 34, padding: "0 12px",
        borderRadius: 8, border: `1px solid ${active ? (selected?.color ?? C.live) + "55" : C.lineHi}`,
        background: active ? `${selected?.color ?? C.live}0E` : C.panelHi, cursor: "pointer", fontFamily: "inherit",
      }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>Alert Ingestion</span>
        {active && (
          <>
            <span style={{ width: 1, height: 12, background: C.lineHi }} />
            <span className="soc-mono" style={{ fontSize: 10.5, color: selected?.color, fontWeight: 700 }}>{selected?.icon}</span>
            <span style={{ fontSize: 10.5, color: selected?.color, fontWeight: 600, whiteSpace: "nowrap" }}>{selected?.label}</span>
          </>
        )}
        <svg width="9" height="9" viewBox="0 0 10 10" style={{ color: C.mut2, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.18s" }}>
          <polyline points="1,3 5,7 9,3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: 230, background: C.panel, border: `1px solid ${C.lineHi}`, borderRadius: 10, overflow: "hidden", zIndex: 999, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", animation: "soc-in 0.15s ease both" }}>
          <div style={{ padding: "8px 12px 6px", borderBottom: `1px solid ${C.line}`, fontSize: 9.5, fontWeight: 700, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.6 }}>Select source</div>
          {SOURCE_OPTIONS.map(opt => {
            const isCur = active === opt.id;
            return (
              <button key={opt.id} className="soc-btn" onClick={() => { onSelect(isCur ? null : opt.id); setOpen(false); }}
                style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", border: "none", background: isCur ? `${opt.color}10` : "transparent", cursor: "pointer", fontFamily: "inherit", borderBottom: `1px solid ${C.line}`, borderLeft: isCur ? `3px solid ${opt.color}` : "3px solid transparent" }}
                onMouseOver={e => { if (!isCur) e.currentTarget.style.background = `${C.lineHi}50`; }}
                onMouseOut={e  => { e.currentTarget.style.background = isCur ? `${opt.color}10` : "transparent"; }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: `${opt.color}15`, border: `1px solid ${opt.color}28`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span className="soc-mono" style={{ fontSize: 12, color: opt.color, fontWeight: 700 }}>{opt.icon}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: isCur ? opt.color : C.text, marginBottom: 1 }}>{opt.label}</div>
                  <div style={{ fontSize: 9.5, color: C.mut2 }}>{opt.desc}</div>
                </div>
                {isCur && <span style={{ fontSize: 11, color: opt.color }}>✓</span>}
              </button>
            );
          })}
          {active && (
            <button className="soc-btn" onClick={() => { onSelect(null); setOpen(false); }}
              style={{ width: "100%", textAlign: "center", padding: "7px 12px", border: "none", background: "transparent", cursor: "pointer", fontSize: 10, color: C.mut2, fontFamily: "inherit" }}>
              ✕ Dismiss panel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Ingestion panel (slide-in) ────────────────────────────────────────────────
function IngestionPanel({ source, onIngest }: { source: SourceId | null; onIngest: (a: AlertQueueItem, src: ProcessingAgent["source"]) => void }) {
  const alertQueue = useStore(s => s.alertQueue);
  const [json, setJson] = useState("");
  const [err,  setErr]  = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = alertQueue.filter(a => a.status === "new").length;
  const opt = SOURCE_OPTIONS.find(s => s.id === source);
  const PANEL_H = source === "paste" ? 190 : source === "siem" ? 172 : 110;

  const handlePaste = () => {
    try {
      const parsed = JSON.parse(json.trim());
      const alerts = Array.isArray(parsed) ? parsed : [parsed];
      let ok = 0;
      alerts.forEach(raw => { const a = normalise(raw, "paste"); if (a) { onIngest(a, "paste"); ok++; } });
      setErr(ok ? "" : "Could not normalise — check JSON structure");
      if (ok) setJson("");
    } catch (e) { setErr("Invalid JSON: " + String(e)); }
  };
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parsed = JSON.parse(String(ev.target?.result ?? "{}"));
        const alerts = Array.isArray(parsed) ? parsed : [parsed];
        alerts.forEach(raw => { const a = normalise(raw, "upload"); if (a) onIngest(a, "upload"); });
        setErr("");
      } catch { setErr("Failed to parse file"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div style={{ overflow: "hidden", maxHeight: source ? PANEL_H : 0, transition: "max-height 0.26s cubic-bezier(0.4,0,0.2,1)", borderBottom: source ? `1px solid ${C.line}` : "none", background: C.bg2 }}>
      {source && (
        <div style={{ padding: "12px 20px", display: "flex", gap: 14, alignItems: "flex-start" }}>
          <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 2 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: `${opt?.color}14`, border: `1px solid ${opt?.color}28`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="soc-mono" style={{ fontSize: 13, color: opt?.color, fontWeight: 700 }}>{opt?.icon}</span>
            </div>
            <div className="soc-mono" style={{ fontSize: 8, color: opt?.color, textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" }}>{opt?.label}</div>
          </div>
          <div style={{ width: 1, background: C.line, alignSelf: "stretch", flexShrink: 0 }} />

          {source === "gen" && (
            <div style={{ flex: 1, display: "flex", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderRadius: 8, background: C.panel, border: `1px solid ${pending > 0 ? C.live + "50" : C.line}`, minWidth: 190 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: pending > 0 ? C.live : C.mut2, animation: pending > 0 ? "soc-pulse 1.5s ease-in-out infinite" : "none", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: C.text }}>Alert Generator feed</div>
                  <div className="soc-mono" style={{ fontSize: 9.5, color: pending > 0 ? C.live : C.mut2 }}>{pending > 0 ? `${pending} alert${pending !== 1 ? "s" : ""} pending` : "queue empty"}</div>
                </div>
              </div>
              <div style={{ flex: 1, padding: "7px 11px", borderRadius: 8, background: `${C.live}07`, border: `1px solid ${C.live}18`, fontSize: 10, color: C.mut, lineHeight: 1.55 }}>
                Alerts from the <span style={{ color: C.amber }}>Alert Generator</span> tab are picked up automatically. Master Agent assigns a specialized child agent per alert type — same type reuses cached skills with zero AI tokens.
              </div>
            </div>
          )}
          {source === "paste" && (
            <div style={{ flex: 1, display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: C.mut2, marginBottom: 5 }}>Paste any SIEM JSON — native or Splunk / Elastic / Sentinel format.</div>
                <textarea value={json} onChange={e => setJson(e.target.value)} placeholder='{ "title": "...", "severity": "HIGH", ... }' spellCheck={false}
                  style={{ width: "100%", height: 80, background: C.panel, border: `1px solid ${err ? C.crit : C.line}`, borderRadius: 7, padding: 8, color: C.text, fontSize: 9.5, fontFamily: "'JetBrains Mono', monospace", resize: "none", outline: "none", lineHeight: 1.5, boxSizing: "border-box" }} />
                {err && <div style={{ fontSize: 9.5, color: C.crit, marginTop: 3 }}>{err}</div>}
              </div>
              <button className="soc-btn" onClick={handlePaste} disabled={!json.trim()}
                style={{ alignSelf: "flex-start", marginTop: 22, whiteSpace: "nowrap", fontFamily: "inherit", fontSize: 10.5, fontWeight: 600, padding: "8px 16px", borderRadius: 7, border: "none", background: json.trim() ? C.live : C.line, color: json.trim() ? C.bg : C.mut2, cursor: json.trim() ? "pointer" : "default" }}>
                Ingest
              </button>
            </div>
          )}
          {source === "upload" && (
            <div style={{ flex: 1, display: "flex", gap: 14 }}>
              <div className="soc-btn" onClick={() => fileRef.current?.click()}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: "14px 24px", borderRadius: 8, border: `2px dashed ${C.lineHi}`, cursor: "pointer", transition: "border-color 0.15s" }}
                onMouseOver={e => (e.currentTarget.style.borderColor = C.live)}
                onMouseOut={e => (e.currentTarget.style.borderColor = C.lineHi)}>
                <div style={{ fontSize: 20 }}>📂</div>
                <div style={{ fontSize: 10.5, color: C.mut }}>Choose .json file</div>
              </div>
              <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleFile} />
              <div style={{ flex: 1, fontSize: 10, color: C.mut, lineHeight: 1.5 }}>
                {err && <div style={{ color: C.crit, marginBottom: 5 }}>{err}</div>}
                Single alert object or JSON array. Supports native AlertQueueItem, Splunk, Elastic, Sentinel, or generic flat JSON.
              </div>
            </div>
          )}
          {source === "siem" && (
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {[
                { name: "Splunk SOAR",        lines: ["POST /api/atlas/ingest", "Alert Actions → Webhook", "Map payload to schema"] },
                { name: "Microsoft Sentinel", lines: ["Logic App → HTTP action", "Trigger: New incident",   "Body: map to schema"] },
                { name: "Elastic / Kibana",   lines: ["Alerting → Webhook",     "Action: Webhook connector","Map rule context to JSON"] },
              ].map(s => (
                <div key={s.name} style={{ padding: "9px 11px", borderRadius: 8, background: C.panel, border: `1px solid ${C.line}` }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: C.text, marginBottom: 6 }}>{s.name}</div>
                  {s.lines.map((l, i) => <div key={i} className="soc-mono" style={{ fontSize: 9, color: i === 0 ? C.live : C.mut2, marginBottom: 2 }}>{l}</div>)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Build a ResolvedIncident from a processing agent + insight ────────────────
function buildResolved(a: ProcessingAgent, ins: InsightAnalysis, mttr: number): ResolvedIncident {
  return {
    procId:             a.procId,
    alert:              a.alert,
    iocs:               ins.iocs,
    techniques:         [a.alert.techniqueId].filter(Boolean),
    verdict:            ins.verdict,
    riskScore:          ins.riskScore,
    confidence:         ins.confidence,
    mttr,
    resolvedAt:         Date.now(),
    agentLabel:         a.childAgent.label,
    agentColor:         a.childAgent.color,
    isFirstRun:         a.isFirstRun,
    attackChain:        ins.attackChain,
    recommendations:    ins.recommendations,
    threatActorProfile: ins.threatActorProfile,
  };
}

// ── Main view ─────────────────────────────────────────────────────────────────
let PROC_ID = 100;
const APPROX_TOKENS_PER_CALL = 400;

export default function AgenticSOCOperationView() {
  const alertQueue             = useStore(s => s.alertQueue);
  const updateAlertStatus      = useStore(s => s.updateAlertStatus);
  const pushResolvedIncident   = useStore(s => s.pushResolvedIncident);

  const [processing,   setProcessing]   = useState<ProcessingAgent[]>([]);
  const [log,          setLog]          = useState<LogEntry[]>([]);
  const [metrics,      setMetrics]      = useState<Metrics>({ tp: 0, fp: 0, escalated: 0, totalMttr: 0, resolved: 0 });
  const [reduced,      setReduced]      = useState(false);
  const apiKey        = useStore(s => s.apiKey);
  const [activeSource, setActiveSource] = useState<SourceId | null>("gen");
  const [regVersion,   setRegVersion]   = useState(0); // bump to re-render registry

  const processedIds = useRef(new Set<string>());
  const logRef       = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
  }, []);
  const pushLog = useCallback((procId: string, sev: string, msg: string) => {
    setLog(l => [{ t: Date.now(), procId, sev, msg }, ...l].slice(0, 120));
  }, []);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = 0; }, [log.length]);

  const ingest = useCallback((alert: AlertQueueItem, source: ProcessingAgent["source"]) => {
    const procId      = `SOC-${++PROC_ID}`;
    const agentConf   = AGENT_CONFIG[alert.useCase] ?? AGENT_CONFIG.unknown;
    const hasSkills   = AGENT_REGISTRY.has(alert.useCase);
    const agent: ProcessingAgent = {
      procId, alert, source, childAgent: agentConf, isFirstRun: !hasSkills,
      stageIdx: 0, note: STAGE_NOTES.Triage[0], insights: null, approval: null,
      spawnAt: Date.now(), done: false, mttr: null, analyzing: false,
      analyzeProgress: 0, analyzeSubstage: "", showInsights: false, insightTab: "analysis",
    };
    setProcessing(prev => [agent, ...prev].slice(0, 14));
    pushLog(procId, alert.severity, `master agent → ${agentConf.label} [${hasSkills ? "skills cached" : "first run"}]`);
  }, [pushLog]);

  // Watch Zustand queue for new alerts from Alert Generator / background
  useEffect(() => {
    alertQueue.forEach(a => {
      if (a.status === "new" && !processedIds.current.has(a.id)) {
        processedIds.current.add(a.id);
        updateAlertStatus(a.id, "acknowledged");
        ingest(a, "alert-gen");
      }
    });
  }, [alertQueue, ingest, updateAlertStatus]);

  // 5-minute analysis progress ticker (runs independently of pipeline tick)
  useEffect(() => {
    const progressTick = setInterval(() => {
      setProcessing(prev =>
        prev.map(a => {
          if (!a.analyzing) return a;
          const newProgress = Math.min(a.analyzeProgress + (2 + Math.random() * 3), 95);
          const substageIdx = Math.floor((newProgress / 100) * INSIGHT_SUBSTAGES.length);
          const substage    = INSIGHT_SUBSTAGES[Math.min(substageIdx, INSIGHT_SUBSTAGES.length - 1)];
          return { ...a, analyzeProgress: Math.round(newProgress), analyzeSubstage: substage };
        })
      );
    }, 3000); // tick every 3s so 95% takes ~60-90s (visual 5-min feel at 3s intervals)
    return () => clearInterval(progressTick);
  }, []);

  // Pipeline tick
  useEffect(() => {
    const tick = setInterval(() => {
      setProcessing(prev =>
        prev.map(a => {
          if (a.done || a.approval === "pending" || a.analyzing) return a;

          // 30% chance — rotate note only
          if (Math.random() < 0.30) {
            const notes = STAGE_NOTES[STAGES[a.stageIdx]] ?? [];
            return { ...a, note: notes[Math.floor(Math.random() * notes.length)] || a.note };
          }

          const cur = STAGES[a.stageIdx];

          // ── INSIGHT STAGE: agent analysis ────────────────────────────────
          if (cur === "Insight") {
            const skills = AGENT_REGISTRY.get(a.alert.useCase);

            if (skills) {
              // REUSE — apply cached skills, zero AI tokens
              const insights = applySkills(skills, a.alert);
              skills.reuseCount++;
              const mttr = Math.round((Date.now() - a.spawnAt) / 1000);
              pushLog(a.procId, a.alert.severity, `${skills.label} reuse #${skills.reuseCount} — 0 tokens, insight ready`);
              const needsApproval = insights.verdict !== "False Positive" && a.alert.severity === "CRITICAL";
              if (needsApproval) {
                return { ...a, insights, approval: "pending", note: "awaiting analyst approval", mttr, showInsights: true };
              }
              setMetrics(m => ({ ...m, tp: insights.verdict === "True Positive" ? m.tp + 1 : m.tp, fp: insights.verdict === "False Positive" ? m.fp + 1 : m.fp, totalMttr: m.totalMttr + mttr, resolved: m.resolved + 1 }));
              pushResolvedIncident(buildResolved({ ...a, isFirstRun: false }, insights, mttr));
              return { ...a, insights, stageIdx: 4, note: STAGE_NOTES.Respond[0], isFirstRun: false, showInsights: false, mttr };
            }

            if (apiKey.trim()) {
              // FIRST RUN — train agent with Groq (simulates 5-min deep analysis)
              pushLog(a.procId, a.alert.severity, `training ${a.childAgent.label} via Groq AI — deep analysis initiated`);
              setTimeout(async () => {
                try {
                  const result = await groqTrainAndAnalyze(apiKey.trim(), a.alert);
                  const newSkills: AgentSkills = {
                    alertType: a.alert.useCase, label: a.childAgent.label, color: a.childAgent.color,
                    trainedAt: Date.now(), reuseCount: 0, ...result.skills,
                  };
                  AGENT_REGISTRY.set(a.alert.useCase, newSkills);
                  setRegVersion(v => v + 1);

                  // Ensure sampleQueries exists (Groq may omit it)
                  const insight: InsightAnalysis = {
                    ...result.insight,
                    sampleQueries: result.insight.sampleQueries ?? heuristicQueries(a.alert),
                  };

                  const needsApproval = insight.verdict !== "False Positive" && a.alert.severity === "CRITICAL";
                  const mttr = Math.round((Date.now() - a.spawnAt) / 1000);
                  pushLog(a.procId, a.alert.severity, `${a.childAgent.label} trained — ${insight.verdict} (${insight.confidence}% conf)`);

                  setProcessing(prev => prev.map(ag => {
                    if (ag.procId !== a.procId) return ag;
                    if (needsApproval) {
                      pushLog(a.procId, a.alert.severity, "critical — awaiting analyst approval");
                      return { ...ag, insights: insight, approval: "pending", analyzing: false, analyzeProgress: 100, note: "destructive action — needs sign-off", isFirstRun: true, showInsights: true, mttr };
                    }
                    const isFP = insight.verdict === "False Positive";
                    setMetrics(m => ({ ...m, tp: !isFP ? m.tp + 1 : m.tp, fp: isFP ? m.fp + 1 : m.fp, totalMttr: m.totalMttr + mttr, resolved: m.resolved + 1 }));
                    updateAlertStatus(ag.alert.id, isFP ? "dismissed" : "dispatched");
                    pushResolvedIncident(buildResolved({ ...ag, isFirstRun: true }, insight, mttr));
                    return { ...ag, insights: insight, stageIdx: 4, analyzing: false, analyzeProgress: 100, note: STAGE_NOTES.Respond[0], isFirstRun: true, showInsights: true, mttr };
                  }));
                } catch (err) {
                  pushLog(a.procId, a.alert.severity, `training error: ${String(err).slice(0, 55)}`);
                  setProcessing(prev => prev.map(ag => ag.procId !== a.procId ? ag : { ...ag, analyzing: false, analyzeProgress: 0, stageIdx: 4, note: "analysis failed — proceeding" }));
                }
              }, 0);
              return { ...a, analyzing: true, analyzeProgress: 0, analyzeSubstage: INSIGHT_SUBSTAGES[0], note: `${a.childAgent.label} deep analysis running…`, isFirstRun: true };
            }

            // No API key — heuristic (instant)
            const mttr = Math.round((Date.now() - a.spawnAt) / 1000);
            const isFP = Math.random() < 0.2;
            const heuristic: InsightAnalysis = {
              threatActorProfile: "No API key — heuristic assessment only.",
              attackChain: [a.alert.title, `${a.alert.techniqueId} observed on ${a.alert.sourceHost}`],
              iocs: [a.alert.sourceIp, a.alert.destIp].filter(Boolean),
              riskScore: isFP ? 15 : 65, verdict: isFP ? "False Positive" : "Needs Review",
              confidence: 50, reasoning: "Add a Groq API key for AI-powered analysis.",
              recommendations: [a.alert.recommendedAction || "Review alert manually"],
              sampleQueries: heuristicQueries(a.alert),
            };
            setMetrics(m => ({ ...m, tp: !isFP ? m.tp + 1 : m.tp, fp: isFP ? m.fp + 1 : m.fp, totalMttr: m.totalMttr + mttr, resolved: m.resolved + 1 }));
            pushResolvedIncident(buildResolved(a, heuristic, mttr));
            return { ...a, insights: heuristic, stageIdx: 4, note: STAGE_NOTES.Respond[0], mttr };
          }

          // ── Advance stage ─────────────────────────────────────────────────
          const nextIdx   = Math.min(a.stageIdx + 1, STAGES.length - 1);
          const nextStage = STAGES[nextIdx];
          if (nextStage === "Resolved") {
            pushLog(a.procId, a.alert.severity, "incident resolved");
            return { ...a, stageIdx: nextIdx, done: true, note: "closed" };
          }
          pushLog(a.procId, a.alert.severity, `→ ${nextStage.toLowerCase()}`);
          return { ...a, stageIdx: nextIdx, note: (STAGE_NOTES[nextStage] ?? [])[0] || "" };
        })
      );
    }, 1700);
    return () => clearInterval(tick);
  }, [pushLog, apiKey, updateAlertStatus]);

  // Retire resolved cards after 16s
  useEffect(() => {
    const t = setInterval(() => {
      setProcessing(prev => prev.filter(a => !(a.done && Date.now() - a.spawnAt > 16000)));
    }, 3000);
    return () => clearInterval(t);
  }, []);

  const decide = useCallback((procId: string, ok: boolean) => {
    setProcessing(prev =>
      prev.map(a => {
        if (a.procId !== procId) return a;
        const mttr = Math.round((Date.now() - a.spawnAt) / 1000);
        if (ok) {
          pushLog(procId, a.alert.severity, "approved → containment executing");
          setMetrics(m => ({ ...m, tp: m.tp + 1, totalMttr: m.totalMttr + mttr, resolved: m.resolved + 1 }));
          updateAlertStatus(a.alert.id, "dispatched");
          if (a.insights) pushResolvedIncident(buildResolved(a, a.insights, mttr));
          return { ...a, approval: "approved", stageIdx: 4, note: STAGE_NOTES.Respond[1], mttr };
        }
        pushLog(procId, a.alert.severity, "escalated to human analyst");
        setMetrics(m => ({ ...m, escalated: m.escalated + 1, totalMttr: m.totalMttr + mttr, resolved: m.resolved + 1 }));
        updateAlertStatus(a.alert.id, "dismissed");
        return { ...a, approval: "rejected", stageIdx: 5, done: true, note: "escalated", mttr };
      })
    );
  }, [pushLog, updateAlertStatus]);

  const toggleInsights = useCallback((procId: string) => {
    setProcessing(prev => prev.map(a => a.procId === procId ? { ...a, showInsights: !a.showInsights } : a));
  }, []);

  const changeInsightTab = useCallback((procId: string, tab: "analysis" | "mindmap" | "queries") => {
    setProcessing(prev => prev.map(a => a.procId === procId ? { ...a, insightTab: tab } : a));
  }, []);

  const active       = processing.filter(a => !a.done).length;
  const pending      = processing.filter(a => a.approval === "pending").length;
  const avgMttr      = metrics.resolved > 0 ? Math.round(metrics.totalMttr / metrics.resolved) : 0;
  const fpRate       = metrics.resolved > 0 ? Math.round((metrics.fp / metrics.resolved) * 100) : 0;
  const hasApiKey    = apiKey.trim().length > 0;
  const registrySize = AGENT_REGISTRY.size;
  const totalReuses  = Array.from(AGENT_REGISTRY.values()).reduce((s, a) => s + a.reuseCount, 0);
  const tokensSaved  = totalReuses * APPROX_TOKENS_PER_CALL;

  return (
    <div style={{ fontFamily: "'Space Grotesk', sans-serif", background: C.bg, color: C.text, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{FONT}{`
        @keyframes soc-pulse { 0%,100%{opacity:.3;transform:scale(1)} 50%{opacity:1;transform:scale(1.45)} }
        @keyframes soc-in    { from{opacity:0;transform:translateY(-8px) scale(.97)} to{opacity:1;transform:none} }
        @keyframes soc-sweep { 0%{transform:translateX(-100%)} 100%{transform:translateX(370%)} }
        @keyframes soc-blink { 0%,100%{opacity:1} 50%{opacity:.15} }
        .soc-card  { animation: soc-in .35s ease both; }
        .soc-mono  { font-family: 'JetBrains Mono', monospace; }
        .soc-scroll::-webkit-scrollbar { width: 5px }
        .soc-scroll::-webkit-scrollbar-thumb { background: ${C.line}; border-radius: 3px }
        .soc-btn   { cursor: pointer; transition: all .12s ease; }
        .soc-btn:hover  { filter: brightness(1.15); }
        .soc-btn:active { transform: scale(.96); }
      `}</style>

      {/* ── Command bar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 18px", background: C.bg2, borderBottom: `1px solid ${C.line}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: C.panelHi, border: `1px solid ${C.lineHi}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: active > 0 ? C.live : C.mut2, animation: active > 0 && !reduced ? "soc-pulse 1.8s ease-in-out infinite" : "none" }} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, letterSpacing: 0.2 }}>Agentic SOC — Live Pipeline</div>
            <div className="soc-mono" style={{ fontSize: 9, color: C.mut2 }}>{active > 0 ? `${active} agent${active !== 1 ? "s" : ""} processing` : "idle — awaiting alerts"}</div>
          </div>
        </div>

        <div style={{ width: 1, height: 26, background: C.line }} />
        <IngestionDropdown active={activeSource} onSelect={setActiveSource} />
        <div style={{ width: 1, height: 26, background: C.line }} />

        <div style={{ flex: 1 }} />
        <Stat label="Ingested" value={metrics.tp + metrics.fp + metrics.escalated} color={C.text} />
        <div style={{ width: 1, height: 26, background: C.line }} />
        <Stat label="Active"   value={active}  color={C.live} />
        <Stat label="Approval" value={pending} color={pending ? C.high : C.mut2} blink={pending > 0} />
        <Stat label="Resolved" value={metrics.resolved} color={C.ok} />
      </div>

      {/* ── Ingestion panel ── */}
      <IngestionPanel source={activeSource} onIngest={ingest} />

      {/* ── Master agent bar ── */}
      <MasterAgentBar processing={processing} registrySize={registrySize} totalReuses={totalReuses} tokensaved={tokensSaved} />

      {/* ── Metrics bar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 18px", background: C.bg, borderBottom: `1px solid ${C.line}`, flexShrink: 0, overflowX: "auto" }}>
        <Chip label="Avg MTTR"  value={avgMttr > 0 ? `${avgMttr}s` : "—"} color={C.live} />
        <Chip label="True Pos"  value={metrics.tp}        color={C.ok}  />
        <Chip label="False Pos" value={metrics.fp}        color={C.mut} />
        <Chip label="Escalated" value={metrics.escalated} color={C.high}/>
        <Chip label="FP Rate"   value={fpRate > 0 ? `${fpRate}%` : "—"} color={fpRate > 40 ? C.crit : fpRate > 25 ? C.high : C.ok} />
        <Chip label="Agents"    value={registrySize}      color={C.purple} />
        <Chip label="Reuses"    value={totalReuses}       color={C.ok}  />
        <div style={{ flex: 1 }} />
        <div className="soc-mono" style={{ fontSize: 9, color: C.mut2 }}>
          {hasApiKey ? "🟢 AI analysis active" : "⚪ Heuristic — add Groq key"}
          {totalReuses > 0 && <span style={{ color: C.ok, marginLeft: 8 }}>· ~{tokensSaved.toLocaleString()} tokens saved</span>}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>

        {/* Agent Registry */}
        <AgentRegistryPanel registryVersion={regVersion} />

        {/* Incident board */}
        <div className="soc-scroll" style={{ flex: 1, overflowY: "auto", padding: 14, borderRight: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.9, color: C.mut2, fontWeight: 600 }}>Live Incident Board</div>
            <div className="soc-mono" style={{ fontSize: 9, color: C.mut2 }}>{active} active · {processing.filter(a => a.done).length} retiring</div>
          </div>

          {processing.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 260, textAlign: "center", gap: 10 }}>
              <div style={{ width: 44, height: 44, borderRadius: 11, background: `${C.purple}10`, border: `1px solid ${C.purple}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>◈</div>
              <div className="soc-mono" style={{ fontSize: 11.5, color: C.mut2 }}>Master Agent idle</div>
              <div style={{ fontSize: 10, color: C.mut2, maxWidth: 290 }}>
                Use <span style={{ color: C.amber }}>Alert Ingestion ▾</span> above to connect a source. Once alerts arrive, Master Agent assigns specialized child agents automatically.
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
              {processing.map(a => (
                <IncidentCard key={a.procId} a={a} reduced={reduced} onDecide={decide} onToggleInsights={toggleInsights} onTabChange={changeInsightTab} />
              ))}
            </div>
          )}
        </div>

        {/* Right panel: pipeline + log */}
        <div style={{ width: 256, flexShrink: 0, display: "flex", flexDirection: "column", background: C.bg2, overflow: "hidden" }}>
          <div style={{ padding: "10px 13px 10px", borderBottom: `1px solid ${C.line}`, flexShrink: 0 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, color: C.mut2, fontWeight: 600, marginBottom: 10 }}>Pipeline</div>
            <PipelineFunnel agents={processing} />
          </div>
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "9px 13px 5px", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8, color: C.mut2, fontWeight: 600, flexShrink: 0 }}>Event Stream</div>
            <div ref={logRef} className="soc-scroll" style={{ flex: 1, overflowY: "auto", padding: "0 13px 13px", display: "flex", flexDirection: "column", gap: 5 }}>
              {log.length === 0 && <div className="soc-mono" style={{ fontSize: 10, color: C.mut2 }}>no events yet…</div>}
              {log.map((e, i) => (
                <div key={`${e.t}-${i}`} className="soc-mono" style={{ fontSize: 9.5, lineHeight: 1.45, borderLeft: `2px solid ${SEV_COLOR[e.sev] ?? C.low}40`, paddingLeft: 6 }}>
                  <span style={{ color: C.mut2 }}>{new Date(e.t).toLocaleTimeString([], { hour12: false })} </span>
                  <span style={{ color: SEV_COLOR[e.sev] ?? C.low, fontWeight: 600 }}>{e.procId} </span>
                  <span style={{ color: C.mut }}>{e.msg}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
