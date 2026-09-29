"""Real-time pre-settlement payment interceptor powered by Spanner Graph ISO GQL."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import time
from typing import Any
import uuid

from spanner_aml.detector import RingDetector
from spanner_aml.models import InterceptionResult, Transaction

TRANSACTION_COLUMNS = (
    "transaction_id",
    "from_bank_id",
    "from_account_id",
    "to_bank_id",
    "to_account_id",
    "event_timestamp",
    "amount_paid",
    "payment_currency",
    "amount_received",
    "receiving_currency",
    "payment_format",
    "settlement_status",
    "is_laundering",
)


class SettlementInterceptor:
    """Evaluates candidate payments against AmlGraph in <500ms before settlement."""

    def __init__(
        self,
        database: Any,
        detector: RingDetector | None = None,
    ) -> None:
        self._database = database
        self._detector = detector or RingDetector(database)

    def evaluate_candidate_transfer(
        self,
        from_account_id: str,
        to_account_id: str,
        amount_paid: Decimal,
        from_bank_id: str = "BANK_INTERCEPT",
        to_bank_id: str = "BANK_INTERCEPT",
        payment_currency: str = "USD",
        payment_format: str = "Wire",
        min_amount: Decimal = Decimal("100"),
        persist: bool = False,
        transaction_id: str | None = None,
    ) -> InterceptionResult:
        """Check if a candidate payment from `from_account_id -> to_account_id` closes an active cycle."""
        clean_from = from_account_id.strip()
        clean_to = to_account_id.strip()
        if not clean_from or not clean_to:
            raise ValueError("from_account_id and to_account_id must be non-empty")

        t_start = time.perf_counter()
        # A transfer from `from_account_id -> to_account_id` closes a cycle if there is already
        # an active path from `to_account_id ->* from_account_id`.
        matched = self._detector.check_pre_settlement_cycle(
            from_account_id=clean_to,
            candidate_to_account_id=clean_from,
            min_amount=min(min_amount, amount_paid),
        )
        latency_ms = round((time.perf_counter() - t_start) * 1000.0, 2)

        decision = "HELD" if matched else "SETTLED"
        tx = Transaction(
            transaction_id=transaction_id or f"TX_INT_{uuid.uuid4().hex[:10].upper()}",
            from_bank_id=from_bank_id,
            from_account_id=clean_from,
            to_bank_id=to_bank_id,
            to_account_id=clean_to,
            event_timestamp=datetime.now(timezone.utc),
            amount_received=amount_paid,
            receiving_currency=payment_currency,
            amount_paid=amount_paid,
            payment_currency=payment_currency,
            payment_format=payment_format,
            is_laundering=bool(matched),
            settlement_status=decision,
        )

        if persist:
            with self._database.batch() as batch:
                batch.insert_or_update(
                    table="Transactions",
                    columns=TRANSACTION_COLUMNS,
                    values=[
                        (
                            tx.transaction_id,
                            tx.from_bank_id,
                            tx.from_account_id,
                            tx.to_bank_id,
                            tx.to_account_id,
                            tx.event_timestamp,
                            tx.amount_paid,
                            tx.payment_currency,
                            tx.amount_received,
                            tx.receiving_currency,
                            tx.payment_format,
                            tx.settlement_status,
                            tx.is_laundering,
                        )
                    ],
                )

        return InterceptionResult(
            transaction=tx,
            decision=decision,
            latency_ms=latency_ms,
            matched_evidence=matched,
        )
