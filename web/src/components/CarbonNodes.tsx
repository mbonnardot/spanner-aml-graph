import type { Node, NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import type {
  AccountNodeData,
  BankNodeData,
  EntityNodeData,
} from '../types/aml';

export function AccountNode({ data }: NodeProps<Node<AccountNodeData>>) {
  const profile = data.profile;
  const isHighRisk =
    Boolean(profile?.is_flagged) ||
    Boolean(profile?.is_pep_or_sanctioned) ||
    profile?.kyc_risk_tier === 'HIGH';

  const classNames = [
    'm3-node-account',
    data.isAnchor ? 'm3-node-account--origin' : '',
    isHighRisk ? 'm3-node-account--high-risk' : '',
    data.isHighlighted ? 'm3-node-account--selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classNames}>
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#0b57d0', width: 8, height: 8, border: '2px solid #ffffff' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span
          className="mono-num"
          style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            color: '#0b57d0',
            background: '#e8f0fe',
            padding: '2px 7px',
            borderRadius: 9999,
          }}
        >
          #{data.accountId}
        </span>
        {isHighRisk ? (
          <span
            style={{
              fontSize: '0.64rem',
              fontWeight: 700,
              color: '#b3261e',
              background: '#f9dedc',
              padding: '2px 7px',
              borderRadius: 9999,
            }}
          >
            {profile?.is_pep_or_sanctioned ? 'PEP / SANCTIONS' : 'HIGH RISK'}
          </span>
        ) : data.isAnchor ? (
          <span
            style={{
              fontSize: '0.64rem',
              fontWeight: 700,
              color: '#041e49',
              background: '#d3e3fd',
              padding: '2px 7px',
              borderRadius: 9999,
            }}
          >
            ANCHOR
          </span>
        ) : (
          <span style={{ fontSize: '0.68rem', color: '#444746', fontWeight: 500 }}>
            {profile?.entity_jurisdiction ?? 'USD'}
          </span>
        )}
      </div>

      <div
        style={{
          fontFamily: 'var(--md-sys-typescale-display-font)',
          fontSize: '0.83rem',
          fontWeight: 700,
          color: '#1f1f1f',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={profile?.entity_name ?? data.accountId}
      >
        {profile?.entity_name ?? `Account ${data.accountId}`}
      </div>

      <div
        style={{
          fontSize: '0.7rem',
          color: '#444746',
          marginTop: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
          {profile?.bank_name ?? 'Account'}
        </span>
        <span style={{ color: '#0b57d0', fontWeight: 500, fontSize: '0.66rem' }}>Inspect →</span>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#0b57d0', width: 8, height: 8, border: '2px solid #ffffff' }}
      />
    </div>
  );
}

export function EntityNode({ data }: NodeProps<Node<EntityNodeData>>) {
  const isHighRisk = data.isPep || data.isUbo || data.kycRiskTier === 'HIGH';
  const classNames = [
    'm3-node-entity',
    isHighRisk ? 'm3-node-entity--high-risk' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classNames}>
      <Handle type="target" position={Position.Top} style={{ background: '#7c3aed', width: 7, height: 7 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span
          style={{
            fontSize: '0.63rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            color: isHighRisk ? '#b3261e' : '#5b21b6',
          }}
        >
          {data.isUbo ? 'UBO Controller' : data.entityType}
        </span>
        <span style={{ fontSize: '0.65rem', color: '#444746', fontWeight: 600 }}>{data.jurisdiction}</span>
      </div>
      <div
        style={{
          fontFamily: 'var(--md-sys-typescale-display-font)',
          fontSize: '0.78rem',
          fontWeight: 700,
          color: '#1f1f1f',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={data.entityName}
      >
        {data.entityName}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: '#7c3aed', width: 7, height: 7 }} />
    </div>
  );
}

export function BankNode({ data }: NodeProps<Node<BankNodeData>>) {
  return (
    <div className="m3-node-bank">
      <Handle type="target" position={Position.Top} style={{ background: '#64748b', width: 6, height: 6 }} />
      <div style={{ fontSize: '0.62rem', fontWeight: 700, color: '#444746', textTransform: 'uppercase' }}>
        Institution · {data.jurisdiction}
      </div>
      <div
        style={{
          fontSize: '0.76rem',
          fontWeight: 600,
          color: '#1f1f1f',
          marginTop: 2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={data.bankName}
      >
        {data.bankName}
      </div>
    </div>
  );
}
