import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Header,
  HeaderName,
  HeaderGlobalBar,
  Tag,
  Button,
  Tile,
  TextInput,
  Select,
  SelectItem,
  Toggle,
  InlineNotification,
  InlineLoading,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
} from '@carbon/react';
import {
  Network_3,
  Security,
  DocumentSigned,
  Flash,
  CheckmarkFilled,
  Search,
} from '@carbon/icons-react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
} from '@xyflow/react';
import type { NodeMouseHandler } from '@xyflow/react';
import { AccountNode, BankNode, EntityNode } from './components/CarbonNodes';
import { TransferHopEdge } from './components/TransferHopEdge';
import { buildReactFlowGraph } from './utils/graphLayout';
import type {
  ApiEnvelope,
  CaseSummary,
  ComplianceAlert,
  EnrichedCaseInvestigation,
  HealthResponse,
  InterceptionResult,
  TypologyCode,
} from './types/aml';

const NODE_TYPES = {
  accountNode: AccountNode,
  entityNode: EntityNode,
  bankNode: BankNode,
};

const EDGE_TYPES = {
  transferHopEdge: TransferHopEdge,
};

const ALL_TYPOLOGIES: readonly TypologyCode[] = [
  'CIRCULAR_LAYERING',
  'UBO_SHELL_RING',
  'SAME_ENTITY_RING',
  'SCATTER_GATHER',
  'GATHER_SCATTER',
  'FAN_OUT',
  'FAN_IN',
  'BIPARTITE',
  'STACKED_BIPARTITE',
  'RANDOM_WALK',
];

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return 'Unexpected API error';
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [cases, setCases] = useState<readonly CaseSummary[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>(
    'CASE_HI_CYCLE_10HOP'
  );
  const [investigation, setInvestigation] =
    useState<EnrichedCaseInvestigation | null>(null);
  const [isLoadingGraph, setIsLoadingGraph] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Graph overlays & interactive hover/selection state
  const [showOwnershipOverlay, setShowOwnershipOverlay] =
    useState<boolean>(true);
  const [showBankOverlay, setShowBankOverlay] = useState<boolean>(false);
  const [highlightedHopTxId, setHighlightedHopTxId] = useState<string | null>(
    null
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Custom ad-hoc query state
  const [customTypology, setCustomTypology] = useState<TypologyCode>(
    'CIRCULAR_LAYERING'
  );
  const [customAnchorId, setCustomAnchorId] = useState<string>('8013C4030');
  const [customMinAmount, setCustomMinAmount] = useState<string>('100');

  // Controlled single-ticket SAR generation state
  const [isGeneratingSar, setIsGeneratingSar] = useState<boolean>(false);
  const [activeAlert, setActiveAlert] = useState<ComplianceAlert | null>(null);
  const [savedAlerts, setSavedAlerts] = useState<readonly ComplianceAlert[]>(
    []
  );

  // Pre-Settlement Interceptor state
  const [interceptSender, setInterceptSender] =
    useState<string>('ACC_RING1_C');
  const [interceptReceiver, setInterceptReceiver] =
    useState<string>('ACC_RING1_A');
  const [interceptAmount, setInterceptAmount] = useState<string>('9100');
  const [isIntercepting, setIsIntercepting] = useState<boolean>(false);
  const [interceptResult, setInterceptResult] =
    useState<InterceptionResult | null>(null);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts');
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
        setErrorMessage(getErrorMessage(err));
      } finally {
        setIsLoadingGraph(false);
      }
    },
    []
  );

  useEffect(() => {
    async function bootstrap() {
      try {
        const [healthRes, catalogRes] = await Promise.all([
          fetch('/api/health'),
          fetch('/api/catalog'),
        ]);
        if (healthRes.ok) {
          const hEnv = (await healthRes.json()) as ApiEnvelope<HealthResponse>;
          setHealth(hEnv.data);
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
        await fetchAlerts();
      } catch (err: unknown) {
        setErrorMessage(getErrorMessage(err));
      }
    }
    void bootstrap();
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

  const riskTagType =
    investigation?.risk_assessment.risk_level === 'CRITICAL'
      ? 'red'
      : investigation?.risk_assessment.risk_level === 'HIGH'
      ? 'magenta'
      : investigation?.risk_assessment.risk_level === 'MEDIUM'
      ? 'warm-gray'
      : 'green';

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
    <div className="cds--g100">
      <Header aria-label="Cloud Spanner Graph AML Workbench">
        <HeaderName href="#" prefix="Google Cloud Spanner Graph">
          AML Compliance & SAR Workbench
        </HeaderName>
        <HeaderGlobalBar>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              paddingRight: 16,
            }}
          >
            <Tag type="green" size="sm" renderIcon={CheckmarkFilled}>
              {health
                ? `AmlGraph Online (${health.accounts_count.toLocaleString()} Accts • ${health.transactions_count.toLocaleString()} Txs)`
                : 'Connecting to Spanner Graph...'}
            </Tag>
            {investigation && (
              <Tag type="blue" size="sm" renderIcon={Flash}>
                GQL Latency:{' '}
                {investigation.evidence.query_latency_ms.toFixed(1)} ms
              </Tag>
            )}
            <Tag type="purple" size="sm" renderIcon={Security}>
              Cost Guard: $0 LLM on Detection (1-Ticket SAR On-Demand)
            </Tag>
          </div>
        </HeaderGlobalBar>
      </Header>

      <main className="workbench-shell">
        {/* LEFT PANE: Case Catalog + Ad-Hoc Query + Payment Interceptor */}
        <aside className="left-sidebar">
          <Tabs>
            <TabList aria-label="Investigation Modes">
              <Tab>Flagged Rings ({cases.length})</Tab>
              <Tab>Ad-Hoc GQL</Tab>
              <Tab>Pre-Settlement Gate</Tab>
            </TabList>
            <TabPanels>
              {/* TAB 1: Flagged Case Catalog */}
              <TabPanel style={{ padding: '10px 0' }}>
                <div
                  style={{
                    fontSize: 12,
                    color: '#a8a8a8',
                    marginBottom: 10,
                  }}
                >
                  Select any detected Spanner Graph laundering ring to inspect
                  its multi-hop topology and KYC/UBO profile ($0 LLM cost):
                </div>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  {cases.map((c) => {
                    const isActive = c.case_id === selectedCaseId;
                    return (
                      <div
                        key={c.case_id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleSelectCatalogCase(c)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            handleSelectCatalogCase(c);
                          }
                        }}
                        className={`case-card ${
                          isActive ? 'case-card--active' : ''
                        }`}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 4,
                          }}
                        >
                          <Tag type="high-contrast" size="sm">
                            {c.typology}
                          </Tag>
                          <span
                            style={{
                              fontFamily: "'IBM Plex Mono', monospace",
                              fontSize: 11,
                              color: '#78a9ff',
                            }}
                          >
                            {c.account_id || 'GLOBAL'}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: '#f4f4f4',
                            marginBottom: 2,
                          }}
                        >
                          {c.title}
                        </div>
                        <div style={{ fontSize: 11, color: '#a8a8a8' }}>
                          {c.summary}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TabPanel>

              {/* TAB 2: Ad-Hoc Spanner Graph GQL Query */}
              <TabPanel style={{ padding: '12px 0' }}>
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
                >
                  <Select
                    id="adhoc-typology"
                    labelText="ISO GQL Pattern Typology"
                    value={customTypology}
                    onChange={(e) =>
                      setCustomTypology(e.target.value as TypologyCode)
                    }
                  >
                    {ALL_TYPOLOGIES.map((t) => (
                      <SelectItem key={t} value={t} text={t} />
                    ))}
                  </Select>
                  <TextInput
                    id="adhoc-anchor"
                    labelText="Origin / Hub Account ID"
                    placeholder="e.g. 8013C4030 or ACC_RING1_A"
                    value={customAnchorId}
                    onChange={(e) => setCustomAnchorId(e.target.value)}
                  />
                  <TextInput
                    id="adhoc-min-amount"
                    labelText="Min Hop Amount (USD)"
                    value={customMinAmount}
                    onChange={(e) => setCustomMinAmount(e.target.value)}
                  />
                  <Button
                    kind="primary"
                    size="md"
                    renderIcon={Search}
                    onClick={handleRunCustomQuery}
                    disabled={isLoadingGraph}
                  >
                    Execute Spanner GQL Traversal
                  </Button>
                </div>
              </TabPanel>

              {/* TAB 3: Real-Time Pre-Settlement Payment Interceptor */}
              <TabPanel style={{ padding: '12px 0' }}>
                <Tile style={{ backgroundColor: '#262626', padding: 12 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      marginBottom: 6,
                    }}
                  >
                    Synchronous Payment Gate (&lt;500ms)
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: '#c6c6c6',
                      marginBottom: 12,
                    }}
                  >
                    Tests whether a proposed wire transfer from{' '}
                    <code>from_account_id → to_account_id</code> closes an
                    active multi-hop laundering cycle in Spanner Graph before
                    settlement.
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <TextInput
                      id="intercept-sender"
                      labelText="Proposed Wire Sender Account"
                      value={interceptSender}
                      onChange={(e) => setInterceptSender(e.target.value)}
                    />
                    <TextInput
                      id="intercept-receiver"
                      labelText="Proposed Wire Beneficiary Account"
                      value={interceptReceiver}
                      onChange={(e) => setInterceptReceiver(e.target.value)}
                    />
                    <TextInput
                      id="intercept-amount"
                      labelText="Proposed Wire Amount (USD)"
                      value={interceptAmount}
                      onChange={(e) => setInterceptAmount(e.target.value)}
                    />
                    <Button
                      kind="danger--tertiary"
                      size="sm"
                      renderIcon={Flash}
                      onClick={handleSimulatePaymentIntercept}
                      disabled={isIntercepting}
                    >
                      {isIntercepting
                        ? 'Checking Graph...'
                        : 'Simulate Pre-Settlement Check'}
                    </Button>
                  </div>

                  {interceptResult && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: 10,
                        background: '#161616',
                        borderLeft: `4px solid ${
                          interceptResult.decision === 'HELD' ||
                          interceptResult.decision === 'BLOCK_HOLD_COMPLIANCE'
                            ? '#da1e28'
                            : '#24a148'
                        }`,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 6,
                        }}
                      >
                        <Tag
                          type={
                            interceptResult.decision === 'HELD' ||
                            interceptResult.decision === 'BLOCK_HOLD_COMPLIANCE'
                              ? 'red'
                              : 'green'
                          }
                          size="sm"
                        >
                          {interceptResult.decision}
                        </Tag>
                        <span
                          style={{
                            fontFamily: "'IBM Plex Mono', monospace",
                            fontSize: 11,
                          }}
                        >
                          {interceptResult.latency_ms.toFixed(1)} ms
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: '#e0e0e0' }}>
                        {interceptResult.decision === 'HELD' ||
                        interceptResult.decision === 'BLOCK_HOLD_COMPLIANCE'
                          ? `Blocked (HELD): Transfer closes ${interceptResult.matched_rings.length} active circular layering path(s) returning to ${interceptResult.to_account_id}.`
                          : 'Approved (SETTLED): No circular laundering path closed by this transfer.'}
                      </div>
                    </div>
                  )}
                </Tile>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </aside>

        {/* CENTER PANE: @xyflow/react Subgraph Canvas + Chronological Hop Timeline */}
        <section className="center-stage">
          {errorMessage && (
            <InlineNotification
              kind="error"
              title="Spanner Graph Query Error"
              subtitle={errorMessage}
              onCloseButtonClick={() => setErrorMessage(null)}
              lowContrast
            />
          )}

          <div className="graph-canvas-wrapper">
            {isLoadingGraph && (
              <div
                style={{
                  position: 'absolute',
                  top: 16,
                  left: 16,
                  zIndex: 20,
                  background: '#262626',
                  padding: '8px 14px',
                  border: '1px solid #4589ff',
                }}
              >
                <InlineLoading description="Executing ISO GQL traversal on Cloud Spanner..." />
              </div>
            )}

            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              onNodeClick={handleNodeClick}
              fitView
              fitViewOptions={{ padding: 0.22 }}
              minZoom={0.2}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#333333" gap={22} size={1} />
              <Controls />
              <MiniMap
                nodeColor={(n) =>
                  n.type === 'entityNode'
                    ? '#a56eff'
                    : n.type === 'bankNode'
                    ? '#6f6f6f'
                    : '#4589ff'
                }
                maskColor="rgba(22, 22, 22, 0.75)"
                style={{
                  backgroundColor: '#1c1c1c',
                  border: '1px solid #393939',
                }}
              />
              <Panel
                position="top-right"
                style={{
                  background: 'rgba(28, 28, 28, 0.92)',
                  border: '1px solid #393939',
                  padding: '8px 12px',
                  display: 'flex',
                  gap: 16,
                  alignItems: 'center',
                }}
              >
                <Toggle
                  id="toggle-ownership"
                  size="sm"
                  labelText="Entity & UBO Overlay"
                  labelA="Off"
                  labelB="On"
                  toggled={showOwnershipOverlay}
                  onToggle={(checked) => setShowOwnershipOverlay(checked)}
                />
                <Toggle
                  id="toggle-banks"
                  size="sm"
                  labelText="Bank Nodes"
                  labelA="Off"
                  labelB="On"
                  toggled={showBankOverlay}
                  onToggle={(checked) => setShowBankOverlay(checked)}
                />
              </Panel>
            </ReactFlow>
          </div>

          {/* BOTTOM CENTER: Carbon DataTable Chronological Hop Timeline */}
          <div className="hop-timeline-panel">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Network_3 size={16} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  Chronological GQL Transfer Path (
                  {investigation?.evidence.hop_count ?? 0} Hops • $
                  {totalVolumeUsd.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}{' '}
                  USD Total Flow)
                </span>
              </div>
              <span style={{ fontSize: 11, color: '#a8a8a8' }}>
                Hover any row to highlight the corresponding edge and accounts
                on the graph
              </span>
            </div>

            <Table size="sm" useZebraStyles={false}>
              <TableHead>
                <TableRow>
                  <TableHeader>Hop #</TableHeader>
                  <TableHeader>Transaction ID</TableHeader>
                  <TableHeader>Sender Account</TableHeader>
                  <TableHeader>Beneficiary Account</TableHeader>
                  <TableHeader>Amount Paid (USD)</TableHeader>
                  <TableHeader>Payment Format</TableHeader>
                  <TableHeader>UTC Timestamp</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {(investigation?.evidence.hops ?? []).map((hop) => {
                  const isRowActive = highlightedHopTxId === hop.transaction_id;
                  return (
                    <TableRow
                      key={`${hop.hop_index}-${hop.transaction_id}`}
                      onMouseEnter={() =>
                        setHighlightedHopTxId(hop.transaction_id)
                      }
                      onMouseLeave={() => setHighlightedHopTxId(null)}
                      style={{
                        cursor: 'pointer',
                        backgroundColor: isRowActive ? '#353535' : undefined,
                      }}
                    >
                      <TableCell>
                        <Tag type="blue" size="sm">
                          #{hop.hop_index}
                        </Tag>
                      </TableCell>
                      <TableCell
                        style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                      >
                        {hop.transaction_id}
                      </TableCell>
                      <TableCell
                        style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                      >
                        {hop.from_account_id}
                      </TableCell>
                      <TableCell
                        style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                      >
                        {hop.to_account_id}
                      </TableCell>
                      <TableCell
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          color: '#ff832b',
                          fontWeight: 600,
                        }}
                      >
                        $
                        {hop.amount_paid.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </TableCell>
                      <TableCell>{hop.payment_format}</TableCell>
                      <TableCell
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: 11,
                        }}
                      >
                        {hop.event_timestamp}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </section>

        {/* RIGHT PANE: Deterministic Risk Dossier + Controlled Single-Ticket SAR Generator */}
        <aside className="right-dossier">
          {investigation && (
            <>
              <Tile style={{ backgroundColor: '#262626', padding: 14 }}>
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
                      fontSize: 12,
                      textTransform: 'uppercase',
                      letterSpacing: 0.6,
                      color: '#a8a8a8',
                    }}
                  >
                    Deterministic Graph Risk Score
                  </span>
                  <Tag type={riskTagType} size="md">
                    {investigation.risk_assessment.risk_level} (
                    {investigation.risk_assessment.risk_score.toFixed(2)})
                  </Tag>
                </div>

                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    marginBottom: 8,
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
                  {investigation.case_id} • {investigation.evidence.typology}
                </div>

                <ul
                  style={{
                    margin: '0 0 12px 16px',
                    padding: 0,
                    fontSize: 12,
                    color: '#e0e0e0',
                    lineHeight: 1.5,
                  }}
                >
                  {investigation.risk_assessment.reasons.map((reason, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      {reason}
                    </li>
                  ))}
                </ul>

                {/* CONTROLLED SINGLE-TICKET SAR ACTION */}
                <Button
                  kind="primary"
                  size="md"
                  renderIcon={DocumentSigned}
                  onClick={handleDraftSingleTicketSar}
                  disabled={isGeneratingSar}
                  style={{ width: '100%', maxWidth: 'none' }}
                >
                  {isGeneratingSar
                    ? 'Drafting Grounded FinCEN SAR (1 Ticket)...'
                    : 'Draft FinCEN SAR (1 Ticket Only)'}
                </Button>
                <div
                  style={{
                    fontSize: 10.5,
                    color: '#a8a8a8',
                    marginTop: 6,
                  }}
                >
                  Invokes Vertex AI Gemini 2.5 Flash strictly for this single
                  case and verifies 100% of cited Transaction & Account IDs
                  against the Spanner Graph subgraph.
                </div>
              </Tile>

              {/* Selected Account KYC & UBO Dossier */}
              {selectedAccountProfile && (
                <Tile style={{ backgroundColor: '#262626', padding: 12 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      Selected Account KYC / UBO Profile
                    </span>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: 12,
                        color: '#78a9ff',
                      }}
                    >
                      {selectedAccountProfile.account_id}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: '#e0e0e0',
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 6,
                    }}
                  >
                    <div>
                      <span style={{ color: '#8d8d8d' }}>Owner Entity: </span>
                      {selectedAccountProfile.entity_name} (
                      {selectedAccountProfile.entity_id})
                    </div>
                    <div>
                      <span style={{ color: '#8d8d8d' }}>Jurisdiction: </span>
                      {selectedAccountProfile.entity_jurisdiction}
                    </div>
                    <div>
                      <span style={{ color: '#8d8d8d' }}>Bank: </span>
                      {selectedAccountProfile.bank_name} (
                      {selectedAccountProfile.bank_id})
                    </div>
                    <div>
                      <span style={{ color: '#8d8d8d' }}>KYC Risk Tier: </span>
                      {selectedAccountProfile.kyc_risk_tier}
                    </div>
                  </div>
                  {selectedAccountProfile.ubo_entity_id && (
                    <div
                      style={{
                        marginTop: 8,
                        paddingTop: 6,
                        borderTop: '1px solid #393939',
                        fontSize: 11.5,
                      }}
                    >
                      <span style={{ color: '#ffb784', fontWeight: 600 }}>
                        Beneficial Owner (CONTROLS):{' '}
                      </span>
                      {selectedAccountProfile.ubo_entity_name} (
                      {selectedAccountProfile.ubo_entity_id})
                    </div>
                  )}
                </Tile>
              )}

              {/* Active SAR Narrative or Saved ComplianceAlerts History */}
              {activeAlert ? (
                <Tile style={{ backgroundColor: '#262626', padding: 12 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      FinCEN SAR Filing ({activeAlert.alert_id})
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
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
                  <div className="sar-narrative-box">
                    {activeAlert.sar_narrative}
                  </div>
                </Tile>
              ) : (
                <Tile style={{ backgroundColor: '#262626', padding: 12 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      marginBottom: 8,
                    }}
                  >
                    Persisted Spanner ComplianceAlerts ({savedAlerts.length})
                  </div>
                  {savedAlerts.length === 0 ? (
                    <div style={{ fontSize: 11.5, color: '#a8a8a8' }}>
                      No SARs filed yet in this session. Click{' '}
                      <strong>
                        &ldquo;Draft FinCEN SAR (1 Ticket Only)&rdquo;
                      </strong>{' '}
                      above to generate and persist a grounded SAR narrative to
                      Cloud Spanner.
                    </div>
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      {savedAlerts.slice(0, 5).map((a) => (
                        <div
                          key={a.alert_id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setActiveAlert(a)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') setActiveAlert(a);
                          }}
                          style={{
                            padding: 8,
                            background: '#161616',
                            border: '1px solid #393939',
                            cursor: 'pointer',
                            fontSize: 11.5,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                            }}
                          >
                            <span
                              style={{
                                fontFamily: "'IBM Plex Mono', monospace",
                                fontWeight: 600,
                              }}
                            >
                              {a.alert_id}
                            </span>
                            <Tag type="red" size="sm">
                              Risk {a.risk_score.toFixed(2)}
                            </Tag>
                          </div>
                          <div style={{ color: '#a8a8a8', marginTop: 2 }}>
                            {a.typology} • Trigger Tx {a.trigger_transaction_id}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Tile>
              )}
            </>
          )}
        </aside>
      </main>
    </div>
  );
}
export default App;
