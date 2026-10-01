import type { HealthResponse, ViewMode } from '../types/aml';

interface WorkbenchHeaderProps {
  readonly health: HealthResponse | null;
  readonly lastLatencyMs: number | null;
  readonly viewMode: ViewMode;
  readonly onChangeViewMode: (mode: ViewMode) => void;
  readonly onOpenSimulator: () => void;
}

export function WorkbenchHeader({
  health,
  lastLatencyMs,
  viewMode,
  onChangeViewMode,
  onOpenSimulator,
}: WorkbenchHeaderProps) {
  return (
    <header className="m3-top-bar">
      <div className="m3-top-bar__brand">
        <div className="m3-top-bar__logo" aria-hidden="true">
          <span className="material-symbols-outlined">hub</span>
        </div>
        <div>
          <div className="m3-top-bar__title">
            Google Cloud Spanner Graph{' '}
            <span>• AML Investigation Workbench</span>
          </div>
          <div className="m3-top-bar__subtitle">
            Real-Time ISO GQL Pattern Matching & Single-Ticket Vertex AI Gemini
            SAR
          </div>
        </div>
      </div>

      {/* M3 Segmented View Mode Switcher */}
      <div className="m3-segmented-group" role="tablist" aria-label="View Mode">
        <button
          type="button"
          className={`m3-segmented-btn ${
            viewMode === 'story3d' ? 'm3-segmented-btn--active' : ''
          }`}
          onClick={() => onChangeViewMode('story3d')}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            auto_awesome_motion
          </span>
          3D Story Scroll
        </button>
        <button
          type="button"
          className={`m3-segmented-btn ${
            viewMode === 'free3d' ? 'm3-segmented-btn--active' : ''
          }`}
          onClick={() => onChangeViewMode('free3d')}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            3d_rotation
          </span>
          3D Free Orbit
        </button>
        <button
          type="button"
          className={`m3-segmented-btn ${
            viewMode === 'workbench2d' ? 'm3-segmented-btn--active' : ''
          }`}
          onClick={() => onChangeViewMode('workbench2d')}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            schema
          </span>
          2D Workbench
        </button>
      </div>

      <div className="m3-top-bar__actions">
        {health ? (
          <div
            className="m3-status-pill m3-status-pill--connected"
            title="Connected to live Cloud Spanner instance"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              check_circle
            </span>
            <span>
              Spanner Live ({health.accounts_count.toLocaleString()} accts •{' '}
              {health.transactions_count.toLocaleString()} txs)
            </span>
          </div>
        ) : (
          <div className="m3-status-pill">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              sync
            </span>
            <span>Connecting...</span>
          </div>
        )}

        {lastLatencyMs !== null && (
          <div
            className="m3-status-pill m3-status-pill--latency"
            title="Last Spanner ISO GQL traversal latency"
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 16 }}
            >
              bolt
            </span>
            <span>GQL {lastLatencyMs.toFixed(0)} ms</span>
          </div>
        )}

        <button
          type="button"
          className="m3-btn m3-btn--tonal"
          onClick={onOpenSimulator}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            science
          </span>
          Live Simulator
        </button>
      </div>
    </header>
  );
}
