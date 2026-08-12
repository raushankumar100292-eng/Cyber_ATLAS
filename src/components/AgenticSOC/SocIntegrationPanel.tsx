// ─────────────────────────────────────────────────────────────────────────────
// SOC Integration Panel — Step 4
//
// UI for configuring VirusTotal, AbuseIPDB, and Mock enrichment providers.
// API keys are masked in the UI and never printed to logs.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { useStore } from "../../lib/store";
import { maskApiKey, testProviderConnection } from "../../agents/enrichment/enrichment-service";
import type { EnrichmentProvider } from "../../agents/enrichment/enrichment-types";

const C = {
  bg:      "#161F2E",
  border:  "#26324A",
  text:    "#E5EAF3",
  mut:     "#8593AC",
  live:    "#33D6C4",
  crit:    "#F1665A",
  high:    "#EFA23C",
  ok:      "#4FC98A",
  panel:   "#0C111B",
};

interface ProviderRowProps {
  id:        EnrichmentProvider;
  label:     string;
  needsKey:  boolean;
  tagColor:  string;
  tagLabel:  string;
}

function ProviderRow({ id, label, needsKey, tagColor, tagLabel }: ProviderRowProps) {
  const socIntegrations  = useStore(s => s.socIntegrations);
  const setSocIntegration = useStore(s => s.setSocIntegration);
  const cfg = socIntegrations[id];

  const [editing,    setEditing]    = useState(false);
  const [draft,      setDraft]      = useState("");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMsg,    setTestMsg]    = useState("");

  const handleToggle = () => {
    setSocIntegration(id, { enabled: !cfg.enabled });
  };

  const handleSaveKey = () => {
    setSocIntegration(id, { apiKey: draft.trim() });
    setDraft("");
    setEditing(false);
    setTestStatus("idle");
  };

  const handleTest = async () => {
    setTestStatus("testing");
    setTestMsg("");
    const key = needsKey ? cfg.apiKey : "";
    const result = await testProviderConnection(id, { enabled: true, apiKey: key });
    setTestStatus(result.ok ? "ok" : "fail");
    setTestMsg(result.message);
  };

  const masked = needsKey ? maskApiKey(cfg.apiKey) : "—";
  const hasKey = !needsKey || Boolean(cfg.apiKey?.trim());

  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: "12px 14px", marginBottom: 10,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        {/* Toggle */}
        <button
          onClick={handleToggle}
          title={cfg.enabled ? "Disable" : "Enable"}
          style={{
            width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer",
            background: cfg.enabled ? C.live : C.border,
            position: "relative", flexShrink: 0, transition: "background 0.2s",
          }}
        >
          <span style={{
            position: "absolute", top: 2, left: cfg.enabled ? 18 : 2,
            width: 16, height: 16, borderRadius: "50%",
            background: cfg.enabled ? "#fff" : C.mut,
            transition: "left 0.2s",
          }} />
        </button>

        <span style={{ color: C.text, fontWeight: 600, fontSize: 13, flex: 1 }}>{label}</span>

        <span style={{
          fontSize: 10, padding: "2px 8px", borderRadius: 10,
          background: tagColor + "22", color: tagColor, fontWeight: 700,
        }}>{tagLabel}</span>

        {cfg.enabled && (
          <span style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 10,
            background: hasKey ? C.ok + "22" : C.high + "22",
            color: hasKey ? C.ok : C.high, fontWeight: 700,
          }}>
            {hasKey ? "configured" : "no key"}
          </span>
        )}
      </div>

      {/* API key row */}
      {needsKey && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          {editing ? (
            <>
              <input
                type="password"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleSaveKey(); if (e.key === "Escape") setEditing(false); }}
                placeholder="Paste API key…"
                autoFocus
                style={{
                  flex: 1, background: "#0a0f18", border: `1px solid ${C.live}`,
                  color: C.text, borderRadius: 6, padding: "5px 10px", fontSize: 12,
                  fontFamily: "JetBrains Mono, monospace", outline: "none",
                }}
              />
              <button onClick={handleSaveKey} style={{
                background: C.live, color: "#000", border: "none", borderRadius: 6,
                padding: "5px 12px", fontSize: 12, cursor: "pointer", fontWeight: 700,
              }}>Save</button>
              <button onClick={() => setEditing(false)} style={{
                background: C.border, color: C.mut, border: "none", borderRadius: 6,
                padding: "5px 10px", fontSize: 12, cursor: "pointer",
              }}>Cancel</button>
            </>
          ) : (
            <>
              <span style={{
                flex: 1, fontFamily: "JetBrains Mono, monospace", fontSize: 12,
                color: cfg.apiKey ? C.mut : C.crit, letterSpacing: 1,
              }}>
                {cfg.apiKey ? masked : "not set"}
              </span>
              <button onClick={() => { setDraft(""); setEditing(true); }} style={{
                background: C.border, color: C.mut, border: "none", borderRadius: 6,
                padding: "4px 10px", fontSize: 11, cursor: "pointer",
              }}>
                {cfg.apiKey ? "Change" : "Set key"}
              </button>
            </>
          )}
        </div>
      )}

      {/* Test connection */}
      {cfg.enabled && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={handleTest}
            disabled={testStatus === "testing" || (!needsKey ? false : !cfg.apiKey)}
            style={{
              background: C.border, color: testStatus === "testing" ? C.mut : C.text,
              border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 11,
              cursor: testStatus === "testing" ? "wait" : "pointer",
            }}
          >
            {testStatus === "testing" ? "Testing…" : "Test connection"}
          </button>
          {testStatus === "ok"   && <span style={{ color: C.ok,   fontSize: 11 }}>✓ {testMsg}</span>}
          {testStatus === "fail" && <span style={{ color: C.crit, fontSize: 11 }}>✗ {testMsg}</span>}
        </div>
      )}
    </div>
  );
}

interface Props {
  onClose: () => void;
}

export default function SocIntegrationPanel({ onClose }: Props) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12,
          width: 420, maxHeight: "85vh", overflowY: "auto",
          padding: 20, boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <span style={{ color: C.live, fontSize: 16, marginRight: 8 }}>◎</span>
          <h3 style={{ margin: 0, color: C.text, fontSize: 15, fontWeight: 700, flex: 1 }}>
            Threat Intel Integrations
          </h3>
          <button onClick={onClose} style={{
            background: "none", border: "none", color: C.mut,
            fontSize: 18, cursor: "pointer", lineHeight: 1,
          }}>×</button>
        </div>

        <p style={{ color: C.mut, fontSize: 12, margin: "0 0 16px", lineHeight: 1.5 }}>
          Enable providers to enrich IOCs (IPs, domains, file hashes) during the SOC Enrich stage.
          API keys are stored in localStorage only — never committed to source.
        </p>

        <ProviderRow
          id="virustotal"
          label="VirusTotal"
          needsKey={true}
          tagColor="#3b82f6"
          tagLabel="4 req/min"
        />
        <ProviderRow
          id="abuseipdb"
          label="AbuseIPDB"
          needsKey={true}
          tagColor="#8b5cf6"
          tagLabel="1K/day · IPv4"
        />
        <ProviderRow
          id="mock"
          label="Mock Provider"
          needsKey={false}
          tagColor={C.ok}
          tagLabel="Testing"
        />

        {/* Rate limit note */}
        <p style={{ color: C.mut, fontSize: 11, margin: "12px 0 0", lineHeight: 1.6 }}>
          VT free tier: 4 req/min. AbuseIPDB free: 1,000/day.
          Results are cached for 30 min to conserve quota.
        </p>
      </div>
    </div>
  );
}
