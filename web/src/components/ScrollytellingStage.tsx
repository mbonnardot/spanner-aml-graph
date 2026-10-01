import { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { TransactionUniverse3D } from './TransactionUniverse3D';
import type {
  AccountKycProfile,
  CaseSummary,
  ComplianceAlert,
  EnrichedCaseInvestigation,
  GraphUniverseResponse,
  HealthResponse,
  InterceptionResult,
} from '../types/aml';

gsap.registerPlugin(ScrollTrigger);

interface ScrollytellingStageProps {
  readonly health: HealthResponse | null;
  readonly universe: GraphUniverseResponse | null;
  readonly cases: readonly CaseSummary[];
  readonly selectedCaseId: string;
  readonly onSelectCase: (item: CaseSummary) => void;
  readonly investigation: EnrichedCaseInvestigation | null;
  readonly isLoadingGraph: boolean;
  readonly totalVolumeUsd: number;
  readonly showOwnershipOverlay: boolean;
  readonly onToggleOwnershipOverlay: () => void;
  readonly showBankOverlay: boolean;
  readonly onToggleBankOverlay: () => void;
  readonly selectedNodeId: string | null;
  readonly onSelectNodeId: (id: string) => void;
  readonly selectedAccountProfile: AccountKycProfile | null;
  readonly interceptSender: string;
  readonly onChangeInterceptSender: (v: string) => void;
  readonly interceptReceiver: string;
  readonly onChangeInterceptReceiver: (v: string) => void;
  readonly interceptAmount: string;
  readonly onChangeInterceptAmount: (v: string) => void;
  readonly onSimulateIntercept: () => void;
  readonly isIntercepting: boolean;
  readonly interceptResult: InterceptionResult | null;
  readonly onDraftSingleTicketSar: () => void;
  readonly isGeneratingSar: boolean;
  readonly activeAlert: ComplianceAlert | null;
  readonly freeOrbitOnly?: boolean;
}

const DEMO_SCENARIO_LABELS: Readonly<
  Record<string, { readonly badge: string; readonly title: string }>
> = {
  CASE_HI_CYCLE_10HOP: {
    badge: '10-Hop Cycle',
    title: 'Washing Machine Loop',
  },
  CASE_SEED_CYCLE_3HOP: {
    badge: '3-Hop Offshore',
    title: 'Cayman-BVI Shell Ring',
  },
  CASE_SEED_UBO_SHELL: {
    badge: 'UBO Network',
    title: 'Hidden Puppet Master',
  },
  CASE_HI_SCATTER_GATHER: {
    badge: '16 Mules',
    title: 'Smurfing Diamond',
  },
  CASE_HI_RANDOM_WALK_8HOP: {
    badge: '8-Hop Trail',
    title: 'Zig-Zag Escape Trail',
  },
};

const CHAPTERS = [
  { id: 1 as const, label: '01 • Nebula', icon: 'blur_on' },
  { id: 2 as const, label: '02 • Isolate Ring', icon: 'filter_center_focus' },
  { id: 3 as const, label: '03 • Hop Fly-Through', icon: 'flight_takeoff' },
  { id: 4 as const, label: '04 • UBO & Banks', icon: 'account_tree' },
  { id: 5 as const, label: '05 • Intercept & SAR', icon: 'shield_lock' },
];

export function ScrollytellingStage({
  health,
  universe,
  cases,
  selectedCaseId,
  onSelectCase,
  investigation,
  isLoadingGraph,
  totalVolumeUsd,
  showOwnershipOverlay,
  onToggleOwnershipOverlay,
  showBankOverlay,
  onToggleBankOverlay,
  selectedNodeId,
  onSelectNodeId,
  selectedAccountProfile,
  interceptSender,
  onChangeInterceptSender,
  interceptReceiver,
  onChangeInterceptReceiver,
  interceptAmount,
  onChangeInterceptAmount,
  onSimulateIntercept,
  isIntercepting,
  interceptResult,
  onDraftSingleTicketSar,
  isGeneratingSar,
  activeAlert,
  freeOrbitOnly = false,
}: ScrollytellingStageProps) {
  const [activeChapter, setActiveChapter] = useState<1 | 2 | 3 | 4 | 5>(
    freeOrbitOnly ? 2 : 1
  );
  const [activeHopIndex, setActiveHopIndex] = useState<number>(0);

  const scrollProgressRef = useRef<number>(freeOrbitOnly ? 0.28 : 0);
  const lenisRef = useRef<Lenis | null>(null);
  const chapterRefs = useRef<(HTMLElement | null)[]>([]);
  const manualHopLockUntilRef = useRef<number>(0);

  const hops = investigation?.evidence.hops ?? [];
  const hopCount = hops.length;

  useEffect(() => {
    setActiveHopIndex(0);
  }, [investigation?.case_id]);

  // Synchronize window scroll -> scrollProgressRef (0..1), activeChapter, and Chapter 3 hop index
  const syncScroll = useCallback(() => {
    if (freeOrbitOnly) {
      scrollProgressRef.current = 0.28;
      return;
    }
    const docEl = document.documentElement;
    const maxScroll = Math.max(1, docEl.scrollHeight - window.innerHeight);
    const progress = Math.max(0, Math.min(1, window.scrollY / maxScroll));
    scrollProgressRef.current = progress;

    let nextChapter: 1 | 2 | 3 | 4 | 5 = 1;
    if (progress < 0.14) {
      nextChapter = 1;
    } else if (progress < 0.38) {
      nextChapter = 2;
    } else if (progress < 0.65) {
      nextChapter = 3;
      if (hopCount > 0 && Date.now() > manualHopLockUntilRef.current) {
        const hopProgress = (progress - 0.38) / (0.65 - 0.38);
        const computedHop = Math.min(
          hopCount - 1,
          Math.max(0, Math.floor(hopProgress * hopCount))
        );
        setActiveHopIndex(computedHop);
      }
    } else if (progress < 0.84) {
      nextChapter = 4;
    } else {
      nextChapter = 5;
    }

    setActiveChapter((prev) => (prev === nextChapter ? prev : nextChapter));
  }, [freeOrbitOnly, hopCount]);

  useEffect(() => {
    if (freeOrbitOnly) {
      scrollProgressRef.current = 0.28;
      setActiveChapter(2);
      return;
    }

    const lenis = new Lenis({
      duration: 1.08,
      smoothWheel: true,
      wheelMultiplier: 0.95,
    });
    lenisRef.current = lenis;

    lenis.on('scroll', () => {
      syncScroll();
      ScrollTrigger.update();
    });
    window.addEventListener('scroll', syncScroll, { passive: true });
    syncScroll();

    const tickerCallback = (time: number) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(tickerCallback);
    gsap.ticker.lagSmoothing(0);

    return () => {
      window.removeEventListener('scroll', syncScroll);
      gsap.ticker.remove(tickerCallback);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [freeOrbitOnly, syncScroll]);

  const scrollToChapter = (chapterNum: 1 | 2 | 3 | 4 | 5) => {
    setActiveChapter(chapterNum);
    const targetElem = chapterRefs.current[chapterNum - 1];
    if (targetElem && lenisRef.current) {
      lenisRef.current.scrollTo(targetElem, { offset: -72, duration: 1.25 });
    } else if (targetElem) {
      targetElem.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleManualSelectHop = (idx: number) => {
    manualHopLockUntilRef.current = Date.now() + 3500;
    setActiveHopIndex(idx);
  };

  const curatedCases = cases.filter((c) => c.case_id in DEMO_SCENARIO_LABELS);
  const currentHop = hops[activeHopIndex] ?? hops[0];

  if (freeOrbitOnly) {
    return (
      <div className="m3-free-orbit-wrapper">
        <TransactionUniverse3D
          universe={universe}
          investigation={investigation}
          scrollProgressRef={scrollProgressRef}
          activeChapter={activeChapter}
          activeHopIndex={activeHopIndex}
          showOwnershipOverlay={showOwnershipOverlay}
          showBankOverlay={showBankOverlay}
          selectedNodeId={selectedNodeId}
          onSelectNodeId={onSelectNodeId}
          interceptResult={interceptResult}
          interactiveOrbit
        />
        <div className="m3-free-orbit-hud">
          <div className="m3-free-orbit-hud__row">
            {CHAPTERS.map((ch) => (
              <button
                key={ch.id}
                type="button"
                className={`m3-filter-chip ${
                  activeChapter === ch.id ? 'm3-filter-chip--active' : ''
                }`}
                onClick={() => {
                  scrollProgressRef.current = ch.id === 1 ? 0 : 0.35;
                  setActiveChapter(ch.id);
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16 }}
                >
                  {ch.icon}
                </span>
                {ch.label}
              </button>
            ))}
            <button
              type="button"
              className={`m3-filter-chip ${
                showOwnershipOverlay ? 'm3-filter-chip--active' : ''
              }`}
              onClick={onToggleOwnershipOverlay}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                person_search
              </span>
              UBO Layer
            </button>
            <button
              type="button"
              className={`m3-filter-chip ${
                showBankOverlay ? 'm3-filter-chip--active' : ''
              }`}
              onClick={onToggleBankOverlay}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 16 }}
              >
                account_balance
              </span>
              Bank Layer
            </button>
          </div>
          <div className="m3-free-orbit-hud__hint">
            Drag anywhere in 3D space to orbit • Scroll wheel to zoom • Click any
            node badge to inspect
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="m3-scrolly-root">
      {/* Sticky Full-Screen 3D WebGL Transaction Universe */}
      <TransactionUniverse3D
        universe={universe}
        investigation={investigation}
        scrollProgressRef={scrollProgressRef}
        activeChapter={activeChapter}
        activeHopIndex={activeHopIndex}
        showOwnershipOverlay={showOwnershipOverlay}
        showBankOverlay={showBankOverlay}
        selectedNodeId={selectedNodeId}
        onSelectNodeId={onSelectNodeId}
        interceptResult={interceptResult}
        interactiveOrbit={false}
      />

      {/* Sticky Top Scenario & Chapter Progress HUD */}
      <div className="m3-scrolly-hud">
        <div className="m3-scrolly-hud__chapters">
          {CHAPTERS.map((ch) => (
            <button
              key={ch.id}
              type="button"
              className={`m3-chapter-pill ${
                activeChapter === ch.id ? 'm3-chapter-pill--active' : ''
              }`}
              onClick={() => scrollToChapter(ch.id)}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 14 }}
              >
                {ch.icon}
              </span>
              <span>{ch.label}</span>
            </button>
          ))}
        </div>

        <div className="m3-scrolly-hud__scenarios">
          <span className="m3-scrolly-hud__label">Pattern:</span>
          {curatedCases.map((c) => {
            const meta = DEMO_SCENARIO_LABELS[c.case_id];
            const isSelected = c.case_id === selectedCaseId;
            return (
              <button
                key={c.case_id}
                type="button"
                className={`m3-scenario-chip ${
                  isSelected ? 'm3-scenario-chip--active' : ''
                }`}
                onClick={() => onSelectCase(c)}
              >
                <strong>{meta?.title ?? c.title}</strong>
                <span>{meta?.badge}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Parallax Scroll Track with 5 Narrative Chapters */}
      <div className="m3-scrolly-track">
        {/* CHAPTER 01: CENTERED SPATIAL HERO OVER THE 3,267-TRANSACTION NEBULA */}
        <section
          ref={(el) => {
            chapterRefs.current[0] = el;
          }}
          className="m3-scrolly-section m3-scrolly-section--hero"
        >
          <div className="m3-hero-overlay">
            <div className="m3-scrolly-eyebrow">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 15 }}
              >
                blur_on
              </span>
              CLOUD SPANNER PROPERTY GRAPH • REAL-TIME AML ENGINE
            </div>

            <h1 className="m3-hero-headline">
              Find the laundering ring hidden in{' '}
              <span>
                {(health?.transactions_count ?? 3267).toLocaleString()} live wire
                transfers.
              </span>
            </h1>

            <p className="m3-hero-subheadline">
              Orbiting in 3D space are{' '}
              <strong>
                {(health?.accounts_count ?? 761).toLocaleString()} bank accounts
              </strong>{' '}
              across{' '}
              <strong>
                {(health?.banks_count ?? 473).toLocaleString()} institutions
              </strong>
              . Scroll down—or trigger Spanner GQL below—to watch the benign
              cloud part and the hidden laundering ring converge in sub-second
              time.
            </p>

            <div className="m3-hero-cta-row">
              <button
                type="button"
                className="m3-btn m3-btn--filled m3-btn--hero"
                onClick={() => scrollToChapter(2)}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 20 }}
                >
                  bolt
                </span>
                {isLoadingGraph
                  ? 'Running Spanner GQL...'
                  : 'Run Spanner GQL & Isolate Ring'}
              </button>

              <button
                type="button"
                className="m3-btn m3-btn--outlined"
                onClick={() => scrollToChapter(2)}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 18 }}
                >
                  south
                </span>
                Scroll to Zoom & Isolate
              </button>
            </div>
          </div>
        </section>

        {/* CHAPTER 02: SUB-SECOND ISO GQL ISOLATION */}
        <section
          ref={(el) => {
            chapterRefs.current[1] = el;
          }}
          className="m3-scrolly-section"
        >
          <div className="m3-scrolly-card">
            <div className="m3-scrolly-eyebrow">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 15 }}
              >
                filter_center_focus
              </span>
              02 • SUB-SECOND ISO GQL ISOLATION
            </div>
            <h2 className="m3-scrolly-h2">
              {investigation?.demo_guide?.nickname ??
                'Isolated Laundering Ring'}
            </h2>
            <p className="m3-scrolly-body">
              {investigation?.demo_guide?.plain_english ??
                'Cloud Spanner Graph filters out 99.7% of benign background noise in a single pass, pulling the offending accounts out of the nebula into a locked 3D ring.'}
            </p>

            {investigation && (
              <div className="m3-scrolly-metrics">
                <div className="m3-scrolly-metric m3-scrolly-metric--blue">
                  <span>GQL Latency</span>
                  <strong>
                    {investigation.evidence.query_latency_ms.toFixed(0)} ms
                  </strong>
                </div>
                <div className="m3-scrolly-metric">
                  <span>Ring Depth</span>
                  <strong>{investigation.evidence.hop_count} Hops</strong>
                </div>
                <div className="m3-scrolly-metric">
                  <span>Total Volume</span>
                  <strong>
                    $
                    {totalVolumeUsd.toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </strong>
                </div>
                <div className="m3-scrolly-metric m3-scrolly-metric--danger">
                  <span>Risk Score</span>
                  <strong>
                    {investigation.risk_assessment.risk_level} (
                    {(investigation.risk_assessment.risk_score * 100).toFixed(0)}
                    %)
                  </strong>
                </div>
              </div>
            )}

            <div className="m3-tonal-Callout">
              <strong>Why Spanner Graph Wins:</strong>{' '}
              {investigation?.demo_guide?.why_spanner_wins}
            </div>

            {investigation?.demo_guide?.gql_query && (
              <div style={{ marginTop: 14 }}>
                <div className="m3-code-caption">
                  Live Parameterized ISO GQL Executed on Cloud Spanner
                </div>
                <pre className="m3-code-block" style={{ maxHeight: 175 }}>
                  {investigation.demo_guide.gql_query}
                </pre>
              </div>
            )}

            <div className="m3-scrolly-actions" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="m3-btn m3-btn--tonal"
                onClick={() => scrollToChapter(3)}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 18 }}
                >
                  flight_takeoff
                </span>
                Trace Every Hop in 3D
              </button>
            </div>
          </div>
        </section>

        {/* CHAPTER 03: 3D HOP-BY-HOP FLY-THROUGH */}
        <section
          ref={(el) => {
            chapterRefs.current[2] = el;
          }}
          className="m3-scrolly-section m3-scrolly-section--tall"
        >
          <div className="m3-scrolly-card">
            <div className="m3-scrolly-eyebrow">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 15 }}
              >
                flight_takeoff
              </span>
              03 • CHRONOLOGICAL 3D HOP FLY-THROUGH
            </div>
            <h2 className="m3-scrolly-h2">
              Tracing Hop #{activeHopIndex + 1} of {Math.max(hopCount, 1)}
            </h2>
            <p className="m3-scrolly-body">
              Scroll or step through each hop—the 3D camera locks onto the active
              wire transfer arc while Spanner enforces{' '}
              <code>e[i].event_timestamp &lt;= e[i+1].event_timestamp</code>.
            </p>

            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <button
                type="button"
                className="m3-btn m3-btn--outlined"
                style={{ padding: '7px 14px', fontSize: '0.76rem' }}
                disabled={activeHopIndex <= 0}
                onClick={() =>
                  handleManualSelectHop(Math.max(0, activeHopIndex - 1))
                }
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16 }}
                >
                  chevron_left
                </span>
                Prev Hop
              </button>
              <button
                type="button"
                className="m3-btn m3-btn--filled"
                style={{ padding: '7px 16px', fontSize: '0.76rem' }}
                onClick={() =>
                  handleManualSelectHop(
                    hopCount > 0 ? (activeHopIndex + 1) % hopCount : 0
                  )
                }
              >
                Next Hop in 3D
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16 }}
                >
                  chevron_right
                </span>
              </button>
            </div>

            <div className="m3-hop-pill-grid">
              {hops.map((hop, idx) => (
                <button
                  key={hop.transaction_id}
                  type="button"
                  className={`m3-hop-pill ${
                    idx === activeHopIndex ? 'm3-hop-pill--active' : ''
                  }`}
                  onClick={() => handleManualSelectHop(idx)}
                >
                  <span>#{hop.hop_index}</span>
                  <strong>
                    $
                    {hop.amount_paid.toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </strong>
                </button>
              ))}
            </div>

            {currentHop && (
              <div className="m3-hop-spotlight-card">
                <div className="m3-hop-spotlight-card__header">
                  <span className="m3-badge m3-badge--amber">
                    ACTIVE WIRE • HOP #{currentHop.hop_index}
                  </span>
                  <span className="m3-mono-muted">
                    TX: {currentHop.transaction_id}
                  </span>
                </div>

                <div className="m3-hop-spotlight-card__amount">
                  $
                  {currentHop.amount_paid.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  <span>
                    {currentHop.currency} • {currentHop.payment_format}
                  </span>
                </div>

                <div className="m3-hop-spotlight-card__route">
                  <div>
                    <small>ORIGINATOR</small>
                    <strong>
                      {investigation?.kyc_profiles[currentHop.from_account_id]
                        ?.entity_name ?? currentHop.from_account_id}
                    </strong>
                    <code>{currentHop.from_account_id}</code>
                  </div>
                  <span
                    className="material-symbols-outlined"
                    style={{ color: '#38bdf8', fontSize: 22 }}
                  >
                    trending_flat
                  </span>
                  <div>
                    <small>BENEFICIARY</small>
                    <strong>
                      {investigation?.kyc_profiles[currentHop.to_account_id]
                        ?.entity_name ?? currentHop.to_account_id}
                    </strong>
                    <code>{currentHop.to_account_id}</code>
                  </div>
                </div>

                <div className="m3-mono-muted" style={{ marginTop: 10 }}>
                  Settled:{' '}
                  {currentHop.event_timestamp
                    .replace('T', ' ')
                    .replace('+00:00', ' UTC')}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* CHAPTER 04: UNMASKING THE HIDDEN PUPPET MASTER (UBO & BANKS) */}
        <section
          ref={(el) => {
            chapterRefs.current[3] = el;
          }}
          className="m3-scrolly-section"
        >
          <div className="m3-scrolly-card">
            <div className="m3-scrolly-eyebrow">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 15 }}
              >
                account_tree
              </span>
              04 • MULTI-LAYER 3D OWNERSHIP & BANKING TOPOLOGY
            </div>
            <h2 className="m3-scrolly-h2">
              Unmasking the Hidden Beneficial Owner (UBO)
            </h2>
            <p className="m3-scrolly-body">
              Look above and below the payment ring: Spanner Graph traverses{' '}
              <code>:CONTROLS</code> and <code>:OWNS</code> corporate ownership
              edges (violet octahedrons above) and <code>:HELD_AT</code> banking
              edges (cyan nodes below) in the exact same query.
            </p>

            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                marginBottom: 14,
              }}
            >
              <button
                type="button"
                className={`m3-filter-chip ${
                  showOwnershipOverlay ? 'm3-filter-chip--active' : ''
                }`}
                onClick={onToggleOwnershipOverlay}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16 }}
                >
                  person_search
                </span>
                Pin UBO Layer
              </button>
              <button
                type="button"
                className={`m3-filter-chip ${
                  showBankOverlay ? 'm3-filter-chip--active' : ''
                }`}
                onClick={onToggleBankOverlay}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16 }}
                >
                  account_balance
                </span>
                Pin Bank Layer
              </button>
            </div>

            {selectedAccountProfile && (
              <div className="m3-card" style={{ padding: 14 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  <span className="m3-code-caption" style={{ marginBottom: 0 }}>
                    Selected 3D Node KYC Dossier
                  </span>
                  <span
                    className={`m3-badge ${
                      selectedAccountProfile.is_pep_or_sanctioned
                        ? 'm3-badge--danger'
                        : 'm3-badge--blue'
                    }`}
                  >
                    {selectedAccountProfile.is_pep_or_sanctioned
                      ? 'PEP / SANCTIONED'
                      : selectedAccountProfile.kyc_risk_tier}
                  </span>
                </div>

                <div
                  style={{
                    fontSize: '1.02rem',
                    fontWeight: 700,
                    color: '#f8fafc',
                    marginBottom: 4,
                  }}
                >
                  {selectedAccountProfile.entity_name}
                </div>
                <div className="m3-mono-muted" style={{ marginBottom: 10 }}>
                  Account: {selectedAccountProfile.account_id} • IBAN:{' '}
                  {selectedAccountProfile.iban}
                </div>

                <div className="m3-kv-row">
                  <span className="m3-kv-row__label">Institution</span>
                  <span className="m3-kv-row__value">
                    {selectedAccountProfile.bank_name} (
                    {selectedAccountProfile.bank_jurisdiction})
                  </span>
                </div>
                <div className="m3-kv-row">
                  <span className="m3-kv-row__label">Beneficial Owner (UBO)</span>
                  <span
                    className="m3-kv-row__value"
                    style={{
                      color: selectedAccountProfile.ubo_entity_name
                        ? '#c084fc'
                        : undefined,
                    }}
                  >
                    {selectedAccountProfile.ubo_entity_name ??
                      'Direct Corporate Holder'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* CHAPTER 05: PRE-SETTLEMENT GATE & GEMINI SAR */}
        <section
          ref={(el) => {
            chapterRefs.current[4] = el;
          }}
          className="m3-scrolly-section"
        >
          <div className="m3-scrolly-card">
            <div className="m3-scrolly-eyebrow">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 15 }}
              >
                shield_lock
              </span>
              05 • REAL-TIME INTERCEPTION & SINGLE-TICKET GEMINI SAR
            </div>
            <h2 className="m3-scrolly-h2">
              Block the Wire in &lt;150ms & File the FinCEN SAR
            </h2>
            <p className="m3-scrolly-body">
              Because Cloud Spanner is the live operational ledger (zero overnight
              ETL), it blocks ring-closing wires before settlement and invokes
              Vertex AI Gemini <strong>only on the single escalated case</strong>.
            </p>

            {/* 1. Live Pre-Settlement Gate */}
            <div className="m3-card" style={{ padding: 14, marginBottom: 14 }}>
              <div
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  color: '#f8fafc',
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 18, color: '#f43f5e' }}
                >
                  gpp_maybe
                </span>
                1. Test Pre-Settlement Wire Interception
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 96px',
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <input
                  className="m3-input"
                  value={interceptSender}
                  onChange={(e) => onChangeInterceptSender(e.target.value)}
                  placeholder="Sender"
                />
                <input
                  className="m3-input"
                  value={interceptReceiver}
                  onChange={(e) => onChangeInterceptReceiver(e.target.value)}
                  placeholder="Receiver"
                />
                <input
                  className="m3-input"
                  type="number"
                  value={interceptAmount}
                  onChange={(e) => onChangeInterceptAmount(e.target.value)}
                  placeholder="USD"
                />
              </div>

              <button
                type="button"
                className="m3-btn m3-btn--tonal"
                style={{ width: '100%' }}
                disabled={isIntercepting}
                onClick={onSimulateIntercept}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 18 }}
                >
                  shield
                </span>
                {isIntercepting
                  ? 'Evaluating 3D Path...'
                  : 'Simulate Wire & Block in 3D Space'}
              </button>

              {interceptResult && (
                <div
                  className={`m3-card ${
                    interceptResult.decision === 'HELD' ||
                    interceptResult.decision === 'BLOCK_HOLD_COMPLIANCE'
                      ? 'm3-card--tonal-error'
                      : 'm3-card--tonal-primary'
                  }`}
                  style={{ marginTop: 10, padding: 10, fontSize: '0.78rem' }}
                >
                  <strong>Decision: {interceptResult.decision}</strong> •{' '}
                  {interceptResult.latency_ms.toFixed(1)} ms Spanner check •{' '}
                  {interceptResult.matched_rings.length} upstream cycle(s) matched.
                </div>
              )}
            </div>

            {/* 2. Single-Ticket Gemini FinCEN SAR */}
            <div className="m3-card" style={{ padding: 14 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: '#f8fafc',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 18, color: '#38bdf8' }}
                  >
                    auto_awesome
                  </span>
                  2. Single-Ticket Vertex AI Gemini SAR
                </span>
                <span className="m3-badge m3-badge--green">$0 Bulk Cost</span>
              </div>

              <button
                type="button"
                className="m3-btn m3-btn--filled"
                style={{ width: '100%' }}
                disabled={!investigation || isGeneratingSar}
                onClick={onDraftSingleTicketSar}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 18 }}
                >
                  description
                </span>
                {isGeneratingSar
                  ? 'Drafting Grounded FinCEN SAR...'
                  : 'Draft FinCEN SAR with Gemini (1 Ticket)'}
              </button>

              {activeAlert && (
                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 6,
                    }}
                  >
                    <span className="m3-badge m3-badge--green">
                      Citations Verified: {String(activeAlert.citations_verified)}
                    </span>
                    <span className="m3-badge m3-badge--blue">
                      {activeAlert.alert_id}
                    </span>
                  </div>
                  <div
                    className="m3-sar-narrative"
                    style={{ maxHeight: 210, overflowY: 'auto' }}
                  >
                    {activeAlert.sar_narrative}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
