import type { HealthResponse } from '../types/aml';

interface WorkbenchHeaderProps {
  readonly health: HealthResponse | null;
  readonly lastLatencyMs: number | null;
  readonly onOpenSimulator: () => void;
}

export function WorkbenchHeader({
  health,
  lastLatencyMs,
  onOpenSimulator,
}: WorkbenchHeaderProps) {
  return (
    <header className="m3-top-bar">
      <div className="m3-brand">
        <div className="m3-brand__logo">
          <span className="material-symbols-outlined">hub</span>
        </div>
        <div>
          <div className="m3-brand__title">Cloud Spanner Graph · AML Compliance Workbench</div>
          <div className="m3-brand__subtitle">
            Deterministic ISO GQL Multi-Hop Detection + On-Demand Gemini SAR
          </div>
        </div>
      </div>

      <div className="m3-top-bar__actions">
        <span
          className="m3-chip m3-chip--success"
          title="Detection runs 100% in Spanner Graph GQL at $0 LLM cost"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            verified
          </span>
          Detection: $0 LLM Cost
        </span>

        {lastLatencyMs !== null && (
          <span className="m3-chip m3-chip--primary mono-num">
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              bolt
            </span>
            GQL {lastLatencyMs.toFixed(1)} ms
          </span>
        )}

        <span className="m3-chip m3-chip--tonal mono-num">
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#146c2e' }}>
            cloud_done
          </span>
          {health
            ? `${health.accounts_count.toLocaleString()} Acc · ${health.transactions_count.toLocaleString()} Tx`
            : 'Spanner Live'}
        </span>

        <button type="button" className="m3-btn m3-btn--outlined" onClick={onOpenSimulator}>
          <span className="material-symbols-outlined" style={{ fontSize: 17 }}>
            science
          </span>
          Live Simulator
        </button>
      </div>
    </header>
  );
}
