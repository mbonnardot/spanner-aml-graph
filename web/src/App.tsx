import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
} from '@xyflow/react';
import type { NodeMouseHandler } from '@xyflow/react';
import { AccountNode, BankNode, EntityNode } from './components/CarbonNodes';
import { CaseDossierSidebar } from './components/CaseDossierSidebar';
import { DemoStoryBanner } from './components/DemoStoryBanner';
import { InvestigationSidebar } from './components/InvestigationSidebar';
import { ScrollytellingStage } from './components/ScrollytellingStage';
import { TransferHopEdge } from './components/TransferHopEdge';
import { WorkbenchHeader } from './components/WorkbenchHeader';
import { buildReactFlowGraph } from './utils/graphLayout';
import type {
  ApiEnvelope,
  CaseSummary,
  ComplianceAlert,
  EnrichedCaseInvestigation,
  GraphUniverseResponse,
  HealthResponse,
  InterceptionResult,
  TypologyCode,
  ViewMode,
} from './types/aml';

const NODE_TYPES = {
  accountNode: AccountNode,
  entityNode: EntityNode,
  bankNode: BankNode,
};

const EDGE_TYPES = {
  transferHopEdge: TransferHopEdge,
};

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return 'Unexpected API error';
}

export function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('story3d');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [universe, setUniverse] = useState<GraphUniverseResponse | null>(null);
  const [cases, setCases] = useState<readonly CaseSummary[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>(
    'CASE_HI_CYCLE_10HOP'
  );
  const [investigation, setInvestigation] =
    useState<EnrichedCaseInvestigation | null>(null);
  const [isLoadingGraph, setIsLoadingGraph] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [showOwnershipOverlay, setShowOwnershipOverlay] =
    useState<boolean>(false);
  const [showBankOverlay, setShowBankOverlay] = useState<boolean>(false);
  const [showGqlModal, setShowGqlModal] = useState<boolean>(false);
  const [simulatorOpen, setSimulatorOpen] = useState<boolean>(false);

  const [highlightedHopTxId, setHighlightedHopTxId] = useState<string | null>(
    null
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const [customTypology, setCustomTypology] = useState<TypologyCode>(
    'CIRCULAR_LAYERING'
  );
  const [customAnchorId, setCustomAnchorId] = useState<string>('8013C4030');
  const [customMinAmount, setCustomMinAmount] = useState<string>('100');

  const [isGeneratingSar, setIsGeneratingSar] = useState<boolean>(false);
  const [activeAlert, setActiveAlert] = useState<ComplianceAlert | null>(null);
  const [savedAlerts, setSavedAlerts] = useState<readonly ComplianceAlert[]>(
    []
  );

  const [interceptSender, setInterceptSender] =
    useState<string>('ACC_RING1_C');
  const [interceptReceiver, setInterceptReceiver] =
    useState<string>('ACC_RING1_A');
  const [interceptAmount, setInterceptAmount] = useState<string>('9100');
  const [isIntercepting, setIsIntercepting] = useState<boolean>(false);
  const [interceptResult, setInterceptResult] =
    useState<InterceptionResult | null>(null);

  const investigationAbortRef = useRef<AbortController | null>(null);

  const fetchAlerts = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/alerts', { signal });
      if (res.ok) {
        const envelope = (await res.json()) as ApiEnvelope<{
          readonly alerts: readonly ComplianceAlert[];
        }>;
        if (envelope.success && envelope.data?.alerts) {
          setSavedAlerts(envelope.data.alerts);
        }
      }
    } catch {
      // Non-fatal background refresh
    }
  }, []);

  const runInvestigation = useCallback(
    async (params: {
      readonly case_id: string;
      readonly typology: TypologyCode;
      readonly account_id: string;
      readonly min_amount: number;
    }) => {
      investigationAbortRef.current?.abort();
      const controller = new AbortController();
      investigationAbortRef.current = controller;

      setIsLoadingGraph(true);
      setErrorMessage(null);
      setActiveAlert(null);
      setSelectedNodeId(null);
      setHighlightedHopTxId(null);
      try {
        const res = await fetch('/api/investigate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
          signal: controller.signal,
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as {
            detail?: string;
          };
          throw new Error(
            errBody.detail ?? `HTTP ${res.status} while querying Spanner Graph`
          );
        }
        const envelope =
          (await res.json()) as ApiEnvelope<EnrichedCaseInvestigation>;
        setInvestigation(envelope.data);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setErrorMessage(getErrorMessage(err));
      } finally {
        if (investigationAbortRef.current === controller) {
          setIsLoadingGraph(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    const controller = new AbortController();
    async function bootstrap() {
      try {
        const [healthRes, catalogRes, universeRes] = await Promise.all([
          fetch('/api/health', { signal: controller.signal }),
          fetch('/api/catalog', { signal: controller.signal }),
          fetch('/api/universe', { signal: controller.signal }),
        ]);
        if (healthRes.ok) {
          const hEnv = (await healthRes.json()) as ApiEnvelope<HealthResponse>;
          setHealth(hEnv.data);
        }
        if (universeRes.ok) {
          const uEnv =
            (await universeRes.json()) as ApiEnvelope<GraphUniverseResponse>;
          setUniverse(uEnv.data);
        }
        if (catalogRes.ok) {
          const cEnv = (await catalogRes.json()) as ApiEnvelope<{
            readonly cases: readonly CaseSummary[];
          }>;
          const catalog = cEnv.data?.cases ?? [];
          setCases(catalog);
          if (catalog.length > 0) {
            const initialCase = catalog[0];
            setSelectedCaseId(initialCase.case_id);
            await runInvestigation({
              case_id: initialCase.case_id,
              typology: initialCase.typology,
              account_id: initialCase.account_id,
              min_amount: initialCase.min_amount,
            });
          }
        }
        await fetchAlerts(controller.signal);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setErrorMessage(getErrorMessage(err));
      }
    }
    void bootstrap();
    return () => {
      controller.abort();
      investigationAbortRef.current?.abort();
    };
  }, [runInvestigation, fetchAlerts]);

  const handleSelectCatalogCase = (item: CaseSummary) => {
    setSelectedCaseId(item.case_id);
    setCustomTypology(item.typology);
    setCustomAnchorId(item.account_id);
    setCustomMinAmount(String(item.min_amount));
    void runInvestigation({
      case_id: item.case_id,
      typology: item.typology,
      account_id: item.account_id,
      min_amount: item.min_amount,
    });
  };

  const handleRunCustomQuery = () => {
    const parsedMin = Number.parseFloat(customMinAmount) || 100;
    const adhocId = `ADHOC_${customTypology}_${customAnchorId || 'SCAN'}`;
    setSelectedCaseId(adhocId);
    void runInvestigation({
      case_id: adhocId,
      typology: customTypology,
      account_id: customAnchorId.trim(),
      min_amount: parsedMin,
    });
  };

  const handleDraftSingleTicketSar = async () => {
    if (!investigation) {
      return;
    }
    setIsGeneratingSar(true);
    setErrorMessage(null);
    try {
      const activeCatalog = cases.find((c) => c.case_id === selectedCaseId);
      const res = await fetch('/api/alerts/generate-sar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case_id: investigation.case_id,
          typology: investigation.evidence.typology,
          account_id:
            activeCatalog?.account_id ??
            investigation.evidence.account_ids[0] ??
            '',
          min_amount: activeCatalog?.min_amount ?? 100,
          persist_alert: true,
        }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          detail?: string;
        };
        throw new Error(errBody.detail ?? `SAR Generation HTTP ${res.status}`);
      }
      const envelope = (await res.json()) as ApiEnvelope<ComplianceAlert>;
      setActiveAlert(envelope.data);
      await fetchAlerts();
    } catch (err: unknown) {
      setErrorMessage(getErrorMessage(err));
    } finally {
      setIsGeneratingSar(false);
    }
  };

  const handleSimulatePaymentIntercept = async () => {
    setIsIntercepting(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/intercept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_account_id: interceptSender.trim(),
          to_account_id: interceptReceiver.trim(),
          amount_paid: Number.parseFloat(interceptAmount) || 5000,
          payment_currency: 'USD',
          payment_format: 'Wire',
          persist: false,
        }),
      });
      if (!res.ok) {
        throw new Error(`Interceptor HTTP ${res.status}`);
      }
      const envelope = (await res.json()) as ApiEnvelope<InterceptionResult>;
      setInterceptResult(envelope.data);
    } catch (err: unknown) {
      setErrorMessage(getErrorMessage(err));
    } finally {
      setIsIntercepting(false);
    }
  };

  const { nodes, edges } = useMemo(() => {
    if (!investigation) {
      return { nodes: [], edges: [] };
    }
    return buildReactFlowGraph(investigation, {
      showOwnershipOverlay,
      showBankOverlay,
      highlightedHopTxId,
      selectedNodeId,
    });
  }, [
    investigation,
    showOwnershipOverlay,
    showBankOverlay,
    highlightedHopTxId,
    selectedNodeId,
  ]);

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (
      !node.id.startsWith('entity:') &&
      !node.id.startsWith('ubo:') &&
      !node.id.startsWith('bank:')
    ) {
      setSelectedNodeId(node.id);
    }
  }, []);

  const selectedAccountProfile = useMemo(() => {
    if (!investigation) {
      return null;
    }
    const targetId =
      selectedNodeId ?? investigation.evidence.account_ids[0] ?? '';
    return investigation.kyc_profiles[targetId] ?? null;
  }, [investigation, selectedNodeId]);

  const totalVolumeUsd = useMemo(() => {
    if (!investigation) {
      return 0;
    }
    return investigation.evidence.hops.reduce(
      (sum, h) => sum + h.amount_paid,
      0
    );
  }, [investigation]);

  return (
    <div>
      <WorkbenchHeader
        health={health}
        lastLatencyMs={investigation?.evidence.query_latency_ms ?? null}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        onOpenSimulator={() => setSimulatorOpen(true)}
      />

      {viewMode !== 'workbench2d' ? (
        <>
          <ScrollytellingStage
            health={health}
            universe={universe}
            cases={cases}
            selectedCaseId={selectedCaseId}
            onSelectCase={handleSelectCatalogCase}
            investigation={investigation}
            isLoadingGraph={isLoadingGraph}
            totalVolumeUsd={totalVolumeUsd}
            showOwnershipOverlay={showOwnershipOverlay}
            onToggleOwnershipOverlay={() => setShowOwnershipOverlay((v) => !v)}
            showBankOverlay={showBankOverlay}
            onToggleBankOverlay={() => setShowBankOverlay((v) => !v)}
            selectedNodeId={selectedNodeId}
            onSelectNodeId={setSelectedNodeId}
            selectedAccountProfile={selectedAccountProfile}
            interceptSender={interceptSender}
            onChangeInterceptSender={setInterceptSender}
            interceptReceiver={interceptReceiver}
            onChangeInterceptReceiver={setInterceptReceiver}
            interceptAmount={interceptAmount}
            onChangeInterceptAmount={setInterceptAmount}
            onSimulateIntercept={handleSimulatePaymentIntercept}
            isIntercepting={isIntercepting}
            interceptResult={interceptResult}
            onDraftSingleTicketSar={handleDraftSingleTicketSar}
            isGeneratingSar={isGeneratingSar}
            activeAlert={activeAlert}
            freeOrbitOnly={viewMode === 'free3d'}
          />
          {simulatorOpen && (
            <InvestigationSidebar
              cases={cases}
              selectedCaseId={selectedCaseId}
              onSelectCase={handleSelectCatalogCase}
              simulatorOpen={simulatorOpen}
              onCloseSimulator={() => setSimulatorOpen(false)}
              customTypology={customTypology}
              onChangeCustomTypology={setCustomTypology}
              customAnchorId={customAnchorId}
              onChangeCustomAnchorId={setCustomAnchorId}
              customMinAmount={customMinAmount}
              onChangeCustomMinAmount={setCustomMinAmount}
              onRunCustomQuery={handleRunCustomQuery}
              isLoadingGraph={isLoadingGraph}
              interceptSender={interceptSender}
              onChangeInterceptSender={setInterceptSender}
              interceptReceiver={interceptReceiver}
              onChangeInterceptReceiver={setInterceptReceiver}
              interceptAmount={interceptAmount}
              onChangeInterceptAmount={setInterceptAmount}
              onSimulateIntercept={handleSimulatePaymentIntercept}
              isIntercepting={isIntercepting}
              interceptResult={interceptResult}
            />
          )}
        </>
      ) : (
        <div className="m3-workspace">
          <InvestigationSidebar
            cases={cases}
            selectedCaseId={selectedCaseId}
            onSelectCase={handleSelectCatalogCase}
            simulatorOpen={simulatorOpen}
            onCloseSimulator={() => setSimulatorOpen(false)}
            customTypology={customTypology}
            onChangeCustomTypology={setCustomTypology}
            customAnchorId={customAnchorId}
            onChangeCustomAnchorId={setCustomAnchorId}
            customMinAmount={customMinAmount}
            onChangeCustomMinAmount={setCustomMinAmount}
            onRunCustomQuery={handleRunCustomQuery}
            isLoadingGraph={isLoadingGraph}
            interceptSender={interceptSender}
            onChangeInterceptSender={setInterceptSender}
            interceptReceiver={interceptReceiver}
            onChangeInterceptReceiver={setInterceptReceiver}
            interceptAmount={interceptAmount}
            onChangeInterceptAmount={setInterceptAmount}
            onSimulateIntercept={handleSimulatePaymentIntercept}
            isIntercepting={isIntercepting}
            interceptResult={interceptResult}
          />

          <main className="m3-stage">
            <DemoStoryBanner
              guide={investigation?.demo_guide}
              investigation={investigation}
              totalVolumeUsd={totalVolumeUsd}
              showGqlModal={showGqlModal}
              onToggleGqlModal={() => setShowGqlModal((v) => !v)}
            />

            {errorMessage && (
              <div
                className="m3-card m3-card--tonal-error"
                style={{
                  margin: '8px 16px 0',
                  padding: '8px 14px',
                  fontSize: '0.8rem',
                }}
              >
                {errorMessage}
              </div>
            )}

            <div className="m3-canvas-wrap">
              <div className="m3-canvas-controls-bar">
                <button
                  type="button"
                  className={`m3-filter-chip ${
                    showOwnershipOverlay ? 'm3-filter-chip--active' : ''
                  }`}
                  onClick={() => setShowOwnershipOverlay((v) => !v)}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                  >
                    {showOwnershipOverlay ? 'check' : 'person_search'}
                  </span>
                  Reveal UBO & Entities
                </button>

                <button
                  type="button"
                  className={`m3-filter-chip ${
                    showBankOverlay ? 'm3-filter-chip--active' : ''
                  }`}
                  onClick={() => setShowBankOverlay((v) => !v)}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                  >
                    {showBankOverlay ? 'check' : 'account_balance'}
                  </span>
                  Reveal Banks
                </button>

                <button
                  type="button"
                  className={`m3-filter-chip ${
                    showGqlModal ? 'm3-filter-chip--active' : ''
                  }`}
                  onClick={() => setShowGqlModal(true)}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 16 }}
                  >
                    code
                  </span>
                  View ISO GQL Query
                </button>
              </div>

              <div className="m3-canvas-legend">
                <span>
                  <span
                    className="m3-legend-dot"
                    style={{ background: '#0b57d0' }}
                  />
                  Anchor / Money Flow
                </span>
                <span>
                  <span
                    className="m3-legend-dot"
                    style={{ background: '#b3261e' }}
                  />
                  High-Risk / PEP Linked
                </span>
                {showOwnershipOverlay && (
                  <span>
                    <span
                      className="m3-legend-dot"
                      style={{ background: '#7c3aed' }}
                    />
                    Beneficial Owner (UBO)
                  </span>
                )}
              </div>

              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                edgeTypes={EDGE_TYPES}
                onNodeClick={handleNodeClick}
                fitView
                fitViewOptions={{ padding: 0.24 }}
                minZoom={0.25}
                maxZoom={1.75}
                proOptions={{ hideAttribution: true }}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={22}
                  size={1.2}
                  color="#cbd5e1"
                />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
          </main>

          <CaseDossierSidebar
            investigation={investigation}
            selectedAccountProfile={selectedAccountProfile}
            highlightedHopTxId={highlightedHopTxId}
            onHoverHop={setHighlightedHopTxId}
            onSelectAccountId={setSelectedNodeId}
            onDraftSingleTicketSar={handleDraftSingleTicketSar}
            isGeneratingSar={isGeneratingSar}
            activeAlert={activeAlert}
            savedAlerts={savedAlerts}
          />
        </div>
      )}
    </div>
  );
}

export default App;
