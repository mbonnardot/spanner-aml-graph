"""Live GCP Cloud Spanner integration tests (executed when SPANNER_PROJECT_ID is configured)."""

from __future__ import annotations

from decimal import Decimal
import os
import pytest

from spanner_aml.config import SpannerConfig
from spanner_aml.detector import RingDetector
from spanner_aml.loader import load_dataset_into_spanner, parse_ibm_aml_files
from spanner_aml.schema_manager import apply_schema

pytestmark = pytest.mark.skipif(
    not os.environ.get("SPANNER_PROJECT_ID"),
    reason="Live Spanner integration test requires SPANNER_PROJECT_ID, SPANNER_INSTANCE_ID, and SPANNER_DATABASE_ID",
)


def test_end_to_end_live_spanner_aml_graph():
    cfg = SpannerConfig.from_env()
    db = cfg.get_database()

    apply_schema(db)
    dataset = parse_ibm_aml_files()
    counts = load_dataset_into_spanner(db, dataset)
    assert counts["Transactions"] == 12

    detector = RingDetector(db)

    circular = detector.detect_circular_rings("ACC_RING1_A", min_amount=Decimal("50000"))
    assert len(circular) >= 1
    assert circular[0].hop_count == 4
    assert circular[0].account_ids[0] == "ACC_RING1_A"
    assert circular[0].account_ids[-1] == "ACC_RING1_A"

    same_entity = detector.detect_same_entity_rings(min_amount=Decimal("50000"))
    assert any(ev.subject_entity_id == "ENT_OMEGA_TRADING" for ev in same_entity)

    ubo_rings = detector.detect_ubo_shell_rings(min_amount=Decimal("50000"))
    assert any(ev.subject_entity_id == "ENT_UBO_VIKTOR" for ev in ubo_rings)

    clean = detector.detect_circular_rings("ACC_CLEAN_01", min_amount=Decimal("100"))
    assert len(clean) == 0
