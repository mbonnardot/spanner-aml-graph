"""Controlled single-ticket FinCEN SAR generator (Vertex AI Gemini + Deterministic Verifier) and AlertRepository."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from typing import Any
import uuid

from google.cloud import spanner  # type: ignore[import-untyped]
from google.cloud.spanner_v1 import param_types  # type: ignore[import-untyped]
from google.cloud.spanner_v1.data_types import JsonObject  # type: ignore[import-untyped]

from spanner_aml.models import (
    ComplianceAlert,
    EnrichedCaseInvestigation,
    LaunderingRingEvidence,
)

COMPLIANCE_ALERT_COLUMNS = (
    "alert_id",
    "trigger_transaction_id",
    "subject_entity_id",
    "typology",
    "risk_score",
    "evidence_subgraph",
    "sar_narrative",
    "alert_status",
    "created_at",
)

SQL_LIST_COMPLIANCE_ALERTS = """
SELECT alert_id,
       trigger_transaction_id,
       subject_entity_id,
       typology,
       risk_score,
       evidence_subgraph,
       sar_narrative,
       alert_status,
       created_at
FROM ComplianceAlerts
ORDER BY created_at DESC
LIMIT @limit
""".strip()


def verify_sar_citations(narrative: str, evidence: LaunderingRingEvidence) -> bool:
    """Verify that every transaction_id and account_id in the evidence subgraph appears in the narrative."""
    if not narrative or not narrative.strip():
        return False
    for hop in evidence.hops:
        if hop.transaction_id not in narrative:
            return False
        if hop.from_account_id not in narrative:
            return False
        if hop.to_account_id not in narrative:
            return False
    return True


def compile_deterministic_sar(investigation: EnrichedCaseInvestigation) -> str:
    """Compile a 100% grounded 5-section FinCEN Suspicious Activity Report narrative."""
    ev = investigation.evidence
    risk = investigation.risk_assessment
    profiles = investigation.kyc_profiles

    trigger_tx = ev.hops[-1].transaction_id if ev.hops else "UNKNOWN_TX"
    subject_id = ev.subject_entity_id or (
        profiles[ev.hops[0].from_account_id].entity_id
        if ev.hops and ev.hops[0].from_account_id in profiles
        else "MULTIPLE_SUBJECTS"
    )

    subject_lines: list[str] = []
    for acc_id in sorted(profiles.keys()):
        p = profiles[acc_id]
        pep_flag = " [PEP / SANCTIONED]" if p.is_pep_or_sanctioned else ""
        ubo_info = (
            f" | Controlled by UBO: {p.ubo_entity_name or p.ubo_entity_id} ({p.ubo_entity_id})"
            if p.ubo_entity_id
            else ""
        )
        subject_lines.append(
            f"- Account `{p.account_id}` (IBAN: `{p.iban or 'N/A'}`) held at **{p.bank_name}** "
            f"(`{p.bank_id}`, Jurisdiction: `{p.bank_jurisdiction or 'N/A'}`) — Owned by **{p.entity_name}** "
            f"(`{p.entity_id}`, Type: `{p.entity_type}`, KYC Tier: `{p.kyc_risk_tier}`, "
            f"Jurisdiction: `{p.entity_jurisdiction or 'N/A'}`){pep_flag}{ubo_info}"
        )
    if not subject_lines:
        for acc_id in ev.account_ids:
            subject_lines.append(f"- Account `{acc_id}` (participating node in `AmlGraph`)")

    hop_lines: list[str] = []
    for idx, hop in enumerate(ev.hops, start=1):
        hop_lines.append(
            f"{idx}. **Hop #{idx}** (`{hop.event_timestamp.isoformat()}`): Transaction `{hop.transaction_id}` "
            f"transferred **{hop.amount_paid:,.2f} {hop.currency}** via `{hop.payment_format}` "
            f"from Account `{hop.from_account_id}` to Account `{hop.to_account_id}` "
            f"(received: {hop.amount_received:,.2f} {hop.currency})."
        )

    reason_lines = "\n".join(f"- {r}" for r in risk.reasons)

    sections = [
        "### I. EXECUTIVE SUMMARY & ALERT TRIGGER",
        (
            f"Case `{investigation.case_id}` was flagged by Cloud Spanner Graph (`AmlGraph`) ISO GQL "
            f"detection under typology **`{ev.typology}`** with a composite risk score of "
            f"**{risk.risk_score:.2f} ({risk.risk_level})**. The subgraph comprises **{ev.hop_count} "
            f"chronological hops** across **{len(set(ev.account_ids))} accounts**, initiating with "
            f"**${ev.initial_amount:,.2f} USD** and concluding at **${ev.final_amount:,.2f} USD** "
            f"(retention ratio: **{ev.retention_ratio:.2%}**, elapsed window: **{ev.total_duration_seconds:.0f}s**). "
            f"Primary trigger transaction: `{trigger_tx}`. Primary subject entity: `{subject_id}`."
        ),
        "",
        "### II. SUBJECT ENTITIES, KYC RISK & BENEFICIAL OWNERSHIP (UBO)",
        "\n".join(subject_lines),
        "",
        "### III. CHRONOLOGICAL TRANSACTION TRAIL (SPANNER GRAPH EVIDENCE)",
        "\n".join(hop_lines),
        "",
        "### IV. MONEY LAUNDERING TYPOLOGY & RED-FLAG INDICATORS",
        reason_lines,
        "",
        "### V. REGULATORY ACTION & FILING RECOMMENDATION",
        (
            f"1. **Immediate Action:** Maintain hold (`HELD`) on trigger transaction `{trigger_tx}` and flag "
            f"participating accounts ({', '.join(f'`{a}`' for a in sorted(set(ev.account_ids)))}) for enhanced due diligence.\n"
            f"2. **FinCEN SAR Filing:** File Form 111 (Suspicious Activity Report) citing typology `{ev.typology}` "
            f"and preserving the deterministic Spanner Graph `AmlGraph` path packet (`{ev.query_latency_ms:.2f}ms` query execution)."
        ),
    ]
    return "\n".join(sections)


def _serialize_investigation_subgraph(
    investigation: EnrichedCaseInvestigation,
    sar_generation_source: str,
    citations_verified: bool,
) -> dict[str, Any]:
    ev = investigation.evidence
    return {
        "case_id": investigation.case_id,
        "typology": ev.typology,
        "hop_count": ev.hop_count,
        "initial_amount_usd": str(ev.initial_amount),
        "final_amount_usd": str(ev.final_amount),
        "retention_ratio": ev.retention_ratio,
        "total_duration_seconds": ev.total_duration_seconds,
        "query_latency_ms": ev.query_latency_ms,
        "enrichment_latency_ms": investigation.enrichment_latency_ms,
        "sar_generation_source": sar_generation_source,
        "citations_verified": citations_verified,
        "risk_reasons": list(investigation.risk_assessment.reasons),
        "account_ids": list(ev.account_ids),
        "hops": [
            {
                "transaction_id": h.transaction_id,
                "from_account_id": h.from_account_id,
                "to_account_id": h.to_account_id,
                "amount_paid": str(h.amount_paid),
                "amount_received": str(h.amount_received),
                "currency": h.currency,
                "payment_format": h.payment_format,
                "event_timestamp": h.event_timestamp.isoformat(),
            }
            for h in ev.hops
        ],
    }


class AlertRepository:
    """Persistence adapter for Cloud Spanner ComplianceAlerts table."""

    def __init__(self, database: Any) -> None:
        self._database = database

    def save_alert(self, alert: ComplianceAlert) -> ComplianceAlert:
        """Persist a ComplianceAlert row to Cloud Spanner ComplianceAlerts."""
        subgraph_dict = dict(alert.evidence_subgraph)
        with self._database.batch() as batch:
            batch.insert_or_update(
                table="ComplianceAlerts",
                columns=COMPLIANCE_ALERT_COLUMNS,
                values=[
                    (
                        alert.alert_id,
                        alert.trigger_transaction_id,
                        alert.subject_entity_id,
                        alert.typology,
                        alert.risk_score,
                        JsonObject(subgraph_dict),
                        alert.sar_narrative,
                        alert.alert_status,
                        spanner.COMMIT_TIMESTAMP,
                    )
                ],
            )
        return alert

    def list_alerts(self, limit: int = 50) -> tuple[ComplianceAlert, ...]:
        """List saved ComplianceAlerts ordered by created_at DESC."""
        with self._database.snapshot() as snapshot:
            rows = list(
                snapshot.execute_sql(
                    SQL_LIST_COMPLIANCE_ALERTS,
                    params={"limit": limit},
                    param_types={"limit": param_types.INT64},
                )
            )
        results: list[ComplianceAlert] = []
        for row in rows:
            raw_ev = row[5]
            if isinstance(raw_ev, str):
                try:
                    ev_dict = json.loads(raw_ev)
                except ValueError:
                    ev_dict = {"raw": raw_ev}
            elif isinstance(raw_ev, dict):
                ev_dict = dict(raw_ev)
            elif hasattr(raw_ev, "keys"):
                ev_dict = {k: raw_ev[k] for k in raw_ev.keys()}
            else:
                ev_dict = {}

            created_at = row[8]
            if not isinstance(created_at, datetime):
                created_at = datetime.now(timezone.utc)

            results.append(
                ComplianceAlert(
                    alert_id=str(row[0]),
                    trigger_transaction_id=str(row[1]),
                    subject_entity_id=str(row[2]) if row[2] else None,
                    typology=str(row[3]),
                    risk_score=float(row[4]),
                    evidence_subgraph=ev_dict,
                    sar_narrative=str(row[6] or ""),
                    sar_generation_source=str(
                        ev_dict.get("sar_generation_source", "DETERMINISTIC_FALLBACK")
                    ),
                    citations_verified=bool(ev_dict.get("citations_verified", True)),
                    alert_status=str(row[7] or "OPEN"),
                    created_at=created_at,
                )
            )
        return tuple(results)


class SarInvestigator:
    """Controlled single-ticket SAR narrative drafter using Vertex AI Gemini 2.5 Flash + citation verification."""

    def __init__(
        self,
        alert_repository: AlertRepository | None = None,
        project_id: str | None = None,
        location: str = "us-central1",
        model_name: str = "gemini-2.5-flash",
        enable_vertex_llm: bool = True,
        genai_client: Any | None = None,
    ) -> None:
        self._alert_repository = alert_repository
        self._project_id = project_id or os.environ.get(
            "SPANNER_PROJECT_ID", "spanner-aml-graph"
        )
        self._location = location
        self._model_name = model_name
        self._enable_vertex_llm = enable_vertex_llm
        self._genai_client = genai_client

    def _generate_with_vertex_gemini(
        self, investigation: EnrichedCaseInvestigation, deterministic_draft: str
    ) -> str | None:
        """Call Vertex AI Gemini on a single ticket and return the narrative if grounded."""
        if not self._enable_vertex_llm:
            return None
        try:
            client = self._genai_client
            if client is None:
                from google import genai

                client = genai.Client(
                    vertexai=True,
                    project=self._project_id,
                    location=self._location,
                )
            prompt = (
                "You are a Senior Financial Crimes Compliance Investigator drafting an official FinCEN "
                "Suspicious Activity Report (SAR) from deterministic Cloud Spanner Graph (`AmlGraph`) evidence.\n"
                "CRITICAL GROUNDING RULE: You MUST include EVERY exact `transaction_id` and `account_id` "
                "present in the evidence below verbatim, and preserve the 5 markdown section headings:\n"
                "### I. EXECUTIVE SUMMARY & ALERT TRIGGER\n"
                "### II. SUBJECT ENTITIES, KYC RISK & BENEFICIAL OWNERSHIP (UBO)\n"
                "### III. CHRONOLOGICAL TRANSACTION TRAIL (SPANNER GRAPH EVIDENCE)\n"
                "### IV. MONEY LAUNDERING TYPOLOGY & RED-FLAG INDICATORS\n"
                "### V. REGULATORY ACTION & FILING RECOMMENDATION\n\n"
                "Grounded Spanner Graph Dossier:\n"
                f"{deterministic_draft}"
            )
            response = client.models.generate_content(
                model=self._model_name,
                contents=prompt,
            )
            text = getattr(response, "text", None)
            if text and verify_sar_citations(text, investigation.evidence):
                return str(text).strip()
        except Exception:
            return None
        return None

    def draft_sar_for_case(
        self,
        investigation: EnrichedCaseInvestigation,
        persist_alert: bool = True,
    ) -> ComplianceAlert:
        """Draft a verified FinCEN SAR for a single selected case and optionally save to ComplianceAlerts."""
        deterministic_draft = compile_deterministic_sar(investigation)
        vertex_narrative = self._generate_with_vertex_gemini(
            investigation, deterministic_draft
        )

        if vertex_narrative is not None:
            narrative = vertex_narrative
            source = "VERTEX_GEMINI"
        else:
            narrative = deterministic_draft
            source = "DETERMINISTIC_FALLBACK"

        verified = verify_sar_citations(narrative, investigation.evidence)
        ev = investigation.evidence
        trigger_tx = ev.hops[-1].transaction_id if ev.hops else "UNKNOWN_TX"
        subject_id = ev.subject_entity_id
        if not subject_id and ev.hops:
            first_acc = ev.hops[0].from_account_id
            if first_acc in investigation.kyc_profiles:
                subject_id = investigation.kyc_profiles[first_acc].entity_id

        subgraph_payload = _serialize_investigation_subgraph(
            investigation=investigation,
            sar_generation_source=source,
            citations_verified=verified,
        )
        alert = ComplianceAlert(
            alert_id=f"ALT_{uuid.uuid4().hex[:10].upper()}",
            trigger_transaction_id=trigger_tx,
            subject_entity_id=subject_id,
            typology=ev.typology,
            risk_score=investigation.risk_assessment.risk_score,
            evidence_subgraph=subgraph_payload,
            sar_narrative=narrative,
            sar_generation_source=source,
            citations_verified=verified,
            alert_status="OPEN",
            created_at=datetime.now(timezone.utc),
        )
        if persist_alert and self._alert_repository is not None:
            self._alert_repository.save_alert(alert)
        return alert
