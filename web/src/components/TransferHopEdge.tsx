import type { Edge, EdgeProps } from '@xyflow/react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import type { TransferEdgeData } from '../types/aml';

export function TransferHopEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps<Edge<TransferEdgeData>>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  if (!data) {
    return <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />;
  }

  const hop = data.hop;
  const extraCount = data.allHopsBetweenPair.length - 1;
  const formattedAmount = `$${hop.amount_paid.toLocaleString('en-US', {
    maximumFractionDigits: 0,
  })}`;

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          }}
          className={`m3-edge-pill ${data.isHighlighted ? 'm3-edge-pill--highlighted' : ''}`}
        >
          <span
            style={{
              background: data.isHighlighted ? '#e37400' : '#0b57d0',
              color: '#ffffff',
              borderRadius: 9999,
              padding: '1px 6px',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            H{hop.hop_index}
          </span>
          <span className="mono-num">{formattedAmount}</span>
          {extraCount > 0 && (
            <span style={{ fontSize: 10, color: '#444746' }}>+{extraCount}</span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
