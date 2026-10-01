"""Unit tests for Spanner Graph KYC/UBO Enricher, Pre-Settlement Interceptor, and Controlled SAR Agent."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import MagicMock
import pytest

from spanner_aml.models import (
    AccountKycProfile,
    ComplianceAlert,
    EnrichedCaseInvestigation,
    InterceptionResult,
    LaunderingRingEvidence,
    RiskAssessment,
    TransferHop,
)
from spanner_aml.enricher import GraphContextEnricher, compute_risk_assessment
from spanner_aml.interceptor import SettlementInterceptor
from spanner_aml.sar_agent import (
    AlertRepository,
    SarInvestigator,
    compile_deterministic_sar,
    verify_sar_citations,
)


def _sample_evidence() -> LaunderingRingEvidence:
    hops = (
        TransferHop(
            transaction_id="TX_RING1_1",
            from_account_id="ACC_A",
            to_account_id="ACC_B",
            amount_paid=Decimal("50000.00"),
            amount_received=Decimal("50000.00"),
            currency="USD",
            payment_format="Wire",
            event_timestamp=datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc),
        ),
        TransferHop(
            transaction_id="TX_RING1_2",
            from_account_id="ACC_B",
            to_account_id="ACC_A",
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
        query_latency_ms=145.2,
        raw_graph_path={"hop_count": 2},
    )


def test_enricher_and_deterministic_risk_assessment():
    evidence = _sample_evidence()
    mock_db = MagicMock()
    mock_snapshot = MagicMock()
    mock_db.snapshot.return_value.__enter__.return_value = mock_snapshot
    mock_snapshot.execute_sql.side_effect = [
        [
            (
                "ACC_A",
                "KY11BANK0001",
                "USD",
                "ACTIVE",
                True,
                "BANK_001",
                "Cayman Trade Bank",
                "CTBKKYKY",
                "KY",
                "ENT_SHELL_1",
                "Aethelgard Holdings Ltd",
                "SHELL",
                "HIGH",
                True,
                "KY",
                "ENT_UBO_1",
            ),
            (
                "ACC_B",
                "VG22BANK0002",
                "USD",
                "ACTIVE",
                False,
                "BANK_002",
                "BVI Offshore Bank",
                "BVIOVGVG",
                "VG",
                "ENT_SHELL_2",
                "Boreal Ventures Corp",
                "CORPORATION",
                "MEDIUM",
                False,
                "VG",
                "ENT_UBO_1",
            ),
        ],
        [("ENT_UBO_1", "Viktor Vane (PEP)")],
    ]

    enricher = GraphContextEnricher(mock_db)
    investigation = enricher.enrich_evidence(evidence, case_id="CASE_001")

    assert investigation.case_id == "CASE_001"
    assert len(investigation.kyc_profiles) == 2
    assert investigation.kyc_profiles["ACC_A"].ubo_entity_name == "Viktor Vane (PEP)"
    assert investigation.risk_assessment.risk_score >= 0.80
    assert investigation.risk_assessment.risk_level == "CRITICAL"
    assert any("PEP" in r or "Sanctioned" in r for r in investigation.risk_assessment.reasons)
    with pytest.raises(TypeError):
        investigation.kyc_profiles["MUTATE"] = None  # type: ignore[index]


def test_settlement_interceptor_holds_closing_cycle_and_settles_clean():
    mock_db = MagicMock()
    mock_batch = MagicMock()
    mock_db.batch.return_value.__enter__.return_value = mock_batch
    mock_detector = MagicMock()
    mock_detector.check_pre_settlement_ring.return_value = (_sample_evidence(),)

    interceptor = SettlementInterceptor(mock_db, detector=mock_detector)
    res_held = interceptor.evaluate_candidate_transfer(
        from_account_id="ACC_B",
        to_account_id="ACC_A",
        amount_paid=Decimal("49500.00"),
        persist=True,
    )
    assert res_held.decision == "HELD"
    assert res_held.transaction.settlement_status == "HELD"
    assert len(res_held.matched_evidence) == 1
    assert mock_batch.insert_or_update.called

    mock_detector.check_pre_settlement_ring.return_value = ()
    res_clean = interceptor.evaluate_candidate_transfer(
        from_account_id="ACC_CLEAN_1",
        to_account_id="ACC_CLEAN_2",
        amount_paid=Decimal("2500.00"),
        persist=False,
    )
    assert res_clean.decision == "SETTLED"
    assert res_clean.transaction.settlement_status == "SETTLED"
    assert len(res_clean.matched_evidence) == 0


def test_sar_investigator_verifies_citations_and_persists_alert():
    evidence = _sample_evidence()
    profiles = {
        "ACC_A": AccountKycProfile(
            account_id="ACC_A",
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
    }
    risk = compute_risk_assessment(evidence, profiles)
    investigation = EnrichedCaseInvestigation(
        case_id="CASE_001",
        evidence=evidence,
        kyc_profiles=profiles,
        risk_assessment=risk,
        enrichment_latency_ms=32.5,
    )

    det_sar = compile_deterministic_sar(investigation)
    assert verify_sar_citations(det_sar, evidence) is True
    assert verify_sar_citations("Incomplete narrative missing tx ids", evidence) is False
    assert "I. EXECUTIVE SUMMARY" in det_sar
    assert "TX_RING1_1" in det_sar
    assert "TX_RING1_2" in det_sar

    mock_db = MagicMock()
    mock_batch = MagicMock()
    mock_db.batch.return_value.__enter__.return_value = mock_batch
    mock_snapshot = MagicMock()
    mock_db.snapshot.return_value.__enter__.return_value = mock_snapshot
    mock_snapshot.execute_sql.return_value = [
        (
            "ALT_001",
            "TX_RING1_2",
            "ENT_SHELL_1",
            "CIRCULAR_LAYERING",
            0.95,
            {"case_id": "CASE_001", "sar_generation_source": "DETERMINISTIC_FALLBACK"},
            det_sar,
            "OPEN",
            datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc),
        )
    ]

    repo = AlertRepository(mock_db)
    investigator = SarInvestigator(
        alert_repository=repo,
        enable_vertex_llm=False,
    )
    alert = investigator.draft_sar_for_case(investigation, persist_alert=True)
    assert alert.typology == "CIRCULAR_LAYERING"
    assert alert.citations_verified is True
    assert alert.sar_generation_source == "DETERMINISTIC_FALLBACK"
    assert mock_batch.insert_or_update.called
    with pytest.raises(TypeError):
        alert.evidence_subgraph["MUTATE"] = 1  # type: ignore[index]

    listed = repo.list_alerts(limit=10)
    assert len(listed) == 1
    assert listed[0].alert_id == "ALT_001"


def test_settlement_interceptor_holds_non_cyclic_laundering_trail():
    from spanner_aml.detector import RingDetector

    mock_db = MagicMock()
    mock_snapshot = MagicMock()
    mock_db.snapshot.return_value.__enter__.return_value = mock_snapshot
    # First call: GQL_PRE_SETTLEMENT_CYCLE_CHECK returns empty (non-cyclic pattern)
    # Second call: GQL_PRE_SETTLEMENT_TRAIL_CHECK returns a 2-hop laundering path ending at ACC_MULE -> ACC_PAYOUT
    mock_snapshot.execute_sql.side_effect = [
        [],
        [
            (
                [
                    {
                        "kind": "edge",
                        "labels": ["TRANSFERRED_TO"],
                        "properties": {
                            "transaction_id": "TX_LAYER_1",
                            "from_account_id": "ACC_ORIGIN",
                            "to_account_id": "ACC_MULE",
                            "amount_paid": "25000.00",
                            "amount_received": "25000.00",
                            "payment_currency": "USD",
                            "payment_format": "Wire",
                            "event_timestamp": "2026-09-01T10:00:00Z",
                        },
                    },
                    {
                        "kind": "edge",
                        "labels": ["TRANSFERRED_TO"],
                        "properties": {
                            "transaction_id": "TX_PAYOUT_2",
                            "from_account_id": "ACC_MULE",
                            "to_account_id": "ACC_PAYOUT",
                            "amount_paid": "24800.00",
                            "amount_received": "24800.00",
                            "payment_currency": "USD",
                            "payment_format": "Wire",
                            "event_timestamp": "2026-09-01T10:10:00Z",
                        },
                    },
                ],
                2,
            )
        ],
    ]
    detector = RingDetector(mock_db)
    interceptor = SettlementInterceptor(mock_db, detector=detector)
    res = interceptor.evaluate_candidate_transfer(
        from_account_id="ACC_MULE",
        to_account_id="ACC_PAYOUT",
        amount_paid=Decimal("24800.00"),
        persist=False,
    )
    assert res.decision == "HELD"
    assert len(res.matched_evidence) == 1
    assert res.matched_evidence[0].hop_count == 2
