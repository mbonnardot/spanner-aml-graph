import {
  Header,
  HeaderName,
  HeaderGlobalBar,
  Tag,
} from '@carbon/react';
import {
  CheckmarkFilled,
  Flash,
  Security,
} from '@carbon/icons-react';
import type { EnrichedCaseInvestigation, HealthResponse } from '../types/aml';

type Props = {
  readonly health: HealthResponse | null;
  readonly investigation: EnrichedCaseInvestigation | null;
};

export function WorkbenchHeader({ health, investigation }: Props) {
  return (
    <Header aria-label="Cloud Spanner Graph AML Workbench">
      <HeaderName href="#" prefix="Google Cloud Spanner Graph">
        AML Compliance &amp; SAR Workbench
      </HeaderName>
      <HeaderGlobalBar>
        <div className="workbench-header-bar">
          <Tag type="green" size="sm" renderIcon={CheckmarkFilled}>
            <span className="tabular-nums">
              {health
                ? `AmlGraph Online (${health.accounts_count.toLocaleString()} Accts • ${health.transactions_count.toLocaleString()} Txs)`
                : 'Connecting to Spanner Graph...'}
            </span>
          </Tag>
          {investigation && (
            <Tag type="blue" size="sm" renderIcon={Flash}>
              <span className="tabular-nums">
                GQL Latency: {investigation.evidence.query_latency_ms.toFixed(1)} ms
              </span>
            </Tag>
          )}
          <Tag type="purple" size="sm" renderIcon={Security}>
            Cost Guard: $0 LLM on Detection (1-Ticket SAR On-Demand)
          </Tag>
        </div>
      </HeaderGlobalBar>
    </Header>
  );
}
