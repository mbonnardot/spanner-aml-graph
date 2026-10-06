# Cloud Spanner Graph — Real-Time AML Detection & Pre-Settlement Interception

An end-to-end **Anti-Money Laundering (AML) Graph Investigation & Pre-Settlement Wire Interception** workbench built on **Google Cloud Spanner Graph (ISO GQL)**, **FastAPI**, **React + Three.js 3D Scrollytelling**, and **Vertex AI Gemini**.

Instead of relying on overnight relational batch jobs that fail across multi-hop shell networks, this system models banks, legal entities, Ultimate Beneficial Owners (UBOs), accounts, and cross-border wires as a unified **Cloud Spanner Property Graph (`AmlGraph`)**—detecting 8 distinct money-laundering topologies in real time and freezing illicit cash-out wires **in `<150ms` before settlement**.

---

## Architecture Overview

```text
+---------------------------------------------------------------------------------------------------+
|                             3D Scrollytelling Workbench (web/)                                    |
|                                                                                                   |
|  +-------------------------------------------+     +-------------------------------------------+  |
|  |     5-Act Interactive AML Story Stage     | <-> |     Three.js 3D Transaction Universe      |  |
|  |  • Pattern Switcher (8 AML Topologies)    |     |  • Live Multi-Bank Account & Wire Graph   |  |
|  |  • Hop-by-Hop Layering & KYC Inspector    |     |  • Animated Dirty -> Layering -> Clean    |  |
|  |  • Pre-Settlement Gate & FinCEN SAR UI    |     |  • Crimson Frozen Wire Conduit Callout    |  |
|  +-------------------------------------------+     +-------------------------------------------+  |
+---------------------------------------------------------------------------------------------------+
                         ^                                           ^
                         | REST / JSON (`/api/*`)                    | Real-Time Interception (`<150ms`)
                         v                                           v
+---------------------------------------------------------------------------------------------------+
|                           Python AML Graph Engine (src/spanner_aml/)                              |
|                                                                                                   |
|  +----------------------------+   +----------------------------+   +---------------------------+  |
|  |  ISO GQL Ring Detector     |   |  KYC / UBO Enricher        |   |  Pre-Settlement Gate      |  |
|  |  • 8 Laundering Topologies |-->|  • Multi-Hop UBO Lookup    |   |  • Upstream Trail & Ring  |  |
|  |  • Chronological Hop Check |   |  • Zero LLM Token Cost     |   |  • HOLD vs SETTLED (<150ms|  |
|  +----------------------------+   +----------------------------+   +---------------------------+  |
|                 ^                                |                                ^               |
|                 |                                v                                |               |
|                 |                 +----------------------------+                  |               |
|                 |                 |  Vertex AI Gemini SAR      |                  |               |
|                 |                 |  • FinCEN SAR Narrative    |                  |               |
|                 |                 +----------------------------+                  |               |
+-----------------|--------------------------------|--------------------------------|---------------+
                  |                                |                                |
                  | Parameterized ISO GQL          | Write Alert                    | Primary-Key GQL
                  v                                v                                v
+---------------------------------------------------------------------------------------------------+
|                        Google Cloud Spanner Property Graph (`AmlGraph`)                           |
|                                                                                                   |
|  Nodes:  (Bank) • (Entity / UBO) • (Account)                                                      |
|  Edges:  -[:CONTROLS]-> • -[:OWNS]-> • -[:HELD_AT]-> • -[:TRANSFERRED_TO {amount, timestamp}]->   |
|  Tables: Banks • Entities • Accounts • Transactions • ComplianceAlerts                            |
+---------------------------------------------------------------------------------------------------+
```

---

## Supported AML Laundering Topologies (8 Patterns)

Every investigation traces how dirty money moves through the three classical money-laundering stages—**1. Placement**, **2. Layering**, and **3. Integration (Clean Cash-Out)**:

| Pattern | Topology | How Funds Are Cleaned (Placement $\rightarrow$ Layering $\rightarrow$ Integration) | Cloud Spanner ISO GQL Detection |
| :--- | :--- | :--- | :--- |
| **Circular Layering (`Cycle`)** | `A → B → C → … → A` | Illicit cash hops across multi-bank mule accounts and loops back to the originator disguised as legitimate business revenue or loan repayment. | `MATCH p = TRAIL (a:Account)-[chain:TRANSFERRED_TO]->{2, 12}(a)` with chronological `ARRAY_FILTER` validation. |
| **UBO Shell Ring (`UBO_SHELL_RING`)** | `UBO → Shell 1 → … → Shell 2 ← UBO` | A single Ultimate Beneficial Owner moves funds across distinct offshore shell companies that appear unrelated in single-hop SQL tables. | Traverses `(:Entity)-[:CONTROLS]->(:Entity)-[:OWNS]->(:Account)` across multi-hop transfer chains. |
| **Same-Entity Ring (`SAME_ENTITY_RING`)** | `Entity → Acc 1 → Mules → Acc 2 ← Entity` | A high-risk entity rotates funds between separate accounts it controls across different banks via intermediary conduits. | Matches `ACYCLIC (src)-[chain:TRANSFERRED_TO]->{2, 4}(dst)` anchored on shared high-risk owner entities. |
| **Fan-Out (`Smurfing / Structuring`)** | `1 Origin → N Mule Accounts` | One source account splits a large illicit sum into structured transfers just below reporting thresholds across many mule accounts. | Aggregates outgoing degree & chronological fan-out edges per hub account (`GQL_FAN_OUT`). |
| **Fan-In (`Aggregation`)** | `N Feeder Accounts → 1 Collector` | Dozens of mule accounts funnel structured cash deposits into a single clean offshore treasury or collector account. | Aggregates incoming degree & chronological feeder wires per sink account (`GQL_FAN_IN`). |
| **Scatter-Gather** | `Origin → Mules → Clean Collector` | Dirty funds fan out across parallel mule accounts to sever audit trails, then re-converge into a single payout destination. | Multi-hop diamond/convergent path matching (`GQL_SCATTER_GATHER`). |
| **Gather-Scatter** | `Feeders → Central Hub → Payouts` | Multiple illicit sources pool funds into a central clearing account that immediately disperses payouts to clean beneficiaries. | Multi-hop hub-aggregation and dispersion matching (`GQL_GATHER_SCATTER`). |
| **Stacked Bipartite / Random Walk** | `Layer 1 → Layer 2 → Layer 3 / 8-Hop Chain` | High-velocity transfers pass through walls of shell conduits or deep sequential chains before exiting into clean offshore assets. | Bounded multi-hop `ACYCLIC` path traversal (`{2, 11}`) with strict timestamp ordering. |

---

## 5-Act Interactive 3D Scrollytelling Experience

The frontend workbench ([`web/`](web/)) guides analysts and stakeholders through a spacious, 5-act interactive 3D narrative:

1. **Landing Overview (`Bank Network Universe`)**: Visualizes all accounts and cross-bank wires in 3D space with real-time network telemetry and a one-click **`Use Spanner Graph to Catch Money Laundering`** launch trigger.
2. **`01 • CHOOSE A PATTERN`**: Switch seamlessly across all **8 AML topologies** and inspect how each topology structures placement, layering, and clean payout.
3. **`02 • PLACEMENT & ORIGIN`**: Zooms into the originating high-risk account where dirty funds enter the banking graph, with inline collapsible **Spanner ISO GQL** query inspection.
4. **`03 • LAYERING HOPS`**: Step hop-by-hop through the cross-bank transfer chain (`Step 1` $\rightarrow$ `Step N`), inspecting entity KYC profiles, bank jurisdictions, and the final clean cash-out wire.
5. **`04 • REAL-TIME PREVENTION & FINCEN SAR`**:
   - **Pre-Settlement Wire Gate (`<150ms`)**: Automatically targets the active pattern's final cash-out wire, explains the 3-stage pre-settlement hold, and locks the 3D conduit in crimson (`⛔ WIRE FROZEN PRE-SETTLEMENT`) when intercepted.
   - **FinCEN SAR Filing**: Generates a structured Suspicious Activity Report narrative via Vertex AI Gemini and persists the alert to Cloud Spanner (`ComplianceAlerts`).

---

## Project Structure

```text
spanner-aml-graph/
├── schema/
│   └── aml_graph.sql              # Cloud Spanner DDL & CREATE OR REPLACE PROPERTY GRAPH AmlGraph
├── data/
│   └── seed/                      # Curated multi-typology AML seed accounts, transactions & KYC enrichments
├── src/spanner_aml/
│   ├── config.py                  # Environment-validated Spanner configuration (zero hardcoded credentials)
│   ├── models.py                  # Strictly immutable (@dataclass(frozen=True)) domain models
│   ├── schema_manager.py          # Idempotent Spanner DDL & Property Graph schema applicator
│   ├── loader.py                  # Batched Spanner ingestion loader & IBM HI-Small / LI-Small parser
│   ├── queries.py                 # Parameterized ISO GQL query library for all 8 AML typologies
│   ├── detector.py                # RingDetector & <150ms pre-settlement cycle/trail engines
│   ├── enricher.py                # Zero-LLM multi-hop KYC, Bank, and UBO graph context enricher
│   ├── interceptor.py             # Real-time Pre-Settlement Payment Rail Interceptor (HELD / SETTLED)
│   ├── sar.py                     # Vertex AI Gemini FinCEN SAR drafter & ComplianceAlerts repository
│   ├── cli.py                     # CLI entrypoint (`spanner-aml`)
│   └── api/app.py                 # FastAPI backend & SPA static bundle server
├── web/                           # React 19 + TypeScript + Vite + Three.js 3D Scrollytelling UI
└── tests/
    ├── unit/                      # Fast unit test suite (32 tests, >90% coverage)
    └── integration/               # Live Cloud Spanner Graph integration suite
```

---

## Quickstart

### 1. Prerequisites & Environment Variables

 Configure your Google Cloud Spanner target via environment variables (no project IDs or secrets are hardcoded in source):

```bash
export SPANNER_PROJECT_ID="your-gcp-project-id"
export SPANNER_INSTANCE_ID="your-spanner-instance-id"
export SPANNER_DATABASE_ID="aml-db"
export SPANNER_ENABLE_BUILTIN_METRICS="false"
```

### 2. Install Python Package & Apply Spanner Graph Schema

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# Apply schema/aml_graph.sql and seed the initial multi-typology dataset
spanner-aml init-schema
spanner-aml seed
```

### 3. Build Frontend & Launch the Workbench Server

```bash
npm --prefix web install
npm --prefix web run build

uvicorn spanner_aml.api.app:app --host 127.0.0.1 --port 8765
```

Open **`http://127.0.0.1:8765`** in your browser to explore the 3D AML Investigation Workbench.

---

## CLI Commands

The `spanner-aml` CLI supports schema management, dataset ingestion, detection, and live pre-settlement interception checks directly from the terminal:

```bash
# Apply Cloud Spanner relational + Property Graph DDL
spanner-aml init-schema

# Ingest curated seed dataset into Cloud Spanner
spanner-aml seed

# Run GQL circular laundering detection on a target account
spanner-aml detect --account-id ACC_RING1_A --min-amount 1000

# Evaluate a candidate outbound wire through the <150ms Pre-Settlement Gate
spanner-aml intercept --from-account ACC_RING1_D --to-account ACC_RING1_A --amount 96200
```

---

## Running Tests

```bash
# Run the full Python unit test suite with coverage report
.venv/bin/pytest tests/unit --cov=spanner_aml --cov-report=term-missing -v

# Verify TypeScript & production frontend bundle build
npm --prefix web run build
```
