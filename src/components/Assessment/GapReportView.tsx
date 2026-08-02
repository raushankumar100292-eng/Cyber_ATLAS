import { useMemo } from "react";
import { useStore } from "../../lib/store";
import { getIndustryProfile, computeIndustryGaps, computeLogSourceGaps } from "../../data/industryKB";
import type { IndustryTechnique } from "../../data/industryKB";

const FONT = `@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500;700&display=swap');`;
const C = {
  bg: "#0C111B", bg2: "#111827", panel: "#161F2E", panelHi: "#1C2738",
  line: "#26324A", text: "#E5EAF3", mut: "#8593AC", mut2: "#6B7A96",
  live: "#33D6C4", crit: "#F1665A", high: "#EFA23C", med: "#5AA6F1", ok: "#4FC98A", purple: "#A78BFA", amber: "#FBBF24",
};
const MONO = "'JetBrains Mono',monospace";

function pctColor(p: number): string {
  return p >= 70 ? C.ok : p >= 40 ? C.amber : C.crit;
}

// ── Circular readiness gauge ────────────────────────────────────────────────────
function Gauge({ pct, label }: { pct: number; label: string }) {
  const R = 46, cx = 56, cy = 56, circ = 2 * Math.PI * R;
  const dash = (pct / 100) * circ;
  const col = pctColor(pct);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <svg width={112} height={112} viewBox="0 0 112 112">
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={C.line} strokeWidth={9} />
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={col} strokeWidth={9} strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`} transform={`rotate(-90 ${cx} ${cy})`} style={{ transition: "stroke-dasharray 0.7s ease" }} />
        <text x={cx} y={cy - 2} textAnchor="middle" fill={col} fontSize={24} fontWeight={700} fontFamily={MONO}>{pct}%</text>
        <text x={cx} y={cy + 16} textAnchor="middle" fill={C.mut2} fontSize={9} fontFamily={MONO}>baseline</text>
      </svg>
      <div style={{ fontSize: 10, color: C.mut2, textAlign: "center" }}>{label}</div>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div style={{ padding: "12px 16px", borderRadius: 10, background: C.panel, border: `1px solid ${color}25`, flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 9, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1, fontFamily: MONO }}>{value}</div>
      {sub && <div style={{ fontSize: 9.5, color: C.mut2, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function Section({ title, count, accent, children }: { title: string; count?: number; accent?: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 16, borderRadius: 10, background: C.panel, border: `1px solid ${C.line}` }}>
      <div style={{ fontSize: 10, color: accent ?? C.mut2, textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 600, marginBottom: 12 }}>
        {title}{count !== undefined && <span style={{ marginLeft: 6, fontFamily: MONO }}>{count}</span>}
      </div>
      {children}
    </div>
  );
}

function TechRow({ t, missing }: { t: IndustryTechnique; missing: boolean }) {
  const col = missing ? C.amber : C.ok;
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderBottom: `1px solid ${C.line}20` }}>
      <span style={{ fontSize: 10, fontFamily: MONO, color: col, minWidth: 62, flexShrink: 0 }}>{t.id}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: C.text }}>
          {t.name} <span style={{ color: C.mut2, fontSize: 9.5 }}>· {t.tactic}</span>
        </div>
        {missing && <div style={{ fontSize: 9.5, color: C.mut, marginTop: 2, lineHeight: 1.45 }}>{t.why}</div>}
      </div>
      <span style={{ fontSize: 8.5, fontFamily: MONO, color: col, flexShrink: 0, marginTop: 1 }}>{missing ? "GAP" : "✓"}</span>
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────────
function EmptyState({ title, body }: { title: string; body: string }) {
  const setView = useStore(s => s.setView);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: C.mut }}>
      <div style={{ fontSize: 32, opacity: 0.5 }}>◎</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{title}</div>
      <div style={{ fontSize: 11, color: C.mut2, maxWidth: 380, textAlign: "center", lineHeight: 1.6 }}>{body}</div>
      <button onClick={() => setView("upload")}
        style={{ marginTop: 6, padding: "7px 16px", borderRadius: 8, border: `1px solid ${C.live}45`, background: `${C.live}12`, color: C.live, fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}>
        Go to Data Upload →
      </button>
    </div>
  );
}

// ── Main view ──────────────────────────────────────────────────────────────────
export default function GapReportView() {
  const coverage      = useStore(s => s.coverage);
  const analysis      = useStore(s => s.useCaseAnalysis);
  const industryKey   = useStore(s => s.industryKey);
  const industryLabel = useStore(s => s.industryLabel);
  const clientName    = useStore(s => s.clientName);

  const profile = getIndustryProfile(industryKey);

  const report = useMemo(() => {
    if (!coverage || !profile) return null;
    const coveredIds = coverage.entries.map(e => e.techniqueId);
    const tech = computeIndustryGaps(profile, coveredIds);
    // Client log sources: union of per-entry logSources + analysis breakdown.
    const srcSet = new Set<string>();
    coverage.entries.forEach(e => (e.logSources ?? []).forEach(s => srcSet.add(s)));
    (analysis?.logSourceBreakdown ?? []).forEach(l => srcSet.add(l.source));
    const logs = computeLogSourceGaps(profile, srcSet);
    // Readiness = techniques weighted 70%, log sources 30%.
    const readiness = Math.round(tech.coveragePct * 0.7 + logs.coveragePct * 0.3);
    return { tech, logs, readiness };
  }, [coverage, profile, analysis]);

  if (!coverage) {
    return (
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", background: C.bg, height: "100%" }}>
        <style>{FONT}</style>
        <EmptyState title="No coverage data yet"
          body="Upload a MITRE coverage or use-case file (with an industry selected) to generate a pre-assessment gap report against that sector's baseline." />
      </div>
    );
  }
  if (!profile) {
    return (
      <div style={{ fontFamily: "'Space Grotesk',sans-serif", background: C.bg, height: "100%" }}>
        <style>{FONT}</style>
        <EmptyState title="No industry selected"
          body="This client was uploaded without an industry, so there's no sector baseline to compare against. Re-run the upload and pick an industry to unlock the gap report." />
      </div>
    );
  }

  const { tech, logs, readiness } = report!;
  const riskLevel = readiness >= 70 ? "Low" : readiness >= 40 ? "Medium" : "High";
  const riskColor = readiness >= 70 ? C.ok : readiness >= 40 ? C.amber : C.crit;

  return (
    <div style={{ fontFamily: "'Space Grotesk',sans-serif", background: C.bg, color: C.text, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{FONT}</style>

      {/* Header */}
      <div style={{ padding: "10px 20px", background: C.bg2, borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Pre-Assessment · Gap Report</div>
          <div style={{ fontSize: 9.5, color: C.mut2, fontFamily: MONO }}>
            {clientName || "Client"} · {industryLabel || profile.label} · vs. sector baseline
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 8, background: `${riskColor}12`, border: `1px solid ${riskColor}35` }}>
          <span style={{ fontSize: 9, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.5 }}>Sector Risk</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: riskColor, fontFamily: MONO }}>{riskLevel}</span>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Top row: gauge + stat cards */}
        <div style={{ display: "flex", gap: 14, alignItems: "stretch", flexWrap: "wrap" }}>
          <div style={{ padding: "12px 20px", borderRadius: 10, background: C.panel, border: `1px solid ${C.line}`, display: "flex", alignItems: "center" }}>
            <Gauge pct={tech.coveragePct} label="technique coverage" />
          </div>
          <StatCard label="Baseline Techniques" value={`${tech.covered.length}/${profile.techniques.length}`} sub={`${tech.missing.length} gap(s) vs. sector`} color={pctColor(tech.coveragePct)} />
          <StatCard label="Log Sources" value={`${logs.present.length}/${profile.logSources.length}`} sub={`${logs.missing.length} likely missing`} color={pctColor(logs.coveragePct)} />
          <StatCard label="Readiness Score" value={`${readiness}%`} sub="techniques 70% · logs 30%" color={riskColor} />
          <StatCard label="Uploaded Coverage" value={coverage.entries.length} sub="techniques in dataset" color={C.med} />
        </div>

        {/* Sector posture */}
        <Section title="Sector Threat Posture" accent={C.purple}>
          <div style={{ fontSize: 11.5, color: C.text, lineHeight: 1.6, marginBottom: 10 }}>{profile.threatProfile}</div>
          <div style={{ fontSize: 9.5, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>Top threat actors targeting {profile.label}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {profile.topThreatActors.map(a => (
              <span key={a} style={{ fontSize: 10, fontFamily: MONO, padding: "3px 9px", borderRadius: 5, color: C.crit, background: `${C.crit}15`, border: `1px solid ${C.crit}30` }}>{a}</span>
            ))}
          </div>
        </Section>

        {/* Prioritized gaps (missing techniques) */}
        <Section title="Prioritized Technique Gaps" count={tech.missing.length} accent={tech.missing.length ? C.amber : C.ok}>
          {tech.missing.length === 0 ? (
            <div style={{ fontSize: 11, color: C.ok }}>✓ Coverage addresses every technique in the {profile.label} baseline. Focus next on depth and detection quality.</div>
          ) : (
            <>
              <div style={{ fontSize: 10, color: C.mut, marginBottom: 4, lineHeight: 1.5 }}>
                These sector-baseline techniques have no matching coverage in the uploaded dataset — highest priority to close, in sector-priority order.
              </div>
              {tech.missing.map(t => <TechRow key={t.id} t={t} missing />)}
            </>
          )}
        </Section>

        {/* Two columns: covered techniques + log source gaps */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Section title="Baseline Techniques Covered" count={tech.covered.length} accent={C.ok}>
            {tech.covered.length === 0
              ? <div style={{ fontSize: 10.5, color: C.mut2 }}>None of the sector-baseline techniques are covered yet.</div>
              : tech.covered.map(t => <TechRow key={t.id} t={t} missing={false} />)}
          </Section>

          <Section title="Log Source Coverage" count={logs.present.length} accent={pctColor(logs.coveragePct)}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {profile.logSources.map(src => {
                const present = logs.present.includes(src);
                return (
                  <div key={src} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, background: present ? `${C.ok}20` : `${C.crit}18`, border: `1px solid ${present ? C.ok : C.crit}45`, color: present ? C.ok : C.crit }}>
                      {present ? "✓" : "✕"}
                    </span>
                    <span style={{ fontSize: 10.5, color: present ? C.text : C.mut2 }}>{src}</span>
                    {!present && <span style={{ fontSize: 8.5, fontFamily: MONO, color: C.crit, marginLeft: "auto" }}>MISSING</span>}
                  </div>
                );
              })}
            </div>
          </Section>
        </div>

        {/* Benchmark note */}
        <div style={{ padding: "10px 14px", borderRadius: 8, background: C.panelHi, border: `1px solid ${C.line}`, fontSize: 9.5, color: C.mut2, lineHeight: 1.6 }}>
          Benchmarked against the ATLAS Industry Knowledge Base for <span style={{ color: C.text }}>{profile.label}</span> — {profile.techniques.length} sector-priority techniques and {profile.logSources.length} expected log sources. Grounded in MITRE ATT&CK + sector threat intelligence, not model guessing. Next step: generate detection use cases for the {tech.missing.length} technique gap(s).
        </div>

      </div>
    </div>
  );
}
