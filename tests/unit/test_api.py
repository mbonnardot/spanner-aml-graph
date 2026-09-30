"""Unit tests for the FastAPI Spanner Graph AML Compliance Workbench API and WorkbenchService."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import MagicMock
import pytest

from fastapi.testclient import TestClient

from spanner_aml.api.app import WorkbenchService, create_app, get_spanner_db
from spanner_aml.models import (
    AccountKycProfile,
    ComplianceAlert,
    EnrichedCaseInvestigation,
    InterceptionResult,
    LaunderingRingEvidence,
    RiskAssessment,
    Transaction,
    TransferHop,
)
from spanner_aml.sar_agent import SarInvestigator


def _sample_evidence() -> LaunderingRingEvidence:
    hops = (
        TransferHop(
            transaction_id="TX_RING1_1",
            from_account_id="ACC_RING1_A",
            to_account_id="ACC_RING1_B",
            amount_paid=Decimal("50000.00"),
            amount_received=Decimal("50000.00"),
            currency="USD",
            payment_format="Wire",
            event_timestamp=datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc),
        ),
        TransferHop(
            transaction_id="TX_RING1_2",
            from_account_id="ACC_RING1_B",
            to_account_id="ACC_RING1_A",
            amount_paid=Decimal("49500.00"),
            amount_received=Decimal("49500.00"),
            currency="USD",
            payment_format="Wire",
            event_timestamp=datetime(2026, 9, 1, 10, 15, tzinfo=timezone.utc),
        ),
    )
    return LaunderingRingEvidence.from_hops(
        typology="CIRCULAR_LAYERING",
        hops=hops,
        subject_entity_id="ENT_SHELL_1",
        query_latency_ms=138.4,
        raw_graph_path={"hop_count": 2},
    )


def test_fastapi_workbench_endpoints():
    app = create_app()
    mock_db = MagicMock()
    mock_snapshot = MagicMock()
    mock_db.snapshot.return_value.__enter__.return_value = mock_snapshot
    app.dependency_overrides[get_spanner_db] = lambda: mock_db

    try:
        client = TestClient(app)

        # 1. GET /api/health
        mock_snapshot.execute_sql.return_value = [(1363, 7760, 8283, 8221, 2)]
        res_health = client.get("/api/health")
        assert res_health.status_code == 200
        body_health = res_health.json()
        assert body_health["success"] is True
        assert body_health["data"]["transactions_count"] == 8221

        # 2. GET /api/catalog
        res_cat = client.get("/api/catalog")
        assert res_cat.status_code == 200
        body_cat = res_cat.json()
        assert body_cat["success"] is True
        assert len(body_cat["data"]["cases"]) >= 10

        # 3. POST /api/investigate
        ev = _sample_evidence()
        profile_a = AccountKycProfile(
            account_id="ACC_RING1_A",
            iban="KY11BANK0001",
            currency="USD",
            account_status="ACTIVE",
            is_flagged=True,
            bank_id="BANK_001",
            bank_name="Cayman Trade Bank",
            bic_swift="CTBKKYKY",
            bank_jurisdiction="KY",
            entity_id="ENT_SHELL_1",
            entity_name="Aethelgard Holdings Ltd",
            entity_type="SHELL",
            kyc_risk_tier="HIGH",
            is_pep_or_sanctioned=True,
            entity_jurisdiction="KY",
            ubo_entity_id="ENT_UBO_1",
            ubo_entity_name="Viktor Vane (PEP)",
        )
        inv = EnrichedCaseInvestigation(
            case_id="CASE_SEED_1",
            evidence=ev,
            kyc_profiles={"ACC_RING1_A": profile_a},
            risk_assessment=RiskAssessment(
                risk_score=0.95,
                risk_level="CRITICAL",
                reasons=("PEP detected: +0.25",),
            ),
            enrichment_latency_ms=28.1,
        )
        mock_service = MagicMock()
        mock_service.investigate_case.return_value = inv
        mock_service.intercept_payment.return_value = InterceptionResult(
            transaction=Transaction(
                transaction_id="TX_INT_001",
                from_bank_id="BANK_001",
                from_account_id="ACC_RING1_B",
                to_bank_id="BANK_001",
                to_account_id="ACC_RING1_A",
                event_timestamp=datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc),
                amount_received=Decimal("49500.00"),
                receiving_currency="USD",
                amount_paid=Decimal("49500.00"),
                payment_currency="USD",
                payment_format="Wire",
                is_laundering=True,
                settlement_status="HELD",
            ),
            decision="HELD",
            latency_ms=112.4,
            matched_evidence=(ev,),
        )
        sample_alert = ComplianceAlert(
            alert_id="ALT_999",
            trigger_transaction_id="TX_RING1_2",
            subject_entity_id="ENT_SHELL_1",
            typology="CIRCULAR_LAYERING",
            risk_score=0.95,
            evidence_subgraph={"case_id": "CASE_SEED_1"},
            sar_narrative="### I. EXECUTIVE SUMMARY\nGrounded SAR for TX_RING1_1 and TX_RING1_2",
            sar_generation_source="DETERMINISTIC_FALLBACK",
            citations_verified=True,
            alert_status="OPEN",
            created_at=datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc),
        )
        mock_service.generate_single_ticket_sar.return_value = sample_alert
        mock_service.list_alerts.return_value = (sample_alert,)
        app.state.workbench_service = mock_service

        res_inv = client.post(
            "/api/investigate",
            json={
                "case_id": "CASE_SEED_1",
                "typology": "CIRCULAR_LAYERING",
                "account_id": "ACC_RING1_A",
                "min_amount": 1000.0,
            },
        )
        assert res_inv.status_code == 200
        assert res_inv.json()["data"]["risk_assessment"]["risk_level"] == "CRITICAL"

        # 404 and 400 error handling
        mock_service.investigate_case.side_effect = LookupError("Not found")
        assert (
            client.post(
                "/api/investigate",
                json={"typology": "CYCLE", "account_id": "ACC_NONE"},
            ).status_code
            == 404
        )
        mock_service.investigate_case.side_effect = ValueError("Bad typology")
        assert (
            client.post(
                "/api/investigate",
                json={"typology": "UNKNOWN", "account_id": "ACC_NONE"},
            ).status_code
            == 400
        )

        # 4. POST /api/intercept
        res_int = client.post(
            "/api/intercept",
            json={
                "from_account_id": "ACC_RING1_B",
                "to_account_id": "ACC_RING1_A",
                "amount_paid": 49500.0,
                "payment_currency": "USD",
                "payment_format": "Wire",
                "persist": False,
            },
        )
        assert res_int.status_code == 200
        assert res_int.json()["data"]["decision"] == "HELD"

        # 5. POST /api/alerts/generate-sar
        res_sar = client.post(
            "/api/alerts/generate-sar",
            json={
                "case_id": "CASE_SEED_1",
                "typology": "CIRCULAR_LAYERING",
                "account_id": "ACC_RING1_A",
                "min_amount": 1000.0,
                "persist_alert": True,
            },
        )
        assert res_sar.status_code == 200
        assert res_sar.json()["data"]["alert_id"] == "ALT_999"

        # 6. GET /api/alerts
        res_alerts = client.get("/api/alerts")
        assert res_alerts.status_code == 200
        assert len(res_alerts.json()["data"]["alerts"]) == 1
    finally:
        app.dependency_overrides.clear()


def test_workbench_service_typology_routing_and_vertex_gemini():
    from unittest.mock import create_autospec
    from spanner_aml.detector import RingDetector

    mock_db = MagicMock()
    service = WorkbenchService(mock_db)
    ev = _sample_evidence()
    service._detector = create_autospec(RingDetector, instance=True)
    service._enricher = MagicMock()

    for typ, method_name in (
        ("CIRCULAR_LAYERING", "detect_circular_rings"),
        ("UBO_SHELL_RING", "detect_ubo_shell_rings"),
        ("SAME_ENTITY_RING", "detect_same_entity_rings"),
        ("FAN_OUT", "detect_fan_out"),
        ("FAN_IN", "detect_fan_in"),
        ("GATHER_SCATTER", "detect_gather_scatter"),
        ("SCATTER_GATHER", "detect_scatter_gather"),
        ("BIPARTITE", "detect_bipartite"),
        ("STACKED_BIPARTITE", "detect_stacked_bipartite"),
        ("RANDOM_WALK", "detect_random_walk_layering"),
    ):
        getattr(service._detector, method_name).return_value = (ev,)
        res = service._run_detector(typ, "ACC_TEST", Decimal("100"))
        assert len(res) == 1

    with pytest.raises(ValueError):
        service._run_detector("INVALID_TYPOLOGY", "ACC_TEST", Decimal("100"))

    # Test Vertex AI Gemini client path with grounded citation verification
    mock_genai = MagicMock()
    mock_resp = MagicMock()
    mock_resp.text = (
        "### I. EXECUTIVE SUMMARY & ALERT TRIGGER\n"
        "Grounded Vertex SAR citing TX_RING1_1, TX_RING1_2, ACC_RING1_A, and ACC_RING1_B."
    )
    mock_genai.models.generate_content.return_value = mock_resp
    inv = EnrichedCaseInvestigation(
        case_id="CASE_VTX",
        evidence=ev,
        kyc_profiles={},
        risk_assessment=RiskAssessment(
            risk_score=0.85, risk_level="CRITICAL", reasons=("Test",)
        ),
        enrichment_latency_ms=10.0,
    )
    sar_agent = SarInvestigator(
        alert_repository=None,
        enable_vertex_llm=True,
        genai_client=mock_genai,
    )
    alert = sar_agent.draft_sar_for_case(inv, persist_alert=False)
    assert alert.sar_generation_source == "VERTEX_GEMINI"
    assert alert.citations_verified is True

    # Test WorkbenchService high-level orchestration methods
    service._detector.detect_circular_rings.return_value = (ev,)
    service._enricher.enrich_evidence.return_value = inv
    enriched = service.investigate_case(
        "CIRCULAR_LAYERING", "ACC_RING1_A", Decimal("100"), case_id="CASE_1"
    )
    assert enriched.case_id == "CASE_VTX"

    service._detector.detect_circular_rings.return_value = ()
    with pytest.raises(LookupError):
        service.investigate_case("CIRCULAR_LAYERING", "ACC_NONE", Decimal("100"))

    service._interceptor = MagicMock()
    service.intercept_payment("ACC_A", "ACC_B", Decimal("500"))
    service._interceptor.evaluate_candidate_transfer.assert_called_once()

    service._detector.detect_circular_rings.return_value = (ev,)
    service._sar_investigator = MagicMock()
    service._sar_investigator.draft_sar_for_case.return_value = alert
    sar_res = service.generate_single_ticket_sar(
        "CIRCULAR_LAYERING", "ACC_RING1_A", Decimal("100")
    )
    assert sar_res.alert_id == alert.alert_id

    service._alert_repo = MagicMock()
    service._alert_repo.list_alerts.return_value = (alert,)
    assert len(service.list_alerts(limit=10)) == 1

