"""ISO GQL laundering ring detection engine for Cloud Spanner Graph."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import json
import time
from typing import Any, Sequence

from google.cloud.spanner_v1 import param_types  # type: ignore[import-untyped]

from spanner_aml.models import LaunderingRingEvidence, TransferHop
from spanner_aml.queries import (
    GQL_BIPARTITE,
    GQL_CIRCULAR_LAYERING,
    GQL_FAN_IN,
    GQL_FAN_OUT,
    GQL_GATHER_SCATTER,
    GQL_PRE_SETTLEMENT_CYCLE_CHECK,
    GQL_PRE_SETTLEMENT_TRAIL_CHECK,
    GQL_RANDOM_WALK_LAYERING,
    GQL_SAME_ENTITY_RING,
    GQL_SCATTER_GATHER,
    GQL_STACKED_BIPARTITE,
    GQL_UBO_SHELL_RING,
)


def _unwrap_json(value: Any) -> Any:
    """Convert Spanner JsonObject or JSON string into standard Python dicts/lists."""
    if value is None:
        return None
    if hasattr(value, "serialize"):
        return json.loads(value.serialize())
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        return json.loads(value)
    return value



def _parse_iso_ts(raw_ts: str) -> datetime:
    cleaned = raw_ts.strip()
    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1] + "+00:00"
    return datetime.fromisoformat(cleaned).astimezone(timezone.utc)


def _edge_dict_to_hop(elem: dict[str, Any]) -> TransferHop | None:
    props = elem.get("properties", elem)
    if not isinstance(props, dict) or "transaction_id" not in props:
        return None
    return TransferHop(
        transaction_id=str(props["transaction_id"]),
        from_account_id=str(props["from_account_id"]),
        to_account_id=str(props["to_account_id"]),
        amount_paid=Decimal(str(props["amount_paid"])),
        amount_received=Decimal(str(props["amount_received"])),
        currency=str(props.get("payment_currency", "USD")),
        payment_format=str(props.get("payment_format", "Wire")),
        event_timestamp=_parse_iso_ts(str(props["event_timestamp"])),
    )


def parse_graph_path_hops(path_json: Any) -> tuple[TransferHop, ...]:
    """Extract ordered TransferHop instances from a Spanner SAFE.TO_JSON(path) payload."""
    unwrapped = _unwrap_json(path_json)
    if isinstance(unwrapped, dict) and "elements" in unwrapped:
        elements = unwrapped["elements"]
    elif isinstance(unwrapped, list):
        elements = unwrapped
    else:
        raise ValueError(f"Unsupported graph path JSON structure: {type(unwrapped)}")

    hops: list[TransferHop] = []
    for raw_elem in elements:
        elem = _unwrap_json(raw_elem)
        if not isinstance(elem, dict):
            continue
        if elem.get("kind") not in (None, "edge"):
            continue
        hop = _edge_dict_to_hop(elem)
        if hop is not None:
            hops.append(hop)
    return tuple(hops)


def _dedup_hops(hops: Sequence[TransferHop]) -> tuple[TransferHop, ...]:
    seen: set[str] = set()
    ordered: list[TransferHop] = []
    for h in sorted(hops, key=lambda x: x.event_timestamp):
        if h.transaction_id not in seen:
            seen.add(h.transaction_id)
            ordered.append(h)
    return tuple(ordered)


def _extract_entity_id(entity_json: Any) -> str | None:
    unwrapped = _unwrap_json(entity_json)
    if isinstance(unwrapped, dict):
        props = unwrapped.get("properties", unwrapped)
        if isinstance(props, dict) and "entity_id" in props:
            return str(props["entity_id"])
    return None


class RingDetector:
    """Executes parameterized ISO GQL queries against Cloud Spanner Graph."""

    def __init__(self, database: Any) -> None:
        self._database = database

    def detect_circular_rings(
        self,
        account_id: str,
        min_amount: Decimal = Decimal("1000"),
    ) -> tuple[LaunderingRingEvidence, ...]:
        """Detect 2-to-12 hop simple circular rings returning to `account_id`."""
        if not account_id or not account_id.strip():
            raise ValueError("account_id must be a non-empty string")

        t_start = time.perf_counter()
        with self._database.snapshot() as snapshot:
            rows = list(
                snapshot.execute_sql(
                    GQL_CIRCULAR_LAYERING,
                    params={"account_id": account_id.strip(), "min_amount": min_amount},
                    param_types={
                        "account_id": param_types.STRING,
                        "min_amount": param_types.NUMERIC,
                    },
                )
            )
        latency_ms = round((time.perf_counter() - t_start) * 1000.0, 2)

        results: list[LaunderingRingEvidence] = []
        for row in rows:
            ring_path_raw = row[0]
            hops = parse_graph_path_hops(ring_path_raw)
            results.append(
                LaunderingRingEvidence.from_hops(
                    typology="CIRCULAR_LAYERING",
                    hops=hops,
                    subject_entity_id=None,
                    query_latency_ms=latency_ms,
                    raw_graph_path={"path": _unwrap_json(ring_path_raw)},
                )
            )
        return tuple(results)

    def check_pre_settlement_ring(
        self,
        from_account_id: str,
        to_account_id: str,
        candidate_amount: Decimal,
        candidate_timestamp: datetime,
        min_amount: Decimal = Decimal("1000"),
    ) -> tuple[LaunderingRingEvidence, ...]:
        """Evaluate whether a candidate payment `from_account_id -> to_account_id` closes a cycle."""
        if not from_account_id.strip() or not to_account_id.strip():
            raise ValueError("from_account_id and to_account_id must be non-empty")

        t_start = time.perf_counter()
        with self._database.snapshot() as snapshot:
            rows = list(
                snapshot.execute_sql(
                    GQL_PRE_SETTLEMENT_CYCLE_CHECK,
    GQL_PRE_SETTLEMENT_TRAIL_CHECK,
                    params={
                        "from_account_id": from_account_id.strip(),
                        "to_account_id": to_account_id.strip(),
                        "min_amount": min_amount,
                        "candidate_timestamp": candidate_timestamp,
                    },
                    param_types={
                        "from_account_id": param_types.STRING,
                        "to_account_id": param_types.STRING,
                        "min_amount": param_types.NUMERIC,
                        "candidate_timestamp": param_types.TIMESTAMP,
                    },
                )
            )
        latency_ms = round((time.perf_counter() - t_start) * 1000.0, 2)

        candidate_hop = TransferHop(
            transaction_id="tx_candidate_pending",
            from_account_id=from_account_id.strip(),
            to_account_id=to_account_id.strip(),
            amount_paid=candidate_amount,
            amount_received=candidate_amount,
            currency="USD",
            payment_format="Wire",
            event_timestamp=candidate_timestamp,
        )

        results: list[LaunderingRingEvidence] = []
        for row in rows:
            prior_path_raw = row[0]
            prior_hops = parse_graph_path_hops(prior_path_raw)
            full_hops = prior_hops + (candidate_hop,)
            results.append(
                LaunderingRingEvidence.from_hops(
                    typology="PRE_SETTLEMENT_CYCLE_CHECK",
                    hops=full_hops,
                    subject_entity_id=None,
                    query_latency_ms=latency_ms,
                    raw_graph_path={"prior_path": _unwrap_json(prior_path_raw)},
                )
            )
        return tuple(results)

    def check_pre_settlement_laundering_trail(
        self,
        from_account_id: str,
        to_account_id: str,
    ) -> tuple[LaunderingRingEvidence, ...]:
        """Evaluate whether `from_account_id -> to_account_id` is the payout edge of an upstream laundering trail."""
        if not from_account_id.strip() or not to_account_id.strip():
            raise ValueError("from_account_id and to_account_id must be non-empty")

        t_start = time.perf_counter()
        with self._database.snapshot() as snapshot:
            rows = list(
                snapshot.execute_sql(
                    GQL_PRE_SETTLEMENT_TRAIL_CHECK,
                    params={
                        "from_account_id": from_account_id.strip(),
                        "to_account_id": to_account_id.strip(),
                    },
                    param_types={
                        "from_account_id": param_types.STRING,
                        "to_account_id": param_types.STRING,
                    },
                )
            )
        latency_ms = round((time.perf_counter() - t_start) * 1000.0, 2)

        results: list[LaunderingRingEvidence] = []
        for row in rows:
            path_raw = row[0]
            hops = parse_graph_path_hops(path_raw)
            if hops:
                results.append(
                    LaunderingRingEvidence.from_hops(
                        typology="PRE_SETTLEMENT_TRAIL_CHECK",
                        hops=hops,
                        subject_entity_id=None,
                        query_latency_ms=latency_ms,
                        raw_graph_path={"laundering_path": _unwrap_json(path_raw)},
                    )
                )
        return tuple(results)

    def detect_same_entity_rings(
        self,
        min_amount: Decimal = Decimal("1000"),
    ) -> tuple[LaunderingRingEvidence, ...]:
        """Detect multi-hop paths between two distinct accounts owned by the same Entity."""
        t_start = time.perf_counter()
        with self._database.snapshot() as snapshot:
            rows = list(
                snapshot.execute_sql(
                    GQL_SAME_ENTITY_RING,
                    params={"min_amount": min_amount},
                    param_types={"min_amount": param_types.NUMERIC},
                )
            )
        latency_ms = round((time.perf_counter() - t_start) * 1000.0, 2)

        results: list[LaunderingRingEvidence] = []
        for row in rows:
            owner_entity_raw, ring_path_raw = row[0], row[1]
            hops = parse_graph_path_hops(ring_path_raw)
            results.append(
                LaunderingRingEvidence.from_hops(
                    typology="SAME_ENTITY_RING",
                    hops=hops,
                    subject_entity_id=_extract_entity_id(owner_entity_raw),
                    query_latency_ms=latency_ms,
                    raw_graph_path={
                        "owner_entity": _unwrap_json(owner_entity_raw),
                        "path": _unwrap_json(ring_path_raw),
                    },
                )
            )
        return tuple(results)

    def detect_ubo_shell_rings(
        self,
        min_amount: Decimal = Decimal("1000"),
    ) -> tuple[LaunderingRingEvidence, ...]:
        """Detect multi-hop paths between accounts of distinct shell companies controlled by one UBO."""
        t_start = time.perf_counter()
        with self._database.snapshot() as snapshot:
            rows = list(
                snapshot.execute_sql(
                    GQL_UBO_SHELL_RING,
                    params={"min_amount": min_amount},
                    param_types={"min_amount": param_types.NUMERIC},
                )
            )
        latency_ms = round((time.perf_counter() - t_start) * 1000.0, 2)

        results: list[LaunderingRingEvidence] = []
        for row in rows:
            ubo_raw, s1_raw, s2_raw, ring_path_raw = row[0], row[1], row[2], row[3]
            hops = parse_graph_path_hops(ring_path_raw)
            results.append(
                LaunderingRingEvidence.from_hops(
                    typology="UBO_SHELL_RING",
                    hops=hops,
                    subject_entity_id=_extract_entity_id(ubo_raw),
                    query_latency_ms=latency_ms,
                    raw_graph_path={
                        "ubo_entity": _unwrap_json(ubo_raw),
                        "origin_shell": _unwrap_json(s1_raw),
                        "destination_shell": _unwrap_json(s2_raw),
                        "path": _unwrap_json(ring_path_raw),
                    },
                )
            )
        return tuple(results)

    def detect_fan_out(
        self,
        account_id: str,
        min_amount: Decimal = Decimal("1000"),
        min_degree: int = 2,
    ) -> tuple[LaunderingRingEvidence, ...]:
        """Detect high-degree fan-out splitting from a hub account."""
        t_start = time.perf_counter()
        with self._database.snapshot() as snapshot:
            rows = list(
                snapshot.execute_sql(
                    GQL_FAN_OUT,
                    params={
                        "account_id": account_id.strip(),
                        "min_amount": min_amount,
                        "min_degree": min_degree,
                    },
                    param_types={
                        "account_id": param_types.STRING,
                        "min_amount": param_types.NUMERIC,
                        "min_degree": param_types.INT64,
                    },
                )
            )
        latency_ms = round((time.perf_counter() - t_start) * 1000.0, 2)

        results: list[LaunderingRingEvidence] = []
        for row in rows:
            hub_id, out_degree, out_edges_raw = row[0], row[1], row[2]
            hops = _dedup_hops(parse_graph_path_hops(out_edges_raw))
            if hops:
                results.append(
                    LaunderingRingEvidence.from_hops(
                        typology="FAN_OUT",
                        hops=hops,
                        subject_entity_id=None,
                        query_latency_ms=latency_ms,
                        raw_graph_path={"hub_account_id": hub_id, "out_degree": out_degree},
                    )
                )
        return tuple(results)

    def detect_fan_in(
        self,
        account_id: str,
        min_amount: Decimal = Decimal("1000"),
        min_degree: int = 2,
    ) -> tuple[LaunderingRingEvidence, ...]:
        """Detect high-degree fan-in aggregation into a sink account."""
        t_start = time.perf_counter()
        with self._database.snapshot() as snapshot:
            rows = list(
                snapshot.execute_sql(
                    GQL_FAN_IN,
                    params={
                        "account_id": account_id.strip(),
                        "min_amount": min_amount,
                        "min_degree": min_degree,
                    },
                    param_types={
                        "account_id": param_types.STRING,
                        "min_amount": param_types.NUMERIC,
                        "min_degree": param_types.INT64,
                    },
                )
            )
        latency_ms = round((time.perf_counter() - t_start) * 1000.0, 2)

        results: list[LaunderingRingEvidence] = []
        for row in rows:
            sink_id, in_degree, in_edges_raw = row[0], row[1], row[2]
            hops = _dedup_hops(parse_graph_path_hops(in_edges_raw))
            if hops:
                results.append(
                    LaunderingRingEvidence.from_hops(
                        typology="FAN_IN",
                        hops=hops,
                        subject_entity_id=None,
                        query_latency_ms=latency_ms,
                        raw_graph_path={"sink_account_id": sink_id, "in_degree": in_degree},
                    )
                )
        return tuple(results)

    def detect_gather_scatter(
        self,
        hub_account_id: str,
        min_amount: Decimal = Decimal("1000"),
    ) -> tuple[LaunderingRingEvidence, ...]:
        """Detect gather-scatter aggregation into and distribution out of `hub_account_id`."""
        t_start = time.perf_counter()
        with self._database.snapshot() as snapshot:
            rows = list(
                snapshot.execute_sql(
                    GQL_GATHER_SCATTER,
                    params={
                        "account_id": hub_account_id.strip(),
                        "min_amount": min_amount,
                    },
                    param_types={
                        "account_id": param_types.STRING,
                        "min_amount": param_types.NUMERIC,
                    },
                )
            )
        latency_ms = round((time.perf_counter() - t_start) * 1000.0, 2)

        results: list[LaunderingRingEvidence] = []
        for row in rows:
            hub_id, in_deg, out_deg, in_edges_raw, out_edges_raw = (
                row[0],
                row[1],
                row[2],
                row[3],
                row[4],
            )
            hops = _dedup_hops(
                parse_graph_path_hops(in_edges_raw) + parse_graph_path_hops(out_edges_raw)
            )
            if hops:
                results.append(
                    LaunderingRingEvidence.from_hops(
                        typology="GATHER_SCATTER",
                        hops=hops,
                        subject_entity_id=None,
                        query_latency_ms=latency_ms,
                        raw_graph_path={
                            "hub_account_id": hub_id,
                            "fan_in_degree": in_deg,
                            "fan_out_degree": out_deg,
                        },
                    )
                )
        return tuple(results)

    def detect_scatter_gather(
        self,
        origin_account_id: str,
        min_amount: Decimal = Decimal("1000"),
        min_degree: int = 2,
    ) -> tuple[LaunderingRingEvidence, ...]:
        """Detect scatter-gather diamond patterns originating at `origin_account_id`."""
        t_start = time.perf_counter()
        with self._database.snapshot() as snapshot:
            rows = list(
                snapshot.execute_sql(
                    GQL_SCATTER_GATHER,
                    params={
                        "account_id": origin_account_id.strip(),
                        "min_amount": min_amount,
                        "min_degree": min_degree,
                    },
                    param_types={
                        "account_id": param_types.STRING,
                        "min_amount": param_types.NUMERIC,
                        "min_degree": param_types.INT64,
                    },
                )
            )
        latency_ms = round((time.perf_counter() - t_start) * 1000.0, 2)

        results: list[LaunderingRingEvidence] = []
        for row in rows:
            orig_id, sink_id, mule_cnt, scatter_raw, gather_raw = (
                row[0],
                row[1],
                row[2],
                row[3],
                row[4],
            )
            hops = _dedup_hops(
                parse_graph_path_hops(scatter_raw) + parse_graph_path_hops(gather_raw)
            )
            if hops:
                results.append(
                    LaunderingRingEvidence.from_hops(
                        typology="SCATTER_GATHER",
                        hops=hops,
                        subject_entity_id=None,
                        query_latency_ms=latency_ms,
                        raw_graph_path={
                            "origin_account_id": orig_id,
                            "sink_account_id": sink_id,
                            "mule_count": mule_cnt,
                        },
                    )
                )
        return tuple(results)

    def detect_bipartite(
        self,
        account_id: str,
        min_amount: Decimal = Decimal("1000"),
    ) -> tuple[LaunderingRingEvidence, ...]:
        """Detect single-layer bipartite relay transfers through `account_id`."""
        t_start = time.perf_counter()
        with self._database.snapshot() as snapshot:
            rows = list(
                snapshot.execute_sql(
                    GQL_BIPARTITE,
                    params={"account_id": account_id.strip(), "min_amount": min_amount},
                    param_types={
                        "account_id": param_types.STRING,
                        "min_amount": param_types.NUMERIC,
                    },
                )
            )
        latency_ms = round((time.perf_counter() - t_start) * 1000.0, 2)

        results: list[LaunderingRingEvidence] = []
        for row in rows:
            s_acc_id, recv_acc_id, peer_cnt, funding_raw, bipartite_raw = (
                row[0],
                row[1],
                row[2],
                row[3],
                row[4],
            )
            hops = _dedup_hops(
                parse_graph_path_hops(funding_raw) + parse_graph_path_hops(bipartite_raw)
            )
            if hops:
                results.append(
                    LaunderingRingEvidence.from_hops(
                        typology="BIPARTITE",
                        hops=hops,
                        subject_entity_id=None,
                        query_latency_ms=latency_ms,
                        raw_graph_path={
                            "source_account_id": s_acc_id,
                            "receiver_account_id": recv_acc_id,
                            "funding_peer_count": peer_cnt,
                        },
                    )
                )
        return tuple(results)

    def detect_stacked_bipartite(
        self,
        min_amount: Decimal = Decimal("1000"),
    ) -> tuple[LaunderingRingEvidence, ...]:
        """Detect multi-layer stacked bipartite relay chains."""
        t_start = time.perf_counter()
        with self._database.snapshot() as snapshot:
            rows = list(
                snapshot.execute_sql(
                    GQL_STACKED_BIPARTITE,
                    params={"min_amount": min_amount},
                    param_types={"min_amount": param_types.NUMERIC},
                )
            )
        latency_ms = round((time.perf_counter() - t_start) * 1000.0, 2)

        results: list[LaunderingRingEvidence] = []
        for row in rows:
            relay_path_raw = row[0]
            hops = parse_graph_path_hops(relay_path_raw)
            if hops:
                results.append(
                    LaunderingRingEvidence.from_hops(
                        typology="STACKED_BIPARTITE",
                        hops=hops,
                        subject_entity_id=None,
                        query_latency_ms=latency_ms,
                        raw_graph_path={"path": _unwrap_json(relay_path_raw)},
                    )
                )
        return tuple(results)

    def detect_random_walk_layering(
        self,
        account_id: str,
        min_amount: Decimal = Decimal("1000"),
    ) -> tuple[LaunderingRingEvidence, ...]:
        """Detect 2-to-11 hop sequential non-cyclic layering chains starting at `account_id`."""
        t_start = time.perf_counter()
        with self._database.snapshot() as snapshot:
            rows = list(
                snapshot.execute_sql(
                    GQL_RANDOM_WALK_LAYERING,
                    params={"account_id": account_id.strip(), "min_amount": min_amount},
                    param_types={
                        "account_id": param_types.STRING,
                        "min_amount": param_types.NUMERIC,
                    },
                )
            )
        latency_ms = round((time.perf_counter() - t_start) * 1000.0, 2)

        results: list[LaunderingRingEvidence] = []
        for row in rows:
            walk_path_raw = row[0]
            hops = parse_graph_path_hops(walk_path_raw)
            if hops:
                results.append(
                    LaunderingRingEvidence.from_hops(
                        typology="RANDOM_WALK",
                        hops=hops,
                        subject_entity_id=None,
                        query_latency_ms=latency_ms,
                        raw_graph_path={"path": _unwrap_json(walk_path_raw)},
                    )
                )
        return tuple(results)

    def scan_all_typologies(
        self,
        seed_account_ids: Sequence[str] = ("ACC_RING1_A",),
        min_amount: Decimal = Decimal("1000"),
    ) -> tuple[LaunderingRingEvidence, ...]:
        """Run all circular, same-entity, and UBO shell ring detectors and return combined evidence."""
        collected: list[LaunderingRingEvidence] = []
        for acc_id in seed_account_ids:
            collected.extend(self.detect_circular_rings(acc_id, min_amount=min_amount))
        collected.extend(self.detect_same_entity_rings(min_amount=min_amount))
        collected.extend(self.detect_ubo_shell_rings(min_amount=min_amount))
        return tuple(collected)

