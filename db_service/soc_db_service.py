"""
ATLAS SOC — Local MS Access persistence service
================================================
A small FastAPI service that stores everything the Agentic SOC produces —
generated alerts (with an incident number + full detail), resolved incidents,
triage decisions, analytics snapshots, campaign detections and IOCs — into a
REAL Microsoft Access database (.accdb).

The React dashboard (browser) cannot talk to Access directly, so it POSTs to
this local service, which writes to Access via pyodbc.

Setup (Windows)
---------------
1. Install the Access engine (ODBC driver) if you don't have Access installed:
   "Microsoft Access Database Engine 2016 Redistributable" (x64).
2. pip install -r requirements.txt
3. python db_service/soc_db_service.py
   -> serves on http://127.0.0.1:8077 and creates ./data/atlas_soc.accdb

The dashboard auto-detects the service; if it isn't running, the app keeps
working (it just doesn't persist).
"""
from __future__ import annotations

import os
import datetime as dt
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# ── DB location ───────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
ACCDB_PATH = DATA_DIR / "atlas_soc.accdb"

ODBC_CONN = (
    r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};"
    rf"DBQ={ACCDB_PATH};"
)

# ── Access file + schema bootstrap ──────────────────────────────────────────────
def _create_accdb_if_missing() -> None:
    """Create an empty .accdb using ADOX (needs the ACE OLEDB provider)."""
    if ACCDB_PATH.exists():
        return
    try:
        import win32com.client  # type: ignore
        cat = win32com.client.Dispatch("ADOX.Catalog")
        cat.Create(
            f"Provider=Microsoft.ACE.OLEDB.12.0;Data Source={ACCDB_PATH};"
        )
        cat = None
        print(f"[db] created new Access database at {ACCDB_PATH}")
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(
            "Could not create the .accdb file. Install the 'Microsoft Access "
            "Database Engine 2016 Redistributable' and pywin32 (pip install pywin32). "
            f"Original error: {e}"
        )


# Access DDL for each table. Access dialect: AUTOINCREMENT, TEXT(n), MEMO, LONG, DATETIME.
TABLES: dict[str, str] = {
    "Alerts": """
        CREATE TABLE Alerts (
            Id AUTOINCREMENT PRIMARY KEY,
            IncidentNo TEXT(50), AlertId TEXT(80), UseCase TEXT(50),
            UseCaseLabel TEXT(120), Severity TEXT(20), Title TEXT(255),
            Description MEMO, Tactic TEXT(80), TechniqueId TEXT(40),
            TechniqueName TEXT(150), SourceIp TEXT(60), SourceHost TEXT(150),
            SourceUser TEXT(150), SourceProcess TEXT(150), DestIp TEXT(60),
            DestHost TEXT(150), DestPort LONG, Evidence MEMO, RawLog MEMO,
            RecommendedAction MEMO, AlertTimestamp TEXT(40), Status TEXT(30),
            IngestedAt DATETIME
        )""",
    "Incidents": """
        CREATE TABLE Incidents (
            Id AUTOINCREMENT PRIMARY KEY,
            IncidentNo TEXT(50), ProcId TEXT(40), AlertId TEXT(80),
            Title TEXT(255), Severity TEXT(20), Verdict TEXT(40),
            RiskScore LONG, Confidence LONG, Mttr LONG, AgentLabel TEXT(120),
            AgentColor TEXT(30), IsFirstRun LONG,
            ThreatActorProfile MEMO, AttackChain MEMO, Recommendations MEMO,
            Iocs MEMO, Techniques MEMO, Reasoning MEMO,
            SplunkQueries MEMO, KqlQueries MEMO,
            ResolvedAt DATETIME, ResolvedAtMs DOUBLE
        )""",
    "Triage": """
        CREATE TABLE Triage (
            Id AUTOINCREMENT PRIMARY KEY,
            IncidentNo TEXT(50), AlertId TEXT(80), Decision TEXT(40),
            Analyst TEXT(120), Priority TEXT(20), Notes MEMO, DecidedAt DATETIME
        )""",
    "Analytics": """
        CREATE TABLE Analytics (
            Id AUTOINCREMENT PRIMARY KEY,
            SnapshotAt DATETIME, Ingested LONG, Resolved LONG, TruePos LONG,
            FalsePos LONG, Escalated LONG, AvgMttr LONG, FpRate LONG,
            AgentsTrained LONG, SkillsReused LONG, Payload MEMO
        )""",
    "Campaigns": """
        CREATE TABLE Campaigns (
            Id AUTOINCREMENT PRIMARY KEY,
            CampaignId TEXT(60), Name TEXT(255), ThreatActor TEXT(150),
            Severity TEXT(20), IncidentCount LONG, Techniques MEMO,
            Incidents MEMO, Summary MEMO, DetectedAt DATETIME
        )""",
    "Iocs": """
        CREATE TABLE Iocs (
            Id AUTOINCREMENT PRIMARY KEY,
            IncidentNo TEXT(50), [Type] TEXT(40), [Value] TEXT(255),
            Severity TEXT(20), [Source] TEXT(120), FirstSeen DATETIME
        )""",
    # Industry Knowledge Base — the sector security baseline, mirrored from the
    # app's curated KB so it is queryable as real data (drives industry-based
    # alert generation and the gap report).
    "IndustryProfiles": """
        CREATE TABLE IndustryProfiles (
            Id AUTOINCREMENT PRIMARY KEY,
            IndustryKey TEXT(40), Label TEXT(120), Summary MEMO,
            ThreatProfile MEMO, ThreatActors MEMO, LogSources MEMO,
            PriorityTactics MEMO, TechniqueCount LONG, UpdatedAt DATETIME
        )""",
    "IndustryBaselines": """
        CREATE TABLE IndustryBaselines (
            Id AUTOINCREMENT PRIMARY KEY,
            IndustryKey TEXT(40), IndustryLabel TEXT(120),
            TechniqueId TEXT(40), TechniqueName TEXT(150),
            Tactic TEXT(80), Rationale MEMO, [Rank] LONG, UpdatedAt DATETIME
        )""",
}


def _connect():
    import pyodbc  # type: ignore
    return pyodbc.connect(ODBC_CONN, autocommit=True)


# Columns added after the original schema shipped. On an existing .accdb we
# ALTER TABLE ADD COLUMN for any that are missing, so older databases upgrade in
# place without losing data. (Access has no "ADD COLUMN IF NOT EXISTS".)
MIGRATIONS: dict[str, list[tuple[str, str]]] = {
    "Incidents": [
        ("AgentColor", "TEXT(30)"), ("IsFirstRun", "LONG"),
        ("Reasoning", "MEMO"), ("SplunkQueries", "MEMO"), ("KqlQueries", "MEMO"),
        ("ResolvedAtMs", "DOUBLE"),
    ],
}


def _ensure_schema() -> None:
    conn = _connect()
    cur = conn.cursor()
    existing = {row.table_name for row in cur.tables(tableType="TABLE")}
    for name, ddl in TABLES.items():
        if name not in existing:
            cur.execute(ddl)
            print(f"[db] created table {name}")
    # Apply column migrations to pre-existing tables.
    for table, cols in MIGRATIONS.items():
        if table not in existing and table not in TABLES:
            continue
        have = {row.column_name for row in cur.columns(table=table)}
        for col, coltype in cols:
            if col not in have:
                try:
                    cur.execute(f"ALTER TABLE {table} ADD COLUMN [{col}] {coltype}")
                    print(f"[db] migrated {table}: added column {col}")
                except Exception as e:  # noqa: BLE001
                    print(f"[db] migration warning ({table}.{col}): {e}")
    cur.close()
    conn.close()


def _insert(table: str, row: dict[str, Any]) -> None:
    cols = ", ".join(f"[{k}]" for k in row)
    marks = ", ".join("?" for _ in row)
    conn = _connect()
    cur = conn.cursor()
    cur.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", list(row.values()))
    cur.close()
    conn.close()


def _exec(sql: str, params: list[Any]) -> None:
    conn = _connect()
    cur = conn.cursor()
    cur.execute(sql, params)
    cur.close()
    conn.close()


def _query(sql: str) -> list[dict[str, Any]]:
    conn = _connect()
    cur = conn.cursor()
    cur.execute(sql)
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return rows


def _now() -> dt.datetime:
    return dt.datetime.now()


def _lines(v: Any) -> list[str]:
    """MEMO field stored as newline-joined text → list, empties dropped."""
    if not v:
        return []
    return [ln for ln in str(v).split("\n") if ln.strip()]


# ── API models ──────────────────────────────────────────────────────────────────
class Alert(BaseModel):
    incidentNo: str = ""
    alertId: str = ""
    useCase: str = ""
    useCaseLabel: str = ""
    severity: str = ""
    title: str = ""
    description: str = ""
    tactic: str = ""
    techniqueId: str = ""
    techniqueName: str = ""
    sourceIp: str = ""
    sourceHost: str = ""
    sourceUser: str = ""
    sourceProcess: Optional[str] = ""
    destIp: str = ""
    destHost: str = ""
    destPort: int = 0
    evidence: list[str] = []
    rawLog: str = ""
    recommendedAction: str = ""
    timestamp: str = ""
    status: str = ""


class Incident(BaseModel):
    incidentNo: str = ""
    procId: str = ""
    alertId: str = ""
    title: str = ""
    severity: str = ""
    verdict: str = ""
    riskScore: int = 0
    confidence: int = 0
    mttr: int = 0
    agentLabel: str = ""
    agentColor: str = ""
    isFirstRun: bool = False
    threatActorProfile: str = ""
    attackChain: list[str] = []
    recommendations: list[str] = []
    iocs: list[str] = []
    techniques: list[str] = []
    reasoning: str = ""
    splunkQueries: list[str] = []
    kqlQueries: list[str] = []
    resolvedAt: float = 0  # epoch ms from the client (exact resolve time)


class TriageRow(BaseModel):
    incidentNo: str = ""
    alertId: str = ""
    decision: str = ""
    analyst: str = "auto"
    priority: str = ""
    notes: str = ""


class AnalyticsRow(BaseModel):
    ingested: int = 0
    resolved: int = 0
    truePos: int = 0
    falsePos: int = 0
    escalated: int = 0
    avgMttr: int = 0
    fpRate: int = 0
    agentsTrained: int = 0
    skillsReused: int = 0
    payload: str = ""


class CampaignRow(BaseModel):
    campaignId: str = ""
    name: str = ""
    threatActor: str = ""
    severity: str = ""
    incidentCount: int = 0
    techniques: list[str] = []
    incidents: list[str] = []
    summary: str = ""


class IocRow(BaseModel):
    incidentNo: str = ""
    type: str = ""
    value: str = ""
    severity: str = ""
    source: str = ""


class IndustryTechniqueIn(BaseModel):
    id: str = ""
    name: str = ""
    tactic: str = ""
    why: str = ""


class IndustryProfileIn(BaseModel):
    key: str = ""
    label: str = ""
    summary: str = ""
    threatProfile: str = ""
    topThreatActors: list[str] = []
    logSources: list[str] = []
    priorityTactics: list[str] = []
    techniques: list[IndustryTechniqueIn] = []


class IndustrySeedIn(BaseModel):
    profiles: list[IndustryProfileIn] = []


# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="ATLAS SOC Access Store")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    _create_accdb_if_missing()
    _ensure_schema()
    print(f"[db] ready · {ACCDB_PATH}")


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "db": str(ACCDB_PATH), "exists": ACCDB_PATH.exists()}


@app.post("/api/alerts")
def add_alert(a: Alert) -> dict[str, Any]:
    _insert("Alerts", {
        "IncidentNo": a.incidentNo, "AlertId": a.alertId, "UseCase": a.useCase,
        "UseCaseLabel": a.useCaseLabel, "Severity": a.severity, "Title": a.title[:255],
        "Description": a.description, "Tactic": a.tactic, "TechniqueId": a.techniqueId,
        "TechniqueName": a.techniqueName, "SourceIp": a.sourceIp, "SourceHost": a.sourceHost,
        "SourceUser": a.sourceUser, "SourceProcess": a.sourceProcess or "", "DestIp": a.destIp,
        "DestHost": a.destHost, "DestPort": a.destPort, "Evidence": "\n".join(a.evidence),
        "RawLog": a.rawLog, "RecommendedAction": a.recommendedAction,
        "AlertTimestamp": a.timestamp, "Status": a.status, "IngestedAt": _now(),
    })
    return {"ok": True, "incidentNo": a.incidentNo}


@app.post("/api/incidents")
def add_incident(i: Incident) -> dict[str, Any]:
    _insert("Incidents", {
        "IncidentNo": i.incidentNo, "ProcId": i.procId, "AlertId": i.alertId,
        "Title": i.title[:255], "Severity": i.severity, "Verdict": i.verdict,
        "RiskScore": i.riskScore, "Confidence": i.confidence, "Mttr": i.mttr,
        "AgentLabel": i.agentLabel, "AgentColor": i.agentColor, "IsFirstRun": 1 if i.isFirstRun else 0,
        "ThreatActorProfile": i.threatActorProfile,
        "AttackChain": "\n".join(i.attackChain), "Recommendations": "\n".join(i.recommendations),
        "Iocs": "\n".join(i.iocs), "Techniques": "\n".join(i.techniques),
        "Reasoning": i.reasoning,
        "SplunkQueries": "\n".join(i.splunkQueries), "KqlQueries": "\n".join(i.kqlQueries),
        "ResolvedAt": _now(), "ResolvedAtMs": i.resolvedAt or (_now().timestamp() * 1000),
    })
    return {"ok": True}


@app.get("/api/incidents")
def list_incidents(limit: int = 500) -> dict[str, Any]:
    """Read resolved incidents back as full case files (Incidents ⋈ Alerts).

    This is the system-of-record read path the Case Review UI hydrates from. The
    embedded `alert` is reconstructed from the Alerts table where available; if the
    matching alert row is missing, the incident's own summary fields are used.
    """
    limit = max(1, min(limit, 2000))
    rows = _query(
        f"SELECT TOP {limit} "
        "I.ProcId, I.AlertId, I.IncidentNo, I.Severity, I.Verdict, I.RiskScore, "
        "I.Confidence, I.Mttr, I.AgentLabel, I.AgentColor, I.IsFirstRun, "
        "I.ThreatActorProfile, I.AttackChain, I.Recommendations, I.Iocs, I.Techniques, "
        "I.Reasoning, I.SplunkQueries, I.KqlQueries, I.ResolvedAtMs, I.Title AS IncTitle, "
        "A.UseCase, A.UseCaseLabel, A.Tactic, A.TechniqueId, A.TechniqueName, "
        "A.SourceIp, A.SourceHost, A.SourceUser, A.SourceProcess, A.DestIp, A.DestHost, "
        "A.DestPort, A.Evidence, A.RawLog, A.RecommendedAction, A.AlertTimestamp, "
        "A.Description, A.Title AS AlertTitle, A.Status "
        "FROM Incidents AS I LEFT JOIN Alerts AS A ON I.AlertId = A.AlertId "
        "ORDER BY I.ResolvedAtMs DESC"
    )
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for r in rows:
        proc = str(r.get("ProcId") or "")
        if proc and proc in seen:  # dedupe if an alert matched more than once
            continue
        seen.add(proc)
        resolved_ms = int(r.get("ResolvedAtMs") or 0)
        title = r.get("AlertTitle") or r.get("IncTitle") or ""
        out.append({
            "procId": proc,
            "alert": {
                "id": r.get("AlertId") or proc,
                "incidentNo": r.get("IncidentNo") or "",
                "useCase": r.get("UseCase") or "",
                "useCaseLabel": r.get("UseCaseLabel") or "",
                "severity": r.get("Severity") or "INFO",
                "title": title,
                "description": r.get("Description") or "",
                "tactic": r.get("Tactic") or "",
                "techniqueId": r.get("TechniqueId") or "",
                "techniqueName": r.get("TechniqueName") or "",
                "sourceIp": r.get("SourceIp") or "",
                "sourceHost": r.get("SourceHost") or "",
                "sourceUser": r.get("SourceUser") or "",
                "sourceProcess": r.get("SourceProcess") or None,
                "destIp": r.get("DestIp") or "",
                "destHost": r.get("DestHost") or "",
                "destPort": int(r.get("DestPort") or 0),
                "evidence": _lines(r.get("Evidence")),
                "rawLog": r.get("RawLog") or "",
                "recommendedAction": r.get("RecommendedAction") or "",
                "alertId": r.get("AlertId") or "",
                "timestamp": r.get("AlertTimestamp") or "",
                "createdAt": resolved_ms,
                "status": r.get("Status") or "dispatched",
            },
            "iocs": _lines(r.get("Iocs")),
            "techniques": _lines(r.get("Techniques")),
            "verdict": r.get("Verdict") or "Needs Review",
            "riskScore": int(r.get("RiskScore") or 0),
            "confidence": int(r.get("Confidence") or 0),
            "mttr": int(r.get("Mttr") or 0),
            "resolvedAt": resolved_ms,
            "agentLabel": r.get("AgentLabel") or "",
            "agentColor": r.get("AgentColor") or "#8593AC",
            "isFirstRun": bool(r.get("IsFirstRun")),
            "attackChain": _lines(r.get("AttackChain")),
            "recommendations": _lines(r.get("Recommendations")),
            "threatActorProfile": r.get("ThreatActorProfile") or "",
            "reasoning": r.get("Reasoning") or "",
            "sampleQueries": {
                "splunk": _lines(r.get("SplunkQueries")),
                "kql": _lines(r.get("KqlQueries")),
            },
        })
    return {"ok": True, "count": len(out), "incidents": out}


@app.post("/api/triage")
def add_triage(t: TriageRow) -> dict[str, Any]:
    _insert("Triage", {
        "IncidentNo": t.incidentNo, "AlertId": t.alertId, "Decision": t.decision,
        "Analyst": t.analyst, "Priority": t.priority, "Notes": t.notes, "DecidedAt": _now(),
    })
    return {"ok": True}


@app.post("/api/analytics")
def add_analytics(a: AnalyticsRow) -> dict[str, Any]:
    _insert("Analytics", {
        "SnapshotAt": _now(), "Ingested": a.ingested, "Resolved": a.resolved,
        "TruePos": a.truePos, "FalsePos": a.falsePos, "Escalated": a.escalated,
        "AvgMttr": a.avgMttr, "FpRate": a.fpRate, "AgentsTrained": a.agentsTrained,
        "SkillsReused": a.skillsReused, "Payload": a.payload,
    })
    return {"ok": True}


@app.post("/api/campaigns")
def add_campaign(c: CampaignRow) -> dict[str, Any]:
    _insert("Campaigns", {
        "CampaignId": c.campaignId, "Name": c.name[:255], "ThreatActor": c.threatActor,
        "Severity": c.severity, "IncidentCount": c.incidentCount,
        "Techniques": "\n".join(c.techniques), "Incidents": "\n".join(c.incidents),
        "Summary": c.summary, "DetectedAt": _now(),
    })
    return {"ok": True}


@app.post("/api/iocs")
def add_ioc(i: IocRow) -> dict[str, Any]:
    _insert("Iocs", {
        "IncidentNo": i.incidentNo, "Type": i.type, "Value": i.value[:255],
        "Severity": i.severity, "Source": i.source, "FirstSeen": _now(),
    })
    return {"ok": True}


@app.post("/api/industry-baselines/seed")
def seed_industry_baselines(body: IndustrySeedIn) -> dict[str, Any]:
    """Upsert the industry Knowledge Base into the DB (source of truth stays the
    app's curated KB; this mirrors it so the baseline is queryable as real data)."""
    tech_total = 0
    for p in body.profiles:
        # Replace existing rows for this industry (idempotent re-seed).
        _exec("DELETE FROM IndustryProfiles WHERE IndustryKey = ?", [p.key])
        _exec("DELETE FROM IndustryBaselines WHERE IndustryKey = ?", [p.key])
        _insert("IndustryProfiles", {
            "IndustryKey": p.key, "Label": p.label[:120], "Summary": p.summary,
            "ThreatProfile": p.threatProfile, "ThreatActors": "\n".join(p.topThreatActors),
            "LogSources": "\n".join(p.logSources), "PriorityTactics": "\n".join(p.priorityTactics),
            "TechniqueCount": len(p.techniques), "UpdatedAt": _now(),
        })
        for rank, t in enumerate(p.techniques, start=1):
            _insert("IndustryBaselines", {
                "IndustryKey": p.key, "IndustryLabel": p.label[:120],
                "TechniqueId": t.id, "TechniqueName": t.name[:150], "Tactic": t.tactic,
                "Rationale": t.why, "Rank": rank, "UpdatedAt": _now(),
            })
            tech_total += 1
    return {"ok": True, "industries": len(body.profiles), "techniques": tech_total}


@app.get("/api/industry-baselines")
def list_industry_baselines(industry: str = "") -> dict[str, Any]:
    """Read the sector baseline back. Optional ?industry=<key> filter."""
    safe = "".join(c for c in industry if c.isalnum() or c == "_").lower()
    where = f" WHERE IndustryKey = '{safe}'" if safe else ""
    rows = _query(
        "SELECT IndustryKey, IndustryLabel, TechniqueId, TechniqueName, Tactic, Rationale, [Rank] "
        "FROM IndustryBaselines" + where + " ORDER BY IndustryKey, [Rank]"
    )
    out = [{
        "industryKey": r.get("IndustryKey") or "",
        "industryLabel": r.get("IndustryLabel") or "",
        "id": r.get("TechniqueId") or "",
        "name": r.get("TechniqueName") or "",
        "tactic": r.get("Tactic") or "",
        "why": r.get("Rationale") or "",
        "rank": int(r.get("Rank") or 0),
    } for r in rows]
    return {"ok": True, "count": len(out), "techniques": out}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8077)
