# Phase 1: Spanner AML Graph Foundation & GQL Ring Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Cloud Spanner relational + `CREATE PROPERTY GRAPH AmlGraph` foundation, an idempotent IBM AML Kaggle CSV loader with a curated 3-typology seed dataset, and an ISO GQL circular laundering ring detection engine with CLI and unit/integration test suites.

**Architecture:** A single unified Cloud Spanner Property Graph (`AmlGraph`) overlays four domain tables (`Banks`, `Entities`, `Accounts`, `Transactions`) using dual projection (`OWNS`, `HELD_AT`, `CONTROLS`) and covering secondary indexes for high-throughput multi-hop traversal. An immutable Python domain layer loads IBM `HI-Small` format CSVs via chunked Spanner mutations and executes parameterized standalone ISO GQL queries (`GRAPH AmlGraph MATCH ...`) to detect direct account cycles, same-entity multi-account cycles, and UBO shell-company rings.

**Tech Stack:** Python 3.11+, `google-cloud-spanner>=3.49.0`, `pytest>=8.0.0`, `pytest-cov>=5.0.0`, Cloud Spanner (GoogleSQL dialect with ISO GQL).

**Spec:** `docs/superpowers/specs/2026-09-28-phase1-spanner-aml-graph-design.md`

## Global Constraints

- Immutability: All domain objects and configurations must use `@dataclass(frozen=True)` and tuple collections; never mutate input arguments or state in-place.
- Security: Zero hardcoded GCP credentials or project identifiers; read `SPANNER_PROJECT_ID`, `SPANNER_INSTANCE_ID`, and `SPANNER_DATABASE_ID` from environment variables and validate at boundaries.
- Parameterized GQL: Never interpolate user inputs into SQL/GQL strings; always bind `@param` variables with `google.cloud.spanner_v1.param_types`.
- Test Coverage: Minimum 80% unit test coverage across `src/spanner_aml/`.
- Spanner Graph Syntax: Standalone GQL queries must start with `GRAPH AmlGraph`, use bounded quantifiers `{m, n}` ($n \le 100$), avoid reserved keyword `timestamp` by using `event_timestamp`, and enforce chronological hop ordering via `GENERATE_ARRAY` and `ARRAY_FILTER`.

---

### Task 1: Project Scaffolding, Environment Configuration & Immutable Domain Models

**Files:**
- Create: `.gitignore`
- Create: `pyproject.toml`
- Create: `src/spanner_aml/__init__.py`
- Create: `src/spanner_aml/config.py`
- Create: `src/spanner_aml/models.py`
- Test: `tests/unit/test_config_and_models.py`

**Interfaces:**
- Consumes: Environment variables `SPANNER_PROJECT_ID`, `SPANNER_INSTANCE_ID`, `SPANNER_DATABASE_ID`, optional `SPANNER_EMULATOR_HOST`.
- Produces:
  - `ConfigurationError(ValueError)`
  - `SpannerConfig.from_env(environ: Mapping[str, str] | None = None) -> SpannerConfig`
  - `Bank`, `Entity`, `Account`, `Transaction`, `TransferHop`, `LaunderingRingEvidence` frozen dataclasses in `src/spanner_aml/models.py`.

- [ ] **Step 1: Create `.gitignore`, `pyproject.toml`, and `src/spanner_aml/__init__.py` scaffolding**

Create `.gitignore`:
```gitignore
__pycache__/
*.py[cod]
*$py.class
.venv/
venv/
.pytest_cache/
.coverage
htmlcov/
dist/
build/
*.egg-info/
.env
```

Create `pyproject.toml`:
```toml
[build-system]
requires = ["setuptools>=68.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "spanner-aml-graph"
version = "0.1.0"
description = "Real-time Anti-Money Laundering circular ring detection on Cloud Spanner Graph (ISO GQL)"
requires-python = ">=3.11"
dependencies = [
    "google-cloud-spanner>=3.49.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-cov>=5.0.0",
]

[project.scripts]
spanner-aml = "spanner_aml.cli:main"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]
addopts = "-q"
```

Create `src/spanner_aml/__init__.py`:
```python
"""Cloud Spanner Graph Anti-Money Laundering (AML) detection package."""

__version__ = "0.1.0"
```

- [ ] **Step 2: Write the failing unit tests for `config.py` and `models.py`**

Create `tests/unit/test_config_and_models.py`:
```python
from dataclasses import FrozenInstanceError
from datetime import datetime, timezone
from decimal import Decimal
import pytest

from spanner_aml.config import ConfigurationError, SpannerConfig
from spanner_aml.models import (
    Account,
    Bank,
    Entity,
    LaunderingRingEvidence,
    Transaction,
    TransferHop,
)


def test_spanner_config_from_env_valid():
    env = {
        "SPANNER_PROJECT_ID": "test-project",
        "SPANNER_INSTANCE_ID": "aml-instance",
        "SPANNER_DATABASE_ID": "aml-db",
    }
    cfg = SpannerConfig.from_env(env)
    assert cfg.project_id == "test-project"
    assert cfg.instance_id == "aml-instance"
    assert cfg.database_id == "aml-db"
    assert cfg.emulator_host is None


def test_spanner_config_missing_env_raises():
    with pytest.raises(ConfigurationError, match="SPANNER_PROJECT_ID"):
        SpannerConfig.from_env({"SPANNER_INSTANCE_ID": "inst", "SPANNER_DATABASE_ID": "db"})


def test_spanner_config_is_immutable():
    cfg = SpannerConfig(
        project_id="p",
        instance_id="i",
        database_id="d",
    )
    with pytest.raises(FrozenInstanceError):
        cfg.project_id = "mutated"  # type: ignore[misc]


def test_domain_models_immutability_and_validation():
    bank = Bank(bank_id="BNK_01", bank_name="First Global", bic_swift="FGLBUS33", jurisdiction="US")
    entity = Entity(
        entity_id="ENT_01",
        entity_name="Acme Holdings",
        entity_type="CORPORATION",
        kyc_risk_tier="HIGH",
        is_pep_or_sanctioned=False,
        jurisdiction="KY",
        ubo_entity_id=None,
    )
    account = Account(
        account_id="ACC_01",
        bank_id=bank.bank_id,
        entity_id=entity.entity_id,
        iban="KY12FGLB00000001",
        currency="USD",
        account_status="ACTIVE",
        is_flagged=False,
    )
    t0 = datetime(2026, 9, 28, 10, 0, tzinfo=timezone.utc)
    t1 = datetime(2026, 9, 28, 12, 30, tzinfo=timezone.utc)
    tx = Transaction(
        transaction_id="tx_001",
        from_bank_id="BNK_01",
        from_account_id="ACC_01",
        to_bank_id="BNK_02",
        to_account_id="ACC_02",
        event_timestamp=t0,
        amount_received=Decimal("98500.00"),
        receiving_currency="USD",
        amount_paid=Decimal("100000.00"),
        payment_currency="USD",
        payment_format="Wire",
        is_laundering=True,
        settlement_status="SETTLED",
    )
    assert tx.amount_paid == Decimal("100000.00")

    hop1 = TransferHop(
        transaction_id="tx_001",
        from_account_id="ACC_01",
        to_account_id="ACC_02",
        amount_paid=Decimal("100000.00"),
        amount_received=Decimal("98500.00"),
        currency="USD",
        payment_format="Wire",
        event_timestamp=t0,
    )
    hop2 = TransferHop(
        transaction_id="tx_002",
        from_account_id="ACC_02",
        to_account_id="ACC_01",
        amount_paid=Decimal("98500.00"),
        amount_received=Decimal("97000.00"),
        currency="USD",
        payment_format="Wire",
        event_timestamp=t1,
    )
    evidence = LaunderingRingEvidence.from_hops(
        typology="CIRCULAR_LAYERING",
        hops=(hop1, hop2),
        subject_entity_id=entity.entity_id,
        query_latency_ms=14.2,
        raw_graph_path={"nodes": [], "edges": []},
    )
    assert evidence.hop_count == 2
    assert evidence.initial_amount == Decimal("100000.00")
    assert evidence.final_amount == Decimal("97000.00")
    assert evidence.retention_ratio == pytest.approx(0.97)
    assert evidence.total_duration_seconds == 9000.0
    assert evidence.account_ids == ("ACC_01", "ACC_02", "ACC_01")
```

- [ ] **Step 3: Run pytest to verify the test fails**

Run: `pytest tests/unit/test_config_and_models.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'spanner_aml.config'`

- [ ] **Step 4: Implement `src/spanner_aml/config.py` and `src/spanner_aml/models.py`**

Create `src/spanner_aml/config.py`:
```python
"""Environment configuration and Cloud Spanner client factory."""

from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Any, Mapping


class ConfigurationError(ValueError):
    """Raised when required Spanner configuration is missing or invalid."""


@dataclass(frozen=True)
class SpannerConfig:
    """Immutable Cloud Spanner connection configuration."""

    project_id: str
    instance_id: str
    database_id: str
    emulator_host: str | None = None

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> SpannerConfig:
        """Load and validate Spanner configuration from environment variables."""
        env = os.environ if environ is None else environ
        required_keys = (
            "SPANNER_PROJECT_ID",
            "SPANNER_INSTANCE_ID",
            "SPANNER_DATABASE_ID",
        )
        missing = [key for key in required_keys if not env.get(key, "").strip()]
        if missing:
            raise ConfigurationError(
                f"Missing required environment variable(s): {', '.join(missing)}"
            )
        emulator = env.get("SPANNER_EMULATOR_HOST", "").strip() or None
        return cls(
            project_id=env["SPANNER_PROJECT_ID"].strip(),
            instance_id=env["SPANNER_INSTANCE_ID"].strip(),
            database_id=env["SPANNER_DATABASE_ID"].strip(),
            emulator_host=emulator,
        )

    def get_database(self, client: Any | None = None) -> Any:
        """Return a bound Cloud Spanner Database handle."""
        if client is None:
            from google.cloud import spanner  # type: ignore[import-untyped]

            client = spanner.Client(project=self.project_id)
        instance = client.instance(self.instance_id)
        return instance.database(self.database_id)
```

Create `src/spanner_aml/models.py`:
```python
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
            raw_graph_path= dict(raw_graph_path),
        )
```

- [ ] **Step 5: Run pytest to verify Task 1 tests pass**

Run: `pytest tests/unit/test_config_and_models.py -v`
Expected: PASS (4 passed)

- [ ] **Step 6: Commit Task 1**

```bash
git add .gitignore pyproject.toml src/spanner_aml/__init__.py src/spanner_aml/config.py src/spanner_aml/models.py tests/unit/test_config_and_models.py
git commit -m "feat: add Spanner config and immutable AML domain models"
```

---

### Task 2: Cloud Spanner Relational & Property Graph Schema (`AmlGraph`) and Schema Manager

**Files:**
- Create: `schema/aml_graph.sql`
- Create: `src/spanner_aml/schema_manager.py`
- Test: `tests/unit/test_schema_manager.py`

**Interfaces:**
- Consumes: `schema/aml_graph.sql` DDL file and a Spanner `Database` object.
- Produces:
  - `load_ddl_statements(sql_path: Path | None = None) -> tuple[str, ...]`
  - `apply_schema(database: Any, sql_path: Path | None = None, timeout_seconds: int = 300) -> tuple[str, ...]`

- [ ] **Step 1: Write the failing unit tests for `schema_manager.py` and `schema/aml_graph.sql`**

Create `tests/unit/test_schema_manager.py`:
```python
from unittest.mock import MagicMock
from spanner_aml.schema_manager import apply_schema, load_ddl_statements


def test_load_ddl_statements_parses_all_tables_indexes_and_graph():
    statements = load_ddl_statements()
    assert len(statements) == 10
    assert statements[0].startswith("CREATE TABLE Banks")
    assert statements[1].startswith("CREATE TABLE Entities")
    assert statements[2].startswith("CREATE TABLE Accounts")
    assert statements[5].startswith("CREATE TABLE Transactions")
    assert statements[8].startswith("CREATE TABLE ComplianceAlerts")
    assert statements[9].startswith("CREATE OR REPLACE PROPERTY GRAPH AmlGraph")
    for stmt in statements:
        assert not stmt.endswith(";")


def test_apply_schema_calls_update_ddl_and_waits():
    mock_db = MagicMock()
    mock_op = MagicMock()
    mock_db.update_ddl.return_value = mock_op

    applied = apply_schema(mock_db, timeout_seconds=120)

    assert len(applied) == 10
    mock_db.update_ddl.assert_called_once_with(list(applied))
    mock_op.result.assert_called_once_with(120)
```

- [ ] **Step 2: Run pytest to verify the test fails**

Run: `pytest tests/unit/test_schema_manager.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'spanner_aml.schema_manager'`

- [ ] **Step 3: Create `schema/aml_graph.sql` and `src/spanner_aml/schema_manager.py`**

Create `schema/aml_graph.sql`:
```sql
-- Cloud Spanner Relational & Property Graph Schema for spanner-aml-graph

CREATE TABLE Banks (
  bank_id      STRING(64) NOT NULL,
  bank_name    STRING(256) NOT NULL,
  bic_swift    STRING(16),
  jurisdiction STRING(64),
) PRIMARY KEY (bank_id);

CREATE TABLE Entities (
  entity_id            STRING(64) NOT NULL,
  entity_name          STRING(256) NOT NULL,
  entity_type          STRING(32) NOT NULL DEFAULT ('CORPORATION'),
  kyc_risk_tier        STRING(32) NOT NULL DEFAULT ('LOW'),
  is_pep_or_sanctioned BOOL NOT NULL DEFAULT (FALSE),
  jurisdiction         STRING(64),
  ubo_entity_id        STRING(64),
  CONSTRAINT FK_Entity_Ubo FOREIGN KEY (ubo_entity_id) REFERENCES Entities (entity_id) NOT ENFORCED
) PRIMARY KEY (entity_id);

CREATE TABLE Accounts (
  account_id     STRING(64) NOT NULL,
  bank_id        STRING(64) NOT NULL,
  entity_id      STRING(64) NOT NULL,
  iban           STRING(34),
  currency       STRING(16) NOT NULL,
  account_status STRING(32) NOT NULL DEFAULT ('ACTIVE'),
  is_flagged     BOOL NOT NULL DEFAULT (FALSE),
  CONSTRAINT FK_Account_Bank FOREIGN KEY (bank_id) REFERENCES Banks (bank_id),
  CONSTRAINT FK_Account_Entity FOREIGN KEY (entity_id) REFERENCES Entities (entity_id)
) PRIMARY KEY (account_id);

CREATE INDEX AccountsByEntity
  ON Accounts (entity_id)
  STORING (bank_id, currency, account_status, is_flagged);

CREATE INDEX AccountsByBank
  ON Accounts (bank_id)
  STORING (entity_id, currency, account_status, is_flagged);

CREATE TABLE Transactions (
  transaction_id     STRING(64) NOT NULL,
  from_bank_id       STRING(64) NOT NULL,
  from_account_id    STRING(64) NOT NULL,
  to_bank_id         STRING(64) NOT NULL,
  to_account_id      STRING(64) NOT NULL,
  event_timestamp    TIMESTAMP NOT NULL,
  amount_received    NUMERIC NOT NULL,
  receiving_currency STRING(16) NOT NULL,
  amount_paid        NUMERIC NOT NULL,
  payment_currency   STRING(16) NOT NULL,
  payment_format     STRING(32) NOT NULL,
  is_laundering      BOOL NOT NULL DEFAULT (FALSE),
  settlement_status  STRING(32) NOT NULL DEFAULT ('SETTLED'),
  CONSTRAINT FK_Tx_FromAccount FOREIGN KEY (from_account_id) REFERENCES Accounts (account_id) NOT ENFORCED,
  CONSTRAINT FK_Tx_ToAccount FOREIGN KEY (to_account_id) REFERENCES Accounts (account_id) NOT ENFORCED
) PRIMARY KEY (transaction_id);

CREATE INDEX TransactionsByFromAccount
  ON Transactions (from_account_id, event_timestamp)
  STORING (to_account_id, amount_paid, payment_currency, amount_received, receiving_currency, payment_format, settlement_status, is_laundering);

CREATE INDEX TransactionsByToAccount
  ON Transactions (to_account_id, event_timestamp)
  STORING (from_account_id, amount_paid, payment_currency, amount_received, receiving_currency, payment_format, settlement_status, is_laundering);

CREATE TABLE ComplianceAlerts (
  alert_id               STRING(64) NOT NULL,
  trigger_transaction_id STRING(64) NOT NULL,
  subject_entity_id      STRING(64),
  typology               STRING(64) NOT NULL,
  risk_score             FLOAT64 NOT NULL,
  evidence_subgraph      JSON NOT NULL,
  sar_narrative          STRING(MAX),
  alert_status           STRING(32) NOT NULL DEFAULT ('OPEN'),
  created_at             TIMESTAMP NOT NULL OPTIONS (allow_commit_timestamp=true),
) PRIMARY KEY (alert_id);

CREATE OR REPLACE PROPERTY GRAPH AmlGraph
  NODE TABLES (
    Banks AS Bank
      KEY (bank_id)
      LABEL Bank PROPERTIES (bank_id, bank_name, bic_swift, jurisdiction),
    Entities AS Entity
      KEY (entity_id)
      LABEL Entity PROPERTIES (
        entity_id, entity_name, entity_type, kyc_risk_tier,
        is_pep_or_sanctioned, jurisdiction, ubo_entity_id
      ),
    Accounts AS Account
      KEY (account_id)
      LABEL Account PROPERTIES (
        account_id, bank_id, entity_id, iban,
        currency, account_status, is_flagged
      )
  )
  EDGE TABLES (
    Entities AS EntityControlsEntity
      KEY (entity_id)
      SOURCE KEY (ubo_entity_id) REFERENCES Entity (entity_id)
      DESTINATION KEY (entity_id) REFERENCES Entity (entity_id)
      LABEL CONTROLS PROPERTIES (ubo_entity_id, entity_id),
    Accounts AS EntityOwnsAccount
      KEY (account_id)
      SOURCE KEY (entity_id) REFERENCES Entity (entity_id)
      DESTINATION KEY (account_id) REFERENCES Account (account_id)
      LABEL OWNS PROPERTIES (entity_id, account_id),
    Accounts AS AccountHeldAtBank
      KEY (account_id)
      SOURCE KEY (account_id) REFERENCES Account (account_id)
      DESTINATION KEY (bank_id) REFERENCES Bank (bank_id)
      LABEL HELD_AT PROPERTIES (account_id, bank_id),
    Transactions AS AccountTransfers
      KEY (transaction_id)
      SOURCE KEY (from_account_id) REFERENCES Account (account_id)
      DESTINATION KEY (to_account_id) REFERENCES Account (account_id)
      LABEL TRANSFERRED_TO PROPERTIES (
        transaction_id, from_bank_id, from_account_id, to_bank_id, to_account_id,
        event_timestamp, amount_paid, payment_currency,
        amount_received, receiving_currency, payment_format,
        settlement_status, is_laundering
      )
  );
```

Create `src/spanner_aml/schema_manager.py`:
```python
"""DDL loader and schema application utilities for Cloud Spanner Graph."""

from __future__ import annotations

from pathlib import Path
from typing import Any

DEFAULT_SCHEMA_PATH = (
    Path(__file__).resolve().parents[2] / "schema" / "aml_graph.sql"
)


def load_ddl_statements(sql_path: Path | None = None) -> tuple[str, ...]:
    """Parse a SQL DDL file into semicolon-stripped Spanner DDL statements."""
    target = DEFAULT_SCHEMA_PATH if sql_path is None else sql_path
    raw_text = target.read_text(encoding="utf-8")
    cleaned_lines = [
        line
        for line in raw_text.splitlines()
        if not line.strip().startswith("--")
    ]
    joined = "\n".join(cleaned_lines)
    statements = [
        chunk.strip()
        for chunk in joined.split(";")
        if chunk.strip()
    ]
    return tuple(statements)


def apply_schema(
    database: Any,
    sql_path: Path | None = None,
    timeout_seconds: int = 300,
) -> tuple[str, ...]:
    """Apply all DDL statements in topological order to the target Spanner database."""
    statements = load_ddl_statements(sql_path)
    operation = database.update_ddl(list(statements))
    operation.result(timeout_seconds)
    return statements
```

- [ ] **Step 4: Run pytest to verify Task 2 tests pass**

Run: `pytest tests/unit/test_schema_manager.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit Task 2**

```bash
git add schema/aml_graph.sql src/spanner_aml/schema_manager.py tests/unit/test_schema_manager.py
git commit -m "feat: add AmlGraph Spanner DDL and schema manager"
```

---

### Task 3: Curated IBM AML Seed Dataset & Batched Spanner Ingestion Loader

**Files:**
- Create: `data/seed/HI-Small_accounts_seed.csv`
- Create: `data/seed/HI-Small_Trans_seed.csv`
- Create: `data/seed/seed_enrichments.json`
- Create: `src/spanner_aml/loader.py`
- Test: `tests/unit/test_loader.py`

**Interfaces:**
- Consumes: `Bank`, `Entity`, `Account`, `Transaction` from `src/spanner_aml/models.py`; CSV files in IBM AML `HI-Small` format; optional `seed_enrichments.json`.
- Produces:
  - `ParsedAmlDataset` frozen dataclass (`banks: tuple[Bank, ...]`, `entities: tuple[Entity, ...]`, `accounts: tuple[Account, ...]`, `transactions: tuple[Transaction, ...]`)
  - `compute_transaction_id(timestamp_str: str, from_bank: str, from_account: str, to_bank: str, to_account: str, amount_paid: str, payment_format: str, duplicate_ordinal: int = 0) -> str`
  - `parse_ibm_aml_files(accounts_csv: Path, transactions_csv: Path, enrichments_json: Path | None = None, limit: int | None = None) -> ParsedAmlDataset`
  - `load_dataset_into_spanner(database: Any, dataset: ParsedAmlDataset, batch_size: int = 500) -> dict[str, int]`

- [ ] **Step 1: Create the curated IBM AML seed dataset (`data/seed/`)**

Create `data/seed/HI-Small_accounts_seed.csv`:
```csv
Bank Name,Bank ID,Account Number,Entity ID,Entity Name
First Manhattan Bank,BNK_US_01,ACC_RING1_A,ENT_APEX_GLOBAL,Apex Global Trading LLC
Zurich Private Bank,BNK_CH_01,ACC_RING1_B,ENT_HELVETIA_HOLDINGS,Helvetia Holdings AG
Cayman Island Trust,BNK_KY_01,ACC_RING1_C,ENT_CORAL_REEF_SHELL,Coral Reef Investments Ltd
Singapore Mercantile Bank,BNK_SG_01,ACC_RING1_D,ENT_PACIFIC_BRIDGE,Pacific Bridge Pte Ltd
First Manhattan Bank,BNK_US_01,ACC_RING2_ORIGIN,ENT_OMEGA_TRADING,Omega Commodities Group
London Clearing House,BNK_GB_01,ACC_RING2_MULE1,ENT_THAMES_LOGISTICS,Thames Logistics UK Ltd
Panama Atlantic Bank,BNK_PA_01,ACC_RING2_MULE2,ENT_ISTHMUS_VENTURES,Isthmus Ventures SA
Zurich Private Bank,BNK_CH_01,ACC_RING2_RETURN,ENT_OMEGA_TRADING,Omega Commodities Group
Cayman Island Trust,BNK_KY_01,ACC_RING3_S1,ENT_SHELL_ALPHA,Alpha Horizon Ventures Ltd
Luxembourg EuroBank,BNK_LU_01,ACC_RING3_INTER1,ENT_CONTINENTAL_CONSULT,Continental Consulting SARL
Singapore Mercantile Bank,BNK_SG_01,ACC_RING3_INTER2,ENT_STRAITS_CAPITAL,Straits Capital Partners
British Virgin Islands Bank,BNK_VG_01,ACC_RING3_S2,ENT_SHELL_BETA,Beta Maritime Holdings Ltd
First Manhattan Bank,BNK_US_01,ACC_CLEAN_01,ENT_ACME_CORP,Acme Manufacturing Inc
London Clearing House,BNK_GB_01,ACC_CLEAN_02,ENT_BRITANNIA_RETAIL,Britannia Retail PLC
Zurich Private Bank,BNK_CH_01,ACC_CLEAN_03,ENT_ALPINE_PHARMA,Alpine Pharma AG
```

Create `data/seed/HI-Small_Trans_seed.csv`:
```csv
Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,Amount Paid,Payment Currency,Payment Format,Is Laundering
2026/09/28 08:00,BNK_US_01,ACC_RING1_A,BNK_CH_01,ACC_RING1_B,98800.00,USD,100000.00,USD,Wire,1
2026/09/28 10:15,BNK_CH_01,ACC_RING1_B,BNK_KY_01,ACC_RING1_C,97500.00,USD,98800.00,USD,Wire,1
2026/09/28 13:30,BNK_KY_01,ACC_RING1_C,BNK_SG_01,ACC_RING1_D,96200.00,USD,97500.00,USD,Wire,1
2026/09/28 16:45,BNK_SG_01,ACC_RING1_D,BNK_US_01,ACC_RING1_A,95000.00,USD,96200.00,USD,Wire,1
2026/09/28 09:00,BNK_US_01,ACC_RING2_ORIGIN,BNK_GB_01,ACC_RING2_MULE1,74000.00,USD,75000.00,USD,Wire,1
2026/09/28 11:20,BNK_GB_01,ACC_RING2_MULE1,BNK_PA_01,ACC_RING2_MULE2,72800.00,USD,74000.00,USD,Wire,1
2026/09/28 14:10,BNK_PA_01,ACC_RING2_MULE2,BNK_CH_01,ACC_RING2_RETURN,71500.00,USD,72800.00,USD,Wire,1
2026/09/28 07:30,BNK_KY_01,ACC_RING3_S1,BNK_LU_01,ACC_RING3_INTER1,148000.00,USD,150000.00,USD,Wire,1
2026/09/28 12:00,BNK_LU_01,ACC_RING3_INTER1,BNK_SG_01,ACC_RING3_INTER2,146000.00,USD,148000.00,USD,Wire,1
2026/09/28 15:30,BNK_SG_01,ACC_RING3_INTER2,BNK_VG_01,ACC_RING3_S2,144500.00,USD,146000.00,USD,Wire,1
2026/09/28 08:30,BNK_US_01,ACC_CLEAN_01,BNK_GB_01,ACC_CLEAN_02,12500.00,USD,12500.00,USD,ACH,0
2026/09/28 11:00,BNK_GB_01,ACC_CLEAN_02,BNK_CH_01,ACC_CLEAN_03,4200.00,USD,4200.00,USD,Wire,0
```

Create `data/seed/seed_enrichments.json`:
```json
{
  "banks": {
    "BNK_US_01": {"bic_swift": "FMNBUS33", "jurisdiction": "US"},
    "BNK_CH_01": {"bic_swift": "ZPBKCHZZ", "jurisdiction": "CH"},
    "BNK_KY_01": {"bic_swift": "CITRKYKY", "jurisdiction": "KY"},
    "BNK_SG_01": {"bic_swift": "SMBKSGSG", "jurisdiction": "SG"},
    "BNK_GB_01": {"bic_swift": "LCHBGB2L", "jurisdiction": "GB"},
    "BNK_PA_01": {"bic_swift": "PABKPAPA", "jurisdiction": "PA"},
    "BNK_LU_01": {"bic_swift": "EUBKLULL", "jurisdiction": "LU"},
    "BNK_VG_01": {"bic_swift": "BVIBVGVG", "jurisdiction": "VG"}
  },
  "extra_entities": [
    {
      "entity_id": "ENT_UBO_VIKTOR",
      "entity_name": "Viktor Rostov (Ultimate Beneficial Owner)",
      "entity_type": "INDIVIDUAL",
      "kyc_risk_tier": "HIGH",
      "is_pep_or_sanctioned": true,
      "jurisdiction": "CY",
      "ubo_entity_id": null
    }
  ],
  "entities": {
    "ENT_APEX_GLOBAL": {"entity_type": "CORPORATION", "kyc_risk_tier": "MEDIUM", "jurisdiction": "US"},
    "ENT_CORAL_REEF_SHELL": {"entity_type": "SHELL_COMPANY", "kyc_risk_tier": "HIGH", "jurisdiction": "KY"},
    "ENT_OMEGA_TRADING": {"entity_type": "CORPORATION", "kyc_risk_tier": "HIGH", "jurisdiction": "US"},
    "ENT_ISTHMUS_VENTURES": {"entity_type": "SHELL_COMPANY", "kyc_risk_tier": "HIGH", "jurisdiction": "PA"},
    "ENT_SHELL_ALPHA": {
      "entity_type": "SHELL_COMPANY",
      "kyc_risk_tier": "HIGH",
      "is_pep_or_sanctioned": true,
      "jurisdiction": "KY",
      "ubo_entity_id": "ENT_UBO_VIKTOR"
    },
    "ENT_SHELL_BETA": {
      "entity_type": "SHELL_COMPANY",
      "kyc_risk_tier": "HIGH",
      "is_pep_or_sanctioned": true,
      "jurisdiction": "VG",
      "ubo_entity_id": "ENT_UBO_VIKTOR"
    }
  },
  "accounts": {
    "ACC_RING1_C": {"is_flagged": true, "iban": "KY99CITR0000001"},
    "ACC_RING3_S1": {"is_flagged": true, "iban": "KY88CITR0000002"},
    "ACC_RING3_S2": {"is_flagged": true, "iban": "VG77BVIB0000003"}
  }
}
```

- [ ] **Step 2: Write the failing unit tests for `loader.py`**

Create `tests/unit/test_loader.py`:
```python
from pathlib import Path
from unittest.mock import MagicMock
from spanner_aml.loader import (
    DEFAULT_SEED_ACCOUNTS_CSV,
    DEFAULT_SEED_ENRICHMENTS_JSON,
    DEFAULT_SEED_TRANSACTIONS_CSV,
    compute_transaction_id,
    load_dataset_into_spanner,
    parse_ibm_aml_files,
)


def test_compute_transaction_id_is_deterministic_and_distinguishes_ordinals():
    tx_id_1 = compute_transaction_id(
        "2026/09/28 08:00", "BNK_1", "ACC_1", "BNK_2", "ACC_2", "100.00", "Wire", 0
    )
    tx_id_2 = compute_transaction_id(
        "2026/09/28 08:00", "BNK_1", "ACC_1", "BNK_2", "ACC_2", "100.00", "Wire", 0
    )
    tx_id_dup = compute_transaction_id(
        "2026/09/28 08:00", "BNK_1", "ACC_1", "BNK_2", "ACC_2", "100.00", "Wire", 1
    )
    assert tx_id_1 == tx_id_2
    assert tx_id_1.startswith("tx_")
    assert tx_id_1 != tx_id_dup


def test_parse_ibm_aml_seed_files_with_enrichments():
    dataset = parse_ibm_aml_files(
        accounts_csv=DEFAULT_SEED_ACCOUNTS_CSV,
        transactions_csv=DEFAULT_SEED_TRANSACTIONS_CSV,
        enrichments_json=DEFAULT_SEED_ENRICHMENTS_JSON,
    )
    assert len(dataset.banks) == 8
    # 14 distinct entities in CSV + 1 extra UBO entity (ENT_UBO_VIKTOR)
    assert len(dataset.entities) == 15
    assert len(dataset.accounts) == 15
    assert len(dataset.transactions) == 12

    entities_by_id = {e.entity_id: e for e in dataset.entities}
    assert entities_by_id["ENT_UBO_VIKTOR"].is_pep_or_sanctioned is True
    assert entities_by_id["ENT_SHELL_ALPHA"].ubo_entity_id == "ENT_UBO_VIKTOR"
    assert entities_by_id["ENT_SHELL_BETA"].ubo_entity_id == "ENT_UBO_VIKTOR"


def test_load_dataset_into_spanner_chunks_batches_topologically():
    dataset = parse_ibm_aml_files(
        accounts_csv=DEFAULT_SEED_ACCOUNTS_CSV,
        transactions_csv=DEFAULT_SEED_TRANSACTIONS_CSV,
        enrichments_json=DEFAULT_SEED_ENRICHMENTS_JSON,
    )
    mock_db = MagicMock()
    mock_batch = MagicMock()
    mock_db.batch.return_value.__enter__.return_value = mock_batch

    counts = load_dataset_into_spanner(mock_db, dataset, batch_size=5)

    assert counts == {
        "Banks": 8,
        "Entities": 15,
        "Accounts": 15,
        "Transactions": 12,
    }
    assert mock_batch.insert_or_update.called
```

- [ ] **Step 3: Run pytest to verify the test fails**

Run: `pytest tests/unit/test_loader.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'spanner_aml.loader'`

- [ ] **Step 4: Implement `src/spanner_aml/loader.py`**

Create `src/spanner_aml/loader.py`:
```python
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
```

- [ ] **Step 5: Run pytest to verify Task 3 tests pass**

Run: `pytest tests/unit/test_loader.py -v`
Expected: PASS (3 passed)

- [ ] **Step 6: Commit Task 3**

```bash
git add data/seed/HI-Small_accounts_seed.csv data/seed/HI-Small_Trans_seed.csv data/seed/seed_enrichments.json src/spanner_aml/loader.py tests/unit/test_loader.py
git commit -m "feat: add curated IBM AML seed dataset and batched Spanner loader"
```

---

### Task 4: ISO GQL Query Library & Laundering Ring Detection Engine

**Files:**
- Create: `src/spanner_aml/queries.py`
- Create: `src/spanner_aml/detector.py`
- Test: `tests/unit/test_detector.py`

**Interfaces:**
- Consumes: `LaunderingRingEvidence`, `TransferHop` from `src/spanner_aml/models.py`; Spanner `Database` object.
- Produces:
  - `GQL_CIRCULAR_LAYERING`, `GQL_PRE_SETTLEMENT_CYCLE_CHECK`, `GQL_SAME_ENTITY_RING`, `GQL_UBO_SHELL_RING` in `src/spanner_aml/queries.py`
  - `parse_graph_path_hops(path_json: Any) -> tuple[TransferHop, ...]`
  - `RingDetector(database: Any)` with methods:
    - `detect_circular_rings(account_id: str, min_amount: Decimal = Decimal("1000")) -> tuple[LaunderingRingEvidence, ...]`
    - `check_pre_settlement_ring(from_account_id: str, to_account_id: str, candidate_amount: Decimal, candidate_timestamp: datetime, min_amount: Decimal = Decimal("1000")) -> tuple[LaunderingRingEvidence, ...]`
    - `detect_same_entity_rings(min_amount: Decimal = Decimal("1000")) -> tuple[LaunderingRingEvidence, ...]`
    - `detect_ubo_shell_rings(min_amount: Decimal = Decimal("1000")) -> tuple[LaunderingRingEvidence, ...]`
    - `scan_all_typologies(seed_account_ids: Sequence[str] = (), min_amount: Decimal = Decimal("1000")) -> tuple[LaunderingRingEvidence, ...]`

- [ ] **Step 1: Write the failing unit tests for `queries.py` and `detector.py`**

Create `tests/unit/test_detector.py`:
```python
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import MagicMock

from spanner_aml.detector import RingDetector, parse_graph_path_hops
from spanner_aml.queries import (
    GQL_CIRCULAR_LAYERING,
    GQL_PRE_SETTLEMENT_CYCLE_CHECK,
    GQL_SAME_ENTITY_RING,
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
    for query in (
        GQL_CIRCULAR_LAYERING,
        GQL_PRE_SETTLEMENT_CYCLE_CHECK,
        GQL_SAME_ENTITY_RING,
        GQL_UBO_SHELL_RING,
    ):
        assert query.strip().startswith("GRAPH AmlGraph")
        assert "GENERATE_ARRAY" in query
        assert "ARRAY_FILTER" in query
        assert "SAFE.TO_JSON" in query
        assert "RETURN" in query


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
```

- [ ] **Step 2: Run pytest to verify the test fails**

Run: `pytest tests/unit/test_detector.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'spanner_aml.detector'`

- [ ] **Step 3: Implement `src/spanner_aml/queries.py` and `src/spanner_aml/detector.py`**

Create `src/spanner_aml/queries.py`:
```python
"""Parameterized ISO GQL query definitions for Cloud Spanner Graph (`AmlGraph`)."""

from __future__ import annotations

GQL_CIRCULAR_LAYERING = """
GRAPH AmlGraph
MATCH p = TRAIL (a:Account {account_id: @account_id})-[chain:TRANSFERRED_TO]->{2, 6}(a:Account)
FILTER IS_SIMPLE(p)
  AND chain[SAFE_OFFSET(0)].amount_paid >= @min_amount
LET indices = GENERATE_ARRAY(0, ARRAY_LENGTH(chain) - 2)
LET time_violations = ARRAY_FILTER(
  indices,
  i -> chain[SAFE_OFFSET(i)].event_timestamp >= chain[SAFE_OFFSET(i + 1)].event_timestamp
)
FILTER ARRAY_LENGTH(time_violations) = 0
RETURN SAFE.TO_JSON(p) AS ring_path,
       ARRAY_LENGTH(chain) AS hop_count,
       chain[SAFE_OFFSET(0)].amount_paid AS initial_amount,
       chain[SAFE_OFFSET(ARRAY_LENGTH(chain) - 1)].amount_received AS final_amount
""".strip()

GQL_PRE_SETTLEMENT_CYCLE_CHECK = """
GRAPH AmlGraph
MATCH p = ACYCLIC (origin:Account {account_id: @to_account_id})-[chain:TRANSFERRED_TO]->{1, 5}(sender:Account {account_id: @from_account_id})
FILTER chain[SAFE_OFFSET(0)].amount_paid >= @min_amount
  AND chain[SAFE_OFFSET(ARRAY_LENGTH(chain) - 1)].event_timestamp <= @candidate_timestamp
LET indices = GENERATE_ARRAY(0, ARRAY_LENGTH(chain) - 2)
LET time_violations = ARRAY_FILTER(
  indices,
  i -> chain[SAFE_OFFSET(i)].event_timestamp >= chain[SAFE_OFFSET(i + 1)].event_timestamp
)
FILTER ARRAY_LENGTH(time_violations) = 0
RETURN SAFE.TO_JSON(p) AS prior_path,
       ARRAY_LENGTH(chain) AS prior_hops,
       chain[SAFE_OFFSET(0)].amount_paid AS initial_amount,
       chain[SAFE_OFFSET(ARRAY_LENGTH(chain) - 1)].amount_received AS latest_amount
""".strip()

GQL_SAME_ENTITY_RING = """
GRAPH AmlGraph
MATCH (e:Entity)-[:OWNS]->(src:Account),
      (e:Entity)-[:OWNS]->(dst:Account),
      p = ACYCLIC (src)-[chain:TRANSFERRED_TO]->{2, 5}(dst)
FILTER src.account_id != dst.account_id
  AND chain[SAFE_OFFSET(0)].amount_paid >= @min_amount
LET indices = GENERATE_ARRAY(0, ARRAY_LENGTH(chain) - 2)
LET time_violations = ARRAY_FILTER(
  indices,
  i -> chain[SAFE_OFFSET(i)].event_timestamp >= chain[SAFE_OFFSET(i + 1)].event_timestamp
)
FILTER ARRAY_LENGTH(time_violations) = 0
RETURN SAFE.TO_JSON(e) AS owner_entity,
       SAFE.TO_JSON(p) AS ring_path,
       ARRAY_LENGTH(chain) AS hop_count,
       chain[SAFE_OFFSET(0)].amount_paid AS initial_amount,
       chain[SAFE_OFFSET(ARRAY_LENGTH(chain) - 1)].amount_received AS final_amount
""".strip()

GQL_UBO_SHELL_RING = """
GRAPH AmlGraph
MATCH (ubo:Entity)-[:CONTROLS]->(s1:Entity)-[:OWNS]->(src:Account),
      (ubo:Entity)-[:CONTROLS]->(s2:Entity)-[:OWNS]->(dst:Account),
      p = ACYCLIC (src)-[chain:TRANSFERRED_TO]->{2, 5}(dst)
FILTER s1.entity_id != s2.entity_id
  AND ubo.ubo_entity_id IS NULL
  AND chain[SAFE_OFFSET(0)].amount_paid >= @min_amount
LET indices = GENERATE_ARRAY(0, ARRAY_LENGTH(chain) - 2)
LET time_violations = ARRAY_FILTER(
  indices,
  i -> chain[SAFE_OFFSET(i)].event_timestamp >= chain[SAFE_OFFSET(i + 1)].event_timestamp
)
FILTER ARRAY_LENGTH(time_violations) = 0
RETURN SAFE.TO_JSON(ubo) AS ubo_entity,
       SAFE.TO_JSON(s1) AS origin_shell,
       SAFE.TO_JSON(s2) AS destination_shell,
       SAFE.TO_JSON(p) AS ring_path,
       ARRAY_LENGTH(chain) AS hop_count,
       chain[SAFE_OFFSET(0)].amount_paid AS initial_amount,
       chain[SAFE_OFFSET(ARRAY_LENGTH(chain) - 1)].amount_received AS final_amount
""".strip()
```

Create `src/spanner_aml/detector.py`:
```python
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
```

- [ ] **Step 4: Run pytest to verify Task 4 tests pass**

Run: `pytest tests/unit/test_detector.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit Task 4**

```bash
git add src/spanner_aml/queries.py src/spanner_aml/detector.py tests/unit/test_detector.py
git commit -m "feat: add ISO GQL laundering ring queries and RingDetector engine"
```

---

### Task 5: CLI Entrypoint & Live GCP Cloud Spanner Integration Test Suite

**Files:**
- Create: `src/spanner_aml/cli.py`
- Create: `tests/unit/test_cli.py`
- Create: `tests/integration/test_spanner_live.py`

**Interfaces:**
- Consumes: `SpannerConfig`, `apply_schema`, `parse_ibm_aml_files`, `load_dataset_into_spanner`, `RingDetector`.
- Produces:
  - `main(argv: Sequence[str] | None = None) -> int` in `src/spanner_aml/cli.py` supporting subcommands `init-schema`, `load-data`, and `detect-rings`.
  - Live Spanner integration test suite in `tests/integration/test_spanner_live.py` (auto-skipped if `SPANNER_PROJECT_ID` is not set).

- [ ] **Step 1: Write the failing unit tests for `cli.py`**

Create `tests/unit/test_cli.py`:
```python
from decimal import Decimal
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from spanner_aml.cli import main
from spanner_aml.models import LaunderingRingEvidence, TransferHop


@patch("spanner_aml.cli.SpannerConfig.from_env")
@patch("spanner_aml.cli.apply_schema")
def test_cli_init_schema(mock_apply, mock_from_env, capsys):
    mock_cfg = MagicMock()
    mock_from_env.return_value = mock_cfg
    mock_apply.return_value = ("CREATE TABLE Banks...",)

    rc = main(["init-schema"])
    assert rc == 0
    mock_apply.assert_called_once()
    out = capsys.readouterr().out
    assert "Applied 1 DDL statement(s)" in out


@patch("spanner_aml.cli.SpannerConfig.from_env")
@patch("spanner_aml.cli.load_dataset_into_spanner")
def test_cli_load_data_seed(mock_load, mock_from_env, capsys):
    mock_cfg = MagicMock()
    mock_from_env.return_value = mock_cfg
    mock_load.return_value = {"Banks": 8, "Entities": 15, "Accounts": 15, "Transactions": 12}

    rc = main(["load-data", "--seed"])
    assert rc == 0
    mock_load.assert_called_once()
    out = capsys.readouterr().out
    assert '"Transactions": 12' in out


@patch("spanner_aml.cli.SpannerConfig.from_env")
@patch("spanner_aml.cli.RingDetector")
def test_cli_detect_rings_prints_json_summary(mock_detector_cls, mock_from_env, capsys):
    mock_cfg = MagicMock()
    mock_from_env.return_value = mock_cfg
    t0 = datetime(2026, 9, 28, 8, 0, tzinfo=timezone.utc)
    hop = TransferHop(
        transaction_id="tx_1",
        from_account_id="ACC_RING1_A",
        to_account_id="ACC_RING1_B",
        amount_paid=Decimal("100000.00"),
        amount_received=Decimal("98800.00"),
        currency="USD",
        payment_format="Wire",
        event_timestamp=t0,
    )
    evidence = LaunderingRingEvidence.from_hops(
        typology="CIRCULAR_LAYERING",
        hops=(hop,),
        subject_entity_id=None,
        query_latency_ms=11.5,
        raw_graph_path={},
    )
    mock_detector = MagicMock()
    mock_detector.scan_all_typologies.return_value = (evidence,)
    mock_detector_cls.return_value = mock_detector

    rc = main(["detect-rings", "--account-id", "ACC_RING1_A", "--min-amount", "50000"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "CIRCULAR_LAYERING" in out
    assert "ACC_RING1_A" in out
```

- [ ] **Step 2: Run pytest to verify the test fails**

Run: `pytest tests/unit/test_cli.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'spanner_aml.cli'`

- [ ] **Step 3: Implement `src/spanner_aml/cli.py` and `tests/integration/test_spanner_live.py`**

Create `src/spanner_aml/cli.py`:
```python
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
```

Create `tests/integration/test_spanner_live.py`:
```python
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
```

- [ ] **Step 4: Run pytest with coverage to verify all unit tests pass with >=80% coverage**

Run: `pytest tests/unit --cov=spanner_aml --cov-report=term-missing -v`
Expected: PASS with total coverage >= 85%

- [ ] **Step 5: Commit Task 5**

```bash
git add src/spanner_aml/cli.py tests/unit/test_cli.py tests/integration/test_spanner_live.py
git commit -m "feat: add spanner-aml CLI and live Spanner Graph integration tests"
```
