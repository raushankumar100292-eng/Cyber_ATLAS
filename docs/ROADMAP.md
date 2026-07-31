# ATLAS — Production-Grade Roadmap

Living plan to take ATLAS from a strong demo/POC to a production-grade, AI-native
security operations platform. Expect add-ons and course-corrections as we build.

> **Branch policy:** all development on `v0.2`. `main` / the `v0.1` tag stay frozen —
> they feed the live GitHub Pages site (`https://raushankumar100292-eng.github.io/Cyber_ATLAS/`)
> and must not be disrupted by in-progress work.

---

## Guiding principles
- **Deterministic hands, adaptive brain** — AI *decides*; SOAR/connectors *execute* (auditable). Never let the LLM be the action layer.
- **Augment before automate** — ML ranks & explains; humans gate high-impact / low-confidence actions.
- **Calibrated confidence** — auto-close only where the system is *measurably* right at that confidence band.
- **The data flywheel is the moat** — capture every alert, verdict, and analyst decision cleanly; that labeled corpus powers all the ML.
- **Demo parity** — build UX on `v0.2` with *simulated* connectors/data before the real backend lands, so there is always something clickable.

---

## Current state (what exists today)
- React + TypeScript + Vite, Zustand state, Three.js globe, Framer Motion, Tailwind.
- **Agentic SOC Operation** — Master Agent + specialized child agents; pipeline Triage → Investigate → Enrich → Insight → Respond → Resolved; Groq-powered deep analysis; approval gate for critical destructive actions.
- **Alert Generator** — synthetic SIEM alerts across all 14 MITRE tactics; manual, auto (timer), and sequential rotate; local synthetic fallback when no Groq key; cross-tab sync (BroadcastChannel).
- **Agent Hub** — catalog/registry of seeded + SOC-trained agents (mirrored via the shared store, persisted to localStorage).
- **ACN Assistant** — Accenture-branded, voice-first; immersive full-screen multi-agent mode ("Tik Tik ON"), chat mode, Gemini-backed decompose → agents → synthesize.
- **SOAR Engineer** — AI Playbook Builder (NL/file → visual flow → export to Chronicle / Sentinel / Splunk SOAR / YAML / ZIP). *(Stats, Recent Runs, Integrations are currently mock.)*
- **SOC Analytics / IOC Watchlist / Campaigns** — read the in-memory resolved-incident history (session-scoped).
- **Client type (industry)** — captured on upload (15 industries), stored + displayed. *(Not yet driving analysis.)*
- **MS Access DB service** (`db_service/`) — optional local FastAPI + pyodbc; Alerts / Incidents / Triage / Iocs / Analytics / Campaigns tables.

## Known gaps (the "why" behind the phases)
- **Browser-only** — no backend; secrets/API keys can't live safely in the browser.
- **Persistence** — resolved incidents not saved locally; full analysis (`reasoning` + Splunk/KQL queries) is thrown away; no investigation-history review UI.
- **No real threat-intel enrichment** — VirusTotal / AbuseIPDB / MISP references are cosmetic/LLM-simulated, never real API calls.
- **No real SOAR dispatch** — export-only; Recent Runs / stats are mock.
- **No ITSM** — no ServiceNow/Jira system of record.
- **Verdicts partly heuristic/random** — only the Groq first-run path is real analysis; reuse and no-key paths use heuristics.
- **Agent Hub is a mirror, not a control plane** — editing an agent doesn't change how it actually runs.
- **Client type is informational** — industry doesn't yet tailor the MITRE analysis.

---

## Master phased roadmap

### Phase 0 — Stabilize & harden the current build *(v0.2, low effort, high trust)*
- Keep CI/deploy green; add typecheck + lint + smoke test to the pipeline.
- **Persist the full investigation** — save `reasoning` + Splunk/KQL queries; persist `resolvedIncidents` so history survives reloads.
- **Investigation-history / case-review UI** — searchable past incidents; reopen full case file (attack chain, IOCs, queries, verdict, reasoning, mind map).
- Clearly label or remove mock data (SOAR stats, Recent Runs, Integrations).
- Code-split the large bundle (perf).
- **Done when:** nothing is silently lost, past cases are reviewable, build is reliably green.

### Phase 1 — Backend & platform foundation *(prerequisite for anything "production")*
- **Backend service** (extend `db_service` → proper API, or Node) — move all LLM/API calls server-side.
- **PostgreSQL** replacing MS Access (multi-tenant, concurrent).
- **Secrets vault** (Key Vault / HashiCorp) — connector creds referenced by DB, never stored in it or the browser.
- **AuthN/AuthZ** — SSO/OIDC, RBAC, tenant scoping.
- **Audit log** — every action & AI decision recorded with its evidence.
- **Done when:** users log in, data in Postgres, secrets vaulted, all actions audited.

### Phase 2 — Data flywheel & real detection input
- **Normalized schema** — alerts, incidents, executions, triage decisions, IOCs, **analyst feedback labels**.
- **Real SIEM ingestion connectors** (Splunk / Sentinel / Chronicle via API/webhook); synthetic generator stays for demo/testing.
- **Feedback capture** — every approve/escalate/FP-override stored as a ground-truth label.
- **Done when:** real alerts flow in and every human decision becomes labeled training data.

### Phase 3 — Real enrichment & response integrations
- **IOC enrichment proxy** — VirusTotal + AbuseIPDB (+ GreyNoise), server-side, cached.
- **Real SOAR dispatch connectors** — Chronicle/Sentinel/Splunk SOAR, bidirectional (dispatch + telemetry back).
- **ITSM connector** (ServiceNow/Jira) — ticket lifecycle as the **system of record** (create on ingest → enrich → transition → close), bidirectional sync.
- **Evidence-grounded verdicts** — retire heuristic/random verdict paths; base every verdict on real analysis + enrichment.
- **Done when:** incidents are enriched with real intel, actioned via real SOAR, recorded in ITSM.

### Phase 4 — ML intelligence layer *(the grounded "revolution")*
- **ML alert triage** — dedup + clustering + TP/FP classifier trained on analyst feedback → collapse the flood into a few **cases** (highest-ROI; complements SOAR's rule-based dedup, does not replace it).
- **Attack-narrative graph** — stitch related alerts into one MITRE-mapped campaign story with an LLM narrative.
- **Multi-agent debate** — ACN cross-examination round (agents challenge/validate/refine) for decision quality + less hallucination.
- **Calibrated confidence → confidence-gated autonomy** — auto-resolve only proven-safe bands; escalate the rest.
- *Then:* UEBA anomaly detection, predictive next-move (ATT&CK transition modeling), **dynamic run-time playbook synthesis** (for the long-tail / correlated / novel cases fixed playbooks can't pre-cover).
- **Done when:** analysts see ranked cases + narratives, and the system measurably improves from feedback.

### Phase 5 — Multi-tenant MSSP control plane *(the 20-client "AI OS")*
- **Client/tenant workspaces** — roster, per-client connections/policies/guardrails.
- **Routing Agent** (dispatch the right flow per client) + **Telemetry Agent** (ingest-and-store per client; webhooks + incremental pull with a per-client cursor) + **SME Reporting Agent** (per-client + cross-project fleet reports, auto-generated).
- **Fleet dashboard** — health ranking, cross-project benchmarking, **MITRE coverage roll-up**.
- **Data model note:** SME reports read our **own DB** (system of record for reporting); live SOAR queries only for on-demand real-time drill-down. (Ingest-and-store, query-locally.)
- **Done when:** one SME oversees 20 clients and the AI writes per-client + fleet reports.

### Phase 6 — Production hardening & scale
- Reliability (retries, DLQ, rate-limit/back-pressure, model fallback); observability (metrics, tracing, alerting); scale (job queue + time-series/OLAP store for telemetry).
- Security & compliance (pen-test, SOC 2, data retention/PII); cost controls (token budgets, caching, cheaper-model routing); docs, runbooks, onboarding.
- **Done when:** it survives real load, passes security review, and is operable by a team.

### Sequencing at a glance
```
0 Harden ─▶ 1 Backend/Auth/DB ─▶ 2 Data + real SIEM ─▶ 3 Enrichment/SOAR/ITSM ─▶ 4 ML layer ─▶ 5 MSSP control plane ─▶ 6 Hardening
        (v0.2 demo)              (needs infra ────────────────────────────────────────────────────────────────────────▶)
```
Phase 0 is pure `v0.2`. Phases 4–5 UX can be prototyped on `v0.2` with **simulated** connectors while the real backend (1–3) is built underneath.

---

## Cross-cutting track — Agent Hub / Agent Governance
**Reframe:** Agent Hub is not a settings page — it is the **control plane for the AI workforce** (the SOC specialist agents, ACN's multi-agents, and the MSSP routing/telemetry/SME agents). Just as MSSP manages *clients* and SOAR manages *playbooks*, **Agent Hub manages the *agents themselves*** — their config, autonomy, performance, versions, and deployment. It is the human-governance seam that makes an agentic SOC trustworthy for production.

**Current gap:** editing an agent in the Hub does **not** change how it runs (agents are defined in code; the Hub only mirrors them).

Evolution mapped to the phases:
- **Phase 0–1 — source of truth that drives runtime:** agent config becomes real (model, persona/prompt, tools, autonomy level, confidence thresholds, guardrails); SOC/ACN agents *read their behavior from the Hub* (config → runtime). Persist to backend DB; version agents.
- **Phase 2 — observability:** per-agent metrics (verdict accuracy, TP/FP rate, reuse, tokens/cost, MTTR contribution, drift); full audit of what each agent decided and why.
- **Phase 3–4 — lifecycle & improvement:** feedback-driven retraining; A/B test agent versions and promote the winner; per-agent human-in-the-loop policy (auto-act vs. approval gate); skill definition/versioning/sharing.
- **Phase 5 — fleet & marketplace:** per-tenant agent assignment (which agents run for which client, with client-specific config/guardrails); cross-project reuse ("proven agent from Client A → Client B"); governance/RBAC over who can create/edit/promote.
- **Phase 6 — cost & safety governance:** per-agent token budgets, rate limits, model fallback; guardrail/safety review; per-agent kill-switch.

**First concrete step (Phase 0/1):** make agent config in the Hub actually drive the SOC/ACN agents' behavior — turn it from a mirror into a real control plane.

---

## Feature track — Industry-Driven Assessment & Use-Case Generation

**Rating: 8.2 / 10 — strong, high-potential.** This is the connective tissue that makes ATLAS a *product* (assess → generate → train → deploy → improve) rather than a set of features. The key insight: the **Alert Generator becomes the coverage-testing & agent-training harness**, not just a demo toy — synthetic alerts bootstrap/validate coverage; real alerts + analyst feedback deliver accuracy.

**The loop:**
```
1. Client type (industry) ─▶ 2. Pre-assessment: match vs. predefined industry baseline
                                 (typical log sources + expected MITRE techniques)
                                      │
3. Compare vs. client's uploaded data ─▶ identify MITRE COVERAGE GAPS
                                      │
4. AI agents GENERATE use cases  ─────▶ detections to close each gap
                                      │
5. Alert Generator synthesizes varied ─▶ TRAIN / VALIDATE agents on the new use cases
   alerts for those use cases              │
6. Production SIEM alerts replace     ─▶ agents run at HIGHER ACCURACY (real + feedback)
   synthetic
```

### Critical success factors (get these right or it hollows out)
1. **Industry Knowledge Base is the moat — and the hard part.** Curated mapping `industry → {typical log sources, relevant MITRE techniques / threat profile}`. Must NOT be pure LLM guessing (hallucination kills credibility) — seed from ATT&CK + industry threat reports + expert input; store as real data; improve over time.
2. **Use-case generation must be grounded, not generic.** Each output: name, technique, required log source (that the client actually has), detection logic (SPL/KQL/Sigma), priority, rationale — testable, not prose.
3. **Accuracy comes from real *feedback*, not just real alerts.** Synthetic = bootstrap & coverage validation; real alerts + analyst ground-truth labels = accuracy. Agents trained only on heuristic-labeled synthetic data can learn wrong patterns.

### Sub-phases
- **A — Industry Knowledge Base + make client-type functional** *(v0.2, foundational/keystone)*
  - Build the curated `industry → {log sources, MITRE techniques/threat profile}` dataset (seed the existing 15 industries).
  - Wire `industryLabel` into the analysis (today it's only stored/displayed).
- **B — Pre-Assessment / Gap Report** *(v0.2, high visible value)*
  - Compare the client's uploaded coverage vs. the industry baseline → gaps (missing techniques + missing log sources).
  - Industry-tailored report: current coverage %, industry-expected posture, prioritized gaps, likely-missing log sources, sector benchmark.
- **C — AI Use-Case Generation** *(v0.2 demo; grounded)*
  - For each gap, generate a detection use case (name, technique, required log source, SPL/KQL/Sigma logic, priority, rationale) grounded in the client's available log sources; project coverage uplift.
- **D — Alert-Gen Training & Validation Loop** *(v0.2, ties it together)*
  - Extend the Alert Generator to synthesize technique/use-case-driven varied alerts for each generated use case.
  - Run through the Agentic SOC → validate the use case detects/handles + train the specialist agent → measure coverage uplift + agent accuracy on the synthetic set.
- **E — Production integration + true accuracy** *(needs backend; MSSP)*
  - Swap synthetic feed for real SIEM alerts; capture analyst feedback labels → real accuracy improvement (the flywheel).
  - Instantiate the loop per client in the MSSP control plane; industry-tailored SME reports.

**Plug-in:** A–D are largely doable on `v0.2` (demo-grade, simulated); E depends on the backend + real SIEM/feedback (master Phases 1–2). **Phase A (Industry Knowledge Base) is the keystone dependency for everything else in this track.**

---

## Cross-cutting track — Data Privacy & Governance

**Biggest unaddressed risk today.** When agents "work on" an alert, they send its full
content to a third-party LLM (Groq/Gemini). Alerts contain PII (users/emails), network
detail (internal IPs/hostnames), and raw logs that may hold credentials, tokens, PHI, or
cardholder data. Today that data leaves the environment with **no redaction, browser-held
keys, no tenant isolation, no residency control, and no audit** — safe only because the
demo uses **synthetic** alerts (a genuine privacy advantage of the Alert Generator). The
moment real client alerts flow in, this is not production-safe.

**Regulatory stakes:** GDPR (PII, residency, processor agreements), HIPAA (PHI), PCI-DSS
(cardholder data), client confidentiality/NDA, and **cross-tenant leakage** (Client A's
data must never appear in Client B's context).

**Principle:** *Sanitize at the boundary, isolate per tenant, prefer private/zero-retention
models, and audit everything. The LLM sees the shape of the threat, not the client's raw
secrets.*

Controls, mapped to phases:
- **Phase 1 (non-negotiable foundation):** keys server-side + secrets vault; encryption in
  transit/at rest; the redaction/tokenization layer (below); strict per-tenant isolation
  (no cross-tenant data in one context).
- **Phase 3:** DPA with any LLM provider; data-residency pinning per client; retention &
  deletion / right-to-erasure.
- **Phase 6:** compliance (SOC 2, HIPAA/PCI as needed), pen-test, audit review.
- **`v0.2` interim:** keep using **synthetic alerts** — no real privacy exposure while data is fake.

### Component — Local Enrichment & Tokenization Layer *(privacy + accuracy cornerstone)*
Enrich and sanitize each alert **locally, inside the trust boundary, before** any LLM sees
it; then **de-tokenize** the LLM's output and route real values to SOAR/ITSM/DB. This is the
concrete implementation of the privacy principle **and** it makes the agents *more* accurate.

```
Raw alert
   ─────────────── LOCAL (inside boundary) ───────────────
   1. Parse & normalize                                  (scripting)
   2. ENRICH locally: GeoIP, asset criticality, internal (local ML + lookups)
      threat-intel, UEBA/anomaly score, cached reputation,
      dedup/cluster, TP/FP pre-score
   3. REDACT & TOKENIZE: user@corp.com → <USER_1>,        (scripting + PII/NER model)
      10.2.3.4 → <IP_1>, host → <HOST_1>
      → token↔real MAP kept LOCAL (never sent out)
   ────────────────────────────────────────────────────────
        │  send SANITIZED + enriched context only
        ▼
   LLM agents reason on structure + local intel (not raw identities)
        │  returns decision/analysis (references <IP_1>, <USER_1>…)
        ▼
   ─────────────── LOCAL ───────────────
   4. RE-MAP tokens → real values          (de-tokenize via local map)
   5. Route to SOAR / ITSM / DB with REAL, actionable values
```

**Local ML + scripting does:** PII/entity detection for redaction (e.g. Presidio),
anomaly/UEBA scoring, TP/FP classification, dedup/clustering, local embeddings for
similarity/RAG over past incidents, and local lookups (GeoIP, asset inventory, cached
reputation, blocklists).

**Dual win:** (a) **privacy** — raw identities/secrets never leave; (b) **accuracy** — the
LLM gets real local ground-truth (reputation, criticality, anomaly score) instead of
guessing; (c) **cost/latency** — local ML does the bulk cheaply, LLM only reasons on the
distilled sanitized case.

**Caveats (for it to actually be safe):**
1. **Robust redaction** — a missed field leaks; use a proven library + allow-lists, and add
   **defense-in-depth** with an **on-prem/private LLM** for the most sensitive clients.
2. **Consistent-but-scoped tokenization** — same value → same token *within* a case (so the
   LLM can correlate), but **unique per case/tenant** (no leakage across incidents/clients).
3. **Derive facts before redacting** — some analysis needs the real value ("is this IP
   internal?"); compute it locally first and pass the *derived fact*, not the raw value.
4. **The token map is sensitive** — keep it local/vaulted and ephemeral; never persist with
   the LLM transcript.

**Lands in:** Phase 1 (redaction + local-enrichment service + ephemeral map), Phase 3 (real
reputation/asset lookups), Phase 4 (local ML scoring/clustering that enriches before the LLM).

---

## Notes on scope discipline
- SOAR's rule-based dedup/correlation already collapses known, high-volume alerts — keep deterministic playbooks for the predictable majority. Dynamic synthesis / ML triage target the **long-tail, context-dependent, correlated, and new-detection** cases fixed rules can't pre-cover.
- ITSM (ServiceNow/Jira) is the **incident system of record** in production; ATLAS orchestrates and transitions the ticket, syncing bidirectionally.
- External enrichment and all production connectors require the backend proxy (no direct browser calls — CORS + secret exposure).
