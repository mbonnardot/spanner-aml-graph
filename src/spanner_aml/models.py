"""Immutable domain models for Cloud Spanner Graph AML detection."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from types import MappingProxyType
from typing import Any, Literal, Mapping

TypologyType = Literal[
    "CIRCULAR_LAYERING",
    "SAME_ENTITY_RING",
    "UBO_SHELL_RING",
    "PRE_SETTLEMENT_CYCLE_CHECK",
    "FAN_OUT",
    "FAN_IN",
    "GATHER_SCATTER",
    "SCATTER_GATHER",
    "STACKED_BIPARTITE",
    "RANDOM_WALK",
]

USD_FX_RATES: Mapping[str, Decimal] = MappingProxyType(
    {
        "US Dollar": Decimal("1.00"),
        "USD": Decimal("1.00"),
        "Euro": Decimal("1.1721"),
        "EUR": Decimal("1.1721"),
        "Swiss Franc": Decimal("1.0923"),
        "CHF": Decimal("1.0923"),
        "UK Pound": Decimal("1.2921"),
        "GBP": Decimal("1.2921"),
        "Canadian Dollar": Decimal("0.7599"),
        "CAD": Decimal("0.7599"),
        "Australian Dollar": Decimal("0.7051"),
        "AUD": Decimal("0.7051"),
        "Yuan": Decimal("0.1500"),
        "CNY": Decimal("0.1500"),
        "Yen": Decimal("0.009525"),
        "JPY": Decimal("0.009525"),
        "Rupee": Decimal("0.01362"),
        "INR": Decimal("0.01362"),
        "Ruble": Decimal("0.01300"),
        "RUB": Decimal("0.01300"),
        "Brazil Real": Decimal("0.1765"),
        "BRL": Decimal("0.1765"),
        "Mexican Peso": Decimal("0.04700"),
        "MXN": Decimal("0.04700"),
        "Saudi Riyal": Decimal("0.2666"),
        "SAR": Decimal("0.2666"),
        "Shekel": Decimal("0.2961"),
        "ILS": Decimal("0.2961"),
        "Bitcoin": Decimal("11948.80"),
        "BTC": Decimal("11948.80"),
    }
)


def normalize_to_usd(amount: Decimal, currency: str) -> Decimal:
    """Convert an IBM AML currency amount into USD equivalent rounded to 2 decimal places."""
    rate = USD_FX_RATES.get(currency.strip(), Decimal("1.00"))
    return (amount * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


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
class SimulationEpisode:
    """A single laundering simulation attempt parsed from IBM AML *_Patterns.txt."""

    episode_id: str
    pattern_type: str
    pattern_detail: str
    transactions: tuple[Transaction, ...]
    account_ids: tuple[str, ...]


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
    raw_graph_path: Mapping[str, Any]

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "raw_graph_path",
            MappingProxyType(dict(self.raw_graph_path)),
        )

    @classmethod
    def from_hops(
        cls,
        typology: str,
        hops: tuple[TransferHop, ...],
        subject_entity_id: str | None,
        query_latency_ms: float,
        raw_graph_path: Mapping[str, Any],
    ) -> LaunderingRingEvidence:
        """Construct a validated LaunderingRingEvidence from an ordered tuple of hops."""
        if not hops:
            raise ValueError("hops must contain at least one TransferHop")
        initial = normalize_to_usd(hops[0].amount_paid, hops[0].currency)
        final = normalize_to_usd(hops[-1].amount_received, hops[-1].currency)
        ratio = float(final / initial) if initial > Decimal("0") else 0.0
        timestamps = [h.event_timestamp for h in hops]
        duration = (max(timestamps) - min(timestamps)).total_seconds()
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
            raw_graph_path=MappingProxyType(dict(raw_graph_path)),
        )

