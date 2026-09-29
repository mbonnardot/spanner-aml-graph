"""Spanner Graph KYC/UBO context enricher and deterministic AML risk scorer."""

from __future__ import annotations

import time
import uuid
from typing import Any, Mapping

from google.cloud.spanner_v1 import param_types  # type: ignore[import-untyped]

from spanner_aml.models import (
    AccountKycProfile,
    EnrichedCaseInvestigation,
    LaunderingRingEvidence,
    RiskAssessment,
)
from spanner_aml.queries import GQL_ACCOUNT_KYC_CONTEXT, SQL_UBO_ENTITIES_LOOKUP

HIGH_RISK_JURISDICTIONS: frozenset[str] = frozenset(
    {"KY", "VG", "PA", "BZ", "CH", "CY", "SC", "MT", "LU", "LI"}
)

TYPOLOGY_BASE_WEIGHTS: Mapping[str, float] = {
    "UBO_SHELL_RING": 0.65,
    "CIRCULAR_LAYERING": 0.60,
    "SAME_ENTITY_RING": 0.60,
    "PRE_SETTLEMENT_RING": 0.62,
    "STACKED_BIPARTITE": 0.55,
    "GATHER_SCATTER": 0.55,
    "SCATTER_GATHER": 0.55,
    "FAN_OUT": 0.50,
    "FAN_IN": 0.50,
    "BIPARTITE": 0.48,
    "RANDOM_WALK": 0.52,
}


def compute_risk_assessment(
    evidence: LaunderingRingEvidence,
    kyc_profiles: Mapping[str, AccountKycProfile],
) -> RiskAssessment:
    """Compute a deterministic, explainable [0.0, 1.0] AML risk score."""
    base = TYPOLOGY_BASE_WEIGHTS.get(evidence.typology, 0.50)
    score = base
    reasons: list[str] = [
        f"Base typology risk ({evidence.typology}, {evidence.hop_count} hops): +{base:.2f}"
    ]

    profiles = tuple(kyc_profiles.values())
    if any(p.is_pep_or_sanctioned for p in profiles):
        score += 0.25
        reasons.append(
            "Politically Exposed Person (PEP) or Sanctioned entity in subgraph: +0.25"
        )

    if any(p.kyc_risk_tier.upper() == "HIGH" for p in profiles):
        score += 0.12
        reasons.append("High KYC risk tier entity ownership detected: +0.12")

    if any(p.entity_type.upper() == "SHELL" for p in profiles):
        score += 0.10
        reasons.append("Opaque shell corporation vehicle in transfer path: +0.10")

    offshore = sorted(
        {
            j
            for p in profiles
            for j in (p.bank_jurisdiction, p.entity_jurisdiction)
            if j and j.upper() in HIGH_RISK_JURISDICTIONS
        }
    )
    if offshore:
        score += 0.10
        reasons.append(
            f"Offshore / high-secrecy jurisdiction exposure ({', '.join(offshore)}): +0.10"
        )

    if 0.80 <= evidence.retention_ratio <= 1.05:
        score += 0.08
        reasons.append(
            f"High value retention ratio ({evidence.retention_ratio:.1%}) consistent with fee-skimmed layering: +0.08"
        )

    if evidence.hop_count >= 5:
        score += 0.07
        reasons.append(
            f"Deep multi-hop layering chain ({evidence.hop_count} sequential hops): +0.07"
        )

    clamped = round(min(0.99, max(0.05, score)), 2)
    if clamped >= 0.80:
        level = "CRITICAL"
    elif clamped >= 0.60:
        level = "HIGH"
    elif clamped >= 0.40:
        level = "MEDIUM"
    else:
        level = "LOW"

    return RiskAssessment(
        risk_score=clamped,
        risk_level=level,
        reasons=tuple(reasons),
    )


class GraphContextEnricher:
    """Enriches detected ring evidence with Account, Bank, Entity, and UBO context from AmlGraph."""

    def __init__(self, database: Any) -> None:
        self._database = database

    def fetch_kyc_profiles(
        self, account_ids: tuple[str, ...]
    ) -> tuple[Mapping[str, AccountKycProfile], float]:
        """Fetch KYC, Bank, and UBO profiles for the given account IDs in Spanner."""
        unique_ids = sorted({acc_id.strip() for acc_id in account_ids if acc_id.strip()})
        if not unique_ids:
            return {}, 0.0

        t_start = time.perf_counter()
        with self._database.snapshot() as snapshot:
            rows = list(
                snapshot.execute_sql(
                    GQL_ACCOUNT_KYC_CONTEXT,
                    params={"account_ids": unique_ids},
                    param_types={
                        "account_ids": param_types.Array(param_types.STRING),
                    },
                )
            )
        ubo_ids = sorted({str(r[15]) for r in rows if len(r) > 15 and r[15]})
        ubo_names: dict[str, str] = {}
        if ubo_ids:
            with self._database.snapshot() as ubo_snapshot:
                ubo_rows = list(
                    ubo_snapshot.execute_sql(
                        SQL_UBO_ENTITIES_LOOKUP,
                        params={"ubo_ids": ubo_ids},
                        param_types={
                            "ubo_ids": param_types.Array(param_types.STRING),
                        },
                    )
                )
            for u_row in ubo_rows:
                ubo_names[str(u_row[0])] = str(u_row[1])

        latency_ms = round((time.perf_counter() - t_start) * 1000.0, 2)
        profiles: dict[str, AccountKycProfile] = {}
        for r in rows:
            acc_id = str(r[0])
            ubo_id = str(r[15]) if r[15] else None
            profiles[acc_id] = AccountKycProfile(
                account_id=acc_id,
                iban=str(r[1]) if r[1] else None,
                currency=str(r[2] or "USD"),
                account_status=str(r[3] or "ACTIVE"),
                is_flagged=bool(r[4]),
                bank_id=str(r[5]),
                bank_name=str(r[6]),
                bic_swift=str(r[7]) if r[7] else None,
                bank_jurisdiction=str(r[8]) if r[8] else None,
                entity_id=str(r[9]),
                entity_name=str(r[10]),
                entity_type=str(r[11] or "CORPORATION"),
                kyc_risk_tier=str(r[12] or "LOW"),
                is_pep_or_sanctioned=bool(r[13]),
                entity_jurisdiction=str(r[14]) if r[14] else None,
                ubo_entity_id=ubo_id,
                ubo_entity_name=ubo_names.get(ubo_id) if ubo_id else None,
            )
        return profiles, latency_ms

    def enrich_evidence(
        self,
        evidence: LaunderingRingEvidence,
        case_id: str | None = None,
    ) -> EnrichedCaseInvestigation:
        """Enrich a LaunderingRingEvidence packet with full KYC profiles and deterministic risk score."""
        all_accounts = set(evidence.account_ids)
        for hop in evidence.hops:
            all_accounts.add(hop.from_account_id)
            all_accounts.add(hop.to_account_id)

        profiles, latency_ms = self.fetch_kyc_profiles(tuple(sorted(all_accounts)))
        risk = compute_risk_assessment(evidence, profiles)
        resolved_case_id = case_id or f"CASE_{uuid.uuid4().hex[:8].upper()}"
        return EnrichedCaseInvestigation(
            case_id=resolved_case_id,
            evidence=evidence,
            kyc_profiles=profiles,
            risk_assessment=risk,
            enrichment_latency_ms=latency_ms,
        )
