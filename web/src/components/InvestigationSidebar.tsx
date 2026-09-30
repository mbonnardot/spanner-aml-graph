import {
  Button,
  Select,
  SelectItem,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
  TextInput,
  Tile,
} from '@carbon/react';
import { Flash, Search } from '@carbon/icons-react';
import type {
  CaseSummary,
  InterceptionResult,
  TypologyCode,
} from '../types/aml';

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

type Props = {
  readonly cases: readonly CaseSummary[];
  readonly selectedCaseId: string;
  readonly isLoadingGraph: boolean;
  readonly customTypology: TypologyCode;
  readonly customAnchorId: string;
  readonly customMinAmount: string;
  readonly interceptSender: string;
  readonly interceptReceiver: string;
  readonly interceptAmount: string;
  readonly isIntercepting: boolean;
  readonly interceptResult: InterceptionResult | null;
  readonly onSelectCatalogCase: (item: CaseSummary) => void;
  readonly onCustomTypologyChange: (value: TypologyCode) => void;
  readonly onCustomAnchorChange: (value: string) => void;
  readonly onCustomMinAmountChange: (value: string) => void;
  readonly onRunCustomQuery: () => void;
  readonly onInterceptSenderChange: (value: string) => void;
  readonly onInterceptReceiverChange: (value: string) => void;
  readonly onInterceptAmountChange: (value: string) => void;
  readonly onSimulateIntercept: () => void;
};

export function InvestigationSidebar({
  cases,
  selectedCaseId,
  isLoadingGraph,
  customTypology,
  customAnchorId,
  customMinAmount,
  interceptSender,
  interceptReceiver,
  interceptAmount,
  isIntercepting,
  interceptResult,
  onSelectCatalogCase,
  onCustomTypologyChange,
  onCustomAnchorChange,
  onCustomMinAmountChange,
  onRunCustomQuery,
  onInterceptSenderChange,
  onInterceptReceiverChange,
  onInterceptAmountChange,
  onSimulateIntercept,
}: Props) {
  const isBlocked =
    interceptResult?.decision === 'HELD' ||
    interceptResult?.decision === 'BLOCK_HOLD_COMPLIANCE';

  return (
    <aside className="left-sidebar" aria-label="Investigation Controls">
      <Tabs>
        <TabList aria-label="Investigation Modes">
          <Tab>Flagged Rings ({cases.length})</Tab>
          <Tab>Ad-Hoc GQL</Tab>
          <Tab>Pre-Settlement Gate</Tab>
        </TabList>
        <TabPanels>
          <TabPanel style={{ padding: '10px 0' }}>
            <div className="case-card-summary" style={{ marginBottom: 10 }}>
              Select any detected Spanner Graph laundering ring to inspect its
              multi-hop topology and KYC/UBO profile ($0 LLM cost):
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {cases.map((c) => {
                const isActive = c.case_id === selectedCaseId;
                return (
                  <div
                    key={c.case_id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectCatalogCase(c)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectCatalogCase(c);
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
                        className="tabular-nums"
                        style={{ fontSize: 11, color: '#78a9ff' }}
                      >
                        {c.account_id || 'GLOBAL'}
                      </span>
                    </div>
                    <div className="case-card-title">{c.title}</div>
                    <div className="case-card-summary">{c.summary}</div>
                  </div>
                );
              })}
            </div>
          </TabPanel>

          <TabPanel style={{ padding: '12px 0' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Select
                id="adhoc-typology"
                labelText="ISO GQL Pattern Typology"
                value={customTypology}
                onChange={(e) =>
                  onCustomTypologyChange(e.target.value as TypologyCode)
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
                onChange={(e) => onCustomAnchorChange(e.target.value)}
              />
              <TextInput
                id="adhoc-min-amount"
                labelText="Min Hop Amount (USD)"
                value={customMinAmount}
                onChange={(e) => onCustomMinAmountChange(e.target.value)}
              />
              <Button
                kind="primary"
                size="md"
                renderIcon={Search}
                onClick={onRunCustomQuery}
                disabled={isLoadingGraph}
              >
                Execute Spanner GQL Traversal
              </Button>
            </div>
          </TabPanel>

          <TabPanel style={{ padding: '12px 0' }}>
            <Tile className="dossier-tile">
              <div className="case-card-title" style={{ marginBottom: 6 }}>
                Synchronous Payment Gate (&lt;500ms)
              </div>
              <div className="case-card-summary" style={{ marginBottom: 12 }}>
                Tests whether a proposed wire transfer from{' '}
                <code>from_account_id → to_account_id</code> closes an active
                multi-hop laundering cycle in Spanner Graph before settlement.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <TextInput
                  id="intercept-sender"
                  labelText="Proposed Wire Sender Account"
                  value={interceptSender}
                  onChange={(e) => onInterceptSenderChange(e.target.value)}
                />
                <TextInput
                  id="intercept-receiver"
                  labelText="Proposed Wire Beneficiary Account"
                  value={interceptReceiver}
                  onChange={(e) => onInterceptReceiverChange(e.target.value)}
                />
                <TextInput
                  id="intercept-amount"
                  labelText="Proposed Wire Amount (USD)"
                  value={interceptAmount}
                  onChange={(e) => onInterceptAmountChange(e.target.value)}
                />
                <Button
                  kind="danger--tertiary"
                  size="sm"
                  renderIcon={Flash}
                  onClick={onSimulateIntercept}
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
                      isBlocked ? '#da1e28' : '#24a148'
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
                    <Tag type={isBlocked ? 'red' : 'green'} size="sm">
                      {interceptResult.decision}
                    </Tag>
                    <span className="tabular-nums" style={{ fontSize: 11 }}>
                      {interceptResult.latency_ms.toFixed(1)} ms
                    </span>
                  </div>
                  <div className="case-card-summary" style={{ color: '#e0e0e0' }}>
                    {isBlocked
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
  );
}
