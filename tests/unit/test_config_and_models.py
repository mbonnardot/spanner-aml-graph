from dataclasses import FrozenInstanceError
from datetime import datetime, timezone
from decimal import Decimal
import pytest

from spanner_aml.config import ConfigurationError, SpannerConfig
from spanner_aml.models import (
    Account,
    Bank,
    Entity,
    LaunderingRingEvidence,
    Transaction,
    TransferHop,
)


def test_spanner_config_from_env_valid():
    env = {
        "SPANNER_PROJECT_ID": "test-project",
        "SPANNER_INSTANCE_ID": "aml-instance",
        "SPANNER_DATABASE_ID": "aml-db",
    }
    cfg = SpannerConfig.from_env(env)
    assert cfg.project_id == "test-project"
    assert cfg.instance_id == "aml-instance"
    assert cfg.database_id == "aml-db"
    assert cfg.emulator_host is None


def test_spanner_config_missing_env_raises():
    with pytest.raises(ConfigurationError, match="SPANNER_PROJECT_ID"):
        SpannerConfig.from_env({"SPANNER_INSTANCE_ID": "inst", "SPANNER_DATABASE_ID": "db"})


def test_spanner_config_is_immutable():
    cfg = SpannerConfig(
        project_id="p",
        instance_id="i",
        database_id="d",
    )
    with pytest.raises(FrozenInstanceError):
        cfg.project_id = "mutated"  # type: ignore[misc]


def test_domain_models_immutability_and_validation():
    bank = Bank(bank_id="BNK_01", bank_name="First Global", bic_swift="FGLBUS33", jurisdiction="US")
    entity = Entity(
        entity_id="ENT_01",
        entity_name="Acme Holdings",
        entity_type="CORPORATION",
        kyc_risk_tier="HIGH",
        is_pep_or_sanctioned=False,
        jurisdiction="KY",
        ubo_entity_id=None,
    )
    account = Account(
        account_id="ACC_01",
        bank_id=bank.bank_id,
        entity_id=entity.entity_id,
        iban="KY12FGLB00000001",
        currency="USD",
        account_status="ACTIVE",
        is_flagged=False,
    )
    t0 = datetime(2026, 9, 28, 10, 0, tzinfo=timezone.utc)
    t1 = datetime(2026, 9, 28, 12, 30, tzinfo=timezone.utc)
    tx = Transaction(
        transaction_id="tx_001",
        from_bank_id="BNK_01",
        from_account_id="ACC_01",
        to_bank_id="BNK_02",
        to_account_id="ACC_02",
        event_timestamp=t0,
        amount_received=Decimal("98500.00"),
        receiving_currency="USD",
        amount_paid=Decimal("100000.00"),
        payment_currency="USD",
        payment_format="Wire",
        is_laundering=True,
        settlement_status="SETTLED",
    )
    assert tx.amount_paid == Decimal("100000.00")

    hop1 = TransferHop(
        transaction_id="tx_001",
        from_account_id="ACC_01",
        to_account_id="ACC_02",
        amount_paid=Decimal("100000.00"),
        amount_received=Decimal("98500.00"),
        currency="USD",
        payment_format="Wire",
        event_timestamp=t0,
    )
    hop2 = TransferHop(
        transaction_id="tx_002",
        from_account_id="ACC_02",
        to_account_id="ACC_01",
        amount_paid=Decimal("98500.00"),
        amount_received=Decimal("97000.00"),
        currency="USD",
        payment_format="Wire",
        event_timestamp=t1,
    )
    evidence = LaunderingRingEvidence.from_hops(
        typology="CIRCULAR_LAYERING",
        hops=(hop1, hop2),
        subject_entity_id=entity.entity_id,
        query_latency_ms=14.2,
        raw_graph_path={"nodes": [], "edges": []},
    )
    assert evidence.hop_count == 2
    assert evidence.initial_amount == Decimal("100000.00")
    assert evidence.final_amount == Decimal("97000.00")
    assert evidence.retention_ratio == pytest.approx(0.97)
    assert evidence.total_duration_seconds == 9000.0
    assert evidence.account_ids == ("ACC_01", "ACC_02", "ACC_01")
    with pytest.raises(TypeError):
        evidence.raw_graph_path["mutated"] = True

    evidence_direct = LaunderingRingEvidence(
        typology="CIRCULAR_LAYERING",
        hop_count=2,
        initial_amount=Decimal("100000.00"),
        final_amount=Decimal("97000.00"),
        retention_ratio=0.97,
        total_duration_seconds=9000.0,
        account_ids=("ACC_01", "ACC_02", "ACC_01"),
        hops=(hop1, hop2),
        subject_entity_id=entity.entity_id,
        query_latency_ms=14.2,
        raw_graph_path={"direct": 123},
    )
    with pytest.raises(TypeError):
        evidence_direct.raw_graph_path["mutated"] = True

