# Phase 2 & 3 Design Spec: IBM Carbon AML Compliance Workbench, Pre-Settlement Interceptor & Controlled Gemini SAR Agent (`spanner-aml-graph`)

**Date:** 2026-09-29  
**Status:** Ready for Review  
**Scope:** FastAPI Spanner Graph API + KYC/UBO Subgraph Enricher + Pre-Settlement Interceptor + Controlled Single-Ticket Vertex AI Gemini SAR Generator + React (`@carbon/react` + `@xyflow/react`) Compliance Workbench

---

## 1. Executive Summary & Cost-Controlled Architecture

Running an autonomous LLM agent on thousands of background transactions or every flagged episode is prohibitively expensive and slow. Instead, `spanner-aml-graph` separates **deterministic graph detection & enrichment ($0 LLM cost)** from **human-triggered single-ticket SAR narrative drafting**:

1. **Zero-LLM-Cost Detection, KYC Enrichment & Risk Scoring (100% Cloud Spanner Graph):**
   - Browsing the case catalog, running any of the 10 ISO GQL laundering detectors (`CIRCULAR_LAYERING`, `UBO_SHELL_RING`, `SAME_ENTITY_RING`, `FAN_OUT`, `FAN_IN`, `GATHER_SCATTER`, `SCATTER_GATHER`, `BIPARTITE`, `STACKED_BIPARTITE`, `RANDOM_WALK`), enriching involved accounts with `Entity`, `UBO`, and `Bank` profiles (`GQL_ACCOUNT_KYC_CONTEXT`), and testing candidate payments through the `<500ms` Pre-Settlement Interceptor (`PENDING` $\rightarrow$ `SETTLED` / `HELD`) execute purely on Cloud Spanner (`aml-db`) with **zero LLM calls**.
2. **Controlled Single-Ticket SAR Generation (On-Demand Vertex AI Gemini 2.5 Flash):**
   - Only when a compliance analyst explicitly clicks **"Draft FinCEN SAR (1 Ticket)"** on a single selected case in the UI does the backend invoke Vertex AI (`gemini-2.5-flash` via ADC on project `spanner-aml-graph`, with a deterministic 5-section FinCEN compiler fallback and strict citation verification) and persist the resulting `ComplianceAlert` into Cloud Spanner's `ComplianceAlerts` table.
3. **IBM Carbon Design System (`@carbon/react`) + React Flow (`@xyflow/react`) Workbench:**
   - The frontend uses **IBM Carbon Design System v11** (`@carbon/react`, `@carbon/styles`, `@carbon/icons-react`, `g100` dark theme, `IBM Plex Sans` / `IBM Plex Mono`) paired with **`@xyflow/react` (v12)** and **`dagre`** for the interactive center property graph canvas.

---

## 2. Backend Design (`src/spanner_aml/`)

### 2.1 New Immutable Domain Models (`src/spanner_aml/models.py`)

All domain models use `@dataclass(frozen=True)` and wrap mappings in `types.MappingProxyType`:

- **`AccountKycProfile` (`@dataclass(frozen=True)`):**
  - `account_id: str`
  - `iban: str | None`
  - `currency: str`
  - `account_status: str`
  - `is_flagged: bool`
  - `bank_id: str`
  - `bank_name: str`
  - `bic_swift: str | None`
  - `bank_jurisdiction: str | None`
  - `entity_id: str`
  - `entity_name: str`
  - `entity_type: str`
  - `kyc_risk_tier: str`
  - `is_pep_or_sanctioned: bool`
  - `entity_jurisdiction: str | None`
  - `ubo_entity_id: str | None`
  - `ubo_entity_name: str | None`
- **`RiskAssessment` (`@dataclass(frozen=True)`):**
  - `risk_score: float` (clamped to `[0.0, 1.0]`, rounded to 2 decimal places)
  - `risk_level: str` (`"CRITICAL"` $\ge 0.80$, `"HIGH"` $\ge 0.60$, `"MEDIUM"` $\ge 0.40$, `"LOW"` $< 0.40$)
  - `reasons: tuple[str, ...]` (explainable breakdown: typology base weight, PEP/sanctions presence, high-risk offshore jurisdictions, shell entity presence, structuring retention ratio)
- **`EnrichedCaseInvestigation` (`@dataclass(frozen=True)`):**
  - `case_id: str`
  - `evidence: LaunderingRingEvidence`
  - `kyc_profiles: Mapping[str, AccountKycProfile]` (wrapped in `MappingProxyType`)
  - `risk_assessment: RiskAssessment`
  - `enrichment_latency_ms: float`
- **`ComplianceAlert` (`@dataclass(frozen=True)`):**
  - `alert_id: str`
  - `trigger_transaction_id: str`
  - `subject_entity_id: str | None`
  - `typology: str`
  - `risk_score: float`
  - `evidence_subgraph: Mapping[str, Any]` (wrapped in `MappingProxyType`)
  - `sar_narrative: str`
  - `sar_generation_source: str` (`"VERTEX_GEMINI"` or `"DETERMINISTIC_FALLBACK"`)
  - `citations_verified: bool`
  - `alert_status: str`
  - `created_at: datetime`
- **`InterceptionResult` (`@dataclass(frozen=True)`):**
  - `transaction: Transaction`
  - `decision: str` (`"SETTLED"` or `"HELD"`)
  - `latency_ms: float`
  - `matched_evidence: tuple[LaunderingRingEvidence, ...]`

### 2.2 Spanner Graph KYC/UBO Enrichment (`src/spanner_aml/queries.py` & `src/spanner_aml/enricher.py`)

- **`GQL_ACCOUNT_KYC_CONTEXT` (`src/spanner_aml/queries.py`):**
  ```sql
  GRAPH AmlGraph
  MATCH (b:Bank)<-[:HELD_AT]-(a:Account)<-[:OWNS]-(e:Entity)
  WHERE a.account_id IN UNNEST(@account_ids)
  RETURN a.account_id AS account_id,
         a.iban AS iban,
         a.currency AS currency,
         a.account_status AS account_status,
         a.is_flagged AS is_flagged,
         b.bank_id AS bank_id,
         b.bank_name AS bank_name,
         b.bic_swift AS bic_swift,
         b.jurisdiction AS bank_jurisdiction,
         e.entity_id AS entity_id,
         e.entity_name AS entity_name,
         e.entity_type AS entity_type,
         e.kyc_risk_tier AS kyc_risk_tier,
         e.is_pep_or_sanctioned AS is_pep_or_sanctioned,
         e.jurisdiction AS entity_jurisdiction,
         e.ubo_entity_id AS ubo_entity_id
  ```
  Plus a secondary lookup for any non-null `ubo_entity_id` values so `ubo_entity_name` is populated without requiring an inner `CONTROLS` join (since only UBO-controlled entities have a `CONTROLS` edge).
- **`compute_risk_assessment(evidence, kyc_profiles) -> RiskAssessment` (`src/spanner_aml/enricher.py`):**
  - Pure, deterministic function calculating `risk_score` in `[0.0, 1.0]` with human-readable `reasons`.

### 2.3 Real-Time Pre-Settlement Interceptor (`src/spanner_aml/interceptor.py`)

- **`SettlementInterceptor.evaluate_candidate_transfer(from_account_id, to_account_id, amount_paid, payment_currency="USD", payment_format="Wire", persist=False) -> InterceptionResult`:**
  - Runs `RingDetector.check_pre_settlement_cycle(from_account_id=to_account_id, candidate_to_account_id=from_account_id, min_amount=...)` to check whether a transfer from `from_account_id -> to_account_id` closes an active cycle (`to_account_id -> ... -> from_account_id`).
  - If `persist=True`, writes the transaction to `Transactions` with `settlement_status='HELD'` (if cycle found) or `'SETTLED'` (if clean) and sets `Accounts.is_flagged = TRUE` on ring participants.
  - Zero LLM calls on the hot path.

### 2.4 Controlled Single-Ticket SAR Agent & Alert Repository (`src/spanner_aml/sar_agent.py`)

- **`SarInvestigator`:**
  - Invoked **only** on explicit single-case request (`draft_sar_for_case(investigation: EnrichedCaseInvestigation, persist_alert: bool = True) -> ComplianceAlert`).
  - Attempts Vertex AI Gemini (`google-genai` client with `vertexai=True`, `project=config.project_id`, `location="us-central1"`, model `gemini-2.5-flash`) with a structured system prompt producing a 5-section FinCEN SAR narrative:
    1. **I. Executive Summary & Alert Trigger**
    2. **II. Subject Entities, KYC Risk & Beneficial Ownership (UBO)**
    3. **III. Chronological Transaction Trail (Spanner Graph Evidence)**
    4. **IV. Money Laundering Typology & Red-Flag Indicators**
    5. **V. Regulatory Action & Filing Recommendation**
  - **Grounding & Citation Verifier (`verify_sar_citations`):** Verifies that every `transaction_id` and `account_id` in `investigation.evidence.hops` appears verbatim in the narrative. If any citation is missing or if Vertex AI is unavailable/disabled, falls back to `compile_deterministic_sar(investigation)` which guarantees 100% citation fidelity.
- **`AlertRepository`:**
  - `save_alert(alert: ComplianceAlert) -> ComplianceAlert`: Writes the alert row to Cloud Spanner `ComplianceAlerts` using `spanner.COMMIT_TIMESTAMP`.
  - `list_alerts(limit: int = 50) -> tuple[ComplianceAlert, ...]`: Reads persisted alerts ordered by `created_at DESC`.

### 2.5 FastAPI Service (`src/spanner_aml/api/app.py`)

All endpoints return a consistent immutable envelope:
`{"success": bool, "data": Any, "error": str | None, "meta": dict[str, Any]}`

- `GET /api/health`: Returns Spanner database connectivity and live table counts (`Banks`, `Entities`, `Accounts`, `Transactions`, `ComplianceAlerts`).
- `GET /api/catalog`: Returns a curated + `HI-Small` multi-typology catalog of real laundering cases in `aml-db` (grouped across all 10 supported typologies, with pre-populated seed account IDs and descriptions) so the analyst can click any case in the sidebar to inspect its live Spanner Graph topology.
- `POST /api/investigate`: Runs `RingDetector` + `GraphContextEnricher` for a given `{typology, account_id, min_amount}` and returns the `EnrichedCaseInvestigation` serialized with `@xyflow/react`-ready graph nodes (`Account`, `Entity`, `UBO`, `Bank`), edges (`TRANSFERRED_TO`, `OWNS`, `CONTROLS`, `HELD_AT`), KYC profiles, and deterministic `RiskAssessment`. **Zero LLM calls.**
- `POST /api/intercept`: Evaluates a candidate payment `{from_account_id, to_account_id, amount_paid, payment_currency, payment_format, persist}` through `SettlementInterceptor` and returns `decision` (`SETTLED` | `HELD`), latency in `ms`, and the closing ring subgraph if `HELD`. **Zero LLM calls.**
- `POST /api/alerts/generate-sar`: **Explicit single-ticket trigger.** Runs `SarInvestigator.draft_sar_for_case` for a single case, saves the alert to `ComplianceAlerts`, and returns the `ComplianceAlert` with the 5-section FinCEN SAR narrative.
- `GET /api/alerts`: Lists saved `ComplianceAlerts` from Cloud Spanner.

---

## 3. Frontend Design (`web/` — IBM Carbon Design System + `@xyflow/react`)

### 3.1 Tech Stack & Design System
- **Build & Runtime:** Vite + React 18 + TypeScript (`web/`)
- **UI Component Library:** **IBM Carbon Design System v11** (`@carbon/react`, `@carbon/styles`, `@carbon/icons-react`) configured with Carbon's dark theme (`GlobalTheme theme="g100"`).
- **Center Graph Canvas:** **`@xyflow/react` (v12)** + **`dagre`** for automatic layout calculation:
  - **Circular Ring Geometry:** Used automatically for `CIRCULAR_LAYERING`, `SAME_ENTITY_RING`, `UBO_SHELL_RING`, and `PRE_SETTLEMENT_RING`.
  - **Layered Left-to-Right (`dagre`) Geometry:** Used automatically for `FAN_OUT`, `FAN_IN`, `GATHER_SCATTER`, `SCATTER_GATHER`, `BIPARTITE`, `STACKED_BIPARTITE`, and `RANDOM_WALK`.

### 3.2 3-Pane Workbench Layout (Carbon UI Shell + Grid)

1. **Top Header (`Header`, `HeaderName`, `HeaderGlobalBar`):**
   - Title: `IBM AML // Cloud Spanner Graph Workbench`
   - Live connection status `Tag` (`aml-db • 8,221 Txns • 8,283 Accounts`), active Spanner GQL query latency pill (`ms`), and navigation switcher between **Investigation Workbench**, **Pre-Settlement Interceptor**, and **Saved Compliance Alerts (`ComplianceAlerts`)**.
2. **Left Pane — Case Catalog & Custom GQL Detector (`Tile`, `Dropdown`, `Search`, `StructuredList` / `ClickableTile`):**
   - Filter cases by Typology (`ALL`, `CIRCULAR_LAYERING`, `UBO_SHELL_RING`, `SAME_ENTITY_RING`, `FAN_OUT`, `FAN_IN`, `GATHER_SCATTER`, `SCATTER_GATHER`, `BIPARTITE`, `STACKED_BIPARTITE`, `RANDOM_WALK`) or run an ad-hoc query on any `account_id` and `min_amount`.
   - Clicking any case immediately executes the ISO GQL query on `aml-db` and renders the subgraph in the center canvas ($0 LLM cost).
3. **Center Pane — `@xyflow/react` Property Graph Canvas + Carbon `DataTable` Timeline:**
   - **Toolbar:** Carbon `Toggle` switches for `Show Entities & UBOs (OWNS / CONTROLS)` and `Show Banks (HELD_AT)`, plus layout selector (`Auto`, `Circular Ring`, `Layered Flow`).
   - **Custom `@xyflow/react` Nodes (`CarbonAccountNode`, `CarbonEntityNode`, `CarbonBankNode`):** Styled with Carbon `g90`/`g100` tokens, `IBM Plex Mono` IDs, Carbon `Tag` risk pills (`CRITICAL` / `HIGH` magenta/red, `PEP/SANCTIONED` purple, jurisdiction `Tag`), and ownership indicators.
   - **Custom `@xyflow/react` Edges (`TransferHopEdge`):** Animated directional edges with hop order + USD amount pills (`#1 • $8,805.32`) that highlight when hovered in the bottom Carbon `DataTable` chronological hop timeline.
4. **Right Pane — Deterministic Risk Breakdown & Single-Ticket SAR Generator:**
   - Displays the deterministic **Composite Risk Score (`0.00 – 1.00`)**, Carbon `Tag` risk factors, and KYC/UBO entity cards for every account in the ring.
   - Contains the explicit Carbon primary `Button`: **"Draft FinCEN SAR (1 Ticket)"**.
   - When clicked, displays a Carbon `InlineLoading` state, renders the 5-section FinCEN SAR narrative with a **"Citations Verified (100%)"** Carbon `Tag`, and confirms persistence to Cloud Spanner's `ComplianceAlerts` table.

---

## 4. Testing & Verification Plan

1. **Backend Unit Tests (`tests/unit/` — `>= 85%` coverage across `src/spanner_aml/`):**
   - `tests/unit/test_enricher_and_sar.py`: Tests `GQL_ACCOUNT_KYC_CONTEXT` enrichment, deterministic `compute_risk_assessment`, `SettlementInterceptor`, `SarInvestigator` (both mocked Vertex AI Gemini response and deterministic fallback + citation verifier), and `AlertRepository`.
   - `tests/unit/test_api.py`: Tests all FastAPI endpoints (`/api/health`, `/api/catalog`, `/api/investigate`, `/api/intercept`, `/api/alerts/generate-sar`, `/api/alerts`) using `fastapi.testclient.TestClient`.
2. **Frontend Build & Verification (`web/`):**
   - TypeScript typecheck (`tsc --noEmit`), production Vite bundle build (`npm run build`), and unit tests (`vitest`) for the graph layout builder (`buildReactFlowGraph`).
3. **Live End-to-End Verification against `aml-db`:**
   - Verify `/api/investigate` on live 10-hop cycle `8013C4030`, UBO shell ring, and bipartite relay (`$0` LLM cost).
   - Verify `/api/intercept` on a candidate closing transfer (`<500ms`).
   - Verify `/api/alerts/generate-sar` on a single selected case and confirm the row is persisted in live Cloud Spanner `ComplianceAlerts`.
