import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import { Tag } from '@carbon/react';
import {
  Locked,
  WarningAltFilled,
  UserMultiple,
  Building,
  Finance,
} from '@carbon/icons-react';
import type {
  AccountNodeData,
  BankNodeData,
  EntityNodeData,
} from '../types/aml';

export function AccountNode({ data }: NodeProps<Node<AccountNodeData>>) {
  const profile = data.profile;
  const riskTier = profile?.kyc_risk_tier ?? 'MEDIUM';
  const isHighRisk =
    riskTier === 'HIGH' ||
    riskTier === 'CRITICAL' ||
    Boolean(profile?.is_pep_or_sanctioned) ||
    Boolean(profile?.ubo_entity_id);

  const borderColor = data.isHighlighted
    ? '#ff832b'
    : data.isAnchor
    ? '#da1e28'
    : isHighRisk
    ? '#ff832b'
    : '#4589ff';

  return (
    <div
      style={{
        width: 236,
        background: '#262626',
        border: `1.5px solid ${borderColor}`,
        borderLeft: `5px solid ${borderColor}`,
        padding: '10px 12px',
        color: '#f4f4f4',
        boxShadow: data.isHighlighted
          ? '0 0 0 2px rgba(255, 131, 43, 0.45), 0 8px 20px rgba(0, 0, 0, 0.65)'
          : '0 4px 12px rgba(0, 0, 0, 0.5)',
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: '#4589ff', width: 8, height: 8 }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 13,
            fontWeight: 600,
            color: '#ffffff',
          }}
        >
          {data.accountId}
        </span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {data.isAnchor && (
            <Tag type="red" size="sm">
              ORIGIN / HUB
            </Tag>
          )}
          {profile?.is_flagged && (
            <Tag type="purple" size="sm" renderIcon={Locked}>
              FLAGGED
            </Tag>
          )}
        </div>
      </div>

      <div
        style={{
          fontSize: 11,
          color: '#c6c6c6',
          marginBottom: 6,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {profile?.entity_name ?? 'Account Holder'} (
        {profile?.entity_jurisdiction ?? 'US'})
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          fontFamily: "'IBM Plex Mono', monospace",
          borderTop: '1px solid #393939',
          paddingTop: 6,
        }}
      >
        <span style={{ color: '#ff832b' }}>
          OUT: $
          {data.totalOutUsd.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}
        </span>
        <span style={{ color: '#42be65' }}>
          IN: $
          {data.totalInUsd.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })}
        </span>
      </div>

      {isHighRisk && (
        <div
          style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}
        >
          {(profile?.is_pep_or_sanctioned || profile?.ubo_entity_id) && (
            <Tag type="magenta" size="sm" renderIcon={WarningAltFilled}>
              PEP / UBO
            </Tag>
          )}
          <Tag
            type={
              riskTier === 'HIGH' || riskTier === 'CRITICAL'
                ? 'red'
                : 'warm-gray'
            }
            size="sm"
          >
            KYC {riskTier}
          </Tag>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        style={{ background: '#ff832b', width: 8, height: 8 }}
      />
    </div>
  );
}

export function EntityNode({ data }: NodeProps<Node<EntityNodeData>>) {
  const borderColor = data.isUbo ? '#ff832b' : '#a56eff';
  return (
    <div
      style={{
        width: 205,
        background: '#161616',
        border: `1px dashed ${borderColor}`,
        borderTop: `3px solid ${borderColor}`,
        padding: '8px 10px',
        color: '#f4f4f4',
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: borderColor }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 4,
        }}
      >
        {data.isUbo ? <UserMultiple size={14} /> : <Building size={14} />}
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: data.isUbo ? '#ffb784' : '#d4bbff',
          }}
        >
          {data.isUbo ? 'UBO CONTROLLER' : 'LEGAL ENTITY'}
        </span>
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {data.entityName}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 4,
          fontSize: 10,
          fontFamily: "'IBM Plex Mono', monospace",
          color: '#a8a8a8',
        }}
      >
        <span>{data.entityId}</span>
        <span>{data.jurisdiction}</span>
      </div>
      {data.isPep && (
        <div style={{ marginTop: 4 }}>
          <Tag type="red" size="sm">
            PEP / SANCTIONED
          </Tag>
        </div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: borderColor }}
      />
    </div>
  );
}

export function BankNode({ data }: NodeProps<Node<BankNodeData>>) {
  return (
    <div
      style={{
        width: 190,
        background: '#1c1c1c',
        border: '1px solid #525252',
        padding: '7px 10px',
        color: '#e0e0e0',
        fontFamily: "'IBM Plex Sans', sans-serif",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#6f6f6f' }}
      />
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}
      >
        <Finance size={14} />
        <span style={{ fontWeight: 600 }}>{data.bankName}</span>
      </div>
      <div
        style={{
          fontSize: 10,
          color: '#8d8d8d',
          fontFamily: "'IBM Plex Mono', monospace",
          marginTop: 2,
        }}
      >
        {data.bankId} • {data.jurisdiction}
      </div>
    </div>
  );
}
