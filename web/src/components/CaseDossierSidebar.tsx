import { useState } from 'react';
import { Button, Tag, Tile } from '@carbon/react';
import {
  Checkmark,
  Copy,
  DocumentSigned,
  Undo,
} from '@carbon/icons-react';
import type {
  AccountKycProfile,
  ComplianceAlert,
  EnrichedCaseInvestigation,
} from '../types/aml';

interface SarSection {
  readonly heading: string;
  readonly body: string;
}

function parseSarSections(markdown: string): readonly SarSection[] {
  const rawChunks = markdown
    .split(/^##\s+/m)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (rawChunks.length <= 1) {
    return [{ heading: 'FinCEN SAR Narrative', body: markdown.trim() }];
  }

  return rawChunks.map((chunk) => {
    const newlineIdx = chunk.indexOf('\n');
    if (newlineIdx === -1) {
      return { heading: chunk, body: '' };
    }
    return {
      heading: chunk.slice(0, newlineIdx).trim(),
      body: chunk.slice(newlineIdx + 1).trim(),
    };
  });
}

type Props = {
  readonly investigation: EnrichedCaseInvestigation | null;
  readonly selectedAccountProfile: AccountKycProfile | null;
  readonly isGeneratingSar: boolean;
  readonly activeAlert: ComplianceAlert | null;
  readonly savedAlerts: readonly ComplianceAlert[];
  readonly onDraftSingleTicketSar: () => void;
  readonly onSelectAlert: (alert: ComplianceAlert | null) => void;
};

export function CaseDossierSidebar({
  investigation,
  selectedAccountProfile,
  isGeneratingSar,
  activeAlert,
  savedAlerts,
  onDraftSingleTicketSar,
  onSelectAlert,
}: Props) {
  const [copiedAlertId, setCopiedAlertId] = useState<string | null>(null);

  if (!investigation) {
    return <aside className="right-dossier" aria-label="Case Dossier" />;
  }

  const riskLevel = investigation.risk_assessment.risk_level;
  const riskTagType =
    riskLevel === 'CRITICAL'
      ? 'red'
      : riskLevel === 'HIGH'
      ? 'magenta'
      : riskLevel === 'MEDIUM'
      ? 'warm-gray'
      : 'green';

  const sarSections = activeAlert
    ? parseSarSections(activeAlert.sar_narrative)
    : [];

  const handleCopySar = async () => {
    if (!activeAlert) {
      return;
    }
    try {
      await navigator.clipboard.writeText(activeAlert.sar_narrative);
      setCopiedAlertId(activeAlert.alert_id);
      setTimeout(() => setCopiedAlertId(null), 2000);
    } catch {
      // Ignore clipboard permission errors in restricted contexts
    }
  };

  return (
    <aside className="right-dossier" aria-label="Case Dossier">
      <Tile className="dossier-tile">
        <div className="dossier-section-header">
          <span className="dossier-eyebrow">Deterministic Graph Risk Score</span>
          <Tag type={riskTagType} size="md">
            <span className="tabular-nums">
              {riskLevel} ({investigation.risk_assessment.risk_score.toFixed(2)})
            </span>
          </Tag>
        </div>

        <div className="dossier-case-heading">
          {investigation.case_id} • {investigation.evidence.typology}
        </div>

        <ul className="risk-reason-list">
          {investigation.risk_assessment.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>

        <Button
          kind="primary"
          size="md"
          renderIcon={DocumentSigned}
          onClick={onDraftSingleTicketSar}
          disabled={isGeneratingSar}
          style={{ width: '100%', maxWidth: 'none' }}
        >
          {isGeneratingSar
            ? 'Drafting Grounded FinCEN SAR (1 Ticket)...'
            : 'Draft FinCEN SAR (1 Ticket Only)'}
        </Button>
        <div className="case-card-summary" style={{ marginTop: 6 }}>
          Invokes Vertex AI Gemini 2.5 Flash strictly for this single case and
          verifies 100% of cited Transaction &amp; Account IDs against the
          Spanner Graph subgraph.
        </div>
      </Tile>

      {selectedAccountProfile && (
        <Tile className="dossier-tile">
          <div className="dossier-section-header">
            <span className="dossier-eyebrow">
              Selected Account KYC / UBO Profile
            </span>
            <span
              className="tabular-nums"
              style={{ fontSize: 12, color: '#78a9ff', fontWeight: 600 }}
            >
              {selectedAccountProfile.account_id}
            </span>
          </div>
          <div className="kyc-grid">
            <div>
              <span className="kyc-label">Owner Entity</span>
              {selectedAccountProfile.entity_name} (
              <span className="tabular-nums">
                {selectedAccountProfile.entity_id}
              </span>
              )
            </div>
            <div>
              <span className="kyc-label">Jurisdiction</span>
              {selectedAccountProfile.entity_jurisdiction}
            </div>
            <div>
              <span className="kyc-label">Custodian Bank</span>
              {selectedAccountProfile.bank_name} (
              <span className="tabular-nums">
                {selectedAccountProfile.bank_id}
              </span>
              )
            </div>
            <div>
              <span className="kyc-label">KYC Risk Tier</span>
              {selectedAccountProfile.kyc_risk_tier}
            </div>
          </div>
          {selectedAccountProfile.ubo_entity_id && (
            <div className="kyc-ubo-banner">
              <span style={{ color: '#ffb784', fontWeight: 600 }}>
                Beneficial Owner (CONTROLS):{' '}
              </span>
              {selectedAccountProfile.ubo_entity_name} (
              <span className="tabular-nums">
                {selectedAccountProfile.ubo_entity_id}
              </span>
              )
            </div>
          )}
        </Tile>
      )}

      {activeAlert ? (
        <Tile className="dossier-tile">
          <div className="dossier-section-header">
            <span className="dossier-eyebrow">
              FinCEN SAR Filing ({activeAlert.alert_id})
            </span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <Tag
                type={activeAlert.citations_verified ? 'green' : 'red'}
                size="sm"
              >
                {activeAlert.citations_verified
                  ? '100% Citations Verified'
                  : 'Citation Mismatch'}
              </Tag>
              <Tag type="cyan" size="sm">
                {activeAlert.sar_generation_source}
              </Tag>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 8,
              marginBottom: 8,
            }}
          >
            <Button
              kind="ghost"
              size="sm"
              renderIcon={
                copiedAlertId === activeAlert.alert_id ? Checkmark : Copy
              }
              onClick={handleCopySar}
            >
              {copiedAlertId === activeAlert.alert_id
                ? 'Copied SAR Markdown'
                : 'Copy SAR Narrative'}
            </Button>
            {savedAlerts.length > 0 && (
              <Button
                kind="ghost"
                size="sm"
                renderIcon={Undo}
                onClick={() => onSelectAlert(null)}
              >
                All Filings ({savedAlerts.length})
              </Button>
            )}
          </div>

          <div className="sar-sections-stack">
            {sarSections.map((sec) => (
              <div key={sec.heading} className="sar-section-card">
                <div className="sar-section-title">{sec.heading}</div>
                <div className="sar-section-body">{sec.body}</div>
              </div>
            ))}
          </div>
        </Tile>
      ) : (
        <Tile className="dossier-tile">
          <div className="dossier-section-header">
            <span className="dossier-eyebrow">
              Persisted Spanner ComplianceAlerts ({savedAlerts.length})
            </span>
          </div>
          {savedAlerts.length === 0 ? (
            <div className="case-card-summary">
              No SARs filed yet in this session. Click{' '}
              <strong>&ldquo;Draft FinCEN SAR (1 Ticket Only)&rdquo;</strong>{' '}
              above to generate and persist a grounded SAR narrative to Cloud
              Spanner.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {savedAlerts.slice(0, 5).map((a) => (
                <div
                  key={a.alert_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectAlert(a)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectAlert(a);
                    }
                  }}
                  className="saved-alert-item"
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span
                      className="tabular-nums"
                      style={{ fontWeight: 600 }}
                    >
                      {a.alert_id}
                    </span>
                    <Tag type="red" size="sm">
                      <span className="tabular-nums">
                        Risk {a.risk_score.toFixed(2)}
                      </span>
                    </Tag>
                  </div>
                  <div
                    className="case-card-summary"
                    style={{ marginTop: 2 }}
                  >
                    {a.typology} • Trigger Tx{' '}
                    <span className="tabular-nums">
                      {a.trigger_transaction_id}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Tile>
      )}
    </aside>
  );
}
