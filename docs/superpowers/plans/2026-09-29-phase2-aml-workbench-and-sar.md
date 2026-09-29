# Phase 2 & 3 AML Workbench, Pre-Settlement Interceptor & Controlled SAR Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cost-controlled, zero-idle-token AML Compliance Workbench with a FastAPI Spanner Graph backend, `<500ms` Pre-Settlement Interceptor, on-demand single-ticket Vertex AI Gemini SAR generator (`ComplianceAlerts`), and an IBM Carbon Design System (`@carbon/react`) + `@xyflow/react` interactive graph UI.

**Architecture:** All ring detection, KYC/UBO graph enrichment (`GQL_ACCOUNT_KYC_CONTEXT`), deterministic risk scoring (`0.00–1.00`), and pre-settlement cycle interception execute purely on Cloud Spanner Graph (`AmlGraph`) with zero LLM calls. Only when an analyst clicks "Draft FinCEN SAR (1 Ticket)" on a single selected case in the React workbench does the backend call Vertex AI `gemini-2.5-flash` (with deterministic fallback and 100% hop citation verification) and persist the alert to `ComplianceAlerts`.

**Tech Stack:** Python 3.12, `google-cloud-spanner`, `google-genai` (Vertex AI ADC), `fastapi`, `uvicorn`, `pydantic`, React 18, TypeScript, Vite, `@carbon/react` v11, `@carbon/styles`, `@carbon/icons-react`, `@xyflow/react` v12, `dagre`.

**Spec:** `docs/superpowers/specs/2026-09-29-phase2-aml-workbench-and-sar-design.md`

## Global Constraints

- **Immutability:** All domain models must use `@dataclass(frozen=True)`, tuple collections, and `types.MappingProxyType` for dictionaries. Never mutate inputs in-place.
- **Zero Idle LLM Cost:** Browsing `/api/catalog`, running `/api/investigate`, and testing `/api/intercept` must make **zero LLM calls**—only `/api/alerts/generate-sar` may invoke Gemini for a single ticket.
- **Parameterized SQL/GQL:** Never interpolate user input into SQL or ISO GQL strings; always bind parameters with `google.cloud.spanner_v1.param_types`.
- **FastAPI Architecture:** Put app construction in `create_app()`, use `Depends` for dependencies, return a consistent response envelope (`{success, data, error, meta}`), and keep CORS origins environment-configurable.
- **Test Coverage:** Maintain $\ge 85\%$ unit test coverage across `src/spanner_aml/`.

---

### Task 1: KYC/UBO Graph Enricher, Pre-Settlement Interceptor & Controlled Single-Ticket SAR Agent

**Files:**
- Modify: `src/spanner_aml/models.py`
- Modify: `src/spanner_aml/queries.py`
- Create: `src/spanner_aml/enricher.py`
- Create: `src/spanner_aml/interceptor.py`
- Create: `src/spanner_aml/sar_agent.py`
- Test: `tests/unit/test_enricher_and_sar.py`

**Interfaces:**
- Consumes: `LaunderingRingEvidence`, `TransferHop`, `Transaction`, `normalize_to_usd` from `src/spanner_aml/models.py`; `RingDetector` from `src/spanner_aml/detector.py`.
- Produces:
  - `AccountKycProfile`, `RiskAssessment`, `EnrichedCaseInvestigation`, `ComplianceAlert`, `InterceptionResult` in `src/spanner_aml/models.py`
  - `GQL_ACCOUNT_KYC_CONTEXT` in `src/spanner_aml/queries.py`
  - `GraphContextEnricher`, `compute_risk_assessment` in `src/spanner_aml/enricher.py`
  - `SettlementInterceptor` in `src/spanner_aml/interceptor.py`
  - `SarInvestigator`, `AlertRepository`, `compile_deterministic_sar`, `verify_sar_citations` in `src/spanner_aml/sar_agent.py`

- [ ] **Step 1: Write the failing unit tests in `tests/unit/test_enricher_and_sar.py`**

```python
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import MagicMock
import pytest

from spanner_aml.models import (
    AccountKycProfile,
    ComplianceAlert,
    EnrichedCaseInvestigation,
    InterceptionResult,
    LaunderingRingEvidence,
    RiskAssessment,
    TransferHop,
)
from spanner_aml.enricher import GraphContextEnricher, compute_risk_assessment
from spanner_aml.interceptor import SettlementInterceptor
from spanner_aml.sar_agent import (
    AlertRepository,
    SarInvestigator,
    compile_deterministic_sar,
    verify_sar_citations,
)


def _sample_evidence() -> LaunderingRingEvidence:
    hops = (
        TransferHop(
            transaction_id="TX_RING1_1",
            from_account_id="ACC_A",
            to_account_id="ACC_B",
            amount_paid=Decimal("50000.00"),
            amount_received=Decimal("50000.00"),
            currency="USD",
            payment_format="Wire",
            event_timestamp=datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc),
        ),
        TransferHop(
            transaction_id="TX_RING1_2",
            from_account_id="ACC_B",
            to_account_id="ACC_A",
            amount_paid=Decimal("49500.00"),
            amount_received=Decimal("49500.00"),
            currency="USD",
            payment_format="Wire",
            event_timestamp=datetime(2026, 9, 1, 10, 15, tzinfo=timezone.utc),
        ),
    )
    return LaunderingRingEvidence.from_hops(
        typology="CIRCULAR_LAYERING",
        hops=hops,
        subject_entity_id="ENT_SHELL_1",
        query_latency_ms=145.2,
        raw_graph_path={"hop_count": 2},
    )


def test_enricher_and_deterministic_risk_assessment():
    evidence = _sample_evidence()
    mock_db = MagicMock()
    mock_snapshot = MagicMock()
    mock_db.snapshot.return_value.__enter__.return_value = mock_snapshot
    mock_snapshot.execute_sql.side_effect = [
        [
            (
                "ACC_A",
                "KY11BANK0001",
                "USD",
                "ACTIVE",
                True,
                "BANK_001",
                "Cayman Trade Bank",
                "CTBKKYKY",
                "KY",
                "ENT_SHELL_1",
                "Aethelgard Holdings Ltd",
                "SHELL",
                "HIGH",
                True,
                "KY",
                "ENT_UBO_1",
            ),
            (
                "ACC_B",
                "VG22BANK0002",
                "USD",
                "ACTIVE",
                False,
                "BANK_002",
                "BVI Offshore Bank",
                "BVIOVGVG",
                "VG",
                "ENT_SHELL_2",
                "Boreal Ventures Corp",
                "CORPORATION",
                "MEDIUM",
                False,
                "VG",
                "ENT_UBO_1",
            ),
        ],
        [("ENT_UBO_1", "Viktor Vane (PEP)")],
    ]

    enricher = GraphContextEnricher(mock_db)
    investigation = enricher.enrich_evidence(evidence, case_id="CASE_001")

    assert investigation.case_id == "CASE_001"
    assert len(investigation.kyc_profiles) == 2
    assert investigation.kyc_profiles["ACC_A"].ubo_entity_name == "Viktor Vane (PEP)"
    assert investigation.risk_assessment.risk_score >= 0.80
    assert investigation.risk_assessment.risk_level == "CRITICAL"
    with pytest.raises(TypeError):
        investigation.kyc_profiles["MUTATE"] = None  # type: ignore[index]


def test_settlement_interceptor_holds_closing_cycle():
    mock_db = MagicMock()
    mock_detector = MagicMock()
    mock_detector.check_pre_settlement_cycle.return_value = (_sample_evidence(),)

    interceptor = SettlementInterceptor(mock_db, detector=mock_detector)
    res = interceptor.evaluate_candidate_transfer(
        from_account_id="ACC_B",
        to_account_id="ACC_A",
        amount_paid=Decimal("49500.00"),
        persist=False,
    )
    assert res.decision == "HELD"
    assert res.transaction.settlement_status == "HELD"
    assert len(res.matched_evidence) == 1


def test_sar_investigator_verifies_citations_and_persists_alert():
    evidence = _sample_evidence()
    profiles = {
        "ACC_A": AccountKycProfile(
            account_id="ACC_A",
            iban="KY11BANK0001",
            currency="USD",
            account_status="ACTIVE",
            is_flagged=True,
            bank_id="BANK_001",
            bank_name="Cayman Trade Bank",
            bic_swift="CTBKKYKY",
            bank_jurisdiction="KY",
            entity_id="ENT_SHELL_1",
            entity_name="Aethelgard Holdings Ltd",
            entity_type="SHELL",
            kyc_risk_tier="HIGH",
            is_pep_or_sanctioned=True,
            entity_jurisdiction="KY",
            ubo_entity_id="ENT_UBO_1",
            ubo_entity_name="Viktor Vane (PEP)",
        )
    }
    risk = compute_risk_assessment(evidence, profiles)
    investigation = EnrichedCaseInvestigation(
        case_id="CASE_001",
        evidence=evidence,
        kyc_profiles=profiles,
        risk_assessment=risk,
        enrichment_latency_ms=32.5,
    )

    det_sar = compile_deterministic_sar(investigation)
    assert verify_sar_citations(det_sar, evidence) is True
    assert "I. EXECUTIVE SUMMARY" in det_sar
    assert "TX_RING1_1" in det_sar
    assert "TX_RING1_2" in det_sar

    mock_db = MagicMock()
    repo = AlertRepository(mock_db)
    investigator = SarInvestigator(
        alert_repository=repo,
        enable_vertex_llm=False,
    )
    alert = investigator.draft_sar_for_case(investigation, persist_alert=True)
    assert alert.typology == "CIRCULAR_LAYERING"
    assert alert.citations_verified is True
    assert alert.sar_generation_source == "DETERMINISTIC_FALLBACK"
    assert mock_db.batch.called
```

- [ ] **Step 2: Run pytest to verify RED failure**

Run: `.venv/bin/pytest tests/unit/test_enricher_and_sar.py -v`
Expected: FAIL with `ImportError`

- [ ] **Step 3: Implement models, enricher, interceptor, and SAR agent**

- [ ] **Step 4: Run pytest to verify GREEN pass**

Run: `.venv/bin/pytest tests/unit/test_enricher_and_sar.py -v`
Expected: PASS

---

### Task 2: FastAPI Compliance Workbench Backend & Catalog Service

**Files:**
- Modify: `pyproject.toml`
- Create: `src/spanner_aml/api/__init__.py`
- Create: `src/spanner_aml/api/schemas.py`
- Create: `src/spanner_aml/api/app.py`
- Test: `tests/unit/test_api.py`

**Interfaces:**
- Consumes: `SpannerConfig`, `RingDetector`, `GraphContextEnricher`, `SettlementInterceptor`, `SarInvestigator`, `AlertRepository`.
- Produces: `create_app()` FastAPI factory in `src/spanner_aml/api/app.py` with endpoints:
  - `GET /api/health`
  - `GET /api/catalog`
  - `POST /api/investigate`
  - `POST /api/intercept`
  - `POST /api/alerts/generate-sar`
  - `GET /api/alerts`

- [ ] **Step 1: Write failing API unit tests in `tests/unit/test_api.py`**
- [ ] **Step 2: Run pytest to verify RED failure**
- [ ] **Step 3: Implement `src/spanner_aml/api/schemas.py` and `src/spanner_aml/api/app.py`**
- [ ] **Step 4: Run pytest to verify GREEN pass and $\ge 85\%$ coverage**

---

### Task 3: IBM Carbon Design System (`@carbon/react`) + `@xyflow/react` Compliance Workbench UI

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/types/aml.ts`
- Create: `web/src/utils/graphLayout.ts`
- Create: `web/src/components/CarbonNodes.tsx`
- Create: `web/src/components/TransferHopEdge.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/main.tsx`
- Create: `web/src/styles.scss`

- [ ] **Step 1: Scaffold `web/` with `@carbon/react`, `@carbon/styles`, `@carbon/icons-react`, `@xyflow/react`, `dagre`, and `sass`**
- [ ] **Step 2: Implement graph layout utility (`circular` for rings, `dagre` LR for flows) and custom Carbon React Flow nodes & animated edges**
- [ ] **Step 3: Build the 3-pane IBM Carbon `g100` Dark Theme Workbench (`App.tsx`) with Case Catalog, Interactive Graph Canvas + Chronological Hop `DataTable`, Pre-Settlement Interceptor tab, and Single-Ticket SAR Drawer**
- [ ] **Step 4: Verify TypeScript compilation (`npx tsc --noEmit`) and production build (`npm run build`)**
