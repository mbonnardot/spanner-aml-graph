import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@carbon/react';
import { Network_3 } from '@carbon/icons-react';
import type { TransferHop } from '../types/aml';

type Props = {
  readonly hops: readonly TransferHop[];
  readonly hopCount: number;
  readonly totalVolumeUsd: number;
  readonly highlightedHopTxId: string | null;
  readonly onHoverHop: (txId: string | null) => void;
};

export function HopTimelineTable({
  hops,
  hopCount,
  totalVolumeUsd,
  highlightedHopTxId,
  onHoverHop,
}: Props) {
  return (
    <div className="hop-timeline-panel">
      <div className="hop-timeline-header">
        <div className="hop-timeline-title">
          <Network_3 size={16} />
          <span>
            Chronological GQL Transfer Path (
            <span className="tabular-nums">{hopCount}</span> Hops •{' '}
            <span className="tabular-nums">
              $
              {totalVolumeUsd.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}
            </span>{' '}
            USD Total Flow)
          </span>
        </div>
        <span className="hop-timeline-hint">
          Hover any row to highlight the corresponding edge and accounts on the
          graph
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
          {hops.map((hop) => {
            const isRowActive = highlightedHopTxId === hop.transaction_id;
            return (
              <TableRow
                key={`${hop.hop_index}-${hop.transaction_id}`}
                onMouseEnter={() => onHoverHop(hop.transaction_id)}
                onMouseLeave={() => onHoverHop(null)}
                className={`hop-row ${isRowActive ? 'hop-row--active' : ''}`}
              >
                <TableCell>
                  <Tag type="blue" size="sm">
                    <span className="tabular-nums">#{hop.hop_index}</span>
                  </Tag>
                </TableCell>
                <TableCell className="tabular-nums">
                  {hop.transaction_id}
                </TableCell>
                <TableCell className="tabular-nums">
                  {hop.from_account_id}
                </TableCell>
                <TableCell className="tabular-nums">
                  {hop.to_account_id}
                </TableCell>
                <TableCell
                  className="tabular-nums"
                  style={{ color: '#ff832b', fontWeight: 600 }}
                >
                  $
                  {hop.amount_paid.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </TableCell>
                <TableCell>{hop.payment_format}</TableCell>
                <TableCell className="tabular-nums" style={{ fontSize: 11 }}>
                  {hop.event_timestamp}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
