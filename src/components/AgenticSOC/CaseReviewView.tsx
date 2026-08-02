import { useEffect, useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import type { ResolvedIncident } from "../../lib/store";
import { fetchIncidents } from "../../lib/socDb";

const FONT = `@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500;700&display=swap');`;
const C = {
  bg: "#0C111B", bg2: "#111827", panel: "#161F2E", panelHi: "#1C2738",
  line: "#26324A", lineHi: "#33425F", text: "#E5EAF3",
  mut: "#8593AC", mut2: "#6B7A96",
  live: "#33D6C4",
  crit: "#F1665A", high: "#EFA23C", med: "#5AA6F1", low: "#6E9CAC", ok: "#4FC98A",
  purple: "#A78BFA", amber: "#FBBF24",
};
const SEV_COLOR: Record<string, string> = {
  CRITICAL: C.crit, HIGH: C.high, MEDIUM: C.med, LOW: C.low, INFO: C.mut2,
};
const VERDICT_COLOR: Record<string, string> = {
  "True Positive": C.crit, "False Positive": C.mut, "Needs Review": C.high,
};
const MONO = "'JetBrains Mono',monospace";

function mergeByProc(a: ResolvedIncident[], b: ResolvedIncident[]): ResolvedIncident[] {
  const seen = new Set<string>();
  const out: ResolvedIncident[] = [];
  for (const inc of [...a, ...b]) {
    if (seen.has(inc.procId)) continue;
    seen.add(inc.procId);
    out.push(inc);
  }
  return out.sort((x, y) => y.resolvedAt - x.resolvedAt);
}

// ── Small building blocks ──────────────────────────────────────────────────────
function Chip({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 5, background: `${color}18`, border: `1px solid ${color}35`, color, fontSize: 9.5, fontFamily: MONO, whiteSpace: "nowrap" }}>
      {text}
    </span>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div style={{ padding: 14, borderRadius: 10, background: C.panel, border: `1px solid ${C.line}` }}>
      <div style={{ fontSize: 9.5, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 600, marginBottom: 10 }}>
        {title}
        {count !== undefined && <span style={{ marginLeft: 6, color: C.live, fontFamily: MONO }}>{count}</span>}
      </div>
      {children}
    </div>
  );
}

function KV({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 5 }}>
      <div style={{ width: 92, fontSize: 9.5, color: C.mut2, flexShrink: 0, fontFamily: MONO }}>{k}</div>
      <div style={{ fontSize: 10.5, color: color ?? C.text, wordBreak: "break-word" }}>{v || "—"}</div>
    </div>
  );
}

// ── Query panel (Splunk / KQL tabs + copy) ─────────────────────────────────────
function QueriesPanel({ queries }: { queries: { splunk: string[]; kql: string[] } }) {
  const [tab, setTab] = useState<"splunk" | "kql">("splunk");
  const [copied, setCopied] = useState<number | null>(null);
  const list = tab === "splunk" ? queries.splunk : queries.kql;

  const copy = (q: string, i: number) => {
    void navigator.clipboard.writeText(q);
    setCopied(i);
    setTimeout(() => setCopied(c => (c === i ? null : c)), 1500);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
        {(["splunk", "kql"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${tab === t ? C.live + "55" : C.line}`, background: tab === t ? `${C.live}12` : "transparent", color: tab === t ? C.live : C.mut2, fontSize: 9.5, fontFamily: "inherit", cursor: "pointer" }}>
            {t === "splunk" ? "Splunk SPL" : "KQL / Sentinel"}
            <span style={{ marginLeft: 6, color: C.mut2, fontFamily: MONO }}>{(t === "splunk" ? queries.splunk : queries.kql).length}</span>
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <div style={{ fontSize: 10, color: C.mut2, fontStyle: "italic" }}>No {tab === "splunk" ? "Splunk" : "KQL"} queries captured for this case.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {list.map((q, i) => (
            <div key={i} style={{ position: "relative", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 7, padding: "9px 34px 9px 11px" }}>
              <code style={{ fontSize: 9.5, color: C.text, fontFamily: MONO, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5, display: "block" }}>{q}</code>
              <button onClick={() => copy(q, i)} title="Copy"
                style={{ position: "absolute", top: 6, right: 6, padding: "2px 6px", borderRadius: 5, border: `1px solid ${C.line}`, background: C.panelHi, color: copied === i ? C.ok : C.mut, fontSize: 8.5, cursor: "pointer", fontFamily: "inherit" }}>
                {copied === i ? "✓" : "copy"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Case file (detail) ─────────────────────────────────────────────────────────
function CaseFile({ inc }: { inc: ResolvedIncident }) {
  const a = inc.alert;
  const verdictColor = VERDICT_COLOR[inc.verdict] ?? C.mut;
  const riskColor = inc.riskScore >= 70 ? C.crit : inc.riskScore >= 40 ? C.high : C.ok;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div style={{ padding: 16, borderRadius: 10, background: C.panel, border: `1px solid ${verdictColor}30` }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 3 }}>{a.title || "Untitled incident"}</div>
            <div style={{ fontSize: 9.5, color: C.mut2, fontFamily: MONO }}>
              {a.incidentNo || inc.procId} · {new Date(inc.resolvedAt).toLocaleString([], { hour12: false })}
            </div>
          </div>
          <Chip text={inc.verdict} color={verdictColor} />
        </div>
        {/* Metric strip */}
        <div style={{ display: "flex", gap: 18, marginTop: 14, flexWrap: "wrap" }}>
          <Metric label="Risk" value={String(inc.riskScore)} color={riskColor} />
          <Metric label="Confidence" value={`${inc.confidence}%`} color={C.med} />
          <Metric label="MTTR" value={`${inc.mttr}s`} color={C.live} />
          <Metric label="Severity" value={a.severity} color={SEV_COLOR[a.severity] ?? C.mut} />
          <Metric label="Agent" value={inc.agentLabel} color={inc.agentColor} />
          <Metric label="Path" value={inc.isFirstRun ? "AI first-run" : "Cached skill"} color={inc.isFirstRun ? C.purple : C.mut} />
        </div>
      </div>

      {/* Verdict reasoning */}
      {inc.reasoning && (
        <Section title="Verdict Reasoning">
          <div style={{ fontSize: 11, color: C.text, lineHeight: 1.6 }}>{inc.reasoning}</div>
        </Section>
      )}

      {/* Alert details */}
      <Section title="Alert Details">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 20px" }}>
          <div>
            <KV k="tactic" v={a.tactic} />
            <KV k="technique" v={a.techniqueId ? `${a.techniqueId} — ${a.techniqueName}` : a.techniqueName} color={C.amber} />
            <KV k="source ip" v={a.sourceIp} color={C.med} />
            <KV k="source host" v={a.sourceHost} />
            <KV k="source user" v={a.sourceUser} />
            <KV k="process" v={a.sourceProcess ?? ""} />
          </div>
          <div>
            <KV k="dest ip" v={a.destIp} color={C.med} />
            <KV k="dest host" v={a.destHost} />
            <KV k="dest port" v={a.destPort ? String(a.destPort) : ""} />
            <KV k="use case" v={a.useCaseLabel} />
            <KV k="alert id" v={a.alertId} />
            <KV k="status" v={a.status} />
          </div>
        </div>
        {a.description && <div style={{ marginTop: 10, fontSize: 10.5, color: C.mut, lineHeight: 1.55 }}>{a.description}</div>}
      </Section>

      {/* Evidence + raw log */}
      {(a.evidence?.length > 0 || a.rawLog) && (
        <Section title="Evidence" count={a.evidence?.length || undefined}>
          {a.evidence?.length > 0 && (
            <ul style={{ margin: "0 0 10px", paddingLeft: 16 }}>
              {a.evidence.map((e, i) => (
                <li key={i} style={{ fontSize: 10, color: C.text, marginBottom: 3, lineHeight: 1.45 }}>{e}</li>
              ))}
            </ul>
          )}
          {a.rawLog && (
            <pre style={{ background: C.bg, border: `1px solid ${C.line}`, borderRadius: 7, padding: 10, margin: 0, fontSize: 9, color: C.mut, fontFamily: MONO, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.5 }}>{a.rawLog}</pre>
          )}
        </Section>
      )}

      {/* Threat actor */}
      {inc.threatActorProfile && (
        <Section title="Threat Actor Profile">
          <div style={{ fontSize: 11, color: C.text, lineHeight: 1.6 }}>{inc.threatActorProfile}</div>
        </Section>
      )}

      {/* Attack chain */}
      {inc.attackChain?.length > 0 && (
        <Section title="Attack Chain" count={inc.attackChain.length}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {inc.attackChain.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", background: `${C.purple}20`, border: `1px solid ${C.purple}50`, color: C.purple, fontSize: 9, fontFamily: MONO, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                <div style={{ fontSize: 10.5, color: C.text, lineHeight: 1.5 }}>{step}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* IOCs + techniques */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Section title="IOCs" count={inc.iocs?.length || 0}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {inc.iocs?.length ? inc.iocs.map((v, i) => <Chip key={i} text={v} color={C.crit} />)
              : <span style={{ fontSize: 10, color: C.mut2, fontStyle: "italic" }}>none</span>}
          </div>
        </Section>
        <Section title="MITRE Techniques" count={inc.techniques?.length || 0}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {inc.techniques?.length ? inc.techniques.map((v, i) => <Chip key={i} text={v} color={C.amber} />)
              : <span style={{ fontSize: 10, color: C.mut2, fontStyle: "italic" }}>none</span>}
          </div>
        </Section>
      </div>

      {/* Recommendations */}
      {inc.recommendations?.length > 0 && (
        <Section title="Recommended Actions" count={inc.recommendations.length}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {inc.recommendations.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                <div style={{ color: C.ok, fontSize: 11, flexShrink: 0 }}>▸</div>
                <div style={{ fontSize: 10.5, color: C.text, lineHeight: 1.5 }}>{r}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Investigation queries */}
      <Section title="Investigation Queries">
        <QueriesPanel queries={inc.sampleQueries ?? { splunk: [], kql: [] }} />
      </Section>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 8.5, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color, fontFamily: MONO }}>{value}</div>
    </div>
  );
}

// ── Main view ──────────────────────────────────────────────────────────────────
export default function CaseReviewView() {
  const storeIncidents = useStore(s => s.resolvedIncidents);
  const clearResolved  = useStore(s => s.clearResolvedIncidents);

  const [dbIncidents, setDbIncidents] = useState<ResolvedIncident[]>([]);
  const [loading, setLoading]         = useState(true);
  const [dbOnline, setDbOnline]       = useState(false);
  const [query, setQuery]             = useState("");
  const [verdictF, setVerdictF]       = useState<"all" | "True Positive" | "False Positive" | "Needs Review">("all");
  const [selectedId, setSelectedId]   = useState<string | null>(null);

  // Hydrate from the DB (system of record) on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await fetchIncidents(500);
      if (!alive) return;
      setDbIncidents(rows);
      setDbOnline(rows.length > 0);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const incidents = useMemo(() => mergeByProc(dbIncidents, storeIncidents), [dbIncidents, storeIncidents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return incidents.filter(inc => {
      if (verdictF !== "all" && inc.verdict !== verdictF) return false;
      if (!q) return true;
      const hay = [
        inc.alert.title, inc.alert.incidentNo, inc.agentLabel, inc.threatActorProfile,
        ...(inc.iocs ?? []), ...(inc.techniques ?? []),
        inc.alert.sourceIp, inc.alert.sourceHost, inc.alert.sourceUser,
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [incidents, query, verdictF]);

  const selected = useMemo(
    () => filtered.find(i => i.procId === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );

  return (
    <div style={{ fontFamily: "'Space Grotesk', sans-serif", background: C.bg, color: C.text, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{FONT}</style>

      {/* Header */}
      <div style={{ padding: "10px 20px", background: C.bg2, borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Case Review</div>
          <div style={{ fontSize: 9.5, color: C.mut2, fontFamily: MONO }}>investigation history &amp; full case files</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: dbOnline ? C.ok : C.mut2 }} />
          <span style={{ fontSize: 9, color: dbOnline ? C.ok : C.mut2, fontFamily: MONO }}>
            {dbOnline ? "DB connected" : "local cache"}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        {/* Search */}
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search title, IOC, technique, host…"
          style={{ width: 240, padding: "5px 10px", borderRadius: 6, border: `1px solid ${C.line}`, background: C.panel, color: C.text, fontSize: 10, fontFamily: "inherit", outline: "none" }}
        />
        {/* Verdict filter */}
        <div style={{ display: "flex", gap: 4 }}>
          {([["all", "All"], ["True Positive", "TP"], ["False Positive", "FP"], ["Needs Review", "NR"]] as const).map(([v, lbl]) => (
            <button key={v} onClick={() => setVerdictF(v)}
              style={{ padding: "4px 9px", borderRadius: 6, border: `1px solid ${verdictF === v ? C.live + "55" : C.line}`, background: verdictF === v ? `${C.live}10` : "transparent", color: verdictF === v ? C.live : C.mut2, fontSize: 9.5, fontFamily: "inherit", cursor: "pointer" }}>
              {lbl}
            </button>
          ))}
        </div>
        {incidents.length > 0 && (
          <button onClick={clearResolved}
            style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.crit}35`, background: "transparent", color: C.crit, fontSize: 9.5, fontFamily: "inherit", cursor: "pointer" }}
            title="Clears the local cache (DB rows are retained)">
            Clear cache
          </button>
        )}
      </div>

      {/* Body: master-detail */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* List */}
        <div style={{ width: 320, borderRight: `1px solid ${C.line}`, overflowY: "auto", flexShrink: 0 }}>
          {loading ? (
            <div style={{ padding: 20, textAlign: "center", color: C.mut2, fontSize: 10 }}>Loading case history…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "28px 20px", textAlign: "center", color: C.mut2, fontSize: 10.5, lineHeight: 1.6 }}>
              {incidents.length === 0
                ? "No resolved incidents yet. Run the Agentic SOC pipeline to build case history."
                : "No cases match your search."}
            </div>
          ) : (
            filtered.map(inc => {
              const active = selected?.procId === inc.procId;
              const vColor = VERDICT_COLOR[inc.verdict] ?? C.mut;
              return (
                <div key={inc.procId} onClick={() => setSelectedId(inc.procId)}
                  style={{ padding: "10px 14px", borderBottom: `1px solid ${C.line}30`, cursor: "pointer", background: active ? C.panelHi : "transparent", borderLeft: `2px solid ${active ? vColor : "transparent"}` }}
                  onMouseOver={e => { if (!active) e.currentTarget.style.background = C.panel; }}
                  onMouseOut={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: SEV_COLOR[inc.alert.severity] ?? C.mut, flexShrink: 0 }} />
                    <div style={{ fontSize: 10.5, color: C.text, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={inc.alert.title}>{inc.alert.title}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 8.5, fontFamily: MONO, color: C.mut2 }}>
                    <span>{new Date(inc.resolvedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                    <span style={{ color: inc.agentColor, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 }}>{inc.agentLabel}</span>
                    <span style={{ marginLeft: "auto", color: vColor }}>{inc.verdict === "True Positive" ? "TP" : inc.verdict === "False Positive" ? "FP" : "NR"}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Detail */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {selected ? <CaseFile inc={selected} /> : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: C.mut2, fontSize: 11 }}>
              {loading ? "" : "Select a case to view its full file."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
