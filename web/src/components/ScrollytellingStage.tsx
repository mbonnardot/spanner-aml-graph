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

interface PatternMeta {
  readonly num: string;
  readonly caseId: string;
  readonly name: string;
  readonly nickname: string;
  readonly shapeBadge: string;
  readonly amountHint: string;
  readonly icon: string;
  readonly shortDesc: string;
}

const EIGHT_AML_PATTERNS: readonly PatternMeta[] = [
  {
    num: '01',
    caseId: 'CASE_HI_CYCLE_10HOP',
    name: 'Circular Layering (Cycle)',
    nickname: 'The Washing Machine',
    shapeBadge: '10-Hop 3D Ring',
    amountHint: '$8,805 → $7,945',
    icon: 'sync',
    shortDesc:
      'Funds bounce across 10 accounts and return to the sender disguised as clean revenue.',
  },
  {
    num: '02',
    caseId: 'CASE_HI_FAN_OUT',
    name: 'Fan-Out Structuring',
    nickname: 'The 16-Way Sprinkler',
    shapeBadge: '1 → 16 Cone Split',
    amountHint: '$3,339 → $17,845',
    icon: 'call_split',
    shortDesc:
      'One origin account splits funds across 16 beneficiary accounts below reporting thresholds.',
  },
  {
    num: '03',
    caseId: 'CASE_HI_FAN_IN',
    name: 'Fan-In Smurfing',
    nickname: 'The Collector Funnel',
    shapeBadge: '22 → 1 Funnel',
    amountHint: '$3,505 → $8,094',
    icon: 'call_merge',
    shortDesc:
      'Multiple unrelated feeder accounts funnel structured deposits into a single collector account.',
  },
  {
    num: '04',
    caseId: 'CASE_HI_SCATTER_GATHER',
    name: 'Scatter-Gather Diamond',
    nickname: '16-Mule Diamond',
    shapeBadge: '1 → 13 → 1 Diamond',
    amountHint: '$15,691 → $19,102',
    icon: 'diamond',
    shortDesc:
      'Origin scatters wires across intermediary mule accounts that reconverge at one collector.',
  },
  {
    num: '05',
    caseId: 'CASE_HI_GATHER_SCATTER',
    name: 'Gather-Scatter Hub',
    nickname: 'Clearinghouse Hub',
    shapeBadge: '44-Hop Hourglass',
    amountHint: '$9,132 → $9,284',
    icon: 'hub',
    shortDesc:
      'A central hub aggregates deposits from many senders before dispersing them downstream.',
  },
  {
    num: '06',
    caseId: 'CASE_HI_BIPARTITE',
    name: 'Bipartite Relay',
    nickname: 'Two-Layer Conduit',
    shapeBadge: '2-Layer Wall',
    amountHint: '$152,868 → $9,496',
    icon: 'swap_horiz',
    shortDesc:
      'Upstream feeder accounts wire funds through a parallel layer of pass-through conduits.',
  },
  {
    num: '07',
    caseId: 'CASE_HI_STACKED_BIPARTITE',
    name: 'Stacked Bipartite',
    nickname: 'Multi-Tier Cascade',
    shapeBadge: '3-Tier Cascade',
    amountHint: '$22,443 → $12,598',
    icon: 'layers',
    shortDesc:
      'Funds cascade sequentially across multiple tiers of intermediate shell accounts.',
  },
  {
    num: '08',
    caseId: 'CASE_HI_RANDOM_WALK_8HOP',
    name: 'Random Walk Layering',
    nickname: 'Zig-Zag Escape Trail',
    shapeBadge: '8-Hop Zig-Zag',
    amountHint: '$11,811 → $4,919',
    icon: 'timeline',
    shortDesc:
      'High-velocity 8-hop chain across 9 accounts that never loops back to the origin.',
  },
];

const BONUS_OWNERSHIP_PATTERNS: readonly PatternMeta[] = [
  {
    num: 'UBO',
    caseId: 'CASE_SEED_UBO_SHELL',
    name: 'UBO Offshore Shell Ring',
    nickname: 'Hidden Puppet Master',
    shapeBadge: 'PEP Beneficial Owner',
    amountHint: '$150,000 → $144,500',
    icon: 'person_search',
    shortDesc:
      'Two offshore shell companies look unrelated until Spanner joins their shared Beneficial Owner.',
  },
  {
    num: '3-HOP',
    caseId: 'CASE_SEED_CYCLE_3HOP',
    name: 'Offshore 3-Hop Cycle',
    nickname: 'Cayman-BVI Loop',
    shapeBadge: '4-Hop Ring',
    amountHint: '$100,000 → $95,000',
    icon: 'public',
    shortDesc:
      'Rapid round-trip wire loop through Cayman Islands, BVI, and Panama shell accounts.',
  },
];

const CHAPTERS = [
  { id: 1 as const, label: '01 • Bank System', icon: 'blur_on' },
  { id: 2 as const, label: '02 • 8 AML Patterns', icon: 'grid_view' },
  { id: 3 as const, label: '03 • Follow the Money', icon: 'flight_takeoff' },
  { id: 4 as const, label: '04 • Spanner GQL & UBO', icon: 'account_tree' },
  { id: 5 as const, label: '05 • Block & File SAR', icon: 'shield_lock' },
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
  const [isAutoPlayingHops, setIsAutoPlayingHops] = useState<boolean>(false);
  const [copiedGql, setCopiedGql] = useState<boolean>(false);

  const scrollProgressRef = useRef<number>(freeOrbitOnly ? 0.28 : 0);
  const lenisRef = useRef<Lenis | null>(null);
  const chapterRefs = useRef<(HTMLElement | null)[]>([]);
  const manualHopLockUntilRef = useRef<number>(0);

  const hops = investigation?.evidence.hops ?? [];
  const hopCount = hops.length;

  useEffect(() => {
    setActiveHopIndex(0);
    setIsAutoPlayingHops(false);
  }, [investigation?.case_id]);

  useEffect(() => {
    if (!isAutoPlayingHops || hopCount <= 1) {
      return;
    }
    const timer = window.setInterval(() => {
      manualHopLockUntilRef.current = Date.now() + 4000;
      setActiveHopIndex((prev) => (prev + 1) % hopCount);
    }, 1600);
    return () => window.clearInterval(timer);
  }, [isAutoPlayingHops, hopCount]);

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
      lenisRef.current.scrollTo(targetElem, { offset: -72, duration: 1.2 });
    } else if (targetElem) {
      targetElem.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleSelectPatternById = (caseId: string) => {
    const found = cases.find((c) => c.case_id === caseId);
    if (found) {
      onSelectCase(found);
    }
  };

  const handleManualSelectHop = (idx: number) => {
    manualHopLockUntilRef.current = Date.now() + 3500;
    setActiveHopIndex(idx);
  };

  const handleCopyGql = () => {
    const queryText = investigation?.demo_guide?.gql_query;
    if (!queryText) {
      return;
    }
    navigator.clipboard?.writeText(queryText);
    setCopiedGql(true);
    window.setTimeout(() => setCopiedGql(false), 2000);
  };

  const currentHop = hops[activeHopIndex] ?? hops[0];
  const activePatternMeta =
    EIGHT_AML_PATTERNS.find((p) => p.caseId === selectedCaseId) ??
    BONUS_OWNERSHIP_PATTERNS.find((p) => p.caseId === selectedCaseId) ??
    EIGHT_AML_PATTERNS[0];

  const uniqueAccountsCount = investigation
    ? new Set([
        ...investigation.evidence.account_ids,
        ...investigation.evidence.hops.flatMap((h) => [
          h.from_account_id,
          h.to_account_id,
        ]),
      ]).size
    : 0;

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
            {EIGHT_AML_PATTERNS.map((pat) => (
              <button
                key={pat.caseId}
                type="button"
                className={`m3-filter-chip ${
                  selectedCaseId === pat.caseId ? 'm3-filter-chip--active' : ''
                }`}
                onClick={() => handleSelectPatternById(pat.caseId)}
              >
                <span>#{pat.num}</span>
                {pat.name.split(' ')[0]}
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
            3D sphere or pill to inspect
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

      {/* Sticky Top Navigation HUD (Hidden on Act 1 Landing Screen for a super-clean entry) */}
      <div
        className={`m3-scrolly-hud ${
          activeChapter === 1 ? 'm3-scrolly-hud--hidden' : ''
        }`}
      >
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
          <span className="m3-scrolly-hud__label">8 AML Patterns:</span>
          {EIGHT_AML_PATTERNS.map((pat) => {
            const isSelected = pat.caseId === selectedCaseId;
            return (
              <button
                key={pat.caseId}
                type="button"
                className={`m3-scenario-chip ${
                  isSelected ? 'm3-scenario-chip--active' : ''
                }`}
                onClick={() => handleSelectPatternById(pat.caseId)}
              >
                <strong>
                  {pat.num}. {pat.name.split(' (')[0]}
                </strong>
                <span>{pat.shapeBadge}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Parallax Scroll Track with 5 Clear Storytelling Acts */}
      <div className="m3-scrolly-track">
        {/* ACT 01: CLEAN LANDING SCREEN — THE LIVE BANKING SYSTEM */}
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
                account_balance
              </span>
              LIVE GLOBAL BANKING SYSTEM • CLOUD SPANNER GRAPH
            </div>

            <h1 className="m3-hero-headline">
              You are inside a live bank ledger with{' '}
              <span>
                {(health?.accounts_count ?? 761).toLocaleString()} accounts
              </span>{' '}
              and{' '}
              <span>
                {(health?.transactions_count ?? 3267).toLocaleString()}{' '}
                transactions.
              </span>
            </h1>

            <p className="m3-hero-subheadline">
              Every dot orbiting in 3D space is a bank account across{' '}
              <strong>
                {(health?.banks_count ?? 473).toLocaleString()} financial
                institutions
              </strong>
              , and every line is a cross-border wire transfer. Hidden inside
              this normal banking traffic are{' '}
              <strong>8 money laundering patterns</strong> moving illicit funds
              in plain sight.
            </p>

            <div className="m3-landing-stat-strip">
              <div className="m3-landing-stat">
                <strong>{(health?.accounts_count ?? 761).toLocaleString()}</strong>
                <span>Bank Accounts</span>
              </div>
              <div className="m3-landing-stat">
                <strong>{(health?.banks_count ?? 473).toLocaleString()}</strong>
                <span>Global Banks</span>
              </div>
              <div className="m3-landing-stat">
                <strong>
                  {(health?.transactions_count ?? 3267).toLocaleString()}
                </strong>
                <span>Wire Transfers</span>
              </div>
              <div className="m3-landing-stat m3-landing-stat--accent">
                <strong>8 Patterns</strong>
                <span>Hidden Laundering Rings</span>
              </div>
            </div>

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
                  ? 'Scanning Graph Ledger...'
                  : 'Use Spanner Graph to Catch Money Laundering'}
              </button>
            </div>
          </div>
        </section>

        {/* ACT 02: THE 8 PARADIGMS OF MONEY LAUNDERING & DOLLAR AMOUNTS */}
        <section
          ref={(el) => {
            chapterRefs.current[1] = el;
          }}
          className="m3-scrolly-section"
        >
          <div className="m3-scrolly-card m3-scrolly-card--wide">
            <div className="m3-scrolly-eyebrow">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 15 }}
              >
                grid_view
              </span>
              ACT 02 • THE 8 PARADIGMS OF MONEY LAUNDERING
            </div>
            <h2 className="m3-scrolly-h2">
              {activePatternMeta.num}. {activePatternMeta.name}
            </h2>
            <p className="m3-scrolly-body">
              {investigation?.demo_guide?.plain_english ??
                activePatternMeta.shortDesc}
            </p>

            {/* Clear Dollar Amount & Velocity Summary Bar */}
            {investigation && (
              <div className="m3-amount-flow-banner">
                <div className="m3-amount-flow-banner__step">
                  <span>First Hop Wire</span>
                  <strong>
                    $
                    {investigation.evidence.initial_amount.toLocaleString(
                      undefined,
                      { maximumFractionDigits: 0 }
                    )}
                  </strong>
                </div>
                <span className="material-symbols-outlined m3-amount-flow-banner__arrow">
                  trending_flat
                </span>
                <div className="m3-amount-flow-banner__step">
                  <span>Total Volume Moved</span>
                  <strong>
                    $
                    {totalVolumeUsd.toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </strong>
                  <small>
                    {investigation.evidence.hop_count} hops •{' '}
                    {uniqueAccountsCount} accounts
                  </small>
                </div>
                <span className="material-symbols-outlined m3-amount-flow-banner__arrow">
                  trending_flat
                </span>
                <div className="m3-amount-flow-banner__step m3-amount-flow-banner__step--highlight">
                  <span>Final Hop Wire</span>
                  <strong>
                    $
                    {investigation.evidence.final_amount.toLocaleString(
                      undefined,
                      { maximumFractionDigits: 0 }
                    )}
                  </strong>
                  <small>
                    Caught in {investigation.evidence.query_latency_ms.toFixed(0)}{' '}
                    ms
                  </small>
                </div>
              </div>
            )}

            <div className="m3-code-caption" style={{ marginTop: 12 }}>
              Click any of the 8 canonical AML patterns below to morph the 3D
              graph on the right:
            </div>

            {/* Interactive 8-Pattern Grid */}
            <div className="m3-pattern-grid-8">
              {EIGHT_AML_PATTERNS.map((pat) => {
                const isSelected = pat.caseId === selectedCaseId;
                return (
                  <button
                    key={pat.caseId}
                    type="button"
                    className={`m3-pattern-card ${
                      isSelected ? 'm3-pattern-card--active' : ''
                    }`}
                    onClick={() => handleSelectPatternById(pat.caseId)}
                  >
                    <div className="m3-pattern-card__top">
                      <span className="m3-pattern-card__num">#{pat.num}</span>
                      <span className="m3-pattern-card__shape">
                        {pat.shapeBadge}
                      </span>
                    </div>
                    <div className="m3-pattern-card__title">{pat.name}</div>
                    <div className="m3-pattern-card__sub">
                      “{pat.nickname}” • <strong>{pat.amountHint}</strong>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Bonus Corporate Ownership Patterns */}
            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                marginTop: 10,
                alignItems: 'center',
              }}
            >
              <span className="m3-mono-muted">Corporate Ownership Rings:</span>
              {BONUS_OWNERSHIP_PATTERNS.map((pat) => (
                <button
                  key={pat.caseId}
                  type="button"
                  className={`m3-filter-chip ${
                    selectedCaseId === pat.caseId
                      ? 'm3-filter-chip--active'
                      : ''
                  }`}
                  onClick={() => handleSelectPatternById(pat.caseId)}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 14 }}
                  >
                    {pat.icon}
                  </span>
                  {pat.name} ({pat.amountHint})
                </button>
              ))}
            </div>

            <div className="m3-scrolly-actions" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="m3-btn m3-btn--filled"
                onClick={() => scrollToChapter(3)}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 18 }}
                >
                  flight_takeoff
                </span>
                Follow the Money Hop-by-Hop →
              </button>
            </div>
          </div>
        </section>

        {/* ACT 03: FOLLOW THE MONEY STEP-BY-STEP IN 3D */}
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
              ACT 03 • FOLLOW THE MONEY STEP-BY-STEP
            </div>
            <h2 className="m3-scrolly-h2">
              Wire Hop #{activeHopIndex + 1} of {Math.max(hopCount, 1)}
            </h2>
            <p className="m3-scrolly-body">
              Watch the gold packet travel along the 3D conduit on the right.
              Each hop occurs strictly after the previous wire settled, proving a
              coordinated laundering sequence.
            </p>

            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                flexWrap: 'wrap',
                marginBottom: 12,
              }}
            >
              <button
                type="button"
                className={`m3-btn ${
                  isAutoPlayingHops ? 'm3-btn--tonal' : 'm3-btn--filled'
                }`}
                style={{ padding: '7px 14px', fontSize: '0.76rem' }}
                onClick={() => setIsAutoPlayingHops((prev) => !prev)}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16 }}
                >
                  {isAutoPlayingHops ? 'pause' : 'play_arrow'}
                </span>
                {isAutoPlayingHops ? 'Pause Tour' : 'Auto-Play Hops'}
              </button>
              <button
                type="button"
                className="m3-btn m3-btn--outlined"
                style={{ padding: '7px 12px', fontSize: '0.76rem' }}
                disabled={activeHopIndex <= 0}
                onClick={() => {
                  setIsAutoPlayingHops(false);
                  handleManualSelectHop(Math.max(0, activeHopIndex - 1));
                }}
              >
                Prev
              </button>
              <button
                type="button"
                className="m3-btn m3-btn--outlined"
                style={{ padding: '7px 12px', fontSize: '0.76rem' }}
                onClick={() => {
                  setIsAutoPlayingHops(false);
                  handleManualSelectHop(
                    hopCount > 0 ? (activeHopIndex + 1) % hopCount : 0
                  );
                }}
              >
                Next Hop →
              </button>
            </div>

            <div className="m3-hop-pill-grid" data-lenis-prevent>
              {hops.map((hop, idx) => (
                <button
                  key={`${hop.transaction_id}-${idx}`}
                  type="button"
                  className={`m3-hop-pill ${
                    idx === activeHopIndex ? 'm3-hop-pill--active' : ''
                  }`}
                  onClick={() => {
                    setIsAutoPlayingHops(false);
                    handleManualSelectHop(idx);
                  }}
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
                    <small>SENDER ACCOUNT</small>
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
                    <small>RECEIVER ACCOUNT</small>
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

            <div className="m3-scrolly-actions" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="m3-btn m3-btn--tonal"
                onClick={() => scrollToChapter(4)}
              >
                See How Spanner Graph Catches It →
              </button>
            </div>
          </div>
        </section>

        {/* ACT 04: HOW SPANNER GRAPH CATCHES IT (PLAIN ENGLISH + SCROLLABLE GQL + UBO) */}
        <section
          ref={(el) => {
            chapterRefs.current[3] = el;
          }}
          className="m3-scrolly-section"
        >
          <div className="m3-scrolly-card m3-scrolly-card--wide">
            <div className="m3-scrolly-eyebrow">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 15 }}
              >
                account_tree
              </span>
              ACT 04 • WHY SQL FAILS & HOW SPANNER GRAPH WORKS
            </div>
            <h2 className="m3-scrolly-h2">
              1 Graph Traversal vs. 10 Relational SQL Joins
            </h2>

            <div className="m3-sql-vs-gql-grid">
              <div className="m3-sql-vs-gql-box m3-sql-vs-gql-box--bad">
                <strong>Legacy Relational SQL</strong>
                <p>
                  Tracing 10 hops requires <code>10 SELF-JOINs</code> on the
                  Transactions table plus batch ETL to a separate graph DB—taking
                  hours after the money is gone.
                </p>
              </div>
              <div className="m3-sql-vs-gql-box m3-sql-vs-gql-box--good">
                <strong>Cloud Spanner Property Graph</strong>
                <p>
                  {investigation?.demo_guide?.why_spanner_wins ??
                    'Follows -[e:TRANSFERRED_TO]->{2,12} and :OWNS/:CONTROLS edges directly on the live transactional ledger in ~120ms.'}
                </p>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: 8,
                flexWrap: 'wrap',
                marginBottom: 12,
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
                Show Beneficial Owners (UBO) Above Graph
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
                Show Banks Below Graph
              </button>
            </div>

            {selectedAccountProfile && (
              <div className="m3-card" style={{ padding: 12, marginBottom: 12 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 4,
                  }}
                >
                  <span className="m3-code-caption" style={{ marginBottom: 0 }}>
                    Inspected 3D Node • {selectedAccountProfile.entity_name}
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
                <div className="m3-mono-muted">
                  Acct: {selectedAccountProfile.account_id} • Bank:{' '}
                  {selectedAccountProfile.bank_name} (
                  {selectedAccountProfile.bank_jurisdiction}) • UBO:{' '}
                  <strong style={{ color: '#c084fc' }}>
                    {selectedAccountProfile.ubo_entity_name ??
                      'Direct Corporate Holder'}
                  </strong>
                </div>
              </div>
            )}

            {investigation?.demo_guide?.gql_query && (
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 6,
                  }}
                >
                  <span className="m3-code-caption" style={{ marginBottom: 0 }}>
                    Live ISO GQL Executed on Cloud Spanner (Scrollable)
                  </span>
                  <button
                    type="button"
                    className="m3-filter-chip"
                    style={{ padding: '3px 10px', fontSize: '0.7rem' }}
                    onClick={handleCopyGql}
                  >
                    {copiedGql ? '✓ Copied' : 'Copy GQL'}
                  </button>
                </div>
                <pre
                  className="m3-code-block"
                  data-lenis-prevent
                  onWheel={(e) => e.stopPropagation()}
                >
                  {investigation.demo_guide.gql_query}
                </pre>
              </div>
            )}

            <div className="m3-scrolly-actions" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="m3-btn m3-btn--filled"
                onClick={() => scrollToChapter(5)}
              >
                Block the Wire & Generate FinCEN SAR →
              </button>
            </div>
          </div>
        </section>

        {/* ACT 05: REAL-TIME PRE-SETTLEMENT GATE & GEMINI SAR */}
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
              ACT 05 • REAL-TIME INTERCEPTION & GEMINI FINCEN SAR
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
                    data-lenis-prevent
                    onWheel={(e) => e.stopPropagation()}
                    style={{ maxHeight: 220, overflowY: 'auto' }}
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
