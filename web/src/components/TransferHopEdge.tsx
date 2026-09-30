import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
} from '@xyflow/react';
import type { EdgeProps, Edge } from '@xyflow/react';
import type { TransferEdgeData } from '../types/aml';

export function TransferHopEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
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

  const hop = data?.hop;
  const hopCount = data?.allHopsBetweenPair.length ?? 1;
  const totalAmount =
    data?.allHopsBetweenPair.reduce((acc, h) => acc + h.amount_paid, 0) ??
    hop?.amount_paid ??
    0;
  const isHighlighted = Boolean(data?.isHighlighted);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: isHighlighted ? '#ff832b' : '#4589ff',
          strokeWidth: isHighlighted ? 3 : 2,
        }}
      />
      {hop && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              background: isHighlighted ? '#ff832b' : '#161616',
              color: isHighlighted ? '#161616' : '#f4f4f4',
              border: `1px solid ${isHighlighted ? '#ff832b' : '#4589ff'}`,
            }}
            className="aml-edge-badge nodrag nopan"
          >
            #{hop.hop_index} • $
            {totalAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            {hopCount > 1 ? ` (${hopCount}x)` : ''}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
