"""Command-line interface for spanner-aml-graph Phase 1."""

from __future__ import annotations

import argparse
from collections import Counter
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
    SEED_DIR,
    build_simulation_dataset,
    load_dataset_into_spanner,
    parse_ibm_aml_files,
    parse_patterns_file,
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
    load_p.add_argument(
        "--kaggle-dataset",
        choices=["HI", "LI"],
        default=None,
        help="Load real Kaggle HI-Small or LI-Small Patterns.txt episodes + background sample",
    )
    load_p.add_argument("--background-limit", type=int, default=1000)
    load_p.add_argument("--accounts-csv", type=Path, default=DEFAULT_SEED_ACCOUNTS_CSV)
    load_p.add_argument("--transactions-csv", type=Path, default=DEFAULT_SEED_TRANSACTIONS_CSV)
    load_p.add_argument("--enrichments-json", type=Path, default=DEFAULT_SEED_ENRICHMENTS_JSON)
    load_p.add_argument("--limit", type=int, default=None)
    load_p.add_argument("--batch-size", type=int, default=500)

    inspect_p = sub.add_parser(
        "inspect-patterns",
        help="Parse and summarize laundering simulation episodes from *_Patterns.txt",
    )
    inspect_p.add_argument(
        "--patterns-file",
        type=Path,
        default=SEED_DIR / "HI" / "HI-Small_Patterns.txt",
        help="Path to HI-Small_Patterns.txt or LI-Small_Patterns.txt",
    )

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

    if args.command == "inspect-patterns":
        episodes = parse_patterns_file(args.patterns_file)
        counts = Counter(ep.pattern_type for ep in episodes)
        total_tx = sum(len(ep.transactions) for ep in episodes)
        print(
            json.dumps(
                {
                    "patterns_file": str(args.patterns_file),
                    "total_episodes": len(episodes),
                    "total_transactions": total_tx,
                    "by_pattern_type": dict(sorted(counts.items())),
                },
                indent=2,
            )
        )
        return 0

    cfg = SpannerConfig.from_env()
    database = cfg.get_database()

    if args.command == "init-schema":
        applied = apply_schema(database)
        print(f"Applied {len(applied)} DDL statement(s) to {cfg.database_id}.")
        return 0

    if args.command == "load-data":
        if args.kaggle_dataset in ("HI", "LI"):
            ds_dir = SEED_DIR / args.kaggle_dataset
            prefix = f"{args.kaggle_dataset}-Small"
            dataset = build_simulation_dataset(
                accounts_csv=ds_dir / f"{prefix}_accounts.csv",
                patterns_path=ds_dir / f"{prefix}_Patterns.txt",
                transactions_csv=ds_dir / f"{prefix}_Trans.csv",
                background_tx_limit=args.background_limit,
            )
        else:
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

