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
            ThreatActorProfile MEMO, AttackChain MEMO, Recommendations MEMO,
            Iocs MEMO, Techniques MEMO, ResolvedAt DATETIME
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
            IncidentNo TEXT(50), Type TEXT(40), Value TEXT(255),
            Severity TEXT(20), Source TEXT(120), FirstSeen DATETIME
        )""",
}


def _connect():
    import pyodbc  # type: ignore
    return pyodbc.connect(ODBC_CONN, autocommit=True)


def _ensure_schema() -> None:
    conn = _connect()
    cur = conn.cursor()
    existing = {row.table_name for row in cur.tables(tableType="TABLE")}
    for name, ddl in TABLES.items():
        if name not in existing:
            cur.execute(ddl)
            print(f"[db] created table {name}")
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


def _now() -> dt.datetime:
    return dt.datetime.now()


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
    threatActorProfile: str = ""
    attackChain: list[str] = []
    recommendations: list[str] = []
    iocs: list[str] = []
    techniques: list[str] = []


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
        "AgentLabel": i.agentLabel, "ThreatActorProfile": i.threatActorProfile,
        "AttackChain": "\n".join(i.attackChain), "Recommendations": "\n".join(i.recommendations),
        "Iocs": "\n".join(i.iocs), "Techniques": "\n".join(i.techniques), "ResolvedAt": _now(),
    })
    return {"ok": True}


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


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8077)
