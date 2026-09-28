"""Immutable domain models for Cloud Spanner Graph AML detection."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

TypologyType = Literal[
    "CIRCULAR_LAYERING",
    "SAME_ENTITY_RING",
    "UBO_SHELL_RING",
    "PRE_SETTLEMENT_CYCLE_CHECK",
]


@dataclass(frozen=True)
class Bank:
    """Financial institution node."""

    bank_id: str
    bank_name: str
    bic_swift: str | None = None
    jurisdiction: str | None = None


@dataclass(frozen=True)
class Entity:
    """Legal entity or individual node."""

    entity_id: str
    entity_name: str
    entity_type: str = "CORPORATION"
    kyc_risk_tier: str = "LOW"
    is_pep_or_sanctioned: bool = False
    jurisdiction: str | None = None
    ubo_entity_id: str | None = None


@dataclass(frozen=True)
class Account:
    """Bank account node."""

    account_id: str
    bank_id: str
    entity_id: str
    currency: str = "USD"
    iban: str | None = None
    account_status: str = "ACTIVE"
    is_flagged: bool = False


@dataclass(frozen=True)
class Transaction:
    """Directed transfer edge between two accounts."""

    transaction_id: str
    from_bank_id: str
    from_account_id: str
    to_bank_id: str
    to_account_id: str
    event_timestamp: datetime
    amount_received: Decimal
    receiving_currency: str
    amount_paid: Decimal
    payment_currency: str
    payment_format: str
    is_laundering: bool = False
    settlement_status: str = "SETTLED"


@dataclass(frozen=True)
class TransferHop:
    """A single hop within a detected multi-hop laundering path."""

    transaction_id: str
    from_account_id: str
    to_account_id: str
    amount_paid: Decimal
    amount_received: Decimal
    currency: str
    payment_format: str
    event_timestamp: datetime


@dataclass(frozen=True)
class LaunderingRingEvidence:
    """Deterministic subgraph evidence packet produced by ISO GQL ring detection."""

    typology: str
    hop_count: int
    initial_amount: Decimal
    final_amount: Decimal
    retention_ratio: float
    total_duration_seconds: float
    account_ids: tuple[str, ...]
    hops: tuple[TransferHop, ...]
    subject_entity_id: str | None
    query_latency_ms: float
    raw_graph_path: dict[str, Any]

    @classmethod
    def from_hops(
        cls,
        typology: str,
        hops: tuple[TransferHop, ...],
        subject_entity_id: str | None,
        query_latency_ms: float,
        raw_graph_path: dict[str, Any],
    ) -> LaunderingRingEvidence:
        """Construct a validated LaunderingRingEvidence from an ordered tuple of hops."""
        if not hops:
            raise ValueError("hops must contain at least one TransferHop")
        initial = hops[0].amount_paid
        final = hops[-1].amount_received
        ratio = float(final / initial) if initial > Decimal("0") else 0.0
        duration = (
            hops[-1].event_timestamp - hops[0].event_timestamp
        ).total_seconds()
        account_chain = (hops[0].from_account_id,) + tuple(
            hop.to_account_id for hop in hops
        )
        return cls(
            typology=typology,
            hop_count=len(hops),
            initial_amount=initial,
            final_amount=final,
            retention_ratio=round(ratio, 6),
            total_duration_seconds=max(0.0, float(duration)),
            account_ids=account_chain,
            hops=hops,
            subject_entity_id=subject_entity_id,
            query_latency_ms=query_latency_ms,
            raw_graph_path=dict(raw_graph_path),
        )
