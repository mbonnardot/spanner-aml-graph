import dagre from 'dagre';
import type { Edge, Node } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import type {
  AccountNodeData,
  BankNodeData,
  EnrichedCaseInvestigation,
  EntityNodeData,
  TransferEdgeData,
  TransferHop,
} from '../types/aml';

const CYCLIC_TYPOLOGIES = new Set<string>([
  'CIRCULAR_LAYERING',
  'UBO_SHELL_RING',
  'SAME_ENTITY_RING',
]);

export interface BuildGraphOptions {
  readonly showOwnershipOverlay: boolean;
  readonly showBankOverlay: boolean;
  readonly highlightedHopTxId: string | null;
  readonly selectedNodeId: string | null;
}

export interface ReactFlowGraphResult {
  readonly nodes: Node[];
  readonly edges: Edge[];
}

export function buildReactFlowGraph(
  investigation: EnrichedCaseInvestigation,
  options: BuildGraphOptions
): ReactFlowGraphResult {
  const { evidence, kyc_profiles: profiles } = investigation;
  const accountIdsSet = new Set<string>();
  const inTotals = new Map<string, number>();
  const outTotals = new Map<string, number>();

  for (const hop of evidence.hops) {
    accountIdsSet.add(hop.from_account_id);
    accountIdsSet.add(hop.to_account_id);
    outTotals.set(
      hop.from_account_id,
      (outTotals.get(hop.from_account_id) ?? 0) + hop.amount_paid
    );
    inTotals.set(
      hop.to_account_id,
      (inTotals.get(hop.to_account_id) ?? 0) + hop.amount_received
    );
  }

  const originAccountId =
    evidence.account_ids[0] ?? evidence.hops[0]?.from_account_id ?? '';

  const orderedAccounts: string[] = [];
  if (originAccountId && accountIdsSet.has(originAccountId)) {
    orderedAccounts.push(originAccountId);
  }
  for (const hop of evidence.hops) {
    if (!orderedAccounts.includes(hop.from_account_id)) {
      orderedAccounts.push(hop.from_account_id);
    }
    if (!orderedAccounts.includes(hop.to_account_id)) {
      orderedAccounts.push(hop.to_account_id);
    }
  }

  const highlightedHop = evidence.hops.find(
    (h) => h.transaction_id === options.highlightedHopTxId
  );

  const accountNodes: Node<AccountNodeData>[] = orderedAccounts.map((accId) => {
    const isAnchor = accId === originAccountId;
    const isHighlighted =
      options.selectedNodeId === accId ||
      highlightedHop?.from_account_id === accId ||
      highlightedHop?.to_account_id === accId;

    return {
      id: accId,
      type: 'accountNode',
      position: { x: 0, y: 0 },
      data: {
        kind: 'account',
        accountId: accId,
        isAnchor,
        profile: profiles[accId],
        totalInUsd: inTotals.get(accId) ?? 0,
        totalOutUsd: outTotals.get(accId) ?? 0,
        isHighlighted,
      },
    };
  });

  // Group hops by directed pair so parallel edges render cleanly
  const pairHopsMap = new Map<string, TransferHop[]>();
  for (const hop of evidence.hops) {
    const key = `${hop.from_account_id}__${hop.to_account_id}`;
    const existing = pairHopsMap.get(key) ?? [];
    pairHopsMap.set(key, [...existing, hop]);
  }

  const transferEdges: Edge<TransferEdgeData>[] = [];
  for (const [pairKey, hops] of pairHopsMap.entries()) {
    const primaryHop = hops[0];
    const isHighlighted = hops.some(
      (h) => h.transaction_id === options.highlightedHopTxId
    );
    transferEdges.push({
      id: `tx-${pairKey}-${primaryHop.transaction_id}`,
      source: primaryHop.from_account_id,
      target: primaryHop.to_account_id,
      type: 'transferHopEdge',
      animated: true,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: isHighlighted ? '#ff832b' : '#4589ff',
        width: 18,
        height: 18,
      },
      data: {
        hop: primaryHop,
        allHopsBetweenPair: hops,
        isHighlighted,
      },
    });
  }

  // Position account nodes: Circular Ring geometry for cyclic typologies, Dagre LR for flow typologies
  const isCyclic = CYCLIC_TYPOLOGIES.has(evidence.typology);
  const positionedAccountNodes = isCyclic
    ? layoutCircularRing(accountNodes)
    : layoutDagreLr(accountNodes, transferEdges);

  const overlayNodes: Node[] = [];
  const overlayEdges: Edge[] = [];

  if (options.showOwnershipOverlay) {
    const addedEntities = new Map<string, { x: number; y: number }>();
    const addedUbos = new Map<string, { x: number; y: number }>();

    positionedAccountNodes.forEach((accNode, idx) => {
      const profile = accNode.data.profile;
      if (!profile || !profile.entity_id) {
        return;
      }
      const entityNodeId = `entity:${profile.entity_id}`;
      if (!addedEntities.has(entityNodeId)) {
        const pos = {
          x: accNode.position.x + (idx % 2 === 0 ? -35 : 35),
          y: accNode.position.y - 145,
        };
        addedEntities.set(entityNodeId, pos);
        const entityData: EntityNodeData = {
          kind: 'entity',
          entityId: profile.entity_id,
          entityName: profile.entity_name,
          entityType: profile.entity_type,
          jurisdiction: profile.entity_jurisdiction,
          kycRiskTier: profile.kyc_risk_tier,
          isPep: profile.is_pep_or_sanctioned,
          isUbo: false,
        };
        overlayNodes.push({
          id: entityNodeId,
          type: 'entityNode',
          position: pos,
          data: entityData,
        });
      }

      overlayEdges.push({
        id: `owns-${entityNodeId}-${accNode.id}`,
        source: entityNodeId,
        target: accNode.id,
        label: 'OWNS',
        style: { stroke: '#a56eff', strokeDasharray: '5 4', strokeWidth: 1.5 },
        labelStyle: { fill: '#d4bbff', fontSize: 10, fontFamily: 'IBM Plex Mono' },
        labelBgStyle: { fill: '#161616', fillOpacity: 0.85 },
      });

      if (profile.ubo_entity_id) {
        const uboNodeId = `ubo:${profile.ubo_entity_id}`;
        const entityPos = addedEntities.get(entityNodeId) ?? accNode.position;
        if (!addedUbos.has(uboNodeId)) {
          const uboPos = {
            x: entityPos.x,
            y: entityPos.y - 130,
          };
          addedUbos.set(uboNodeId, uboPos);
          const uboData: EntityNodeData = {
            kind: 'entity',
            entityId: profile.ubo_entity_id,
            entityName: profile.ubo_entity_name ?? profile.ubo_entity_id,
            entityType: 'UBO Individual',
            jurisdiction: profile.entity_jurisdiction,
            kycRiskTier: 'HIGH',
            isPep: profile.is_pep_or_sanctioned,
            isUbo: true,
          };
          overlayNodes.push({
            id: uboNodeId,
            type: 'entityNode',
            position: uboPos,
            data: uboData,
          });
        }
        const controlsEdgeId = `controls-${uboNodeId}-${entityNodeId}`;
        if (!overlayEdges.some((e) => e.id === controlsEdgeId)) {
          overlayEdges.push({
            id: controlsEdgeId,
            source: uboNodeId,
            target: entityNodeId,
            label: 'CONTROLS',
            style: { stroke: '#ff832b', strokeDasharray: '3 3', strokeWidth: 1.8 },
            labelStyle: { fill: '#ffb784', fontSize: 10, fontFamily: 'IBM Plex Mono' },
            labelBgStyle: { fill: '#161616', fillOpacity: 0.85 },
          });
        }
      }
    });
  }

  if (options.showBankOverlay) {
    const addedBanks = new Set<string>();
    positionedAccountNodes.forEach((accNode) => {
      const profile = accNode.data.profile;
      if (!profile || !profile.bank_id) {
        return;
      }
      const bankNodeId = `bank:${profile.bank_id}`;
      if (!addedBanks.has(bankNodeId)) {
        addedBanks.add(bankNodeId);
        const bankData: BankNodeData = {
          kind: 'bank',
          bankId: profile.bank_id,
          bankName: profile.bank_name,
          jurisdiction: profile.bank_jurisdiction,
        };
        overlayNodes.push({
          id: bankNodeId,
          type: 'bankNode',
          position: {
            x: accNode.position.x + 20,
            y: accNode.position.y + 150,
          },
          data: bankData,
        });
      }
      overlayEdges.push({
        id: `held-${accNode.id}-${bankNodeId}`,
        source: accNode.id,
        target: bankNodeId,
        label: 'HELD_AT',
        style: { stroke: '#6f6f6f', strokeDasharray: '4 4', strokeWidth: 1.2 },
        labelStyle: { fill: '#a8a8a8', fontSize: 9, fontFamily: 'IBM Plex Mono' },
        labelBgStyle: { fill: '#161616', fillOpacity: 0.85 },
      });
    });
  }

  return {
    nodes: [...positionedAccountNodes, ...overlayNodes],
    edges: [...transferEdges, ...overlayEdges],
  };
}

function layoutCircularRing(
  nodes: readonly Node<AccountNodeData>[]
): Node<AccountNodeData>[] {
  const count = nodes.length;
  const radius = Math.max(210, count * 44);
  const centerX = 460;
  const centerY = 320;

  return nodes.map((node, index) => {
    const angle = (2 * Math.PI * index) / Math.max(1, count) - Math.PI / 2;
    return {
      ...node,
      position: {
        x: Math.round(centerX + radius * Math.cos(angle) - 120),
        y: Math.round(centerY + radius * Math.sin(angle) - 55),
      },
    };
  });
}

function layoutDagreLr(
  nodes: readonly Node<AccountNodeData>[],
  edges: readonly Edge<TransferEdgeData>[]
): Node<AccountNodeData>[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'LR',
    nodesep: 65,
    ranksep: 190,
    marginx: 50,
    marginy: 50,
  });

  const nodeWidth = 240;
  const nodeHeight = 112;

  for (const node of nodes) {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: Math.round((pos?.x ?? 0) - nodeWidth / 2),
        y: Math.round((pos?.y ?? 0) - nodeHeight / 2),
      },
    };
  });
}
