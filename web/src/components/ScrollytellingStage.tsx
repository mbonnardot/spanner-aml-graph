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
  readonly shortName: string;
  readonly shapeBadge: string;
  readonly shortDesc: string;
  readonly cleanHow: string;
}

const EIGHT_AML_PATTERNS: readonly PatternMeta[] = [
  {
    num: '01',
    caseId: 'CASE_HI_CYCLE_10HOP',
    name: 'Circular Layering',
    shortName: 'Circular',
    shapeBadge: '10-Hop Ring',
    shortDesc:
      'Dirty cash hops across 10 accounts and returns to the sender disguised as clean revenue.',
    cleanHow:
      'Wires illicit funds through 9 offshore mules and pays the criminal’s own company back via a fake "foreign client invoice."',
  },
  {
    num: '02',
    caseId: 'CASE_HI_FAN_OUT',
    name: 'Fan-Out Structuring',
    shortName: 'Fan-Out',
    shapeBadge: '1 → 16 Split',
    shortDesc:
      'One origin account splits dirty funds across 16 mule accounts below reporting thresholds.',
    cleanHow:
      'Breaks a large illicit sum into 16 small wires ("smurfing") so no single transfer triggers a $10k bank alert before cash-out.',
  },
  {
    num: '03',
    caseId: 'CASE_HI_FAN_IN',
    name: 'Fan-In Smurfing',
    shortName: 'Fan-In',
    shapeBadge: '22 → 1 Funnel',
    shortDesc:
      '22 feeder accounts funnel structured deposits into one clean collector account.',
    cleanHow:
      'Aggregates small street-level deposits from 22 mules into one "merchant" treasury account to buy clean real estate or luxury assets.',
  },
  {
    num: '04',
    caseId: 'CASE_HI_SCATTER_GATHER',
    name: 'Scatter-Gather Diamond',
    shortName: 'Scatter-Gather',
    shapeBadge: 'Diamond',
    shortDesc:
      'One sender scatters dirty cash across mules that reconverge at a clean payout account.',
    cleanHow:
      'Splits illicit cash across independent intermediaries to sever the audit trail, then recombines ~95% in a clean destination account.',
  },
  {
    num: '05',
    caseId: 'CASE_HI_GATHER_SCATTER',
    name: 'Gather-Scatter Hub',
    shortName: 'Gather-Scatter',
    shapeBadge: 'Hourglass Hub',
    shortDesc:
      'A central shadow hub pools dirty deposits from many senders and pays out clean wires.',
    cleanHow:
      'Commingles funds from multiple illicit sources inside one clearinghouse account so banks cannot match incoming cash to outgoing payouts.',
  },
  {
    num: '06',
    caseId: 'CASE_HI_BIPARTITE',
    name: 'Bipartite Layering',
    shortName: 'Bipartite',
    shapeBadge: '2-Layer Relay',
    shortDesc:
      'Feeder accounts wire dirty funds through a parallel wall of pass-through shell conduits.',
    cleanHow:
      'Uses two separated layers of front companies to convert illicit cash into seemingly legitimate B2B vendor settlements.',
  },
  {
    num: '07',
    caseId: 'CASE_HI_STACKED_BIPARTITE',
    name: 'Stacked Bipartite',
    shortName: 'Stacked',
    shapeBadge: '3-Tier Cascade',
    shortDesc:
      'Funds cascade sequentially across 3 tiers of shell companies before final payout.',
    cleanHow:
      'Each corporate tier takes a ~2% cut and issues a new cross-border trade receipt, leaving the final payout looking completely legitimate.',
  },
  {
    num: '08',
    caseId: 'CASE_HI_RANDOM_WALK_8HOP',
    name: 'Random Walk Chain',
    shortName: 'Random Walk',
    shapeBadge: '8-Hop Trail',
    shortDesc:
      'High-velocity 8-hop chain across 9 accounts that races to a clean offshore exit.',
    cleanHow:
      'Jumps rapidly across 9 banks in hours—outpacing manual compliance recalls—until the final account cashes out clean funds.',
  },
];

const BONUS_OWNERSHIP_PATTERNS: readonly PatternMeta[] = [
  {
    num: 'UBO',
    caseId: 'CASE_SEED_UBO_SHELL',
    name: 'UBO Offshore Shell Ring',
    shortName: 'UBO Shell Ring',
    shapeBadge: 'Shared Owner',
    shortDesc:
      'Offshore shell companies look unrelated until Spanner links their shared Beneficial Owner.',
    cleanHow:
      'One human owner secretly controls all 3 offshore shell companies—paying themselves "consulting fees" across borders to clean the cash.',
  },
  {
    num: '3-HOP',
    caseId: 'CASE_SEED_CYCLE_3HOP',
    name: 'Offshore 3-Hop Cycle',
    shortName: '3-Hop Offshore',
    shapeBadge: 'Cayman Loop',
    shortDesc:
      'Rapid round-trip wire loop through Cayman Islands, BVI, and Panama shell accounts.',
    cleanHow:
      'Cycles dirty cash through secrecy havens and returns 95% to the origin account disguised as an offshore investment payout.',
  },
];

const CHAPTERS = [
  { id: 1 as const, label: '01 Ledger' },
  { id: 2 as const, label: '02 Patterns' },
  { id: 3 as const, label: '03 Hops' },
  { id: 4 as const, label: '04 Spanner GQL' },
  { id: 5 as const, label: '05 Prevent' },
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
  const [showGqlCode, setShowGqlCode] = useState<boolean>(false);
  const [copiedGql, setCopiedGql] = useState<boolean>(false);
  const [actionTab, setActionTab] = useState<'block' | 'sar'>('block');

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

  // Automatically switch to SAR tab when a SAR is generated
  useEffect(() => {
    if (activeAlert) {
      setActionTab('sar');
    }
  }, [activeAlert]);

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

  // Keyboard ← / → support when in Act 3 (Follow the Money)
  useEffect(() => {
    if (activeChapter !== 3 || hopCount <= 1) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIsAutoPlayingHops(false);
        manualHopLockUntilRef.current = Date.now() + 4000;
        setActiveHopIndex((prev) => (prev + 1) % hopCount);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIsAutoPlayingHops(false);
        manualHopLockUntilRef.current = Date.now() + 4000;
        setActiveHopIndex((prev) => Math.max(0, prev - 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeChapter, hopCount]);

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
  const isLastHop = activeHopIndex === Math.max(0, hopCount - 1);
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
                <span>{pat.num}</span>
                {pat.shortName}
              </button>
            ))}
            <button
              type="button"
              className={`m3-filter-chip ${
                showOwnershipOverlay ? 'm3-filter-chip--active' : ''
              }`}
              onClick={onToggleOwnershipOverlay}
            >
              UBO Layer
            </button>
            <button
              type="button"
              className={`m3-filter-chip ${
                showBankOverlay ? 'm3-filter-chip--active' : ''
              }`}
              onClick={onToggleBankOverlay}
            >
              Bank Layer
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="m3-scrolly-root">
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

      {/* Minimal, Quiet Step Indicator (Hidden on Act 1 Landing) */}
      <nav
        aria-label="Story progress"
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
              {ch.label}
            </button>
          ))}
        </div>
      </nav>

      <div className="m3-scrolly-track">
        {/* ACT 01: SPACIOUS LANDING SCREEN */}
        <section
          ref={(el) => {
            chapterRefs.current[0] = el;
          }}
          className="m3-scrolly-section m3-scrolly-section--hero"
        >
          <div className="m3-hero-overlay">
            <div className="m3-scrolly-eyebrow">LIVE BANKING LEDGER</div>

            <h1 className="m3-hero-headline">
              {(health?.accounts_count ?? 761).toLocaleString()} accounts.{' '}
              <span>
                {(health?.transactions_count ?? 3267).toLocaleString()} wire
                transfers.
              </span>
            </h1>

            <p className="m3-hero-subheadline">
              Every point in this 3D space is an account across{' '}
              <strong>{(health?.banks_count ?? 473).toLocaleString()} banks</strong>
              —and hidden inside normal traffic are{' '}
              <strong>8 money laundering schemes</strong> turning dirty cash
              into clean revenue.
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
                  ? 'Scanning Ledger...'
                  : 'Use Spanner Graph to Catch Money Laundering'}
              </button>
            </div>
          </div>
        </section>

        {/* ACT 02: THE 8 LAUNDERING PATTERNS & HOW MONEY GETS CLEANED */}
        <section
          ref={(el) => {
            chapterRefs.current[1] = el;
          }}
          className="m3-scrolly-section"
        >
          <div
            className={`m3-scrolly-card m3-scrolly-card--wide ${
              activeChapter === 2 ? 'm3-scrolly-card--active' : ''
            }`}
          >
            <div className="m3-scrolly-eyebrow">01 • 8 LAUNDERING PATTERNS</div>
            <h2 className="m3-scrolly-h2">{activePatternMeta.name}</h2>
            <p className="m3-scrolly-body" style={{ marginBottom: 12 }}>
              {activePatternMeta.shortDesc}
            </p>

            {/* Crystal-Clear "How They Clean & Gain the Money" Strip */}
            <div className="m3-clean-how-box">
              <span className="m3-clean-how-box__tag">
                HOW THE MONEY GETS CLEANED
              </span>
              <p>{activePatternMeta.cleanHow}</p>
            </div>

            {investigation && (
              <div className="m3-amount-flow-banner">
                <div className="m3-amount-flow-banner__item">
                  <span>1. Dirty Cash In</span>
                  <strong className="mono-num">
                    $
                    {investigation.evidence.initial_amount.toLocaleString(
                      undefined,
                      { maximumFractionDigits: 0 }
                    )}
                  </strong>
                  <small>Illicit Origin</small>
                </div>
                <span className="m3-amount-flow-banner__arrow">→</span>
                <div className="m3-amount-flow-banner__item m3-amount-flow-banner__item--highlight">
                  <span>2. Layering Trail</span>
                  <strong className="mono-num">
                    $
                    {totalVolumeUsd.toLocaleString(undefined, {
                      maximumFractionDigits: 0,
                    })}
                  </strong>
                  <small>
                    {investigation.evidence.hop_count} hops •{' '}
                    {uniqueAccountsCount} accts
                  </small>
                </div>
                <span className="m3-amount-flow-banner__arrow">→</span>
                <div className="m3-amount-flow-banner__item m3-amount-flow-banner__item--clean">
                  <span>3. Clean Cash-Out</span>
                  <strong className="mono-num">
                    $
                    {investigation.evidence.final_amount.toLocaleString(
                      undefined,
                      { maximumFractionDigits: 0 }
                    )}
                  </strong>
                  <small>Disguised Payout</small>
                </div>
              </div>
            )}

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
                      <span className="m3-pattern-card__badge">{pat.num}</span>
                      <span className="m3-pattern-card__shape">
                        {pat.shapeBadge}
                      </span>
                    </div>
                    <div className="m3-pattern-card__title">
                      {pat.shortName}
                    </div>
                  </button>
                );
              })}
            </div>

            <div
              style={{
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
                marginTop: 6,
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
                    {pat.shortName}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="m3-next-chapter-btn"
                onClick={() => scrollToChapter(3)}
              >
                Next: Follow the Money ↓
              </button>
            </div>
          </div>
        </section>

        {/* ACT 03: FOLLOW THE MONEY HOP-BY-HOP */}
        <section
          ref={(el) => {
            chapterRefs.current[2] = el;
          }}
          className="m3-scrolly-section"
        >
          <div
            className={`m3-scrolly-card ${
              activeChapter === 3 ? 'm3-scrolly-card--active' : ''
            }`}
          >
            <div className="m3-scrolly-eyebrow">02 • FOLLOW THE MONEY</div>
            <h2 className="m3-scrolly-h2">
              Hop {activeHopIndex + 1} of {Math.max(hopCount, 1)}
            </h2>

            {/* Dynamic 3-Stage Laundering Lifecycle Indicator */}
            <div
              className={`m3-laundering-stage-pill ${
                activeHopIndex === 0
                  ? 'm3-laundering-stage-pill--placement'
                  : isLastHop
                    ? 'm3-laundering-stage-pill--integration'
                    : 'm3-laundering-stage-pill--layering'
              }`}
            >
              <strong>
                {activeHopIndex === 0
                  ? 'STAGE 1: PLACEMENT — Dirty Cash Enters'
                  : isLastHop
                    ? 'STAGE 3: INTEGRATION — Clean Cash-Out!'
                    : 'STAGE 2: LAYERING — Scrambling the Trail'}
              </strong>
              <span>
                {activeHopIndex === 0
                  ? 'Illicit cash is wired from the origin account into the first mule.'
                  : isLastHop
                    ? 'The final wire lands disguised as clean business revenue or asset payout.'
                    : 'Mule accounts forward the money across banks to sever the audit trail.'}
              </span>
            </div>

            {/* Clean Progress Bar + Playback Controls */}
            <div className="m3-hop-progress-track">
              <div
                className="m3-hop-progress-fill"
                style={{
                  width: `${
                    hopCount > 0
                      ? ((activeHopIndex + 1) / hopCount) * 100
                      : 100
                  }%`,
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                marginBottom: 14,
              }}
            >
              <button
                type="button"
                className={`m3-btn ${
                  isAutoPlayingHops ? 'm3-btn--tonal' : 'm3-btn--filled'
                }`}
                style={{ padding: '7px 14px', fontSize: '0.78rem' }}
                onClick={() => setIsAutoPlayingHops((prev) => !prev)}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16 }}
                >
                  {isAutoPlayingHops ? 'pause' : 'play_arrow'}
                </span>
                {isAutoPlayingHops ? 'Pause' : 'Auto-Play'}
              </button>
              <button
                type="button"
                className="m3-btn m3-btn--outlined"
                style={{ padding: '7px 12px', fontSize: '0.78rem' }}
                disabled={activeHopIndex <= 0}
                onClick={() => {
                  setIsAutoPlayingHops(false);
                  handleManualSelectHop(Math.max(0, activeHopIndex - 1));
                }}
              >
                ← Prev
              </button>
              <button
                type="button"
                className="m3-btn m3-btn--outlined"
                style={{ padding: '7px 12px', fontSize: '0.78rem' }}
                onClick={() => {
                  setIsAutoPlayingHops(false);
                  handleManualSelectHop(
                    hopCount > 0 ? (activeHopIndex + 1) % hopCount : 0
                  );
                }}
              >
                Next →
              </button>
            </div>

            {currentHop && (
              <div className="m3-hop-spotlight-card">
                <div
                  className="m3-hop-spotlight-card__amount mono-num"
                  style={{ color: isLastHop ? '#10b981' : '#38bdf8' }}
                >
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
                    <small>
                      {activeHopIndex === 0 ? 'DIRTY CASH SENDER' : 'MULE SENDER'}
                    </small>
                    <strong>
                      {investigation?.kyc_profiles[currentHop.from_account_id]
                        ?.entity_name ?? currentHop.from_account_id}
                    </strong>
                    <code>{currentHop.from_account_id}</code>
                  </div>
                  <span
                    className="material-symbols-outlined"
                    style={{
                      color: isLastHop ? '#10b981' : '#38bdf8',
                      fontSize: 20,
                    }}
                  >
                    arrow_forward
                  </span>
                  <div>
                    <small>
                      {isLastHop ? 'CLEAN PAYOUT RECEIVER' : 'MULE RECEIVER'}
                    </small>
                    <strong>
                      {investigation?.kyc_profiles[currentHop.to_account_id]
                        ?.entity_name ?? currentHop.to_account_id}
                    </strong>
                    <code>{currentHop.to_account_id}</code>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 10,
                  }}
                >
                  <span className="m3-mono-muted">
                    {currentHop.event_timestamp
                      .replace('T', ' ')
                      .replace('+00:00', ' UTC')}
                  </span>
                  <button
                    type="button"
                    className="m3-next-chapter-btn"
                    onClick={() => scrollToChapter(4)}
                  >
                    Next: Why Spanner Graph ↓
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ACT 04: WHY SQL FAILS & SPANNER GRAPH GQL */}
        <section
          ref={(el) => {
            chapterRefs.current[3] = el;
          }}
          className="m3-scrolly-section"
        >
          <div
            className={`m3-scrolly-card ${
              activeChapter === 4 ? 'm3-scrolly-card--active' : ''
            }`}
          >
            <div className="m3-scrolly-eyebrow">03 • WHY SPANNER GRAPH</div>
            <h2 className="m3-scrolly-h2">
              1 Graph Traversal vs. 10 SQL Joins
            </h2>
            <p className="m3-scrolly-body">
              Launderers hide behind multi-hop shell companies. Spanner exposes
              the entire path and shared <strong>Beneficial Owner (UBO)</strong>{' '}
              on the live ledger—with zero ETL delay.
            </p>

            <div className="m3-sql-vs-gql-grid">
              <div className="m3-sql-vs-gql-box m3-sql-vs-gql-box--bad">
                <span>Legacy SQL</span>
                <strong>10 SELF-JOINs</strong>
                <small>Hours of batch ETL after clean cash-out</small>
              </div>
              <div className="m3-sql-vs-gql-box m3-sql-vs-gql-box--good">
                <span>Spanner Graph</span>
                <strong>1 GQL Path</strong>
                <small>
                  {investigation
                    ? `${investigation.evidence.query_latency_ms.toFixed(0)} ms`
                    : '~120 ms'}{' '}
                  before funds leave
                </small>
              </div>
            </div>

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
                UBO Owners
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
                Banks
              </button>
              {investigation?.demo_guide?.gql_query && (
                <button
                  type="button"
                  className={`m3-filter-chip ${
                    showGqlCode ? 'm3-filter-chip--active' : ''
                  }`}
                  onClick={() => setShowGqlCode((prev) => !prev)}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                  >
                    code
                  </span>
                  {showGqlCode ? 'Hide GQL Query' : 'View Live GQL Query'}
                </button>
              )}
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
                  <strong style={{ fontSize: '0.82rem', color: '#f8fafc' }}>
                    {selectedAccountProfile.entity_name}
                  </strong>
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
                  {selectedAccountProfile.bank_name} (
                  {selectedAccountProfile.bank_jurisdiction}) • UBO:{' '}
                  <strong style={{ color: '#c084fc' }}>
                    {selectedAccountProfile.ubo_entity_name ?? 'Direct Holder'}
                  </strong>
                </div>
              </div>
            )}

            {showGqlCode && investigation?.demo_guide?.gql_query && (
              <div style={{ marginBottom: 12 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 6,
                  }}
                >
                  <span className="m3-code-caption" style={{ marginBottom: 0 }}>
                    ISO GQL Query
                  </span>
                  <button
                    type="button"
                    className="m3-filter-chip"
                    style={{ padding: '2px 9px', fontSize: '0.68rem' }}
                    onClick={handleCopyGql}
                  >
                    {copiedGql ? '✓ Copied' : 'Copy'}
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

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="m3-next-chapter-btn"
                onClick={() => scrollToChapter(5)}
              >
                Next: Stop the Clean Payout ↓
              </button>
            </div>
          </div>
        </section>

        {/* ACT 05: REAL-TIME PREVENTION (DYNAMIC 2-TAB FLOW) */}
        <section
          ref={(el) => {
            chapterRefs.current[4] = el;
          }}
          className="m3-scrolly-section"
        >
          <div
            className={`m3-scrolly-card ${
              activeChapter === 5 ? 'm3-scrolly-card--active' : ''
            }`}
          >
            <div className="m3-scrolly-eyebrow">04 • REAL-TIME PREVENTION</div>
            <h2 className="m3-scrolly-h2">
              Block Before Clean Payout. File 1 SAR.
            </h2>
            <p className="m3-scrolly-body">
              Intercept the final cash-out wire in &lt;150ms before settlement,
              then draft a grounded FinCEN report with Vertex AI Gemini.
            </p>

            {/* Clean 2-Tab Switcher so only one tool is shown at a time */}
            <div className="m3-action-tabs">
              <button
                type="button"
                className={`m3-action-tab ${
                  actionTab === 'block' ? 'm3-action-tab--active' : ''
                }`}
                onClick={() => setActionTab('block')}
              >
                1. Block Cash-Out Wire
              </button>
              <button
                type="button"
                className={`m3-action-tab ${
                  actionTab === 'sar' ? 'm3-action-tab--active' : ''
                }`}
                onClick={() => setActionTab('sar')}
              >
                2. Draft Gemini SAR
              </button>
            </div>

            {actionTab === 'block' ? (
              <div className="m3-card" style={{ padding: 14 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 88px',
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
                  className="m3-btn m3-btn--filled"
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
                    ? 'Checking Ledger...'
                    : 'Simulate & Block Wire'}
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
                    <strong>{interceptResult.decision}</strong> •{' '}
                    {interceptResult.latency_ms.toFixed(1)} ms •{' '}
                    {interceptResult.matched_rings.length} cycle(s) matched —
                    clean payout frozen in 3D!
                  </div>
                )}
              </div>
            ) : (
              <div className="m3-card" style={{ padding: 14 }}>
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
                    auto_awesome
                  </span>
                  {isGeneratingSar
                    ? 'Drafting FinCEN SAR...'
                    : 'Draft FinCEN SAR with Gemini'}
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
                        Verified Grounded Citations
                      </span>
                      <span className="m3-badge m3-badge--blue">
                        {activeAlert.alert_id}
                      </span>
                    </div>
                    <div
                      className="m3-sar-narrative"
                      data-lenis-prevent
                      onWheel={(e) => e.stopPropagation()}
                      style={{ maxHeight: 210, overflowY: 'auto' }}
                    >
                      {activeAlert.sar_narrative}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
