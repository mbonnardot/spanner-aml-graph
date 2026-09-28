# Phase 1 Design Spec: Cloud Spanner Graph Foundation & GQL Ring Detection (`spanner-aml-graph`)

**Date:** 2026-09-28  
**Status:** Draft for Review  
**Scope:** Phase 1 of 3 (Spanner Graph Schema, IBM AML Kaggle Loader & Curated Seed Dataset, and ISO GQL Circular Laundering Ring Detection Engine)

---

## 1. Executive Summary & Architectural Vision

Traditional Anti-Money Laundering (AML) architectures suffer from an expensive trade-off: live payment processing occurs in an OLTP relational database, while multi-hop graph cycle detection requires exporting transactions via ETL pipelines into a separate graph database hours later—long after illicit funds have settled and exited the bank.

`spanner-aml-graph` eliminates this divide using **Cloud Spanner Graph (ISO GQL)**. By defining a zero-copy Property Graph (`AmlGraph`) directly over live relational banking tables (`Banks`, `Entities`, `Accounts`, `Transactions`), the system executes multi-hop circular laundering detection on live transactional data in milliseconds prior to settlement, producing deterministic subgraph evidence ready for an AI agent to compile into an auditable Suspicious Activity Report (SAR).

### Phased Project Roadmap
1. **Phase 1 (This Spec):** Cloud Spanner relational + `CREATE PROPERTY GRAPH` DDL, IBM AML Kaggle CSV ingestion pipeline + curated multi-typology seed dataset, and the ISO GQL ring detection engine with CLI & test suite.
2. **Phase 2:** Real-time pre-settlement transaction interceptor (`PENDING` $\rightarrow$ `SETTLED` / `HELD`) and AI SAR Agent (Gemini / ADK) that transforms deterministic GQL path evidence into FinCEN-aligned Suspicious Activity Reports stored in `ComplianceAlerts`.
3. **Phase 3:** Interactive web dashboard & visualization surface for live payment interception, graph ring topology rendering, and SAR inspection.

---

## 2. Spanner Relational & Property Graph Schema (`AmlGraph`)

### 2.1 Table Inventory & Graph Mapping Matrix

We model **1 Unified Property Graph (`AmlGraph`)** over the domain plane tables and exclude operational audit outputs (`ComplianceAlerts`) from graph traversal.

| Relational Table | Target Graph | Graph Role | Graph Element Alias | Graph Label | Source $\rightarrow$ Destination | Element Key | Domain Rationale |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `Banks` | `AmlGraph` | Node Table | `Bank` | `Bank` | N/A | `(bank_id)` | Financial institution metadata & SWIFT/BIC |
| `Entities` | `AmlGraph` | Node Table | `Entity` | `Entity` | N/A | `(entity_id)` | Individuals, corporations & shell companies |
| `Entities` | `AmlGraph` | Edge Table | `EntityControlsEntity` | `CONTROLS` | `Entity(ubo_entity_id) -> Entity(entity_id)` | `(entity_id)` | Recursive Ultimate Beneficial Ownership (UBO) |
| `Accounts` | `AmlGraph` | Node Table | `Account` | `Account` | N/A | `(account_id)` | Bank accounts holding funds |
| `Accounts` | `AmlGraph` | Edge Table | `EntityOwnsAccount` | `OWNS` | `Entity(entity_id) -> Account(account_id)` | `(account_id)` | 1:N beneficial account ownership (Dual Projection) |
| `Accounts` | `AmlGraph` | Edge Table | `AccountHeldAtBank` | `HELD_AT` | `Account(account_id) -> Bank(bank_id)` | `(account_id)` | N:1 account domicile at bank (Dual Projection) |
| `Transactions` | `AmlGraph` | Edge Table | `AccountTransfers` | `TRANSFERRED_TO` | `Account(from_account_id) -> Account(to_account_id)` | `(transaction_id)` | Directed payment transfers with timestamps & amounts |
| `ComplianceAlerts` | *Excluded (Control/Audit Plane)* | N/A | N/A | N/A | N/A | `(alert_id)` | Downstream SAR & alert audit ledger |

### 2.2 Complete Executable Cloud Spanner DDL (`schema/aml_graph.sql`)

```sql
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

CREATE INDEX AccountsByEntity ON Accounts (entity_id) STORING (bank_id, currency, account_status, is_flagged);
CREATE INDEX AccountsByBank ON Accounts (bank_id) STORING (entity_id, currency, account_status, is_flagged);

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

---

## 3. Data Ingestion & Curated IBM AML Seed Dataset

### 3.1 Input Format Compatibility
The loader (`src/spanner_aml/loader.py`) natively reads the two standard CSV formats from IBM's Kaggle AML dataset (`HI-Small` / `LI-Small`):

1. **Accounts CSV (`HI-Small_accounts.csv`)**:
   - Columns: `Bank Name,Bank ID,Account Number,Entity ID,Entity Name`
2. **Transactions CSV (`HI-Small_Trans.csv`)**:
   - Columns: `Timestamp,From Bank,Account,To Bank,Account.1,Amount Received,Receiving Currency,Amount Paid,Payment Currency,Payment Format,Is Laundering`
   - Note: Because the raw CSV uses duplicate header `Account` for sender and receiver accounts, the parser reads positional columns `(0..10)` to extract `from_account_id` (index 2) and `to_account_id` (index 4) unambiguously.

### 3.2 Optional Enrichment Overlay (`data/seed/seed_enrichments.json`)
When loading the curated seed dataset (`data/seed/`), `loader.py` merges banking enrichments (UBO parent links `ubo_entity_id`, `kyc_risk_tier`, `is_pep_or_sanctioned`, `jurisdiction`, `bic_swift`, `iban`, `account_status`). When loading raw external Kaggle CSVs without an enrichment file, deterministic defaults are synthesized (`CORPORATION`, `LOW`, `ACTIVE`, ISO currency inferred from the first transaction or `'USD'`).

### 3.3 Seeded Laundering Ring Typologies
The repository includes a self-contained seed dataset (`data/seed/HI-Small_accounts_seed.csv` and `data/seed/HI-Small_Trans_seed.csv`) containing normal baseline commercial transfers plus **three deterministic laundering rings**:

1. **Typology 1 — `CIRCULAR_LAYERING` (Direct Account Cycle, 4 Hops):**
   - `ACC_RING1_A -> ACC_RING1_B -> ACC_RING1_C -> ACC_RING1_D -> ACC_RING1_A`
   - Strictly increasing timestamps (`T+0h`, `T+2h`, `T+5h`, `T+9h`) and ~1.5% fee attrition per hop (`$100,000 -> $98,500 -> $97,000 -> $95,500`).
2. **Typology 2 — `SAME_ENTITY_RING` (Beneficial Owner Multi-Account Ring, 3 Hops):**
   - Entity `ENT_OMEGA_TRADING` owns `ACC_RING2_ORIGIN` (at Bank `BNK_US_01`) and `ACC_RING2_RETURN` (at Bank `BNK_CH_02`).
   - Funds flow `ACC_RING2_ORIGIN -> ACC_RING2_MULE1 -> ACC_RING2_MULE2 -> ACC_RING2_RETURN`, returning to the same legal entity at a different bank without reusing the origin account.
3. **Typology 3 — `UBO_SHELL_RING` (Layered Shell-Company UBO Ring, 3 Hops):**
   - Ultimate Beneficial Owner `ENT_UBO_VIKTOR` controls two offshore shell companies: `ENT_SHELL_ALPHA` (owns `ACC_RING3_S1`) and `ENT_SHELL_BETA` (owns `ACC_RING3_S2`).
   - Funds flow `ACC_RING3_S1 -> ACC_RING3_INTER1 -> ACC_RING3_INTER2 -> ACC_RING3_S2`, disguising self-transfer across separate corporate entities under common beneficial control.

### 3.4 Batched Mutation Mechanics
- **Deterministic Transaction IDs:** Computed via `tx_` + first 20 hex chars of `SHA-256(f"{timestamp}|{from_bank}|{from_acc}|{to_bank}|{to_acc}|{amount_paid}|{payment_format}|{row_idx_within_identical_tuple}")` so repeated loads are 100% idempotent.
- **Chunked Batches:** Writes are ordered topologically (`Banks` $\rightarrow$ `Entities` $\rightarrow$ `Accounts` $\rightarrow$ `Transactions`) using `database.batch().insert_or_update()` in configurable chunks (default `500` rows per commit) to stay well below Cloud Spanner's mutation limits.

---

## 4. ISO GQL Ring Detection Engine (`queries.py` & `detector.py`)

### 4.1 Core GQL Queries
All queries execute natively via Spanner's ISO GQL engine (`GRAPH AmlGraph`) using parameterized query arguments (`@account_id`, `@min_amount`, `@window_start`, `@window_end`) and enforce strict chronological hop ordering (`chain[i].event_timestamp < chain[i+1].event_timestamp`) via `GENERATE_ARRAY` and `ARRAY_FILTER`:

#### Query A: Direct Account Circular Ring (`CIRCULAR_LAYERING`)
```sql
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
```

#### Query B: Pre-Settlement Candidate Ring Check (`PRE_SETTLEMENT_CYCLE_CHECK`)
Given an incoming candidate payment `@from_account_id -> @to_account_id` with `@candidate_timestamp` and `@candidate_amount`, detects if there is already a chronological path of 1 to 5 hops leading from `(origin)` to `@from_account_id` where `(origin)` is either `@to_account_id` itself, another account owned by `@to_account_id`'s entity, or an account owned by a sibling shell company under the same UBO:
```sql
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
```

#### Query C: Beneficial-Owner Multi-Account Ring (`SAME_ENTITY_RING`)
```sql
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
```

#### Query D: Layered Shell-Company UBO Ring (`UBO_SHELL_RING`)
```sql
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
```

### 4.2 Domain Models (`src/spanner_aml/models.py`)
All data models use `@dataclass(frozen=True)` to guarantee immutability:
- `Bank`, `Entity`, `Account`, `Transaction`: Typed domain representations with validation helpers.
- `TransferHop`: Represents a single hop in a detected ring (`transaction_id`, `from_account_id`, `to_account_id`, `amount_paid`, `amount_received`, `currency`, `payment_format`, `event_timestamp`).
- `LaunderingRingEvidence`: Complete deterministic evidence packet returned by `RingDetector`:
  - `typology`: `'CIRCULAR_LAYERING' | 'SAME_ENTITY_RING' | 'UBO_SHELL_RING'`
  - `hop_count`: `int`
  - `initial_amount`: `Decimal`
  - `final_amount`: `Decimal`
  - `retention_ratio`: `float` (`final_amount / initial_amount`)
  - `total_duration_seconds`: `float`
  - `account_ids`: `tuple[str, ...]`
  - `hops`: `tuple[TransferHop, ...]`
  - `subject_entity_id`: `str | None`
  - `query_latency_ms`: `float`
  - `raw_graph_path`: `dict[str, Any]`

---

## 5. Error Handling, Security & Testing Strategy

### 5.1 Security & Input Validation
- **Zero Hardcoded Credentials:** `SpannerConfig.from_env()` reads `SPANNER_PROJECT_ID`, `SPANNER_INSTANCE_ID`, and `SPANNER_DATABASE_ID` from environment variables (supporting optional `SPANNER_EMULATOR_HOST` if set) and fails fast with a descriptive `ConfigurationError` if any required variable is missing or invalid.
- **SQL/GQL Injection Prevention:** Every user-supplied identifier, threshold, or timestamp is bound using `params` and `param_types` in `snapshot.execute_sql()`; string interpolation into GQL is strictly forbidden.

### 5.2 Testing Strategy (80%+ Coverage Requirement)
- **Unit Tests (`tests/unit/`):**
  - `test_config.py`: Env parsing, missing env validation, immutability.
  - `test_models.py`: Immutable domain models, retention ratio & duration calculations, validation errors.
  - `test_schema_manager.py`: Splitting `schema/aml_graph.sql` into ordered DDL statements and invoking `database.update_ddl()`.
  - `test_loader.py`: Parsing IBM `HI-Small` CSVs with duplicate `Account` headers, applying `seed_enrichments.json`, deterministic `transaction_id` generation, and batch chunking using mock Spanner batches.
  - `test_detector.py`: Parsing Spanner `SAFE.TO_JSON(p)` path elements into `LaunderingRingEvidence` across all 3 typologies plus pre-settlement candidate checks.
- **Integration Tests (`tests/integration/test_spanner_live.py`):**
  - Executed against a live GCP Cloud Spanner database when `SPANNER_PROJECT_ID`, `SPANNER_INSTANCE_ID`, and `SPANNER_DATABASE_ID` are set.
  - Verifies end-to-end DDL application, seed dataset ingestion, and live GQL execution confirming all 3 seeded laundering rings are detected with exact hop counts and amounts while clean accounts return zero false positives.
