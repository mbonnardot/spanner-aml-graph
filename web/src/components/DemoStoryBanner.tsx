import type { DemoGuide, EnrichedCaseInvestigation } from '../types/aml';

interface DemoStoryBannerProps {
  readonly guide: DemoGuide | undefined;
  readonly investigation: EnrichedCaseInvestigation | null;
  readonly totalVolumeUsd: number;
  readonly showGqlModal: boolean;
  readonly onToggleGqlModal: () => void;
}

export function DemoStoryBanner({
  guide,
  investigation,
  totalVolumeUsd,
  showGqlModal,
  onToggleGqlModal,
}: DemoStoryBannerProps) {
  if (!guide || !investigation) {
    return null;
  }

  return (
    <>
      <div className="m3-story-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <span className="m3-chip m3-chip--primary">{guide.nickname}</span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: 'var(--md-sys-typescale-display-font)',
                fontSize: '0.92rem',
                fontWeight: 700,
                color: '#1f1f1f',
              }}
            >
              {investigation.evidence.typology.replace(/_/g, ' ')} — Anchor{' '}
              <span className="mono-num" style={{ color: '#0b57d0' }}>
                #{investigation.evidence.account_ids[0] ?? 'SCAN'}
              </span>
            </div>
            <div
              style={{
                fontSize: '0.78rem',
                color: '#444746',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={guide.plain_english}
            >
              {guide.plain_english}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span className="m3-chip m3-chip--tonal mono-num">
            ${totalVolumeUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </span>
          <span className="m3-chip m3-chip--error mono-num">
            Risk {investigation.risk_assessment.risk_score}/100
          </span>
        </div>
      </div>

      {showGqlModal && (
        <div className="m3-dialog-backdrop" onClick={onToggleGqlModal}>
          <div className="m3-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="m3-dialog__header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="material-symbols-outlined" style={{ color: '#0b57d0' }}>
                  code
                </span>
                <div>
                  <div
                    style={{
                      fontFamily: 'var(--md-sys-typescale-display-font)',
                      fontSize: '1rem',
                      fontWeight: 700,
                    }}
                  >
                    Parameterized ISO GQL Query ({investigation.evidence.typology})
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#444746' }}>
                    Executed directly on Cloud Spanner Graph (`AmlGraph`) with zero data movement
                  </div>
                </div>
              </div>
              <button type="button" className="m3-btn m3-btn--outlined" onClick={onToggleGqlModal}>
                Close
              </button>
            </div>
            <div className="m3-dialog__body">
              <pre
                className="mono-num"
                style={{
                  margin: 0,
                  padding: 16,
                  borderRadius: 12,
                  background: '#0f172a',
                  color: '#e2e8f0',
                  fontSize: '0.8rem',
                  lineHeight: 1.55,
                  overflowX: 'auto',
                }}
              >
                {guide.gql_query}
              </pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
