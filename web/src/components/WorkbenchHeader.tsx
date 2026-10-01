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
        <div className="m3-top-bar__title">
          Cloud Spanner Graph <span>• AML</span>
        </div>
      </div>

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
          3D Story
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
          3D Sandbox
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
          2D Inspector
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
              style={{ fontSize: 14 }}
            >
              fiber_manual_record
            </span>
            <span>
              Spanner Live
              {lastLatencyMs !== null ? ` • ${lastLatencyMs.toFixed(0)} ms` : ''}
            </span>
          </div>
        ) : (
          <div className="m3-status-pill">
            <span>Connecting...</span>
          </div>
        )}

        {viewMode === 'workbench2d' && (
          <button
            type="button"
            className="m3-btn m3-btn--tonal"
            onClick={onOpenSimulator}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
              science
            </span>
            Simulator
          </button>
        )}
      </div>
    </header>
  );
}
