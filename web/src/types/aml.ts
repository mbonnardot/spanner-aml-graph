export type TypologyCode =
  | 'CIRCULAR_LAYERING'
  | 'UBO_SHELL_RING'
  | 'SAME_ENTITY_RING'
  | 'SCATTER_GATHER'
  | 'GATHER_SCATTER'
  | 'FAN_OUT'
  | 'FAN_IN'
  | 'BIPARTITE'
  | 'STACKED_BIPARTITE'
  | 'RANDOM_WALK';

export interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error?: string | null;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface CaseSummary {
  readonly case_id: string;
  readonly title: string;
  readonly typology: TypologyCode;
  readonly account_id: string;
  readonly min_amount: number;
  readonly summary: string;
  readonly expected_hops: number;
}

export interface TransferHop {
  readonly hop_index: number;
  readonly transaction_id: string;
  readonly from_account_id: string;
  readonly to_account_id: string;
  readonly amount_paid: number;
  readonly amount_received: number;
  readonly currency: string;
  readonly payment_format: string;
  readonly event_timestamp: string;
}

export interface LaunderingRingEvidence {
  readonly typology: string;
  readonly hop_count: number;
  readonly initial_amount: number;
  readonly final_amount: number;
  readonly retention_ratio: number;
  readonly total_duration_seconds: number;
  readonly account_ids: readonly string[];
  readonly subject_entity_id: string | null;
  readonly query_latency_ms: number;
  readonly hops: readonly TransferHop[];
}

export interface AccountKycProfile {
  readonly account_id: string;
  readonly iban: string;
  readonly currency: string;
  readonly account_status: string;
  readonly is_flagged: boolean;
  readonly bank_id: string;
  readonly bank_name: string;
  readonly bic_swift: string;
  readonly bank_jurisdiction: string;
  readonly entity_id: string;
  readonly entity_name: string;
  readonly entity_type: string;
  readonly kyc_risk_tier: string;
  readonly is_pep_or_sanctioned: boolean;
  readonly entity_jurisdiction: string;
  readonly ubo_entity_id: string | null;
  readonly ubo_entity_name: string | null;
}

export interface RiskAssessment {
  readonly risk_score: number;
  readonly risk_level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  readonly reasons: readonly string[];
}

export interface EnrichedCaseInvestigation {
  readonly case_id: string;
  readonly enrichment_latency_ms: number;
  readonly evidence: LaunderingRingEvidence;
  readonly kyc_profiles: Readonly<Record<string, AccountKycProfile>>;
  readonly risk_assessment: RiskAssessment;
}

export interface ComplianceAlert {
  readonly alert_id: string;
  readonly trigger_transaction_id: string;
  readonly subject_entity_id: string;
  readonly typology: string;
  readonly risk_score: number;
  readonly evidence_subgraph: Readonly<Record<string, unknown>>;
  readonly sar_narrative: string;
  readonly sar_generation_source: string;
  readonly citations_verified: boolean;
  readonly alert_status: string;
  readonly created_at: string;
}

export interface InterceptionResult {
  readonly transaction_id: string;
  readonly from_account_id: string;
  readonly to_account_id: string;
  readonly amount_paid: number;
  readonly payment_currency: string;
  readonly payment_format: string;
  readonly decision: 'HELD' | 'SETTLED' | 'BLOCK_HOLD_COMPLIANCE' | 'APPROVE';
  readonly latency_ms: number;
  readonly matched_rings: readonly LaunderingRingEvidence[];
}

export interface HealthResponse {
  readonly status: string;
  readonly banks_count: number;
  readonly entities_count: number;
  readonly accounts_count: number;
  readonly transactions_count: number;
  readonly alerts_count: number;
}

export interface AccountNodeData extends Record<string, unknown> {
  readonly kind: 'account';
  readonly accountId: string;
  readonly isAnchor: boolean;
  readonly profile: AccountKycProfile | undefined;
  readonly totalInUsd: number;
  readonly totalOutUsd: number;
  readonly isHighlighted: boolean;
}

export interface EntityNodeData extends Record<string, unknown> {
  readonly kind: 'entity';
  readonly entityId: string;
  readonly entityName: string;
  readonly entityType: string;
  readonly jurisdiction: string;
  readonly kycRiskTier: string;
  readonly isPep: boolean;
  readonly isUbo: boolean;
}

export interface BankNodeData extends Record<string, unknown> {
  readonly kind: 'bank';
  readonly bankId: string;
  readonly bankName: string;
  readonly jurisdiction: string;
}

export interface TransferEdgeData extends Record<string, unknown> {
  readonly hop: TransferHop;
  readonly allHopsBetweenPair: readonly TransferHop[];
  readonly isHighlighted: boolean;
}
