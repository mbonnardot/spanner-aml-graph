from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import MagicMock
import pytest

from spanner_aml.detector import RingDetector, parse_graph_path_hops, _unwrap_json
from spanner_aml.queries import (
    GQL_CIRCULAR_LAYERING,
    GQL_FAN_IN,
    GQL_FAN_OUT,
    GQL_GATHER_SCATTER,
    GQL_PRE_SETTLEMENT_CYCLE_CHECK,
    GQL_RANDOM_WALK_LAYERING,
    GQL_SAME_ENTITY_RING,
    GQL_SCATTER_GATHER,
    GQL_STACKED_BIPARTITE,
    GQL_UBO_SHELL_RING,
)


def _sample_spanner_path_json(hop_edges: list[dict]) -> list[dict]:
    """Construct a Spanner SAFE.TO_JSON(path) array of interleaved node/edge elements."""
    elements = []
    for idx, edge_props in enumerate(hop_edges):
        elements.append(
            {
                "kind": "node",
                "identifier": f"node_{idx}",
                "labels": ["Account"],
                "properties": {"account_id": edge_props["from_account_id"]},
            }
        )
        elements.append(
            {
                "kind": "edge",
                "identifier": f"edge_{idx}",
                "labels": ["TRANSFERRED_TO"],
                "properties": edge_props,
            }
        )
    elements.append(
        {
            "kind": "node",
            "identifier": "node_end",
            "labels": ["Account"],
            "properties": {"account_id": hop_edges[-1]["to_account_id"]},
        }
    )
    return elements


def test_gql_queries_follow_spanner_iso_gql_invariants():
    assert "{2, 12}" in GQL_CIRCULAR_LAYERING
    assert "{1, 11}" in GQL_PRE_SETTLEMENT_CYCLE_CHECK

    for query in (
        GQL_CIRCULAR_LAYERING,
        GQL_PRE_SETTLEMENT_CYCLE_CHECK,
        GQL_SAME_ENTITY_RING,
        GQL_UBO_SHELL_RING,
        GQL_RANDOM_WALK_LAYERING,
    ):
        assert query.strip().startswith("GRAPH AmlGraph")
        assert "GENERATE_ARRAY" in query
        assert "ARRAY_FILTER" in query
        assert "SAFE.TO_JSON" in query
        assert "RETURN" in query

    for pattern_query in (
        GQL_FAN_OUT,
        GQL_FAN_IN,
        GQL_GATHER_SCATTER,
        GQL_SCATTER_GATHER,
        GQL_STACKED_BIPARTITE,
    ):
        assert pattern_query.strip().startswith("GRAPH AmlGraph")
        assert "SAFE.TO_JSON" in pattern_query
        assert "RETURN" in pattern_query


def test_parse_graph_path_hops_extracts_ordered_transfer_hops():
    raw_path = _sample_spanner_path_json(
        [
            {
                "transaction_id": "tx_1",
                "from_account_id": "ACC_A",
                "to_account_id": "ACC_B",
                "amount_paid": "100000.00",
                "amount_received": "98800.00",
                "payment_currency": "USD",
                "payment_format": "Wire",
                "event_timestamp": "2026-09-28T08:00:00Z",
            },
            {
                "transaction_id": "tx_2",
                "from_account_id": "ACC_B",
                "to_account_id": "ACC_A",
                "amount_paid": "98800.00",
                "amount_received": "97500.00",
                "payment_currency": "USD",
                "payment_format": "Wire",
                "event_timestamp": "2026-09-28T10:15:00Z",
            },
        ]
    )
    hops = parse_graph_path_hops(raw_path)
    assert len(hops) == 2
    assert hops[0].transaction_id == "tx_1"
    assert hops[0].amount_paid == Decimal("100000.00")
    assert hops[1].to_account_id == "ACC_A"


def test_ring_detector_detects_all_typologies_and_pre_settlement():
    raw_path = _sample_spanner_path_json(
        [
            {
                "transaction_id": "tx_1",
                "from_account_id": "ACC_RING1_A",
                "to_account_id": "ACC_RING1_B",
                "amount_paid": "100000.00",
                "amount_received": "98800.00",
                "payment_currency": "USD",
                "payment_format": "Wire",
                "event_timestamp": "2026-09-28T08:00:00Z",
            },
            {
                "transaction_id": "tx_2",
                "from_account_id": "ACC_RING1_B",
                "to_account_id": "ACC_RING1_A",
                "amount_paid": "98800.00",
                "amount_received": "97500.00",
                "payment_currency": "USD",
                "payment_format": "Wire",
                "event_timestamp": "2026-09-28T10:15:00Z",
            },
        ]
    )

    mock_db = MagicMock()
    mock_snapshot = MagicMock()
    mock_db.snapshot.return_value.__enter__.return_value = mock_snapshot

    # 1. Circular ring row: (ring_path, hop_count, initial_amount, final_amount)
    mock_snapshot.execute_sql.return_value = [
        (raw_path, 2, Decimal("100000.00"), Decimal("97500.00"))
    ]

    detector = RingDetector(mock_db)
    rings = detector.detect_circular_rings("ACC_RING1_A", min_amount=Decimal("50000"))
    assert len(rings) == 1
    assert rings[0].typology == "CIRCULAR_LAYERING"
    assert rings[0].hop_count == 2
    assert rings[0].account_ids == ("ACC_RING1_A", "ACC_RING1_B", "ACC_RING1_A")

    # 2. Pre-settlement check appends candidate hop to prior path
    prior_path = _sample_spanner_path_json(
        [
            {
                "transaction_id": "tx_prior",
                "from_account_id": "ACC_RING1_A",
                "to_account_id": "ACC_RING1_B",
                "amount_paid": "100000.00",
                "amount_received": "98800.00",
                "payment_currency": "USD",
                "payment_format": "Wire",
                "event_timestamp": "2026-09-28T08:00:00Z",
            }
        ]
    )
    mock_snapshot.execute_sql.return_value = [
        (prior_path, 1, Decimal("100000.00"), Decimal("98800.00"))
    ]
    pre_rings = detector.check_pre_settlement_ring(
        from_account_id="ACC_RING1_B",
        to_account_id="ACC_RING1_A",
        candidate_amount=Decimal("97500.00"),
        candidate_timestamp=datetime(2026, 9, 28, 12, 0, tzinfo=timezone.utc),
    )
    assert len(pre_rings) == 1
    assert pre_rings[0].typology == "PRE_SETTLEMENT_CYCLE_CHECK"
    assert pre_rings[0].hop_count == 2
    assert pre_rings[0].account_ids == ("ACC_RING1_A", "ACC_RING1_B", "ACC_RING1_A")


def test_ring_detector_same_entity_and_ubo_shell_and_scan_all():
    raw_path = _sample_spanner_path_json(
        [
            {
                "transaction_id": "tx_se_1",
                "from_account_id": "ACC_SE_1",
                "to_account_id": "ACC_SE_2",
                "amount_paid": "50000.00",
                "amount_received": "49500.00",
                "payment_currency": "USD",
                "payment_format": "Wire",
                "event_timestamp": "2026-09-28T09:00:00Z",
            },
            {
                "transaction_id": "tx_se_2",
                "from_account_id": "ACC_SE_2",
                "to_account_id": "ACC_SE_3",
                "amount_paid": "49500.00",
                "amount_received": "49000.00",
                "payment_currency": "USD",
                "payment_format": "Wire",
                "event_timestamp": "2026-09-28T11:00:00Z",
            },
        ]
    )

    mock_db = MagicMock()
    mock_snapshot = MagicMock()
    mock_db.snapshot.return_value.__enter__.return_value = mock_snapshot

    # Test same entity ring
    owner_entity_json = {
        "kind": "node",
        "labels": ["Entity"],
        "properties": {"entity_id": "ENT_OWNER_1"},
    }
    mock_snapshot.execute_sql.return_value = [
        (owner_entity_json, raw_path, 2, Decimal("50000.00"), Decimal("49000.00"))
    ]

    detector = RingDetector(mock_db)
    se_rings = detector.detect_same_entity_rings(min_amount=Decimal("1000"))
    assert len(se_rings) == 1
    assert se_rings[0].typology == "SAME_ENTITY_RING"
    assert se_rings[0].subject_entity_id == "ENT_OWNER_1"
    assert se_rings[0].hop_count == 2

    # Test UBO shell ring
    ubo_json = {"properties": {"entity_id": "ENT_UBO_1"}}
    s1_json = {"properties": {"entity_id": "ENT_SHELL_1"}}
    s2_json = {"properties": {"entity_id": "ENT_SHELL_2"}}
    mock_snapshot.execute_sql.return_value = [
        (ubo_json, s1_json, s2_json, raw_path, 2, Decimal("50000.00"), Decimal("49000.00"))
    ]
    ubo_rings = detector.detect_ubo_shell_rings(min_amount=Decimal("1000"))
    assert len(ubo_rings) == 1
    assert ubo_rings[0].typology == "UBO_SHELL_RING"
    assert ubo_rings[0].subject_entity_id == "ENT_UBO_1"

    # Test scan_all_typologies
    mock_snapshot.execute_sql.return_value = []
    all_rings = detector.scan_all_typologies(seed_account_ids=["ACC_SE_1"])
    assert isinstance(all_rings, tuple)


def test_ring_detector_ibm_pattern_families():
    mock_db = MagicMock()
    mock_snapshot = MagicMock()
    mock_db.snapshot.return_value.__enter__.return_value = mock_snapshot
    detector = RingDetector(mock_db)

    edge_1 = {
        "kind": "edge",
        "properties": {
            "transaction_id": "tx_fo_1",
            "from_account_id": "ACC_HUB",
            "to_account_id": "ACC_DST_1",
            "amount_paid": "5000.00",
            "amount_received": "5000.00",
            "payment_currency": "USD",
            "payment_format": "ACH",
            "event_timestamp": "2022-09-01T01:00:00Z",
        },
    }
    edge_2 = {
        "kind": "edge",
        "properties": {
            "transaction_id": "tx_fo_2",
            "from_account_id": "ACC_HUB",
            "to_account_id": "ACC_DST_2",
            "amount_paid": "6000.00",
            "amount_received": "6000.00",
            "payment_currency": "USD",
            "payment_format": "ACH",
            "event_timestamp": "2022-09-01T02:00:00Z",
        },
    }

    # 1. FAN_OUT
    mock_snapshot.execute_sql.return_value = [("ACC_HUB", 2, [edge_1, edge_2])]
    fan_out = detector.detect_fan_out("ACC_HUB", min_degree=2)
    assert len(fan_out) == 1
    assert fan_out[0].typology == "FAN_OUT"
    assert fan_out[0].hop_count == 2

    # 2. FAN_IN
    mock_snapshot.execute_sql.return_value = [("ACC_SINK", 2, [edge_1, edge_2])]
    fan_in = detector.detect_fan_in("ACC_SINK", min_degree=2)
    assert len(fan_in) == 1
    assert fan_in[0].typology == "FAN_IN"

    # 3. GATHER_SCATTER
    mock_snapshot.execute_sql.return_value = [("ACC_HUB", 1, 1, [edge_1], [edge_2])]
    gs = detector.detect_gather_scatter("ACC_HUB")
    assert len(gs) == 1
    assert gs[0].typology == "GATHER_SCATTER"
    assert gs[0].hop_count == 2

    # 4. SCATTER_GATHER
    mock_snapshot.execute_sql.return_value = [("ACC_ORIG", "ACC_SINK", 2, [edge_1], [edge_2])]
    sg = detector.detect_scatter_gather("ACC_ORIG")
    assert len(sg) == 1
    assert sg[0].typology == "SCATTER_GATHER"

    # 5. STACKED_BIPARTITE
    relay_path = _sample_spanner_path_json([edge_1["properties"], edge_2["properties"]])
    mock_snapshot.execute_sql.return_value = [(relay_path, 2)]
    sb = detector.detect_stacked_bipartite()
    assert len(sb) == 1
    assert sb[0].typology == "STACKED_BIPARTITE"

    # 6. RANDOM_WALK
    mock_snapshot.execute_sql.return_value = [(relay_path, 2, Decimal("5000.00"), Decimal("6000.00"))]
    rw = detector.detect_random_walk_layering("ACC_HUB")
    assert len(rw) == 1
    assert rw[0].typology == "RANDOM_WALK"


def test_ring_detector_validation_and_unwrapping():
    mock_db = MagicMock()
    detector = RingDetector(mock_db)

    with pytest.raises(ValueError, match="account_id must be a non-empty string"):
        detector.detect_circular_rings("")

    with pytest.raises(ValueError, match="from_account_id and to_account_id must be non-empty"):
        detector.check_pre_settlement_ring("", "ACC_B", Decimal("1000"), datetime.now(timezone.utc))

    with pytest.raises(ValueError, match="from_account_id and to_account_id must be non-empty"):
        detector.check_pre_settlement_ring("ACC_A", "   ", Decimal("1000"), datetime.now(timezone.utc))

    # _unwrap_json variations
    assert _unwrap_json(None) is None
    assert _unwrap_json({"a": 1}) == {"a": 1}
    assert _unwrap_json([1, 2]) == [1, 2]
    assert _unwrap_json('{"key": "val"}') == {"key": "val"}

    class MockSerializable:
        def serialize(self):
            return '{"serialized": true}'

    assert _unwrap_json(MockSerializable()) == {"serialized": True}

    # parse_graph_path_hops with dictionary containing 'elements'
    dict_path = {"elements": _sample_spanner_path_json([
        {
            "transaction_id": "tx_dict",
            "from_account_id": "ACC_X",
            "to_account_id": "ACC_Y",
            "amount_paid": "500.00",
            "amount_received": "500.00",
            "payment_currency": "USD",
            "payment_format": "Wire",
            "event_timestamp": "2026-09-28T08:00:00+00:00",
        }
    ])}
    hops = parse_graph_path_hops(dict_path)
    assert len(hops) == 1
    assert hops[0].transaction_id == "tx_dict"

    with pytest.raises(ValueError, match="Unsupported graph path JSON structure"):
        parse_graph_path_hops(12345)

