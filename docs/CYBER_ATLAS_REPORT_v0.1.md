# Cyber ATLAS — Command Center

**Version 0.1** · Snapshot report

Cyber ATLAS is a browser-based, AI-assisted cybersecurity command center built around
the MITRE ATT&CK framework. It combines an interactive coverage navigator with a live
**Agentic SOC** pipeline, synthetic alert generation, an agent hub, local database
persistence, and a voice assistant.

- **Repository:** `raushankumar100292-eng/Cyber_ATLAS`
- **App name:** `atlas-command-center`
- **Stack:** React + TypeScript + Vite, Zustand (state), Three.js (globe), Framer Motion,
  Tailwind. Optional Python (FastAPI) service for MS Access persistence.
- **AI providers:** Groq (SOC agent analysis + alert generation), Google Gemini (ACN voice assistant).

---

## 1. Views / modules

| View | Purpose |
|------|---------|
| **Globe** | 3D MITRE ATT&CK coverage navigator |
| **Matrix** | ATT&CK tactic/technique matrix |
| **Data Upload / Analyzer** | Import coverage / use-case data, AI gap analysis |
| **Query Translator** | SPL ⇄ KQL conversion, detection-rule generation (Groq) |
| **SOAR** | Playbook builder (Groq) |
| **Architect** | Security strategy guidance (Groq) |
| **Prompt Engineering** | Prompt studio / rephrase (Groq) |
| **Alert Generator** | Synthetic SIEM alert generation (14 MITRE tactics) |
| **Agentic SOC Operation** | Live alert-triage pipeline with Master + child agents |
| **SOC Triage / Analytics / Campaigns / IOC Watchlist** | Downstream SOC views |
| **Agent Hub** | Manage / inspect specialized agents and their skills |

---

## 2. Agentic SOC pipeline

Flow: **Alert Generator → shared queue (incident #) → Master Agent → child agent → pipeline → Database**

1. **Alert Generator** produces alerts (Groq AI if a key is set, else a built-in local
   synthetic generator) for any of the 14 MITRE tactics.
2. `pushAlert` assigns an **incident number** (`INC-YYYYMMDD-#####`), persists to the DB,
   and adds to the shared queue.
3. The **Master Agent** ingests each alert, routes it to a **specialized child agent** by
   use case, and runs it through: **Triage → Investigate → Enrich → Insight → Respond → Resolved.**
4. At **Insight**: with a Groq key the child agent runs a real AI deep-analysis and is
   **trained** (skills cached + mirrored to the Agent Hub); repeat use cases **reuse** the
   trained agent with zero tokens; without a key a fast heuristic is used.
5. Resolved incidents, IOCs, and triage decisions are written to the database.

### MITRE tactic coverage (14/14)
Reconnaissance · Resource Development · Initial Access (Phishing, Supply Chain) ·
Execution · Persistence · Privilege Escalation · Defense Evasion · Credential Access ·
Discovery (Cloud) · Lateral Movement · Collection (Insider) · Command and Control ·
Exfiltration · Impact.

### Generation cadence
- **Manual** — one alert of the selected use case.
- **Auto (no rotate)** — selected use case, one per interval.
- **Auto + rotate** — cycles through use cases one-by-one, one per interval.

---

## 3. Key architectural features

- **Always-mounted SOC + Zustand subscription + poll** — alerts ingest reliably regardless
  of the active view.
- **Cross-tab sync (BroadcastChannel)** — the Alert Generator and SOC can run in separate
  browser tabs; alerts, status, and resolved incidents mirror across tabs. Only the tab
  showing the SOC ingests (no double-processing); only the originating tab writes to the DB.
- **Agent Hub persistence** — trained agents are stored in `localStorage` and rehydrated on
  load, so repeat use cases reuse the existing agent across reloads.
- **Queue management** — hard cap 500; processed alerts auto-prune at 30; up to 50 live
  cards; resolved cards linger 3 minutes; a header indicator shows queue depth / pruning.
- **API key** — single trimmed source (`atlas_groq_key`), reactive everywhere.
- **Build tag** — `ATLAS_BUILD` shown in the SOC header + logged to console to confirm the
  browser is running fresh code.

---

## 4. MS Access persistence (`db_service/`)

A local **FastAPI** service (`soc_db_service.py`, port 8077) writes to a real MS Access
`.accdb` via `pyodbc`. Tables: **Alerts, Incidents, Triage, Iocs, Analytics, Campaigns.**
The browser POSTs fire-and-forget; if the service is down the app keeps working and simply
doesn't persist. Setup: install the Access Database Engine + `pip install -r
db_service/requirements.txt`, then `python db_service/soc_db_service.py`.

---

## 5. ACN voice assistant

**ACN** (Accenture-branded, 3D `>` logo) is a Gemini-powered SOC voice assistant launched
from the SOC header. It supports voice input (Web Speech STT), spoken responses (TTS), and
capabilities: converse, SOC report, security analysis, incident summary, explain alert —
grounded in live SOC state. Architecture is modular for future multi-agent expansion.

---

## 6. Running it

```bash
npm install
npm run dev        # http://localhost:5173
```
Optional persistence:
```bash
cd db_service && pip install -r requirements.txt && python soc_db_service.py
```
Add a **Groq** key in the top-right role menu for AI generation + agent training; add a
**Gemini** key in the ACN panel for the voice assistant.

---

## 7. Version 0.1 scope

This snapshot includes: the agentic SOC pipeline, alert generation across all 14 MITRE
tactics, cross-tab sync, Agent Hub with reuse/persistence, MS Access persistence, the ACN
assistant, queue tuning, and the build-tag diagnostic. **Version 0.2** continues from here.
