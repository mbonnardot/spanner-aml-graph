"""Command-line interface for spanner-aml-graph Phase 1."""

from __future__ import annotations

import argparse
from decimal import Decimal
import json
from pathlib import Path
from typing import Sequence

from spanner_aml.config import SpannerConfig
from spanner_aml.detector import RingDetector
from spanner_aml.loader import (
    DEFAULT_SEED_ACCOUNTS_CSV,
    DEFAULT_SEED_ENRICHMENTS_JSON,
    DEFAULT_SEED_TRANSACTIONS_CSV,
    load_dataset_into_spanner,
    parse_ibm_aml_files,
)
from spanner_aml.schema_manager import apply_schema


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="spanner-aml",
        description="Cloud Spanner Graph (ISO GQL) Anti-Money Laundering Ring Detector",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init-schema", help="Apply Spanner relational & AmlGraph DDL")

    load_p = sub.add_parser("load-data", help="Load IBM AML CSV dataset into Spanner")
    load_p.add_argument(
        "--seed",
        action="store_true",
        help="Load the built-in curated multi-typology seed dataset",
    )
    load_p.add_argument("--accounts-csv", type=Path, default=DEFAULT_SEED_ACCOUNTS_CSV)
    load_p.add_argument("--transactions-csv", type=Path, default=DEFAULT_SEED_TRANSACTIONS_CSV)
    load_p.add_argument("--enrichments-json", type=Path, default=DEFAULT_SEED_ENRICHMENTS_JSON)
    load_p.add_argument("--limit", type=int, default=None)
    load_p.add_argument("--batch-size", type=int, default=500)

    detect_p = sub.add_parser(
        "detect-rings", help="Run ISO GQL laundering ring detection queries"
    )
    detect_p.add_argument(
        "--account-id",
        action="append",
        dest="account_ids",
        default=None,
        help="Account ID(s) to inspect for direct circular rings (default: ACC_RING1_A)",
    )
    detect_p.add_argument(
        "--min-amount",
        type=Decimal,
        default=Decimal("1000"),
        help="Minimum initial transfer amount filter",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Execute the spanner-aml CLI command."""
    parser = _build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    cfg = SpannerConfig.from_env()
    database = cfg.get_database()

    if args.command == "init-schema":
        applied = apply_schema(database)
        print(f"Applied {len(applied)} DDL statement(s) to {cfg.database_id}.")
        return 0

    if args.command == "load-data":
        dataset = parse_ibm_aml_files(
            accounts_csv=DEFAULT_SEED_ACCOUNTS_CSV if args.seed else args.accounts_csv,
            transactions_csv=DEFAULT_SEED_TRANSACTIONS_CSV if args.seed else args.transactions_csv,
            enrichments_json=DEFAULT_SEED_ENRICHMENTS_JSON if args.seed else args.enrichments_json,
            limit=args.limit,
        )
        counts = load_dataset_into_spanner(database, dataset, batch_size=args.batch_size)
        print(json.dumps({"status": "loaded", "counts": counts}, indent=2))
        return 0

    if args.command == "detect-rings":
        seed_accounts = tuple(args.account_ids or ["ACC_RING1_A"])
        detector = RingDetector(database)
        evidences = detector.scan_all_typologies(
            seed_account_ids=seed_accounts,
            min_amount=args.min_amount,
        )
        serialized = [
            {
                "typology": ev.typology,
                "hop_count": ev.hop_count,
                "initial_amount": str(ev.initial_amount),
                "final_amount": str(ev.final_amount),
                "retention_ratio": ev.retention_ratio,
                "total_duration_seconds": ev.total_duration_seconds,
                "account_ids": list(ev.account_ids),
                "subject_entity_id": ev.subject_entity_id,
                "query_latency_ms": ev.query_latency_ms,
            }
            for ev in evidences
        ]
        print(json.dumps({"detected_rings": serialized, "count": len(serialized)}, indent=2))
        return 0

    return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
