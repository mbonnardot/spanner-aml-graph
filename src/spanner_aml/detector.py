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
    GQL_CIRCULAR_LAYERING,
    GQL_PRE_SETTLEMENT_CYCLE_CHECK,
    GQL_SAME_ENTITY_RING,
    GQL_UBO_SHELL_RING,
)


def _unwrap_json(value: Any) -> Any:
    """Convert Spanner JsonObject or JSON string into standard Python dicts/lists."""
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return value
    if hasattr(value, "serialize"):
        return json.loads(value.serialize())
    if isinstance(value, str):
        return json.loads(value)
    return value


def _parse_iso_ts(raw_ts: str) -> datetime:
    cleaned = raw_ts.strip()
    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1] + "+00:00"
    return datetime.fromisoformat(cleaned).astimezone(timezone.utc)


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
    for elem in elements:
        if not isinstance(elem, dict) or elem.get("kind") != "edge":
            continue
        props = elem.get("properties", {})
        if "transaction_id" not in props:
            continue
        hops.append(
            TransferHop(
                transaction_id=str(props["transaction_id"]),
                from_account_id=str(props["from_account_id"]),
                to_account_id=str(props["to_account_id"]),
                amount_paid=Decimal(str(props["amount_paid"])),
                amount_received=Decimal(str(props["amount_received"])),
                currency=str(props.get("payment_currency", "USD")),
                payment_format=str(props.get("payment_format", "Wire")),
                event_timestamp=_parse_iso_ts(str(props["event_timestamp"])),
            )
        )
    return tuple(hops)


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
        """Detect 2-to-6 hop simple circular rings returning to `account_id`."""
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
