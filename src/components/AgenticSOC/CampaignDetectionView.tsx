import { useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import type { AlertQueueItem } from "../../lib/store";

const FONT = `@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500;700&display=swap');`;
const C = {
  bg: "#0C111B", bg2: "#111827", panel: "#161F2E", panelHi: "#1C2738",
  line: "#26324A", lineHi: "#33425F", text: "#E5EAF3",
  mut: "#8593AC", mut2: "#6B7A96",
  live: "#33D6C4", crit: "#F1665A", high: "#EFA23C", med: "#5AA6F1", ok: "#4FC98A",
  purple: "#A78BFA", amber: "#FBBF24",
};
const SEV_COLOR: Record<string, string> = {
  CRITICAL: C.crit, HIGH: C.high, MEDIUM: C.med, LOW: "#6E9CAC", INFO: C.mut2,
};
const SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
const WINDOW_MS = 30 * 60 * 1000; // 30-minute correlation window

// ── Types ─────────────────────────────────────────────────────────────────────
interface SharedAttr { type: "ip" | "user" | "host" | "technique"; value: string }
interface Campaign {
  id:               string
  alerts:           AlertQueueItem[]
  sharedAttributes: SharedAttr[]
  firstSeen:        number
  lastSeen:         number
  maxSeverity:      string
  tactics:          string[]
  techniques:       string[]
  label:            string
  riskLevel:        "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
}

// ── Severity helper ───────────────────────────────────────────────────────────
function maxSeverity(alerts: AlertQueueItem[]): string {
  for (const s of SEV_ORDER) {
    if (alerts.some(a => a.severity === s)) return s;
  }
  return "INFO";
}

// ── Campaign detection algorithm ──────────────────────────────────────────────
function detectCampaigns(alerts: AlertQueueItem[]): Campaign[] {
  if (alerts.length === 0) return [];

  // Build adjacency: two alerts are "related" if they share IP, user, host, or technique
  // within a 30-minute window
  function related(a: AlertQueueItem, b: AlertQueueItem): SharedAttr[] {
    const attrs: SharedAttr[] = [];
    const tDiff = Math.abs(a.createdAt - b.createdAt);
    if (tDiff > WINDOW_MS) return [];
    if (a.sourceIp   && a.sourceIp   === b.sourceIp)   attrs.push({ type: "ip",        value: a.sourceIp });
    if (a.sourceUser && a.sourceUser === b.sourceUser)  attrs.push({ type: "user",      value: a.sourceUser });
    if (a.sourceHost && a.sourceHost === b.sourceHost)  attrs.push({ type: "host",      value: a.sourceHost });
    if (a.techniqueId && a.techniqueId === b.techniqueId) attrs.push({ type: "technique", value: a.techniqueId });
    return attrs;
  }

  // Union-Find for campaign grouping
  const parent = new Map<string, string>();
  const edges  = new Map<string, Map<string, SharedAttr[]>>();

  alerts.forEach(a => parent.set(a.id, a.id));

  function find(id: string): string {
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
    return parent.get(id)!;
  }
  function union(a: string, b: string) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (let i = 0; i < alerts.length; i++) {
    for (let j = i + 1; j < alerts.length; j++) {
      const attrs = related(alerts[i], alerts[j]);
      if (attrs.length > 0) {
        union(alerts[i].id, alerts[j].id);
        const key = `${alerts[i].id}|${alerts[j].id}`;
        edges.set(key, new Map(attrs.map(a => [a.type, a])));
      }
    }
  }

  // Group alerts by root
  const groups = new Map<string, AlertQueueItem[]>();
  alerts.forEach(a => {
    const root = find(a.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(a);
  });

  // Build campaigns — only include groups with 2+ alerts
  const campaigns: Campaign[] = [];
  let idx = 1;
  groups.forEach(members => {
    if (members.length < 2) return;

    // Collect all shared attributes across group
    const allAttrs = new Map<string, SharedAttr>();
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        related(members[i], members[j]).forEach(a => {
          allAttrs.set(`${a.type}:${a.value}`, a);
        });
      }
    }

    const sorted    = [...members].sort((a, b) => a.createdAt - b.createdAt);
    const tactics   = [...new Set(members.map(a => a.tactic).filter(Boolean))];
    const techniques = [...new Set(members.map(a => a.techniqueId).filter(Boolean))];
    const ms        = maxSeverity(members);
    const label     = guessAttackLabel(tactics, techniques, members);

    campaigns.push({
      id:               `CAM-${String(idx++).padStart(3, "0")}`,
      alerts:           sorted,
      sharedAttributes: Array.from(allAttrs.values()),
      firstSeen:        sorted[0].createdAt,
      lastSeen:         sorted[sorted.length - 1].createdAt,
      maxSeverity:      ms,
      tactics,
      techniques,
      label,
      riskLevel:        (ms as Campaign["riskLevel"]) ?? "MEDIUM",
    });
  });

  return campaigns.sort((a, b) => b.lastSeen - a.lastSeen);
}

// ── Guess multi-stage attack label from tactic sequence ───────────────────────
function guessAttackLabel(tactics: string[], techniques: string[], alerts: AlertQueueItem[]): string {
  const t = tactics.map(s => s.toLowerCase());
  if (t.includes("initial access") && t.includes("lateral movement")) return "Multi-Stage Intrusion";
  if (t.includes("initial access") && t.includes("exfiltration"))     return "Breach & Exfiltration";
  if (t.includes("credential access") && t.includes("lateral movement")) return "Credential Theft + Lateral Move";
  if (t.includes("command and control") && t.includes("exfiltration")) return "C2 + Data Exfil";
  if (t.includes("privilege escalation") && t.includes("collection"))  return "PrivEsc + Collection";
  if (alerts.length >= 5)  return "Sustained Attack Campaign";
  if (alerts.length === 2) return "Alert Pair";
  return "Correlated Activity";
}

// ── Alert timeline SVG ────────────────────────────────────────────────────────
function AlertTimeline({ alerts, color }: { alerts: AlertQueueItem[]; color: string }) {
  if (alerts.length === 0) return null;
  const W = 400, H = 36;
  const t0 = alerts[0].createdAt, t1 = alerts[alerts.length - 1].createdAt;
  const range = Math.max(t1 - t0, 1);
  const pts = alerts.map(a => ((a.createdAt - t0) / range) * (W - 16) + 8);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <line x1={8} y1={H / 2} x2={W - 8} y2={H / 2} stroke={`${color}30`} strokeWidth={1.5} />
      {pts.map((x, i) => (
        <g key={i}>
          <circle cx={x} cy={H / 2} r={5} fill={`${SEV_COLOR[alerts[i].severity]}30`} stroke={SEV_COLOR[alerts[i].severity]} strokeWidth={1.2} />
          <title>{alerts[i].title} · {alerts[i].severity}</title>
        </g>
      ))}
    </svg>
  );
}

// ── Campaign card ─────────────────────────────────────────────────────────────
function CampaignCard({ c }: { c: Campaign }) {
  const [open, setOpen] = useState(false);
  const sevColor = SEV_COLOR[c.maxSeverity] ?? C.mut2;
  const dur = Math.round((c.lastSeen - c.firstSeen) / 1000);
  const durStr = dur < 60 ? `${dur}s` : dur < 3600 ? `${Math.floor(dur / 60)}m` : `${Math.floor(dur / 3600)}h`;

  return (
    <div style={{ borderRadius: 11, background: C.panel, border: `1px solid ${sevColor}30`, overflow: "hidden", marginBottom: 10 }}>
      {/* Header */}
      <div onClick={() => setOpen(o => !o)} style={{ padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
        onMouseOver={e => (e.currentTarget.style.background = C.panelHi)}
        onMouseOut={e  => (e.currentTarget.style.background = "transparent")}>

        {/* Severity dot */}
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: sevColor, flexShrink: 0, boxShadow: `0 0 6px ${sevColor}` }} />

        {/* Campaign ID + label */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: sevColor, fontFamily: "'JetBrains Mono',monospace" }}>{c.id}</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: C.text }}>{c.label}</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 8.5, color: C.mut2, fontFamily: "'JetBrains Mono',monospace" }}>
              {c.alerts.length} alerts · {durStr} span
            </span>
            {c.sharedAttributes.slice(0, 3).map(a => (
              <span key={`${a.type}:${a.value}`} style={{ fontSize: 8, color: C.med, background: `${C.med}12`, border: `1px solid ${C.med}25`, borderRadius: 4, padding: "1px 5px", fontFamily: "'JetBrains Mono',monospace" }}>
                {a.type}: {a.value.length > 20 ? a.value.slice(0, 20) + "…" : a.value}
              </span>
            ))}
          </div>
        </div>

        {/* Tactic chips */}
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {c.tactics.slice(0, 2).map(t => (
            <span key={t} style={{ fontSize: 8, color: C.purple, background: `${C.purple}12`, border: `1px solid ${C.purple}25`, borderRadius: 4, padding: "2px 6px" }}>{t}</span>
          ))}
          {c.tactics.length > 2 && <span style={{ fontSize: 8, color: C.mut2 }}>+{c.tactics.length - 2}</span>}
        </div>

        <span style={{ fontSize: 11, color: C.mut2, marginLeft: 4 }}>{open ? "▲" : "▼"}</span>
      </div>

      {/* Expanded body */}
      {open && (
        <div style={{ borderTop: `1px solid ${C.line}`, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Timeline */}
          <div>
            <div style={{ fontSize: 9, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Attack Timeline</div>
            <AlertTimeline alerts={c.alerts} color={sevColor} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
              <span style={{ fontSize: 8.5, color: C.mut2, fontFamily: "'JetBrains Mono',monospace" }}>
                {new Date(c.firstSeen).toLocaleTimeString([], { hour12: false })}
              </span>
              <span style={{ fontSize: 8.5, color: C.mut2, fontFamily: "'JetBrains Mono',monospace" }}>
                {new Date(c.lastSeen).toLocaleTimeString([], { hour12: false })}
              </span>
            </div>
          </div>

          {/* Shared attributes */}
          <div>
            <div style={{ fontSize: 9, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Shared Attributes (correlation keys)</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {c.sharedAttributes.map(a => (
                <div key={`${a.type}:${a.value}`} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, background: `${C.med}0E`, border: `1px solid ${C.med}28` }}>
                  <span style={{ fontSize: 8, color: C.med, textTransform: "uppercase", letterSpacing: 0.4 }}>{a.type}</span>
                  <span style={{ fontSize: 9.5, color: C.text, fontFamily: "'JetBrains Mono',monospace" }}>{a.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Alert list */}
          <div>
            <div style={{ fontSize: 9, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Correlated Alerts</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {c.alerts.map((a, i) => (
                <div key={a.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 10px", borderRadius: 7, background: C.bg2, border: `1px solid ${SEV_COLOR[a.severity]}18` }}>
                  <span style={{ fontSize: 9, color: SEV_COLOR[a.severity], width: 14, flexShrink: 0, fontFamily: "'JetBrains Mono',monospace", marginTop: 1 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10.5, color: C.text, marginBottom: 2 }}>{a.title}</div>
                    <div style={{ fontSize: 8.5, color: C.mut2, fontFamily: "'JetBrains Mono',monospace" }}>
                      {a.techniqueId} · {a.sourceHost} · {new Date(a.createdAt).toLocaleTimeString([], { hour12: false })}
                    </div>
                  </div>
                  <span style={{ fontSize: 8.5, color: SEV_COLOR[a.severity], background: `${SEV_COLOR[a.severity]}14`, border: `1px solid ${SEV_COLOR[a.severity]}30`, borderRadius: 4, padding: "1px 6px", flexShrink: 0 }}>
                    {a.severity}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Technique chips */}
          {c.techniques.length > 0 && (
            <div>
              <div style={{ fontSize: 9, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>MITRE Techniques</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {c.techniques.map(t => (
                  <span key={t} style={{ fontSize: 9, color: C.purple, background: `${C.purple}10`, border: `1px solid ${C.purple}25`, borderRadius: 5, padding: "2px 8px", fontFamily: "'JetBrains Mono',monospace" }}>{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Isolated singles ──────────────────────────────────────────────────────────
function SinglesRow({ alerts }: { alerts: AlertQueueItem[] }) {
  const [show, setShow] = useState(false);
  if (alerts.length === 0) return null;
  return (
    <div style={{ borderRadius: 10, background: C.panel, border: `1px solid ${C.line}`, padding: "10px 14px" }}>
      <div onClick={() => setShow(o => !o)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <span style={{ fontSize: 10, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.6 }}>Isolated Alerts (no correlation)</span>
        <span style={{ fontSize: 10, color: C.mut2, fontFamily: "'JetBrains Mono',monospace" }}>{alerts.length}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: C.mut2 }}>{show ? "▲" : "▼"}</span>
      </div>
      {show && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          {alerts.map(a => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderRadius: 6, background: C.bg2 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: SEV_COLOR[a.severity], flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: C.mut, flex: 1 }}>{a.title}</span>
              <span style={{ fontSize: 8.5, color: C.mut2, fontFamily: "'JetBrains Mono',monospace" }}>{a.sourceHost}</span>
              <span style={{ fontSize: 8.5, color: SEV_COLOR[a.severity] }}>{a.severity[0]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function CampaignDetectionView() {
  const alertQueue = useStore(s => s.alertQueue);
  const [windowMins, setWindowMins] = useState(30);

  const allAlerts   = alertQueue;
  const campaigns   = useMemo(() => detectCampaigns(allAlerts), [allAlerts]);
  const campaignIds = useMemo(() => new Set(campaigns.flatMap(c => c.alerts.map(a => a.id))), [campaigns]);
  const isolated    = useMemo(() => allAlerts.filter(a => !campaignIds.has(a.id)), [allAlerts, campaignIds]);

  const criticalCampaigns = campaigns.filter(c => c.riskLevel === "CRITICAL").length;
  const highCampaigns     = campaigns.filter(c => c.riskLevel === "HIGH").length;

  void windowMins; // future: make correlation window configurable

  return (
    <div style={{ fontFamily: "'Space Grotesk', sans-serif", background: C.bg, color: C.text, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{FONT}</style>

      {/* Header */}
      <div style={{ padding: "10px 20px", background: C.bg2, borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Campaign Detection</div>
          <div style={{ fontSize: 9.5, color: C.mut2, fontFamily: "'JetBrains Mono',monospace" }}>
            alert correlation · {WINDOW_MS / 60000}-min window
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {/* Summary chips */}
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ padding: "5px 12px", borderRadius: 8, background: `${C.purple}0E`, border: `1px solid ${C.purple}25`, textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.purple, fontFamily: "'JetBrains Mono',monospace" }}>{campaigns.length}</div>
            <div style={{ fontSize: 8.5, color: C.mut2, textTransform: "uppercase" }}>Campaigns</div>
          </div>
          {criticalCampaigns > 0 && (
            <div style={{ padding: "5px 12px", borderRadius: 8, background: `${C.crit}0E`, border: `1px solid ${C.crit}25`, textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.crit, fontFamily: "'JetBrains Mono',monospace" }}>{criticalCampaigns}</div>
              <div style={{ fontSize: 8.5, color: C.mut2, textTransform: "uppercase" }}>Critical</div>
            </div>
          )}
          {highCampaigns > 0 && (
            <div style={{ padding: "5px 12px", borderRadius: 8, background: `${C.high}0E`, border: `1px solid ${C.high}25`, textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.high, fontFamily: "'JetBrains Mono',monospace" }}>{highCampaigns}</div>
              <div style={{ fontSize: 8.5, color: C.mut2, textTransform: "uppercase" }}>High</div>
            </div>
          )}
          <div style={{ padding: "5px 12px", borderRadius: 8, background: `${C.mut2}0E`, border: `1px solid ${C.mut2}20`, textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.mut2, fontFamily: "'JetBrains Mono',monospace" }}>{isolated.length}</div>
            <div style={{ fontSize: 8.5, color: C.mut2, textTransform: "uppercase" }}>Isolated</div>
          </div>
        </div>
      </div>

      {/* Window selector */}
      <div style={{ padding: "8px 20px", background: C.bg, borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 9.5, color: C.mut2 }}>Correlation window:</span>
        {[15, 30, 60].map(m => (
          <button key={m} onClick={() => setWindowMins(m)}
            style={{ padding: "3px 10px", borderRadius: 5, border: `1px solid ${windowMins === m ? C.live + "55" : C.line}`, background: windowMins === m ? `${C.live}10` : "transparent", color: windowMins === m ? C.live : C.mut2, fontSize: 9, fontFamily: "inherit", cursor: "pointer" }}>
            {m}m
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 9, color: C.mut2 }}>
          Alerts correlated by shared: source IP · source user · hostname · MITRE technique
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {allAlerts.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 260, textAlign: "center", gap: 10 }}>
            <div style={{ fontSize: 28, opacity: 0.3 }}>⬡</div>
            <div style={{ fontSize: 12, color: C.mut2 }}>No alerts to correlate</div>
            <div style={{ fontSize: 10, color: C.mut2, maxWidth: 300 }}>
              Generate alerts via the Alert Generator or SOC Triage — campaigns appear automatically when 2+ alerts share a source IP, user, hostname, or MITRE technique within the correlation window.
            </div>
          </div>
        ) : campaigns.length === 0 ? (
          <div style={{ marginBottom: 16 }}>
            <div style={{ padding: 16, borderRadius: 10, background: C.panel, border: `1px solid ${C.line}`, textAlign: "center", color: C.mut2, fontSize: 10, marginBottom: 16 }}>
              No correlated campaigns detected — all {allAlerts.length} alert{allAlerts.length !== 1 ? "s" : ""} appear independent within the {WINDOW_MS / 60000}-minute window.
            </div>
            <SinglesRow alerts={isolated} />
          </div>
        ) : (
          <>
            <div style={{ fontSize: 10.5, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600, marginBottom: 12 }}>
              Detected Campaigns — {campaigns.length}
            </div>
            {campaigns.map(c => <CampaignCard key={c.id} c={c} />)}
            <SinglesRow alerts={isolated} />
          </>
        )}
      </div>
    </div>
  );
}
