import { useEffect, useState } from 'react';
import type {
  AccountKycProfile,
  ComplianceAlert,
  EnrichedCaseInvestigation,
} from '../types/aml';

interface CaseDossierSidebarProps {
  readonly investigation: EnrichedCaseInvestigation | null;
  readonly selectedAccountProfile: AccountKycProfile | null;
  readonly highlightedHopTxId: string | null;
  readonly onHoverHop: (txId: string | null) => void;
  readonly onSelectAccountId: (accountId: string) => void;
  readonly onDraftSingleTicketSar: () => void;
  readonly isGeneratingSar: boolean;
  readonly activeAlert: ComplianceAlert | null;
  readonly savedAlerts: readonly ComplianceAlert[];
}

export function CaseDossierSidebar({
  investigation,
  selectedAccountProfile,
  highlightedHopTxId,
  onHoverHop,
  onSelectAccountId,
  onDraftSingleTicketSar,
  isGeneratingSar,
  activeAlert,
  savedAlerts,
}: CaseDossierSidebarProps) {
  const [activeTab, setActiveTab] = useState<'story' | 'kyc' | 'sar'>('story');

  useEffect(() => {
    if (activeAlert) {
      setActiveTab('sar');
    }
  }, [activeAlert]);

  const guide = investigation?.demo_guide;
  const hops = investigation?.evidence.hops ?? [];
  const profiles = investigation?.kyc_profiles ?? {};

  return (
    <aside className="m3-context-sheet">
      <div className="m3-segmented-tabs">
        <button
          type="button"
          className={`m3-segmented-tab ${activeTab === 'story' ? 'm3-segmented-tab--active' : ''}`}
          onClick={() => setActiveTab('story')}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            route
          </span>
          Story & Hops
        </button>
        <button
          type="button"
          className={`m3-segmented-tab ${activeTab === 'kyc' ? 'm3-segmented-tab--active' : ''}`}
          onClick={() => setActiveTab('kyc')}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            badge
          </span>
          KYC Dossier
        </button>
        <button
          type="button"
          className={`m3-segmented-tab ${activeTab === 'sar' ? 'm3-segmented-tab--active' : ''}`}
          onClick={() => setActiveTab('sar')}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            auto_awesome
          </span>
          Gemini SAR
        </button>
      </div>

      <div className="m3-context-sheet__body">
        {activeTab === 'story' && (
          <>
            {guide && (
              <>
                <div className="m3-card m3-card--elevated">
                  <div className="m3-section-label">
                    <span className="material-symbols-outlined" style={{ fontSize: 15, color: '#0b57d0' }}>
                      visibility
                    </span>
                    What Is Happening Here?
                  </div>
                  <p style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.55, color: '#1f1f1f' }}>
                    {guide.plain_english}
                  </p>
                </div>

                <div className="m3-card m3-card--tonal-primary">
                  <div className="m3-section-label" style={{ color: '#0b57d0' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                      hub
                    </span>
                    Why Cloud Spanner Graph Wins
                  </div>
                  <p style={{ margin: 0, fontSize: '0.8rem', lineHeight: 1.55, color: '#041e49' }}>
                    {guide.why_spanner_wins}
                  </p>
                </div>
              </>
            )}

            <div className="m3-card">
              <div className="m3-section-label" style={{ justifyContent: 'space-between' }}>
                <span>Chronological Hop Sequence</span>
                <span className="mono-num">{hops.length} Hops</span>
              </div>
              <div style={{ fontSize: '0.72rem', color: '#444746', marginBottom: 10 }}>
                Hover a hop to highlight the transfer on the graph canvas
              </div>

              {hops.length > 0 ? (
                <div className="m3-hop-list">
                  {hops.map((hop) => {
                    const isHovered = highlightedHopTxId === hop.transaction_id;
                    const senderName =
                      profiles[hop.from_account_id]?.entity_name ?? `#${hop.from_account_id}`;
                    const receiverName =
                      profiles[hop.to_account_id]?.entity_name ?? `#${hop.to_account_id}`;
                    return (
                      <div
                        key={hop.transaction_id}
                        className={`m3-hop-row ${isHovered ? 'm3-hop-row--active' : ''}`}
                        onMouseEnter={() => onHoverHop(hop.transaction_id)}
                        onMouseLeave={() => onHoverHop(null)}
                        onClick={() => {
                          onSelectAccountId(hop.from_account_id);
                          setActiveTab('kyc');
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <span
                            className="mono-num"
                            style={{
                              background: isHovered ? '#e37400' : '#0b57d0',
                              color: '#ffffff',
                              fontWeight: 700,
                              fontSize: '0.68rem',
                              padding: '2px 6px',
                              borderRadius: 9999,
                            }}
                          >
                            H{hop.hop_index}
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontWeight: 600,
                                color: '#1f1f1f',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {senderName} → {receiverName}
                            </div>
                            <div className="mono-num" style={{ fontSize: '0.68rem', color: '#444746' }}>
                              #{hop.from_account_id} → #{hop.to_account_id} · {hop.payment_format}
                            </div>
                          </div>
                        </div>
                        <span className="mono-num" style={{ fontWeight: 700, color: '#0b57d0' }}>
                          ${hop.amount_paid.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: '0.8rem', color: '#444746' }}>No hops returned.</div>
              )}
            </div>
          </>
        )}

        {activeTab === 'kyc' && (
          <>
            {selectedAccountProfile ? (
              <div className="m3-card m3-card--elevated">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="m3-chip m3-chip--primary mono-num">
                    #{selectedAccountProfile.account_id}
                  </span>
                  <span
                    className={`m3-chip ${
                      selectedAccountProfile.is_flagged || selectedAccountProfile.is_pep_or_sanctioned
                        ? 'm3-chip--error'
                        : 'm3-chip--tonal'
                    }`}
                  >
                    {selectedAccountProfile.is_pep_or_sanctioned
                      ? 'PEP / Sanctioned'
                      : selectedAccountProfile.kyc_risk_tier}
                  </span>
                </div>

                <h3
                  style={{
                    fontFamily: 'var(--md-sys-typescale-display-font)',
                    fontSize: '1.05rem',
                    margin: '12px 0 4px',
                  }}
                >
                  {selectedAccountProfile.entity_name}
                </h3>
                <div style={{ fontSize: '0.78rem', color: '#444746', marginBottom: 14 }}>
                  {selectedAccountProfile.entity_type} · Jurisdiction:{' '}
                  <strong>{selectedAccountProfile.entity_jurisdiction}</strong>
                </div>

                <div className="m3-card" style={{ marginBottom: 10 }}>
                  <div className="m3-section-label">Beneficial Owner & Entity Profile</div>
                  <div style={{ fontWeight: 700, fontSize: '0.86rem' }}>
                    {selectedAccountProfile.ubo_entity_name
                      ? `UBO: ${selectedAccountProfile.ubo_entity_name}`
                      : selectedAccountProfile.entity_name}
                  </div>
                  <div className="mono-num" style={{ fontSize: '0.72rem', color: '#444746', marginTop: 4 }}>
                    IBAN: {selectedAccountProfile.iban}
                  </div>
                </div>

                <div className="m3-card">
                  <div className="m3-section-label">Holding Institution (Bank Node)</div>
                  <div style={{ fontWeight: 700, fontSize: '0.86rem' }}>
                    {selectedAccountProfile.bank_name}
                  </div>
                  <div className="mono-num" style={{ fontSize: '0.74rem', color: '#444746', marginTop: 3 }}>
                    BIC / SWIFT: {selectedAccountProfile.bic_swift} ·{' '}
                    {selectedAccountProfile.bank_jurisdiction}
                  </div>
                </div>
              </div>
            ) : (
              <div className="m3-card">
                <p style={{ margin: 0, fontSize: '0.82rem', color: '#444746' }}>
                  Click any account node on the graph canvas to inspect its full KYC entity, beneficial
                  owner, and banking profile.
                </p>
              </div>
            )}
          </>
        )}

        {activeTab === 'sar' && (
          <>
            <div className="m3-card m3-card--tonal-primary">
              <div className="m3-section-label" style={{ color: '#0b57d0' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                  savings
                </span>
                Cost-Controlled AI Escalation
              </div>
              <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: '#041e49', lineHeight: 1.45 }}>
                Spanner Graph filters millions of transfers deterministically for $0 LLM cost. Invoke
                Gemini only for this single confirmed case.
              </p>
              <button
                type="button"
                className="m3-btn m3-btn--filled m3-btn--full"
                disabled={isGeneratingSar || !investigation}
                onClick={onDraftSingleTicketSar}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 17 }}>
                  auto_awesome
                </span>
                {isGeneratingSar
                  ? 'Drafting Grounded FinCEN SAR...'
                  : 'Draft FinCEN SAR (1 Ticket Only)'}
              </button>
            </div>

            {activeAlert && (
              <div className="m3-card m3-card--elevated">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 10,
                  }}
                >
                  <span
                    className={`m3-chip ${
                      activeAlert.citations_verified ? 'm3-chip--success' : 'm3-chip--warning'
                    }`}
                  >
                    {activeAlert.citations_verified ? 'Citations Verified' : 'Review Citations'}
                  </span>
                  <span className="mono-num" style={{ fontSize: '0.72rem', color: '#444746' }}>
                    {activeAlert.sar_generation_source}
                  </span>
                </div>

                <div
                  style={{
                    fontSize: '0.78rem',
                    lineHeight: 1.6,
                    color: '#1f1f1f',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {activeAlert.sar_narrative}
                </div>
              </div>
            )}

            <div className="m3-card">
              <div className="m3-section-label">Persisted Spanner ComplianceAlerts</div>
              {savedAlerts.length === 0 ? (
                <div style={{ fontSize: '0.76rem', color: '#444746' }}>
                  No alerts persisted yet. Draft a SAR above to write to Cloud Spanner.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {savedAlerts.slice(0, 4).map((alert) => (
                    <div
                      key={alert.alert_id}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 10,
                        background: '#ffffff',
                        border: '1px solid #d3dbe5',
                        fontSize: '0.74rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                        <span>{alert.typology}</span>
                        <span className="mono-num" style={{ color: '#b3261e' }}>
                          Risk {alert.risk_score}/100
                        </span>
                      </div>
                      <div className="mono-num" style={{ fontSize: '0.68rem', color: '#444746', marginTop: 2 }}>
                        Entity: {alert.subject_entity_id} · {alert.alert_status}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
