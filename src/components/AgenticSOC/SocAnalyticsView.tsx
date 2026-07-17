import { useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import type { ResolvedIncident } from "../../lib/store";

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
const VERDICT_COLOR = {
  "True Positive":  C.crit,
  "False Positive": C.mut,
  "Needs Review":   C.high,
};

// ── Sparkline SVG ─────────────────────────────────────────────────────────────
function Sparkline({ values, color, label }: { values: number[]; color: string; label: string }) {
  if (values.length < 2) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 60, color: C.mut2, fontSize: 10 }}>
      not enough data
    </div>
  );
  const W = 260, H = 60;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * W,
    H - ((v - min) / range) * (H - 8) - 4,
  ]);
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = path + ` L${W},${H} L0,${H} Z`;
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        <defs>
          <linearGradient id={`sg-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#sg-${label})`} />
        <path d={path} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => i === pts.length - 1 ? (
          <circle key={i} cx={p[0]} cy={p[1]} r={3} fill={color} />
        ) : null)}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span style={{ fontSize: 8.5, color: C.mut2, fontFamily: "'JetBrains Mono',monospace" }}>oldest</span>
        <span style={{ fontSize: 8.5, color: C.mut2, fontFamily: "'JetBrains Mono',monospace" }}>latest</span>
      </div>
    </div>
  );
}

// ── Horizontal bar ────────────────────────────────────────────────────────────
function HBar({ label, value, max, color, suffix = "" }: { label: string; value: number; max: number; color: string; suffix?: string }) {
  const pct = max > 0 ? Math.max((value / max) * 100, 2) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <div style={{ width: 120, fontSize: 9.5, color: C.mut, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "'JetBrains Mono',monospace" }} title={label}>{label}</div>
      <div style={{ flex: 1, height: 7, borderRadius: 4, background: C.line, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, transition: "width 0.6s ease" }} />
      </div>
      <div style={{ width: 36, fontSize: 9.5, color, textAlign: "right", fontFamily: "'JetBrains Mono',monospace" }}>{value}{suffix}</div>
    </div>
  );
}

// ── Big stat card ─────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, icon }: { label: string; value: string | number; sub?: string; color: string; icon: string }) {
  return (
    <div style={{ padding: "14px 16px", borderRadius: 10, background: C.panel, border: `1px solid ${color}20`, flex: 1, minWidth: 110 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 14, color }}>{icon}</span>
        <span style={{ fontSize: 9, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1, fontFamily: "'JetBrains Mono',monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 9.5, color: C.mut2, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

// ── Verdict donut ─────────────────────────────────────────────────────────────
function VerdictDonut({ tp, fp, nr }: { tp: number; fp: number; nr: number }) {
  const total = tp + fp + nr || 1;
  const segments: { label: string; count: number; color: string }[] = [
    { label: "True Positive",  count: tp, color: C.crit },
    { label: "False Positive", count: fp, color: C.mut  },
    { label: "Needs Review",   count: nr, color: C.high },
  ];
  const R = 40, cx = 50, cy = 50;
  let angle = -Math.PI / 2;
  const arcs = segments.map(s => {
    const sweep = (s.count / total) * 2 * Math.PI;
    const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle);
    angle += sweep;
    const x2 = cx + R * Math.cos(angle), y2 = cy + R * Math.sin(angle);
    const large = sweep > Math.PI ? 1 : 0;
    return { ...s, path: `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z` };
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg width={100} height={100} viewBox="0 0 100 100">
        {arcs.map(a => <path key={a.label} d={a.path} fill={a.color} opacity={0.85} />)}
        <circle cx={cx} cy={cy} r={22} fill={C.panel} />
        <text x={cx} y={cy + 4} textAnchor="middle" fill={C.text} fontSize={11} fontWeight="700" fontFamily="'JetBrains Mono',monospace">{total}</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {arcs.map(a => (
          <div key={a.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: a.color, flexShrink: 0 }} />
            <div style={{ fontSize: 9.5, color: C.mut }}>{a.label}</div>
            <div style={{ fontSize: 9.5, fontWeight: 700, color: a.color, fontFamily: "'JetBrains Mono',monospace", marginLeft: "auto", paddingLeft: 10 }}>{a.count}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── MTTR Heatmap tiles (by severity) ─────────────────────────────────────────
function MttrBySeverity({ incidents }: { incidents: ResolvedIncident[] }) {
  const sevs = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  const data = sevs.map(s => {
    const filtered = incidents.filter(i => i.alert.severity === s);
    const avg = filtered.length > 0 ? Math.round(filtered.reduce((a, b) => a + b.mttr, 0) / filtered.length) : null;
    return { sev: s, count: filtered.length, avg };
  });
  const maxAvg = Math.max(...data.map(d => d.avg ?? 0), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {data.map(d => (
        <div key={d.sev} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 70, fontSize: 9, color: SEV_COLOR[d.sev], fontFamily: "'JetBrains Mono',monospace", textTransform: "uppercase" }}>{d.sev}</div>
          <div style={{ flex: 1, height: 14, borderRadius: 4, background: C.line, overflow: "hidden", position: "relative" }}>
            {d.avg !== null && (
              <div style={{ height: "100%", width: `${(d.avg / maxAvg) * 100}%`, background: `${SEV_COLOR[d.sev]}50`, borderRadius: 4, display: "flex", alignItems: "center", paddingLeft: 6, minWidth: 30 }}>
                <span style={{ fontSize: 8.5, color: SEV_COLOR[d.sev], fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" }}>{d.avg}s</span>
              </div>
            )}
            {d.avg === null && <span style={{ fontSize: 8.5, color: C.mut2, paddingLeft: 6, lineHeight: "14px", display: "block" }}>—</span>}
          </div>
          <div style={{ width: 24, fontSize: 8.5, color: C.mut2, textAlign: "right", fontFamily: "'JetBrains Mono',monospace" }}>{d.count}</div>
        </div>
      ))}
    </div>
  );
}

// ── Recent incidents table ────────────────────────────────────────────────────
function RecentTable({ incidents }: { incidents: ResolvedIncident[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Header */}
      <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 70px 50px 50px 55px", gap: 6, padding: "5px 8px", borderBottom: `1px solid ${C.line}` }}>
        {["Time", "Alert", "Agent", "MTTR", "Sev", "Verdict"].map(h => (
          <div key={h} style={{ fontSize: 8.5, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>{h}</div>
        ))}
      </div>
      {incidents.slice(0, 12).map(inc => (
        <div key={inc.procId} style={{ display: "grid", gridTemplateColumns: "90px 1fr 70px 50px 50px 55px", gap: 6, padding: "6px 8px", borderBottom: `1px solid ${C.line}20` }}
          onMouseOver={e => (e.currentTarget.style.background = C.panelHi)}
          onMouseOut={e  => (e.currentTarget.style.background = "transparent")}>
          <div style={{ fontSize: 9, color: C.mut2, fontFamily: "'JetBrains Mono',monospace" }}>{new Date(inc.resolvedAt).toLocaleTimeString([], { hour12: false })}</div>
          <div style={{ fontSize: 9.5, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={inc.alert.title}>{inc.alert.title}</div>
          <div style={{ fontSize: 8.5, color: inc.agentColor, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inc.agentLabel}</div>
          <div style={{ fontSize: 9, color: C.live, fontFamily: "'JetBrains Mono',monospace" }}>{inc.mttr}s</div>
          <div style={{ fontSize: 9, color: SEV_COLOR[inc.alert.severity] }}>{inc.alert.severity[0]}</div>
          <div style={{ fontSize: 8.5, color: VERDICT_COLOR[inc.verdict] ?? C.mut }}>{inc.verdict === "True Positive" ? "TP" : inc.verdict === "False Positive" ? "FP" : "NR"}</div>
        </div>
      ))}
      {incidents.length === 0 && (
        <div style={{ padding: "24px 8px", textAlign: "center", color: C.mut2, fontSize: 10 }}>No resolved incidents yet.</div>
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function SocAnalyticsView() {
  const incidents         = useStore(s => s.resolvedIncidents);
  const clearResolved     = useStore(s => s.clearResolvedIncidents);
  const [timeWindow, setTimeWindow] = useState<"all" | "1h" | "6h">("all");

  const filtered = useMemo(() => {
    if (timeWindow === "all") return incidents;
    const cutoff = Date.now() - (timeWindow === "1h" ? 3_600_000 : 21_600_000);
    return incidents.filter(i => i.resolvedAt >= cutoff);
  }, [incidents, timeWindow]);

  const total    = filtered.length;
  const tp       = filtered.filter(i => i.verdict === "True Positive").length;
  const fp       = filtered.filter(i => i.verdict === "False Positive").length;
  const nr       = filtered.filter(i => i.verdict === "Needs Review").length;
  const avgMttr  = total > 0 ? Math.round(filtered.reduce((a, b) => a + b.mttr, 0) / total) : 0;
  const fpRate   = total > 0 ? Math.round((fp / total) * 100) : 0;
  const aiCount  = filtered.filter(i => i.isFirstRun).length;

  // MTTR sparkline — last 20 resolved
  const mttrSeries = useMemo(() => filtered.slice(0, 20).reverse().map(i => i.mttr), [filtered]);

  // Technique frequency
  const techFreq = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach(i => i.techniques.forEach(t => { if (t) map.set(t, (map.get(t) ?? 0) + 1); }));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [filtered]);

  // Severity distribution
  const sevCounts = useMemo(() => {
    const m: Record<string, number> = {};
    filtered.forEach(i => { m[i.alert.severity] = (m[i.alert.severity] ?? 0) + 1; });
    return m;
  }, [filtered]);

  // Agent performance
  const agentPerf = useMemo(() => {
    const map = new Map<string, { label: string; color: string; count: number; totalMttr: number; tp: number }>();
    filtered.forEach(i => {
      const cur = map.get(i.agentLabel) ?? { label: i.agentLabel, color: i.agentColor, count: 0, totalMttr: 0, tp: 0 };
      map.set(i.agentLabel, { ...cur, count: cur.count + 1, totalMttr: cur.totalMttr + i.mttr, tp: cur.tp + (i.verdict === "True Positive" ? 1 : 0) });
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [filtered]);

  const maxTech = techFreq[0]?.[1] ?? 1;

  return (
    <div style={{ fontFamily: "'Space Grotesk', sans-serif", background: C.bg, color: C.text, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{FONT}</style>

      {/* ── Header ── */}
      <div style={{ padding: "10px 20px", background: C.bg2, borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>SOC Analytics</div>
          <div style={{ fontSize: 9.5, color: C.mut2, fontFamily: "'JetBrains Mono',monospace" }}>resolved incident metrics &amp; trends</div>
        </div>
        <div style={{ flex: 1 }} />
        {/* Time window filter */}
        <div style={{ display: "flex", gap: 4 }}>
          {(["all", "6h", "1h"] as const).map(w => (
            <button key={w} onClick={() => setTimeWindow(w)}
              style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${timeWindow === w ? C.live + "55" : C.line}`, background: timeWindow === w ? `${C.live}10` : "transparent", color: timeWindow === w ? C.live : C.mut2, fontSize: 9.5, fontFamily: "inherit", cursor: "pointer" }}>
              {w === "all" ? "All time" : `Last ${w}`}
            </button>
          ))}
        </div>
        {total > 0 && (
          <button onClick={clearResolved}
            style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.crit}35`, background: "transparent", color: C.crit, fontSize: 9.5, fontFamily: "inherit", cursor: "pointer" }}>
            Clear history
          </button>
        )}
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── Top stat cards ── */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <StatCard label="Total Resolved"  value={total}                     color={C.live}   icon="◎" sub={`${aiCount} via AI · ${total - aiCount} cached`} />
          <StatCard label="True Positives"  value={tp}                        color={C.crit}   icon="✕" sub={`${total > 0 ? Math.round((tp/total)*100) : 0}% of resolved`} />
          <StatCard label="False Positives" value={fp}                        color={C.mut}    icon="○" sub={`${fpRate}% FP rate`} />
          <StatCard label="Needs Review"    value={nr}                        color={C.high}   icon="△" />
          <StatCard label="Avg MTTR"        value={avgMttr > 0 ? `${avgMttr}s` : "—"} color={C.med}    icon="⏱" sub="mean time to resolve" />
        </div>

        {/* ── Row 2: sparkline + verdict donut ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 14 }}>
          <div style={{ padding: 16, borderRadius: 10, background: C.panel, border: `1px solid ${C.line}` }}>
            <div style={{ fontSize: 10, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 600, marginBottom: 12 }}>MTTR Trend (last {Math.min(20, filtered.length)} incidents)</div>
            <Sparkline values={mttrSeries} color={C.live} label="mttr" />
            {mttrSeries.length > 1 && (
              <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
                <div><div style={{ fontSize: 9, color: C.mut2 }}>Min</div><div style={{ fontSize: 12, fontWeight: 700, color: C.ok, fontFamily: "'JetBrains Mono',monospace" }}>{Math.min(...mttrSeries)}s</div></div>
                <div><div style={{ fontSize: 9, color: C.mut2 }}>Max</div><div style={{ fontSize: 12, fontWeight: 700, color: C.crit, fontFamily: "'JetBrains Mono',monospace" }}>{Math.max(...mttrSeries)}s</div></div>
                <div><div style={{ fontSize: 9, color: C.mut2 }}>Avg</div><div style={{ fontSize: 12, fontWeight: 700, color: C.live, fontFamily: "'JetBrains Mono',monospace" }}>{avgMttr}s</div></div>
              </div>
            )}
          </div>
          <div style={{ padding: 16, borderRadius: 10, background: C.panel, border: `1px solid ${C.line}` }}>
            <div style={{ fontSize: 10, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 600, marginBottom: 12 }}>Verdict Breakdown</div>
            <VerdictDonut tp={tp} fp={fp} nr={nr} />
          </div>
        </div>

        {/* ── Row 3: technique freq + severity + MTTR by sev ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
          <div style={{ padding: 16, borderRadius: 10, background: C.panel, border: `1px solid ${C.line}` }}>
            <div style={{ fontSize: 10, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 600, marginBottom: 12 }}>Top MITRE Techniques</div>
            {techFreq.length === 0
              ? <div style={{ fontSize: 10, color: C.mut2 }}>No data yet.</div>
              : techFreq.map(([t, c]) => <HBar key={t} label={t} value={c} max={maxTech} color={C.med} />)
            }
          </div>
          <div style={{ padding: 16, borderRadius: 10, background: C.panel, border: `1px solid ${C.line}` }}>
            <div style={{ fontSize: 10, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 600, marginBottom: 12 }}>Severity Distribution</div>
            {["CRITICAL","HIGH","MEDIUM","LOW","INFO"].map(s => (
              <HBar key={s} label={s} value={sevCounts[s] ?? 0} max={total || 1} color={SEV_COLOR[s]} />
            ))}
          </div>
          <div style={{ padding: 16, borderRadius: 10, background: C.panel, border: `1px solid ${C.line}` }}>
            <div style={{ fontSize: 10, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 600, marginBottom: 12 }}>Avg MTTR by Severity</div>
            <MttrBySeverity incidents={filtered} />
          </div>
        </div>

        {/* ── Row 4: agent performance table ── */}
        <div style={{ padding: 16, borderRadius: 10, background: C.panel, border: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 10, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 600, marginBottom: 12 }}>Agent Performance</div>
          {agentPerf.length === 0
            ? <div style={{ fontSize: 10, color: C.mut2 }}>No agents have resolved incidents yet.</div>
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 60px 60px 60px", gap: 10, padding: "4px 8px", borderBottom: `1px solid ${C.line}` }}>
                  {["Agent", "Handled", "Avg MTTR", "TP", "TP%"].map(h => (
                    <div key={h} style={{ fontSize: 8.5, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.4 }}>{h}</div>
                  ))}
                </div>
                {agentPerf.map(a => (
                  <div key={a.label} style={{ display: "grid", gridTemplateColumns: "1fr 60px 60px 60px 60px", gap: 10, padding: "7px 8px", borderBottom: `1px solid ${C.line}20` }}>
                    <div style={{ fontSize: 10.5, color: a.color, fontWeight: 600 }}>{a.label}</div>
                    <div style={{ fontSize: 9.5, color: C.text, fontFamily: "'JetBrains Mono',monospace" }}>{a.count}</div>
                    <div style={{ fontSize: 9.5, color: C.live, fontFamily: "'JetBrains Mono',monospace" }}>{Math.round(a.totalMttr / a.count)}s</div>
                    <div style={{ fontSize: 9.5, color: C.ok,  fontFamily: "'JetBrains Mono',monospace" }}>{a.tp}</div>
                    <div style={{ fontSize: 9.5, color: a.count > 0 && a.tp / a.count > 0.6 ? C.ok : C.high, fontFamily: "'JetBrains Mono',monospace" }}>
                      {Math.round((a.tp / a.count) * 100)}%
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </div>

        {/* ── Row 5: recent incidents table ── */}
        <div style={{ padding: 16, borderRadius: 10, background: C.panel, border: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 10, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 600, marginBottom: 12 }}>
            Recent Resolved Incidents
            <span style={{ marginLeft: 8, color: C.live, fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5 }}>{total}</span>
          </div>
          <RecentTable incidents={filtered} />
        </div>

      </div>
    </div>
  );
}
