"""IBM AML Kaggle CSV parser and batched Cloud Spanner mutation loader."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
from typing import Any, Sequence, TypeVar

from spanner_aml.models import Account, Bank, Entity, Transaction

T = TypeVar("T")

SEED_DIR = Path(__file__).resolve().parents[2] / "data" / "seed"
DEFAULT_SEED_ACCOUNTS_CSV = SEED_DIR / "HI-Small_accounts_seed.csv"
DEFAULT_SEED_TRANSACTIONS_CSV = SEED_DIR / "HI-Small_Trans_seed.csv"
DEFAULT_SEED_ENRICHMENTS_JSON = SEED_DIR / "seed_enrichments.json"


@dataclass(frozen=True)
class ParsedAmlDataset:
    """Immutable collection of parsed domain records ready for Spanner ingestion."""

    banks: tuple[Bank, ...]
    entities: tuple[Entity, ...]
    accounts: tuple[Account, ...]
    transactions: tuple[Transaction, ...]


def compute_transaction_id(
    timestamp_str: str,
    from_bank: str,
    from_account: str,
    to_bank: str,
    to_account: str,
    amount_paid: str,
    payment_format: str,
    duplicate_ordinal: int = 0,
) -> str:
    """Generate a deterministic, collision-resistant primary key for an IBM AML transaction row."""
    payload = (
        f"{timestamp_str.strip()}|{from_bank.strip()}|{from_account.strip()}|"
        f"{to_bank.strip()}|{to_account.strip()}|{amount_paid.strip()}|"
        f"{payment_format.strip()}|{duplicate_ordinal}"
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]
    return f"tx_{digest}"


def _parse_ibm_timestamp(raw_ts: str) -> datetime:
    """Parse IBM AML timestamp format ('YYYY/MM/DD HH:MM' or ISO-8601) into UTC datetime."""
    cleaned = raw_ts.strip()
    for fmt in ("%Y/%m/%d %H:%M", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(cleaned, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return datetime.fromisoformat(cleaned).astimezone(timezone.utc)


def parse_ibm_aml_files(
    accounts_csv: Path = DEFAULT_SEED_ACCOUNTS_CSV,
    transactions_csv: Path = DEFAULT_SEED_TRANSACTIONS_CSV,
    enrichments_json: Path | None = DEFAULT_SEED_ENRICHMENTS_JSON,
    limit: int | None = None,
) -> ParsedAmlDataset:
    """Parse IBM AML accounts and transactions CSVs with optional banking enrichments."""
    enrichments: dict[str, Any] = {}
    if enrichments_json is not None and enrichments_json.exists():
        enrichments = json.loads(enrichments_json.read_text(encoding="utf-8"))

    bank_enrich = enrichments.get("banks", {})
    entity_enrich = enrichments.get("entities", {})
    account_enrich = enrichments.get("accounts", {})

    banks_by_id: dict[str, Bank] = {}
    entities_by_id: dict[str, Entity] = {}
    accounts_by_id: dict[str, Account] = {}

    for extra_ent in enrichments.get("extra_entities", []):
        ent_id = str(extra_ent["entity_id"])
        entities_by_id[ent_id] = Entity(
            entity_id=ent_id,
            entity_name=str(extra_ent["entity_name"]),
            entity_type=str(extra_ent.get("entity_type", "CORPORATION")),
            kyc_risk_tier=str(extra_ent.get("kyc_risk_tier", "LOW")),
            is_pep_or_sanctioned=bool(extra_ent.get("is_pep_or_sanctioned", False)),
            jurisdiction=extra_ent.get("jurisdiction"),
            ubo_entity_id=extra_ent.get("ubo_entity_id"),
        )

    with accounts_csv.open("r", encoding="utf-8", newline="") as f_acc:
        reader = csv.reader(f_acc)
        header = next(reader, None)
        if header is None:
            raise ValueError(f"Accounts CSV is empty: {accounts_csv}")
        for row in reader:
            if not row or len(row) < 5:
                continue
            bank_name, bank_id, account_id, entity_id, entity_name = (
                col.strip() for col in row[:5]
            )
            if bank_id not in banks_by_id:
                b_meta = bank_enrich.get(bank_id, {})
                banks_by_id[bank_id] = Bank(
                    bank_id=bank_id,
                    bank_name=bank_name,
                    bic_swift=b_meta.get("bic_swift"),
                    jurisdiction=b_meta.get("jurisdiction"),
                )
            if entity_id not in entities_by_id:
                e_meta = entity_enrich.get(entity_id, {})
                entities_by_id[entity_id] = Entity(
                    entity_id=entity_id,
                    entity_name=entity_name,
                    entity_type=str(e_meta.get("entity_type", "CORPORATION")),
                    kyc_risk_tier=str(e_meta.get("kyc_risk_tier", "LOW")),
                    is_pep_or_sanctioned=bool(e_meta.get("is_pep_or_sanctioned", False)),
                    jurisdiction=e_meta.get("jurisdiction"),
                    ubo_entity_id=e_meta.get("ubo_entity_id"),
                )
            if account_id not in accounts_by_id:
                a_meta = account_enrich.get(account_id, {})
                accounts_by_id[account_id] = Account(
                    account_id=account_id,
                    bank_id=bank_id,
                    entity_id=entity_id,
                    currency=str(a_meta.get("currency", "USD")),
                    iban=a_meta.get("iban"),
                    account_status=str(a_meta.get("account_status", "ACTIVE")),
                    is_flagged=bool(a_meta.get("is_flagged", False)),
                )

    transactions: list[Transaction] = []
    seen_tuple_counts: dict[str, int] = {}

    with transactions_csv.open("r", encoding="utf-8", newline="") as f_tx:
        reader = csv.reader(f_tx)
        header = next(reader, None)
        if header is None:
            raise ValueError(f"Transactions CSV is empty: {transactions_csv}")
        for idx, row in enumerate(reader):
            if limit is not None and idx >= limit:
                break
            if not row or len(row) < 11:
                continue
            (
                ts_str,
                from_bank,
                from_acc,
                to_bank,
                to_acc,
                amt_recv_str,
                recv_curr,
                amt_paid_str,
                paid_curr,
                pay_fmt,
                is_laundering_str,
            ) = (col.strip() for col in row[:11])

            tuple_key = f"{ts_str}|{from_bank}|{from_acc}|{to_bank}|{to_acc}|{amt_paid_str}|{pay_fmt}"
            ordinal = seen_tuple_counts.get(tuple_key, 0)
            seen_tuple_counts[tuple_key] = ordinal + 1

            tx_id = compute_transaction_id(
                ts_str, from_bank, from_acc, to_bank, to_acc, amt_paid_str, pay_fmt, ordinal
            )
            transactions.append(
                Transaction(
                    transaction_id=tx_id,
                    from_bank_id=from_bank,
                    from_account_id=from_acc,
                    to_bank_id=to_bank,
                    to_account_id=to_acc,
                    event_timestamp=_parse_ibm_timestamp(ts_str),
                    amount_received=Decimal(amt_recv_str),
                    receiving_currency=recv_curr,
                    amount_paid=Decimal(amt_paid_str),
                    payment_currency=paid_curr,
                    payment_format=pay_fmt,
                    is_laundering=is_laundering_str in ("1", "true", "True", "TRUE"),
                    settlement_status="SETTLED",
                )
            )

    # Order entities so UBO parents (ubo_entity_id is None) are inserted before child entities
    ordered_entities = tuple(
        sorted(entities_by_id.values(), key=lambda e: (e.ubo_entity_id is not None, e.entity_id))
    )

    return ParsedAmlDataset(
        banks=tuple(banks_by_id.values()),
        entities=ordered_entities,
        accounts=tuple(accounts_by_id.values()),
        transactions=tuple(transactions),
    )


def _chunked(items: Sequence[T], size: int) -> Sequence[Sequence[T]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def load_dataset_into_spanner(
    database: Any,
    dataset: ParsedAmlDataset,
    batch_size: int = 500,
) -> dict[str, int]:
    """Write Banks, Entities, Accounts, and Transactions idempotently in topological order."""
    if batch_size <= 0:
        raise ValueError("batch_size must be positive")

    bank_cols = ("bank_id", "bank_name", "bic_swift", "jurisdiction")
    bank_rows = [
        (b.bank_id, b.bank_name, b.bic_swift, b.jurisdiction)
        for b in dataset.banks
    ]
    for chunk in _chunked(bank_rows, batch_size):
        with database.batch() as batch:
            batch.insert_or_update(table="Banks", columns=bank_cols, values=list(chunk))

    entity_cols = (
        "entity_id",
        "entity_name",
        "entity_type",
        "kyc_risk_tier",
        "is_pep_or_sanctioned",
        "jurisdiction",
        "ubo_entity_id",
    )
    entity_rows = [
        (
            e.entity_id,
            e.entity_name,
            e.entity_type,
            e.kyc_risk_tier,
            e.is_pep_or_sanctioned,
            e.jurisdiction,
            e.ubo_entity_id,
        )
        for e in dataset.entities
    ]
    for chunk in _chunked(entity_rows, batch_size):
        with database.batch() as batch:
            batch.insert_or_update(table="Entities", columns=entity_cols, values=list(chunk))

    account_cols = (
        "account_id",
        "bank_id",
        "entity_id",
        "iban",
        "currency",
        "account_status",
        "is_flagged",
    )
    account_rows = [
        (
            a.account_id,
            a.bank_id,
            a.entity_id,
            a.iban,
            a.currency,
            a.account_status,
            a.is_flagged,
        )
        for a in dataset.accounts
    ]
    for chunk in _chunked(account_rows, batch_size):
        with database.batch() as batch:
            batch.insert_or_update(table="Accounts", columns=account_cols, values=list(chunk))

    tx_cols = (
        "transaction_id",
        "from_bank_id",
        "from_account_id",
        "to_bank_id",
        "to_account_id",
        "event_timestamp",
        "amount_received",
        "receiving_currency",
        "amount_paid",
        "payment_currency",
        "payment_format",
        "is_laundering",
        "settlement_status",
    )
    tx_rows = [
        (
            t.transaction_id,
            t.from_bank_id,
            t.from_account_id,
            t.to_bank_id,
            t.to_account_id,
            t.event_timestamp,
            t.amount_received,
            t.receiving_currency,
            t.amount_paid,
            t.payment_currency,
            t.payment_format,
            t.is_laundering,
            t.settlement_status,
        )
        for t in dataset.transactions
    ]
    for chunk in _chunked(tx_rows, batch_size):
        with database.batch() as batch:
            batch.insert_or_update(table="Transactions", columns=tx_cols, values=list(chunk))

    return {
        "Banks": len(bank_rows),
        "Entities": len(entity_rows),
        "Accounts": len(account_rows),
        "Transactions": len(tx_rows),
    }
