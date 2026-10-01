"""FastAPI application factory and endpoints for the Cloud Spanner Graph AML Compliance Workbench."""

from __future__ import annotations

from decimal import Decimal
import os
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from spanner_aml.api.schemas import (
    ApiEnvelope,
    GenerateSarRequest,
    InterceptRequest,
    InvestigateRequest,
)
from spanner_aml.config import SpannerConfig
from spanner_aml.detector import RingDetector
from spanner_aml.enricher import GraphContextEnricher
from spanner_aml.interceptor import SettlementInterceptor
from spanner_aml.models import (
    ComplianceAlert,
    EnrichedCaseInvestigation,
    InterceptionResult,
    LaunderingRingEvidence,
)
from spanner_aml.queries import (
    GQL_BIPARTITE,
    GQL_CIRCULAR_LAYERING,
    GQL_FAN_IN,
    GQL_FAN_OUT,
    GQL_GATHER_SCATTER,
    GQL_PRE_SETTLEMENT_CYCLE_CHECK,
    GQL_RANDOM_WALK_LAYERING,
    GQL_SAME_ENTITY_RING,
    GQL_SCATTER_GATHER,
    GQL_STACKED_BIPARTITE,
    GQL_UBO_SHELL_RING,
)
from spanner_aml.sar_agent import AlertRepository, SarInvestigator

_TYPOLOGY_DEMO_GUIDES: Mapping[str, Mapping[str, str]] = MappingProxyType(
    {
        "CIRCULAR_LAYERING": MappingProxyType(
            {
                "nickname": "The Washing Machine (Circular Loop)",
                "plain_english": (
                    "Criminals bounce illicit funds through a chain of 3 to 10 middlemen accounts "
                    "across different banks and currencies so the money returns to the starting account looking clean."
                ),
                "why_spanner_wins": (
                    "Tracing a 10-hop loop in SQL requires 10 self-joins on a massive Transactions table. "
                    "Cloud Spanner Graph runs 1 bounded path query (-[chain:TRANSFERRED_TO]->{2, 12}) with strict chronological ordering in ~140ms."
                ),
                "gql_query": GQL_CIRCULAR_LAYERING,
            }
        ),
        "UBO_SHELL_RING": MappingProxyType(
            {
                "nickname": "The Hidden Puppet Master (UBO Shell Ring)",
                "plain_english": (
                    "Instead of returning money to the same account, Shell Company A wires funds through intermediaries "
                    "to Shell Company B. On paper they look unrelated, but the same billionaire (UBO) secretly controls both."
                ),
                "why_spanner_wins": (
                    "Spanner Graph traverses corporate ownership edges (:CONTROLS and :OWNS) and wire transfer edges "
                    "(:TRANSFERRED_TO) in a single unified query—exposing hidden beneficial ownership loops instantly."
                ),
                "gql_query": GQL_UBO_SHELL_RING,
            }
        ),
        "SAME_ENTITY_RING": MappingProxyType(
            {
                "nickname": "The Self-Transfer Disguise (Same-Entity Ring)",
                "plain_english": (
                    "A high-risk corporate entity routes funds out of one bank account, bounces them through external "
                    "intermediaries, and deposits them into a second account owned by the exact same corporation."
                ),
                "why_spanner_wins": (
                    "Matches (e:Entity)-[:OWNS]->(src) and (e:Entity)-[:OWNS]->(dst) across variable-length payment "
                    "paths without moving data out of the operational ledger."
                ),
                "gql_query": GQL_SAME_ENTITY_RING,
            }
        ),
        "SCATTER_GATHER": MappingProxyType(
            {
                "nickname": "The Smurfing Diamond (Scatter-Gather)",
                "plain_english": (
                    "An origin account splits a large sum into 16 smaller transfers across 'money mule' accounts "
                    "to stay under reporting thresholds, and all 16 mules immediately forward the funds to one collector account."
                ),
                "why_spanner_wins": (
                    "Matches the full diamond topology (origin -> mule -> sink), groups by origin/sink pairs, "
                    "and verifies every mule's inbound transfer arrived before its outbound transfer."
                ),
                "gql_query": GQL_SCATTER_GATHER,
            }
        ),
        "GATHER_SCATTER": MappingProxyType(
            {
                "nickname": "The Underground Clearinghouse (Gather-Scatter)",
                "plain_english": (
                    "A central hub account collects structured deposits from multiple senders, pools the money, "
                    "and immediately disperses it out to downstream beneficiary accounts."
                ),
                "why_spanner_wins": (
                    "Aggregates both fan-in and fan-out degrees around the central hub node in a single GQL pass "
                    "while enforcing chronological flow (e_in.event_timestamp <= e_out.event_timestamp)."
                ),
                "gql_query": GQL_GATHER_SCATTER,
            }
        ),
        "FAN_OUT": MappingProxyType(
            {
                "nickname": "Rapid Structuring Split (Fan-Out)",
                "plain_english": (
                    "A single account rapidly splits funds across many beneficiary accounts in parallel "
                    "to obscure the origin of illicit proceeds."
                ),
                "why_spanner_wins": (
                    "Uses ISO GQL NEXT pipeline chaining to group outbound edges by hub account and filter on distinct receiver degree."
                ),
                "gql_query": GQL_FAN_OUT,
            }
        ),
        "FAN_IN": MappingProxyType(
            {
                "nickname": "Smurfing Collector Aggregation (Fan-In)",
                "plain_english": (
                    "Many unrelated accounts simultaneously wire smaller amounts into a single collector account "
                    "to consolidate illicit cash deposits."
                ),
                "why_spanner_wins": (
                    "Aggregates inbound transfer edges per sink account in real time on the transactional Spanner database."
                ),
                "gql_query": GQL_FAN_IN,
            }
        ),
        "BIPARTITE": MappingProxyType(
            {
                "nickname": "Pass-Through Conduit Relay (Bipartite)",
                "plain_english": (
                    "Upstream feeder accounts fund an intermediary pass-through account that relays funds "
                    "downstream to isolate the originators from the final recipients."
                ),
                "why_spanner_wins": (
                    "Correlates upstream funding edges and downstream relay edges in one graph pattern match."
                ),
                "gql_query": GQL_BIPARTITE,
            }
        ),
        "STACKED_BIPARTITE": MappingProxyType(
            {
                "nickname": "Multi-Tier Shell Relay (Stacked Bipartite)",
                "plain_english": (
                    "Funds cascade through multiple sequential layers of pass-through accounts so no single bank "
                    "can see both the original sender and final beneficiary."
                ),
                "why_spanner_wins": (
                    "Traverses multi-tier ACYCLIC paths with array-level chronological validation directly inside Spanner."
                ),
                "gql_query": GQL_STACKED_BIPARTITE,
            }
        ),
        "RANDOM_WALK": MappingProxyType(
            {
                "nickname": "The Zig-Zag Escape Trail (Random Walk)",
                "plain_english": (
                    "Instead of looping back, launderers move funds along an 8+ hop zig-zag chain of accounts "
                    "across banks to outrun manual compliance investigations."
                ),
                "why_spanner_wins": (
                    "Traces up to 11 sequential hops in ~100ms using ACYCLIC path matching and timestamp monotonicity checks."
                ),
                "gql_query": GQL_RANDOM_WALK_LAYERING,
            }
        ),
        "PRE_SETTLEMENT_CYCLE_CHECK": MappingProxyType(
            {
                "nickname": "In-Flight Wire Interception (Pre-Settlement Hold)",
                "plain_english": (
                    "Before a new wire transfer settles, Spanner checks whether the recipient previously sent funds "
                    "along a path leading to the current sender—catching the loop before the money leaves."
                ),
                "why_spanner_wins": (
                    "Because Spanner is the live transactional ledger (zero overnight ETL), it can block a ring-closing wire in ~110ms."
                ),
                "gql_query": GQL_PRE_SETTLEMENT_CYCLE_CHECK,
            }
        ),
    }
)


def get_typology_demo_guide(typology: str) -> dict[str, str]:
    """Return plain-English storytelling notes and the live ISO GQL query for a typology."""
    t = typology.strip().upper().replace("-", "_")
    alias_map = {
        "CYCLE": "CIRCULAR_LAYERING",
        "STACK": "STACKED_BIPARTITE",
        "RANDOM": "RANDOM_WALK",
        "RANDOM_WALK_LAYERING": "RANDOM_WALK",
    }
    key = alias_map.get(t, t)
    guide = _TYPOLOGY_DEMO_GUIDES.get(key, _TYPOLOGY_DEMO_GUIDES["CIRCULAR_LAYERING"])
    return dict(guide)


_RAW_CASE_CATALOG: tuple[dict[str, Any], ...] = (
    {
        "case_id": "CASE_HI_CYCLE_10HOP",
        "title": "HI-Small 10-Hop Circular Layering Ring",
        "typology": "CIRCULAR_LAYERING",
        "account_id": "8013C4030",
        "min_amount": 100.0,
        "summary": "10-hop chronological cycle across 10 bank accounts ($8,805 -> $7,945 USD) from Kaggle HI-Small.",
        "expected_hops": 10,
    },
    {
        "case_id": "CASE_SEED_CYCLE_3HOP",
        "title": "Curated 3-Hop Offshore Shell Cycle",
        "typology": "CIRCULAR_LAYERING",
        "account_id": "ACC_RING1_A",
        "min_amount": 1000.0,
        "summary": "High-velocity circular wire loop through Cayman and BVI shell accounts.",
        "expected_hops": 3,
    },
    {
        "case_id": "CASE_SEED_UBO_SHELL",
        "title": "UBO Beneficial Ownership Shell Ring",
        "typology": "UBO_SHELL_RING",
        "account_id": "ACC_RING3_A",
        "min_amount": 1000.0,
        "summary": "Cross-entity layering disguised via two distinct shell corporations controlled by the same PEP UBO.",
        "expected_hops": 2,
    },
    {
        "case_id": "CASE_SEED_SAME_ENTITY",
        "title": "Same-Entity Self-Laundering Loop",
        "typology": "SAME_ENTITY_RING",
        "account_id": "ACC_RING2_A",
        "min_amount": 1000.0,
        "summary": "Multi-account round-trip routing returning funds to a second account owned by the same corporate entity.",
        "expected_hops": 2,
    },
    {
        "case_id": "CASE_HI_SCATTER_GATHER",
        "title": "HI-Small 16-Mule Scatter-Gather Diamond",
        "typology": "SCATTER_GATHER",
        "account_id": "808338D40",
        "min_amount": 10.0,
        "summary": "Origin account scatters funds across 16 intermediary mule accounts that reconverge at a single collector.",
        "expected_hops": 32,
    },
    {
        "case_id": "CASE_HI_GATHER_SCATTER",
        "title": "HI-Small Gather-Scatter Hub Relay",
        "typology": "GATHER_SCATTER",
        "account_id": "811C599A0",
        "min_amount": 10.0,
        "summary": "Central aggregation hub collecting multiple inbound transfers before dispersing downstream.",
        "expected_hops": 6,
    },
    {
        "case_id": "CASE_HI_FAN_OUT",
        "title": "HI-Small 16-Way Structuring Fan-Out",
        "typology": "FAN_OUT",
        "account_id": "800737690",
        "min_amount": 10.0,
        "summary": "Single origin account splitting funds across 16 distinct beneficiary accounts.",
        "expected_hops": 16,
    },
    {
        "case_id": "CASE_HI_FAN_IN",
        "title": "HI-Small Smurfing Fan-In Collector",
        "typology": "FAN_IN",
        "account_id": "811C597B0",
        "min_amount": 10.0,
        "summary": "Collector account aggregating structured deposits from multiple unrelated sender accounts.",
        "expected_hops": 2,
    },
    {
        "case_id": "CASE_HI_BIPARTITE",
        "title": "HI-Small Single-Layer Bipartite Relay",
        "typology": "BIPARTITE",
        "account_id": "8010AA4F0",
        "min_amount": 10.0,
        "summary": "Single-layer bipartite transfer relay funded by upstream feeder accounts.",
        "expected_hops": 2,
    },
    {
        "case_id": "CASE_HI_STACKED_BIPARTITE",
        "title": "HI-Small Multi-Layer Stacked Bipartite",
        "typology": "STACKED_BIPARTITE",
        "account_id": "",
        "min_amount": 1000.0,
        "summary": "Multi-layer sequential bipartite relay chain across intermediate account tiers.",
        "expected_hops": 3,
    },
    {
        "case_id": "CASE_HI_RANDOM_WALK_8HOP",
        "title": "HI-Small 8-Hop Sequential Random Walk",
        "typology": "RANDOM_WALK",
        "account_id": "800178CC0",
        "min_amount": 10.0,
        "summary": "8-hop non-cyclic chronological layering walk across 9 accounts in Kaggle HI-Small.",
        "expected_hops": 8,
    },
)

DEFAULT_CASE_CATALOG: tuple[Mapping[str, Any], ...] = tuple(
    MappingProxyType(dict(item)) for item in _RAW_CASE_CATALOG
)


def _serialize_evidence(ev: LaunderingRingEvidence) -> dict[str, Any]:
    return {
        "typology": ev.typology,
        "hop_count": ev.hop_count,
        "initial_amount": float(ev.initial_amount),
        "final_amount": float(ev.final_amount),
        "retention_ratio": ev.retention_ratio,
        "total_duration_seconds": ev.total_duration_seconds,
        "account_ids": list(ev.account_ids),
        "subject_entity_id": ev.subject_entity_id,
        "query_latency_ms": ev.query_latency_ms,
        "hops": [
            {
                "hop_index": idx,
                "transaction_id": h.transaction_id,
                "from_account_id": h.from_account_id,
                "to_account_id": h.to_account_id,
                "amount_paid": float(h.amount_paid),
                "amount_received": float(h.amount_received),
                "currency": h.currency,
                "payment_format": h.payment_format,
                "event_timestamp": h.event_timestamp.isoformat(),
            }
            for idx, h in enumerate(ev.hops, start=1)
        ],
    }


def _serialize_investigation(inv: EnrichedCaseInvestigation) -> dict[str, Any]:
    return {
        "case_id": inv.case_id,
        "enrichment_latency_ms": inv.enrichment_latency_ms,
        "evidence": _serialize_evidence(inv.evidence),
        "demo_guide": get_typology_demo_guide(inv.evidence.typology),
        "risk_assessment": {
            "risk_score": inv.risk_assessment.risk_score,
            "risk_level": inv.risk_assessment.risk_level,
            "reasons": list(inv.risk_assessment.reasons),
        },
        "kyc_profiles": {
            acc_id: {
                "account_id": p.account_id,
                "iban": p.iban,
                "currency": p.currency,
                "account_status": p.account_status,
                "is_flagged": p.is_flagged,
                "bank_id": p.bank_id,
                "bank_name": p.bank_name,
                "bic_swift": p.bic_swift,
                "bank_jurisdiction": p.bank_jurisdiction,
                "entity_id": p.entity_id,
                "entity_name": p.entity_name,
                "entity_type": p.entity_type,
                "kyc_risk_tier": p.kyc_risk_tier,
                "is_pep_or_sanctioned": p.is_pep_or_sanctioned,
                "entity_jurisdiction": p.entity_jurisdiction,
                "ubo_entity_id": p.ubo_entity_id,
                "ubo_entity_name": p.ubo_entity_name,
            }
            for acc_id, p in inv.kyc_profiles.items()
        },
    }


def _serialize_alert(alert: ComplianceAlert) -> dict[str, Any]:
    return {
        "alert_id": alert.alert_id,
        "trigger_transaction_id": alert.trigger_transaction_id,
        "subject_entity_id": alert.subject_entity_id,
        "typology": alert.typology,
        "risk_score": alert.risk_score,
        "evidence_subgraph": dict(alert.evidence_subgraph),
        "sar_narrative": alert.sar_narrative,
        "sar_generation_source": alert.sar_generation_source,
        "citations_verified": alert.citations_verified,
        "alert_status": alert.alert_status,
        "created_at": alert.created_at.isoformat(),
    }


class WorkbenchService:
    """Coordinates zero-LLM Spanner Graph investigations, pre-settlement checks, and single-ticket SAR drafting."""

    def __init__(self, database: Any) -> None:
        self._database = database
        self._detector = RingDetector(database)
        self._enricher = GraphContextEnricher(database)
        self._interceptor = SettlementInterceptor(database, detector=self._detector)
        self._alert_repo = AlertRepository(database)
        self._sar_investigator = SarInvestigator(alert_repository=self._alert_repo)

    def _run_detector(
        self, typology: str, account_id: str, min_amount: Decimal
    ) -> tuple[LaunderingRingEvidence, ...]:
        t = typology.strip().upper().replace("-", "_")
        acc = account_id.strip()
        if t in ("CIRCULAR_LAYERING", "CYCLE"):
            return self._detector.detect_circular_rings(acc, min_amount=min_amount)
        if t == "UBO_SHELL_RING":
            return self._detector.detect_ubo_shell_rings(min_amount=min_amount)
        if t == "SAME_ENTITY_RING":
            return self._detector.detect_same_entity_rings(min_amount=min_amount)
        if t == "FAN_OUT":
            return self._detector.detect_fan_out(
                acc, min_amount=min_amount, min_degree=2
            )
        if t == "FAN_IN":
            return self._detector.detect_fan_in(
                acc, min_amount=min_amount, min_degree=2
            )
        if t == "GATHER_SCATTER":
            return self._detector.detect_gather_scatter(acc, min_amount=min_amount)
        if t == "SCATTER_GATHER":
            return self._detector.detect_scatter_gather(
                acc, min_amount=min_amount, min_degree=2
            )
        if t == "BIPARTITE":
            return self._detector.detect_bipartite(acc, min_amount=min_amount)
        if t in ("STACKED_BIPARTITE", "STACK"):
            return self._detector.detect_stacked_bipartite(min_amount=min_amount)
        if t in ("RANDOM_WALK", "RANDOM"):
            return self._detector.detect_random_walk_layering(acc, min_amount=min_amount)
        raise ValueError(f"Unsupported typology: {typology}")

    def investigate_case(
        self,
        typology: str,
        account_id: str,
        min_amount: Decimal,
        case_id: str | None = None,
    ) -> EnrichedCaseInvestigation:
        """Execute GQL detection + KYC/UBO graph enrichment ($0 LLM cost)."""
        matches = self._run_detector(typology, account_id, min_amount)
        if not matches:
            raise LookupError(
                f"No laundering subgraph found for typology={typology}, account_id={account_id}"
            )
        # Pick the deepest hop path when multiple sub-paths are returned (e.g. random walk)
        best_evidence = max(matches, key=lambda e: (e.hop_count, e.initial_amount))
        return self._enricher.enrich_evidence(best_evidence, case_id=case_id)

    def intercept_payment(
        self,
        from_account_id: str,
        to_account_id: str,
        amount_paid: Decimal,
        payment_currency: str = "USD",
        payment_format: str = "Wire",
        persist: bool = False,
    ) -> InterceptionResult:
        """Evaluate a candidate payment via the <500ms GQL Pre-Settlement Interceptor."""
        return self._interceptor.evaluate_candidate_transfer(
            from_account_id=from_account_id,
            to_account_id=to_account_id,
            amount_paid=amount_paid,
            payment_currency=payment_currency,
            payment_format=payment_format,
            persist=persist,
        )

    def generate_single_ticket_sar(
        self,
        typology: str,
        account_id: str,
        min_amount: Decimal,
        case_id: str | None = None,
        persist_alert: bool = True,
    ) -> ComplianceAlert:
        """Enrich a single selected case and invoke Vertex AI Gemini (with fallback) to draft + persist a SAR."""
        investigation = self.investigate_case(
            typology=typology,
            account_id=account_id,
            min_amount=min_amount,
            case_id=case_id,
        )
        return self._sar_investigator.draft_sar_for_case(
            investigation=investigation,
            persist_alert=persist_alert,
        )

    def list_alerts(self, limit: int = 50) -> tuple[ComplianceAlert, ...]:
        """List saved ComplianceAlerts from Cloud Spanner."""
        return self._alert_repo.list_alerts(limit=limit)


def get_spanner_db(request: Request) -> Any:
    """Resolve or cache the Cloud Spanner Database handle."""
    if not hasattr(request.app.state, "spanner_db"):
        cfg = SpannerConfig.from_env()
        request.app.state.spanner_db = cfg.get_database()
    return request.app.state.spanner_db


def get_workbench_service(
    request: Request, db: Any = Depends(get_spanner_db)
) -> WorkbenchService:
    """Resolve the WorkbenchService from app.state or construct one."""
    if hasattr(request.app.state, "workbench_service"):
        return request.app.state.workbench_service  # type: ignore[no-any-return]
    service = WorkbenchService(db)
    request.app.state.workbench_service = service
    return service


def create_app() -> FastAPI:
    """Construct the FastAPI application for the Spanner Graph AML Workbench."""
    app = FastAPI(
        title="Cloud Spanner Graph AML Compliance Workbench API",
        version="0.2.0",
    )

    cors_origins_env = os.environ.get(
        "CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    )
    allowed_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/api/health", response_model=ApiEnvelope)
    def health_check(db: Any = Depends(get_spanner_db)) -> ApiEnvelope:
        sql = """
        SELECT
          (SELECT COUNT(*) FROM Banks) AS banks_count,
          (SELECT COUNT(*) FROM Entities) AS entities_count,
          (SELECT COUNT(*) FROM Accounts) AS accounts_count,
          (SELECT COUNT(*) FROM Transactions) AS transactions_count,
          (SELECT COUNT(*) FROM ComplianceAlerts) AS alerts_count
        """
        with db.snapshot() as snapshot:
            row = list(snapshot.execute_sql(sql))[0]
        return ApiEnvelope(
            success=True,
            data={
                "status": "CONNECTED",
                "banks_count": int(row[0]),
                "entities_count": int(row[1]),
                "accounts_count": int(row[2]),
                "transactions_count": int(row[3]),
                "alerts_count": int(row[4]),
            },
            meta={"graph": "AmlGraph"},
        )

    @app.get("/api/catalog", response_model=ApiEnvelope)
    def get_case_catalog() -> ApiEnvelope:
        return ApiEnvelope(
            success=True,
            data={"cases": [dict(c) for c in DEFAULT_CASE_CATALOG]},
            meta={"total": len(DEFAULT_CASE_CATALOG), "llm_cost": 0},
        )

    @app.post("/api/investigate", response_model=ApiEnvelope)
    def investigate_endpoint(
        payload: InvestigateRequest,
        service: WorkbenchService = Depends(get_workbench_service),
    ) -> ApiEnvelope:
        try:
            inv = service.investigate_case(
                typology=payload.typology,
                account_id=payload.account_id,
                min_amount=Decimal(str(payload.min_amount)),
                case_id=payload.case_id,
            )
            return ApiEnvelope(
                success=True,
                data=_serialize_investigation(inv),
                meta={
                    "query_latency_ms": inv.evidence.query_latency_ms,
                    "enrichment_latency_ms": inv.enrichment_latency_ms,
                    "llm_tokens_used": 0,
                },
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/intercept", response_model=ApiEnvelope)
    def intercept_endpoint(
        payload: InterceptRequest,
        service: WorkbenchService = Depends(get_workbench_service),
    ) -> ApiEnvelope:
        res = service.intercept_payment(
            from_account_id=payload.from_account_id,
            to_account_id=payload.to_account_id,
            amount_paid=Decimal(str(payload.amount_paid)),
            payment_currency=payload.payment_currency,
            payment_format=payload.payment_format,
            persist=payload.persist,
        )
        return ApiEnvelope(
            success=True,
            data={
                "transaction_id": res.transaction.transaction_id,
                "from_account_id": res.transaction.from_account_id,
                "to_account_id": res.transaction.to_account_id,
                "amount_paid": float(res.transaction.amount_paid),
                "payment_currency": res.transaction.payment_currency,
                "payment_format": res.transaction.payment_format,
                "decision": res.decision,
                "latency_ms": res.latency_ms,
                "matched_rings": [_serialize_evidence(e) for e in res.matched_evidence],
            },
            meta={"latency_ms": res.latency_ms, "llm_tokens_used": 0},
        )

    @app.post("/api/alerts/generate-sar", response_model=ApiEnvelope)
    def generate_sar_endpoint(
        payload: GenerateSarRequest,
        service: WorkbenchService = Depends(get_workbench_service),
    ) -> ApiEnvelope:
        try:
            alert = service.generate_single_ticket_sar(
                typology=payload.typology,
                account_id=payload.account_id,
                min_amount=Decimal(str(payload.min_amount)),
                case_id=payload.case_id,
                persist_alert=payload.persist_alert,
            )
            return ApiEnvelope(
                success=True,
                data=_serialize_alert(alert),
                meta={
                    "single_ticket_mode": True,
                    "source": alert.sar_generation_source,
                    "citations_verified": alert.citations_verified,
                },
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/alerts", response_model=ApiEnvelope)
    def list_alerts_endpoint(
        limit: int = 50,
        service: WorkbenchService = Depends(get_workbench_service),
    ) -> ApiEnvelope:
        alerts = service.list_alerts(limit=min(max(1, limit), 200))
        return ApiEnvelope(
            success=True,
            data={"alerts": [_serialize_alert(a) for a in alerts]},
            meta={"total": len(alerts)},
        )

    web_dist = Path(__file__).resolve().parents[3] / "web" / "dist"
    if web_dist.is_dir():
        app.mount("/", StaticFiles(directory=str(web_dist), html=True), name="web")

    return app


app = create_app()
