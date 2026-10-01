import { useState } from 'react';
import type {
  CaseSummary,
  InterceptionResult,
  TypologyCode,
} from '../types/aml';

const TYPOLOGY_OPTIONS: readonly { readonly id: TypologyCode; readonly label: string }[] = [
  { id: 'CIRCULAR_LAYERING', label: 'Circular Ring (3-10 Hops)' },
  { id: 'UBO_SHELL_RING', label: 'Hidden UBO Shell Ring' },
  { id: 'SAME_ENTITY_RING', label: 'Same-Entity Multi-Bank Ring' },
  { id: 'SCATTER_GATHER', label: 'Scatter-Gather (Split & Reconverge)' },
  { id: 'GATHER_SCATTER', label: 'Gather-Scatter (Hub & Spoke)' },
  { id: 'FAN_OUT', label: 'Fan-Out (Layering Dispersal)' },
  { id: 'FAN_IN', label: 'Fan-In (Smurfing Aggregation)' },
  { id: 'BIPARTITE', label: 'Bipartite (Relay Layer)' },
  { id: 'STACKED_BIPARTITE', label: 'Stacked Bipartite (Multi-Tier)' },
  { id: 'RANDOM_WALK', label: 'Random Walk (Multi-Hop Mule Chain)' },
];

interface InvestigationSidebarProps {
  readonly cases: readonly CaseSummary[];
  readonly selectedCaseId: string;
  readonly onSelectCase: (item: CaseSummary) => void;
  readonly simulatorOpen: boolean;
  readonly onCloseSimulator: () => void;
  readonly customTypology: TypologyCode;
  readonly onChangeCustomTypology: (t: TypologyCode) => void;
  readonly customAnchorId: string;
  readonly onChangeCustomAnchorId: (val: string) => void;
  readonly customMinAmount: string;
  readonly onChangeCustomMinAmount: (val: string) => void;
  readonly onRunCustomQuery: () => void;
  readonly isLoadingGraph: boolean;
  readonly interceptSender: string;
  readonly onChangeInterceptSender: (val: string) => void;
  readonly interceptReceiver: string;
  readonly onChangeInterceptReceiver: (val: string) => void;
  readonly interceptAmount: string;
  readonly onChangeInterceptAmount: (val: string) => void;
  readonly onSimulateIntercept: () => void;
  readonly isIntercepting: boolean;
  readonly interceptResult: InterceptionResult | null;
}

export function InvestigationSidebar({
  cases,
  selectedCaseId,
  onSelectCase,
  simulatorOpen,
  onCloseSimulator,
  customTypology,
  onChangeCustomTypology,
  customAnchorId,
  onChangeCustomAnchorId,
  customMinAmount,
  onChangeCustomMinAmount,
  onRunCustomQuery,
  isLoadingGraph,
  interceptSender,
  onChangeInterceptSender,
  interceptReceiver,
  onChangeInterceptReceiver,
  interceptAmount,
  onChangeInterceptAmount,
  onSimulateIntercept,
  isIntercepting,
  interceptResult,
}: InvestigationSidebarProps) {
  const [simTab, setSimTab] = useState<'gate' | 'gql'>('gate');

  return (
    <>
      <aside className="m3-nav-rail">
        <div className="m3-nav-rail__header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span
              style={{
                fontFamily: 'var(--md-sys-typescale-display-font)',
                fontSize: '0.88rem',
                fontWeight: 700,
                color: '#1f1f1f',
              }}
            >
              Flagged AML Cases
            </span>
            <span
              className="m3-chip m3-chip--primary"
              style={{ height: 24, padding: '0 9px', fontSize: '0.7rem' }}
            >
              {cases.length} Scenarios
            </span>
          </div>
          <div style={{ fontSize: '0.74rem', color: '#444746', marginTop: 4 }}>
            Select a pattern to traverse live on Cloud Spanner Graph
          </div>
        </div>

        <div className="m3-nav-rail__list">
          {cases.map((item) => {
            const isSelected = item.case_id === selectedCaseId;
            return (
              <button
                key={item.case_id}
                type="button"
                className={`m3-case-card ${isSelected ? 'm3-case-card--active' : ''}`}
                onClick={() => onSelectCase(item)}
              >
                <div className="m3-case-card__top">
                  <span className="m3-case-card__title">{item.title}</span>
                  <span
                    className="mono-num"
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      color: isSelected ? '#041e49' : '#0b57d0',
                      background: isSelected ? '#ffffff' : '#e8f0fe',
                      padding: '2px 7px',
                      borderRadius: 9999,
                    }}
                  >
                    #{item.account_id}
                  </span>
                </div>
                <div className="m3-case-card__subtitle">{item.summary}</div>
              </button>
            );
          })}
        </div>
      </aside>

      {simulatorOpen && (
        <div className="m3-dialog-backdrop" onClick={onCloseSimulator}>
          <div className="m3-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="m3-dialog__header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="material-symbols-outlined" style={{ color: '#0b57d0' }}>
                  science
                </span>
                <div>
                  <div
                    style={{
                      fontFamily: 'var(--md-sys-typescale-display-font)',
                      fontSize: '1rem',
                      fontWeight: 700,
                    }}
                  >
                    Live Spanner Graph Simulator
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#444746' }}>
                    Test synchronous pre-settlement wire blocking or run an ad-hoc GQL traversal
                  </div>
                </div>
              </div>
              <button type="button" className="m3-btn m3-btn--outlined" onClick={onCloseSimulator}>
                Close
              </button>
            </div>

            <div style={{ padding: '12px 24px 0', background: '#f3f6fc' }}>
              <div style={{ display: 'flex', gap: 8, paddingBottom: 12 }}>
                <button
                  type="button"
                  className={`m3-btn ${simTab === 'gate' ? 'm3-btn--filled' : 'm3-btn--outlined'}`}
                  onClick={() => setSimTab('gate')}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                    shield_lock
                  </span>
                  Pre-Settlement Payment Gate
                </button>
                <button
                  type="button"
                  className={`m3-btn ${simTab === 'gql' ? 'm3-btn--filled' : 'm3-btn--outlined'}`}
                  onClick={() => setSimTab('gql')}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                    terminal
                  </span>
                  Ad-Hoc GQL Runner
                </button>
              </div>
            </div>

            <div className="m3-dialog__body">
              {simTab === 'gate' ? (
                <div>
                  <p style={{ marginTop: 0, fontSize: '0.82rem', color: '#444746', lineHeight: 1.5 }}>
                    Because Cloud Spanner is an operational ACID database and a Property Graph in one
                    engine, it evaluates a multi-hop ring check <strong>inline</strong> before a wire
                    transfer settles.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <div className="m3-field">
                      <label className="m3-field__label" htmlFor="sim-sender">
                        Sender Account ID
                      </label>
                      <input
                        id="sim-sender"
                        className="m3-input mono-num"
                        value={interceptSender}
                        onChange={(e) => onChangeInterceptSender(e.target.value)}
                      />
                    </div>
                    <div className="m3-field">
                      <label className="m3-field__label" htmlFor="sim-receiver">
                        Beneficiary Account ID
                      </label>
                      <input
                        id="sim-receiver"
                        className="m3-input mono-num"
                        value={interceptReceiver}
                        onChange={(e) => onChangeInterceptReceiver(e.target.value)}
                      />
                    </div>
                    <div className="m3-field">
                      <label className="m3-field__label" htmlFor="sim-amount">
                        Wire Amount (USD)
                      </label>
                      <input
                        id="sim-amount"
                        className="m3-input mono-num"
                        value={interceptAmount}
                        onChange={(e) => onChangeInterceptAmount(e.target.value)}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="m3-btn m3-btn--filled"
                    disabled={isIntercepting}
                    onClick={onSimulateIntercept}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 17 }}>
                      bolt
                    </span>
                    {isIntercepting ? 'Evaluating on Spanner...' : 'Simulate Outbound Wire'}
                  </button>

                  {interceptResult && (
                    <div
                      className={`m3-card ${
                        interceptResult.decision === 'HELD' ||
                        interceptResult.decision === 'BLOCK_HOLD_COMPLIANCE'
                          ? 'm3-card--tonal-error'
                          : 'm3-card--tonal-success'
                      }`}
                      style={{ marginTop: 16 }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span
                          className={`m3-chip ${
                            interceptResult.decision === 'HELD' ||
                            interceptResult.decision === 'BLOCK_HOLD_COMPLIANCE'
                              ? 'm3-chip--error'
                              : 'm3-chip--success'
                          }`}
                        >
                          {interceptResult.decision}
                        </span>
                        <span className="mono-num" style={{ fontSize: '0.78rem', fontWeight: 600 }}>
                          Spanner Check: {interceptResult.latency_ms.toFixed(1)} ms
                        </span>
                      </div>
                      <p style={{ margin: '10px 0 0', fontSize: '0.82rem', lineHeight: 1.45 }}>
                        {interceptResult.matched_rings.length > 0
                          ? `Blocked: Closes a ${interceptResult.matched_rings[0].hop_count}-hop ${interceptResult.matched_rings[0].typology} ring.`
                          : 'Approved: No suspicious laundering cycle closed by this transfer.'}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <div className="m3-field">
                      <label className="m3-field__label" htmlFor="sim-pattern">
                        ISO GQL Pattern Detector
                      </label>
                      <select
                        id="sim-pattern"
                        className="m3-select"
                        value={customTypology}
                        onChange={(e) => onChangeCustomTypology(e.target.value as TypologyCode)}
                      >
                        {TYPOLOGY_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="m3-field">
                      <label className="m3-field__label" htmlFor="sim-anchor">
                        Anchor Account ID
                      </label>
                      <input
                        id="sim-anchor"
                        className="m3-input mono-num"
                        value={customAnchorId}
                        onChange={(e) => onChangeCustomAnchorId(e.target.value)}
                      />
                    </div>
                    <div className="m3-field">
                      <label className="m3-field__label" htmlFor="sim-min">
                        Min USD Threshold
                      </label>
                      <input
                        id="sim-min"
                        className="m3-input mono-num"
                        value={customMinAmount}
                        onChange={(e) => onChangeCustomMinAmount(e.target.value)}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="m3-btn m3-btn--filled"
                    disabled={isLoadingGraph}
                    onClick={() => {
                      onRunCustomQuery();
                      onCloseSimulator();
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 17 }}>
                      play_arrow
                    </span>
                    Execute GQL Traversal
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
