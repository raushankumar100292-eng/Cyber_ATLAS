import { useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import type { ResolvedIncident } from "../../lib/store";

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

// ── IOC type detection ────────────────────────────────────────────────────────
type IocType = "ip" | "domain" | "hash" | "user" | "host" | "other";

function detectIocType(value: string): IocType {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value))                          return "ip";
  if (/^[a-f0-9]{32,64}$/i.test(value))                               return "hash";
  if (value.includes("@"))                                              return "user";
  if (/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$/.test(value)) return "domain";
  if (/^[A-Z0-9_-]{4,}$/i.test(value) && !value.includes("."))        return "host";
  return "other";
}

const IOC_TYPE_COLOR: Record<IocType, string> = {
  ip:     C.crit,
  domain: C.high,
  hash:   C.purple,
  user:   C.amber,
  host:   C.med,
  other:  C.mut2,
};
const IOC_TYPE_ICON: Record<IocType, string> = {
  ip:     "⬤",
  domain: "⬡",
  hash:   "#",
  user:   "✉",
  host:   "□",
  other:  "◇",
};

// ── Build watchlist from resolved incidents ───────────────────────────────────
interface WatchlistEntry {
  value:       string
  type:        IocType
  count:       number
  maxSeverity: string
  severities:  string[]
  incidents:   { procId: string; title: string; resolvedAt: number; verdict: string }[]
  lastSeen:    number
}

function buildWatchlist(incidents: ResolvedIncident[]): WatchlistEntry[] {
  const map = new Map<string, WatchlistEntry>();

  incidents.forEach(inc => {
    inc.iocs.forEach(raw => {
      const value = raw.trim();
      if (!value || value === "undefined" || value === "null" || value.length < 3) return;

      const existing = map.get(value);
      const entry: WatchlistEntry = existing ?? {
        value,
        type: detectIocType(value),
        count: 0,
        maxSeverity: inc.alert.severity,
        severities: [],
        incidents: [],
        lastSeen: inc.resolvedAt,
      };

      entry.count++;
      entry.severities.push(inc.alert.severity);
      entry.incidents.push({ procId: inc.procId, title: inc.alert.title, resolvedAt: inc.resolvedAt, verdict: inc.verdict });
      entry.lastSeen = Math.max(entry.lastSeen, inc.resolvedAt);

      // Keep highest severity
      const curIdx = SEV_ORDER.indexOf(entry.maxSeverity);
      const newIdx = SEV_ORDER.indexOf(inc.alert.severity);
      if (newIdx < curIdx) entry.maxSeverity = inc.alert.severity;

      map.set(value, entry);
    });
  });

  return Array.from(map.values()).sort((a, b) => {
    const sevDiff = SEV_ORDER.indexOf(a.maxSeverity) - SEV_ORDER.indexOf(b.maxSeverity);
    if (sevDiff !== 0) return sevDiff;
    return b.count - a.count;
  });
}

// ── Type badge ────────────────────────────────────────────────────────────────
function TypeBadge({ type }: { type: IocType }) {
  const color = IOC_TYPE_COLOR[type];
  return (
    <span style={{ fontSize: 8, color, background: `${color}14`, border: `1px solid ${color}28`, borderRadius: 4, padding: "1px 6px", textTransform: "uppercase", letterSpacing: 0.4, fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>
      {IOC_TYPE_ICON[type]} {type}
    </span>
  );
}

// ── Entry row ─────────────────────────────────────────────────────────────────
function WatchlistRow({ entry }: { entry: WatchlistEntry }) {
  const [open, setOpen] = useState(false);
  const sevColor = SEV_COLOR[entry.maxSeverity] ?? C.mut2;
  const copied   = useState(false);

  function copy() {
    navigator.clipboard.writeText(entry.value).catch(() => {});
    copied[1](true);
    setTimeout(() => copied[1](false), 1500);
  }

  return (
    <div style={{ background: open ? C.panelHi : "transparent", borderBottom: `1px solid ${C.line}20`, transition: "background 0.15s" }}>
      {/* Main row */}
      <div onClick={() => setOpen(o => !o)} style={{ display: "grid", gridTemplateColumns: "18px 90px 1fr 55px 60px 70px 60px", gap: 10, padding: "8px 12px", cursor: "pointer", alignItems: "center" }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: sevColor, boxShadow: `0 0 5px ${sevColor}80`, flexShrink: 0 }} />
        <TypeBadge type={entry.type} />
        <div style={{ fontSize: 10.5, color: C.text, fontFamily: "'JetBrains Mono',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={entry.value}>
          {entry.value}
        </div>
        <div style={{ fontSize: 9.5, color: sevColor, fontWeight: 700, textAlign: "center" }}>{entry.maxSeverity[0]}</div>
        <div style={{ fontSize: 9.5, color: C.live, textAlign: "center", fontFamily: "'JetBrains Mono',monospace" }}>{entry.count}×</div>
        <div style={{ fontSize: 9, color: C.mut2, fontFamily: "'JetBrains Mono',monospace", textAlign: "right" }}>
          {new Date(entry.lastSeen).toLocaleTimeString([], { hour12: false })}
        </div>
        <span style={{ fontSize: 10, color: C.mut2, textAlign: "right" }}>{open ? "▲" : "▼"}</span>
      </div>

      {/* Expanded: linked incidents */}
      {open && (
        <div style={{ padding: "0 12px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.5 }}>Linked Incidents</div>
            <button onClick={e => { e.stopPropagation(); copy(); }}
              style={{ fontSize: 8.5, color: copied[0] ? C.ok : C.live, background: "transparent", border: `1px solid ${C.live}30`, borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit", marginLeft: "auto" }}>
              {copied[0] ? "✓ copied" : "⎘ copy IOC"}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {entry.incidents.map((inc, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 8px", borderRadius: 6, background: C.bg2 }}>
                <span style={{ fontSize: 9, color: C.purple, fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{inc.procId}</span>
                <span style={{ fontSize: 9.5, color: C.mut, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inc.title}</span>
                <span style={{ fontSize: 8.5, color: inc.verdict === "True Positive" ? C.crit : inc.verdict === "False Positive" ? C.mut2 : C.high, flexShrink: 0 }}>
                  {inc.verdict === "True Positive" ? "TP" : inc.verdict === "False Positive" ? "FP" : "NR"}
                </span>
                <span style={{ fontSize: 8.5, color: C.mut2, fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>
                  {new Date(inc.resolvedAt).toLocaleTimeString([], { hour12: false })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function IocWatchlistView() {
  const incidents = useStore(s => s.resolvedIncidents);

  const [search,     setSearch]     = useState("");
  const [typeFilter, setTypeFilter] = useState<IocType | "all">("all");
  const [minCount,   setMinCount]   = useState(1);

  const allEntries = useMemo(() => buildWatchlist(incidents), [incidents]);

  const filtered = useMemo(() => {
    return allEntries.filter(e => {
      if (typeFilter !== "all" && e.type !== typeFilter) return false;
      if (e.count < minCount) return false;
      if (search.trim() && !e.value.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [allEntries, typeFilter, minCount, search]);

  // Summary by type
  const byType = useMemo(() => {
    const m: Partial<Record<IocType, number>> = {};
    allEntries.forEach(e => { m[e.type] = (m[e.type] ?? 0) + 1; });
    return m;
  }, [allEntries]);

  const types: IocType[] = ["ip", "domain", "hash", "user", "host", "other"];

  return (
    <div style={{ fontFamily: "'Space Grotesk', sans-serif", background: C.bg, color: C.text, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{FONT}</style>

      {/* Header */}
      <div style={{ padding: "10px 20px", background: C.bg2, borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>IOC Watchlist</div>
          <div style={{ fontSize: 9.5, color: C.mut2, fontFamily: "'JetBrains Mono',monospace" }}>
            aggregated indicators of compromise — {allEntries.length} unique IOCs from {incidents.length} incidents
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {/* Type summary chips */}
        <div style={{ display: "flex", gap: 6 }}>
          {types.filter(t => byType[t]).map(t => (
            <div key={t} style={{ padding: "3px 8px", borderRadius: 6, background: `${IOC_TYPE_COLOR[t]}10`, border: `1px solid ${IOC_TYPE_COLOR[t]}25`, textAlign: "center" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: IOC_TYPE_COLOR[t], fontFamily: "'JetBrains Mono',monospace" }}>{byType[t]}</div>
              <div style={{ fontSize: 8, color: C.mut2, textTransform: "uppercase" }}>{t}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ padding: "8px 20px", background: C.bg, borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
        {/* Search */}
        <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.mut2, fontSize: 11 }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search IOCs…"
            style={{ width: "100%", height: 30, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 7, padding: "0 10px 0 28px", color: C.text, fontSize: 10, fontFamily: "'JetBrains Mono',monospace", outline: "none", boxSizing: "border-box" }} />
        </div>

        {/* Type filter */}
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setTypeFilter("all")}
            style={{ padding: "3px 10px", borderRadius: 5, border: `1px solid ${typeFilter === "all" ? C.live + "55" : C.line}`, background: typeFilter === "all" ? `${C.live}10` : "transparent", color: typeFilter === "all" ? C.live : C.mut2, fontSize: 9, fontFamily: "inherit", cursor: "pointer" }}>
            All
          </button>
          {types.map(t => (
            <button key={t} onClick={() => setTypeFilter(typeFilter === t ? "all" : t)}
              style={{ padding: "3px 10px", borderRadius: 5, border: `1px solid ${typeFilter === t ? IOC_TYPE_COLOR[t] + "55" : C.line}`, background: typeFilter === t ? `${IOC_TYPE_COLOR[t]}12` : "transparent", color: typeFilter === t ? IOC_TYPE_COLOR[t] : C.mut2, fontSize: 9, fontFamily: "inherit", cursor: "pointer" }}>
              {t}
            </button>
          ))}
        </div>

        {/* Min frequency */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: C.mut2 }}>Min freq:</span>
          {[1, 2, 3].map(n => (
            <button key={n} onClick={() => setMinCount(n)}
              style={{ padding: "3px 8px", borderRadius: 5, border: `1px solid ${minCount === n ? C.amber + "55" : C.line}`, background: minCount === n ? `${C.amber}10` : "transparent", color: minCount === n ? C.amber : C.mut2, fontSize: 9, fontFamily: "inherit", cursor: "pointer" }}>
              {n}+
            </button>
          ))}
        </div>

        <span style={{ marginLeft: "auto", fontSize: 9, color: C.mut2 }}>{filtered.length} of {allEntries.length} shown</span>
      </div>

      {/* Table header */}
      <div style={{ display: "grid", gridTemplateColumns: "18px 90px 1fr 55px 60px 70px 60px", gap: 10, padding: "6px 12px", background: C.bg2, borderBottom: `1px solid ${C.line}`, flexShrink: 0 }}>
        {["", "Type", "Indicator", "Sev", "Freq", "Last Seen", ""].map((h, i) => (
          <div key={i} style={{ fontSize: 8.5, color: C.mut2, textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 600 }}>{h}</div>
        ))}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {incidents.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 260, textAlign: "center", gap: 10 }}>
            <div style={{ fontSize: 28, opacity: 0.3 }}>⬡</div>
            <div style={{ fontSize: 12, color: C.mut2 }}>No IOCs yet</div>
            <div style={{ fontSize: 10, color: C.mut2, maxWidth: 300 }}>
              IOCs are extracted automatically when the Agentic SOC resolves incidents. Run alerts through the SOC Operations view to populate this watchlist.
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 120, color: C.mut2, fontSize: 10 }}>
            No IOCs match the current filter.
          </div>
        ) : (
          filtered.map(e => <WatchlistRow key={e.value} entry={e} />)
        )}
      </div>
    </div>
  );
}
