import type {
  AccountKycProfile,
  EnrichedCaseInvestigation,
  GraphUniverseResponse,
  TransferHop,
} from '../types/aml';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RingNode3D {
  readonly id: string;
  readonly kind: 'account' | 'ubo' | 'entity' | 'bank';
  readonly label: string;
  readonly sublabel: string;
  readonly jurisdiction: string;
  readonly cloudPosition: Vec3;
  readonly ringPosition: Vec3;
  readonly colorHex: number;
  readonly badgeColor: string;
  readonly radius: number;
  readonly isAnchor: boolean;
  readonly isHighRisk: boolean;
  readonly profile?: AccountKycProfile;
}

export interface RingEdge3D {
  readonly id: string;
  readonly hop: TransferHop;
  readonly fromId: string;
  readonly toId: string;
  readonly fromPos: Vec3;
  readonly toPos: Vec3;
  readonly controlPos: Vec3;
  readonly colorHex: number;
}

export interface OwnershipTether3D {
  readonly id: string;
  readonly fromPos: Vec3;
  readonly toPos: Vec3;
  readonly label: string;
  readonly kind: 'ubo' | 'bank';
  readonly colorHex: number;
}

export interface BackgroundCloud3D {
  readonly nodePositions: Float32Array;
  readonly nodeColors: Float32Array;
  readonly edgePositions: Float32Array;
  readonly nodeCount: number;
  readonly edgeCount: number;
}

export interface Universe3DSceneData {
  readonly ringNodes: readonly RingNode3D[];
  readonly overlayNodes: readonly RingNode3D[];
  readonly ringEdges: readonly RingEdge3D[];
  readonly tethers: readonly OwnershipTether3D[];
  readonly background: BackgroundCloud3D;
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function deterministicUnit(seed: string, salt: number): number {
  const h = hashString(`${seed}:${salt}`);
  return (h % 10000) / 10000;
}

function computeCloudScatterPosition(id: string, index: number): Vec3 {
  const u1 = deterministicUnit(id, 11 + index);
  const u2 = deterministicUnit(id, 29 + index);
  const u3 = deterministicUnit(id, 47 + index);
  const theta = u1 * Math.PI * 2;
  const phi = Math.acos(2 * u2 - 1);
  const radius = 34 + u3 * 44;
  return {
    x: radius * Math.sin(phi) * Math.cos(theta),
    y: radius * Math.cos(phi) * 0.58,
    z: radius * Math.sin(phi) * Math.sin(theta),
  };
}

export function extractUniqueAccounts(
  investigation: EnrichedCaseInvestigation
): readonly string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const push = (id: string) => {
    if (id && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  };
  investigation.evidence.account_ids.forEach(push);
  investigation.evidence.hops.forEach((h) => {
    push(h.from_account_id);
    push(h.to_account_id);
  });
  return ordered;
}

function computeAccountPositions3D(
  investigation: EnrichedCaseInvestigation,
  accounts: readonly string[]
): ReadonlyMap<string, Vec3> {
  const hops = investigation.evidence.hops;
  const typology = investigation.evidence.typology;
  const map = new Map<string, Vec3>();

  // 1. SCATTER_GATHER: Origin (left) -> Mule Ring (center) -> Collector Sink (right)
  if (typology === 'SCATTER_GATHER' && accounts.length >= 3) {
    const originId = hops[0]?.from_account_id ?? accounts[0];
    const sinkId =
      hops[hops.length - 1]?.to_account_id ?? accounts[accounts.length - 1];
    const mules = accounts.filter((a) => a !== originId && a !== sinkId);

    map.set(originId, { x: -19, y: 0.6, z: 0 });
    map.set(sinkId, { x: 19, y: -0.6, z: 0 });

    mules.forEach((accId, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(mules.length, 1);
      const ringRadius = 11.2;
      map.set(accId, {
        x: Math.sin(angle * 2) * 1.1,
        y: Math.cos(angle) * ringRadius * 0.72,
        z: Math.sin(angle) * ringRadius,
      });
    });
    return map;
  }

  // 2. FAN_OUT: Single Origin Hub (left) -> 3D Arc of Beneficiaries (right)
  if (typology === 'FAN_OUT' && accounts.length >= 2) {
    const originId = hops[0]?.from_account_id ?? accounts[0];
    const receivers = accounts.filter((a) => a !== originId);
    map.set(originId, { x: -18.5, y: 0, z: 0 });
    receivers.forEach((accId, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(receivers.length, 1);
      const r = 12.2;
      map.set(accId, {
        x: 11.5 + Math.cos(angle * 2) * 2.2,
        y: Math.cos(angle) * r * 0.72,
        z: Math.sin(angle) * r,
      });
    });
    return map;
  }

  // 3. FAN_IN: 3D Arc of Senders (left) -> Single Collector Sink (right)
  if (typology === 'FAN_IN' && accounts.length >= 2) {
    const sinkCounts = new Map<string, number>();
    hops.forEach((h) => {
      sinkCounts.set(h.to_account_id, (sinkCounts.get(h.to_account_id) ?? 0) + 1);
    });
    let sinkId = hops[0]?.to_account_id ?? accounts[accounts.length - 1];
    let maxIn = -1;
    sinkCounts.forEach((cnt, id) => {
      if (cnt > maxIn) {
        maxIn = cnt;
        sinkId = id;
      }
    });
    const senders = accounts.filter((a) => a !== sinkId);
    map.set(sinkId, { x: 18.5, y: 0, z: 0 });
    senders.forEach((accId, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(senders.length, 1);
      const r = 11.5;
      map.set(accId, {
        x: -11.5 + Math.sin(angle * 2) * 2.0,
        y: Math.cos(angle) * r * 0.72,
        z: Math.sin(angle) * r,
      });
    });
    return map;
  }

  // 4. GATHER_SCATTER: Senders (left) -> Central Clearinghouse Hub (center) -> Receivers (right)
  if (typology === 'GATHER_SCATTER' && accounts.length >= 2) {
    const degreeMap = new Map<string, number>();
    hops.forEach((h) => {
      degreeMap.set(h.from_account_id, (degreeMap.get(h.from_account_id) ?? 0) + 1);
      degreeMap.set(h.to_account_id, (degreeMap.get(h.to_account_id) ?? 0) + 1);
    });
    let hubId = accounts[0];
    let maxDeg = -1;
    degreeMap.forEach((deg, id) => {
      if (deg > maxDeg) {
        maxDeg = deg;
        hubId = id;
      }
    });
    map.set(hubId, { x: 0, y: 0, z: 0 });

    const inboundSet = new Set<string>();
    const outboundSet = new Set<string>();
    hops.forEach((h) => {
      if (h.to_account_id === hubId && h.from_account_id !== hubId) {
        inboundSet.add(h.from_account_id);
      }
      if (h.from_account_id === hubId && h.to_account_id !== hubId) {
        outboundSet.add(h.to_account_id);
      }
    });

    const peers = accounts.filter((a) => a !== hubId);
    const leftNodes: string[] = [];
    const rightNodes: string[] = [];
    peers.forEach((accId, idx) => {
      if (inboundSet.has(accId) && !outboundSet.has(accId)) {
        leftNodes.push(accId);
      } else if (outboundSet.has(accId) && !inboundSet.has(accId)) {
        rightNodes.push(accId);
      } else if (idx % 2 === 0) {
        leftNodes.push(accId);
      } else {
        rightNodes.push(accId);
      }
    });

    leftNodes.forEach((accId, idx) => {
      const t = leftNodes.length > 1 ? idx / (leftNodes.length - 1) - 0.5 : 0;
      map.set(accId, {
        x: -16.5,
        y: t * 14,
        z: Math.sin(idx * 1.7) * 7.5,
      });
    });
    rightNodes.forEach((accId, idx) => {
      const t = rightNodes.length > 1 ? idx / (rightNodes.length - 1) - 0.5 : 0;
      map.set(accId, {
        x: 16.5,
        y: t * 14,
        z: Math.cos(idx * 1.7) * 7.5,
      });
    });
    return map;
  }

  // 5. BIPARTITE & STACKED_BIPARTITE: Multi-Tier Left-to-Right Layer Columns
  if (typology === 'BIPARTITE' || typology === 'STACKED_BIPARTITE') {
    const count = accounts.length;
    accounts.forEach((accId, idx) => {
      const tierX = count <= 3
        ? (idx - (count - 1) / 2) * 15.5
        : ((idx % 3) - 1) * 15.5;
      const rowOffset = Math.floor(idx / 3);
      map.set(accId, {
        x: tierX,
        y: (idx % 2 === 0 ? 1 : -1) * (2.4 + rowOffset * 2.5),
        z: (idx % 2 === 0 ? -1 : 1) * (3.2 + rowOffset * 2.0),
      });
    });
    return map;
  }

  // 6. RANDOM_WALK: 8-Hop Zig-Zag Escape Trail
  if (typology === 'RANDOM_WALK') {
    const count = accounts.length;
    accounts.forEach((accId, idx) => {
      const t = count > 1 ? idx / (count - 1) - 0.5 : 0;
      const waveAngle = idx * 0.85;
      map.set(accId, {
        x: t * 34,
        y: Math.sin(waveAngle) * 3.4,
        z: Math.cos(waveAngle) * 5.6,
      });
    });
    return map;
  }

  // 7. CIRCULAR_LAYERING / UBO_SHELL_RING / SAME_ENTITY_RING: Sleek 3D Ring Loop
  const count = Math.max(accounts.length, 1);
  const radius = count <= 4 ? 13.5 : 17.2;
  accounts.forEach((accId, idx) => {
    const angle = (2 * Math.PI * idx) / count - Math.PI / 2;
    const elevation = Math.sin(angle * 2) * 0.85;
    map.set(accId, {
      x: Math.cos(angle) * radius,
      y: elevation,
      z: Math.sin(angle) * radius,
    });
  });

  return map;
}

export function buildUniverse3DSceneData(
  universe: GraphUniverseResponse | null,
  investigation: EnrichedCaseInvestigation | null
): Universe3DSceneData {
  const uniqueAccounts = investigation ? extractUniqueAccounts(investigation) : [];
  const activeAccountSet = new Set<string>(uniqueAccounts);

  const ringNodes: RingNode3D[] = [];
  const overlayNodes: RingNode3D[] = [];
  const ringEdges: RingEdge3D[] = [];
  const tethers: OwnershipTether3D[] = [];

  if (investigation && uniqueAccounts.length > 0) {
    const posMap = computeAccountPositions3D(investigation, uniqueAccounts);
    const anchorId = uniqueAccounts[0] ?? '';

    uniqueAccounts.forEach((accId, idx) => {
      const ringPos = posMap.get(accId) ?? { x: 0, y: 0, z: 0 };
      const cloudPos = computeCloudScatterPosition(accId, idx);
      const profile = investigation.kyc_profiles[accId];
      const isAnchor = accId === anchorId;
      const isHighRisk = Boolean(
        profile?.is_pep_or_sanctioned ||
          profile?.is_flagged ||
          profile?.kyc_risk_tier === 'HIGH' ||
          profile?.kyc_risk_tier === 'CRITICAL'
      );

      const colorHex = isAnchor
        ? 0x38bdf8
        : isHighRisk
          ? 0xf43f5e
          : 0x818cf8;
      const badgeColor = isAnchor
        ? '#38bdf8'
        : isHighRisk
          ? '#f43f5e'
          : '#818cf8';

      ringNodes.push({
        id: accId,
        kind: 'account',
        label: profile?.entity_name ?? accId,
        sublabel: accId,
        jurisdiction: profile?.bank_jurisdiction ?? 'US',
        cloudPosition: cloudPos,
        ringPosition: ringPos,
        colorHex,
        badgeColor,
        radius: isAnchor ? 0.92 : 0.66,
        isAnchor,
        isHighRisk,
        profile,
      });
    });

    investigation.evidence.hops.forEach((hop, idx) => {
      const fromPos = posMap.get(hop.from_account_id) ?? { x: -10, y: 0, z: 0 };
      const toPos = posMap.get(hop.to_account_id) ?? { x: 10, y: 0, z: 0 };

      const rawMidX = (fromPos.x + toPos.x) / 2;
      const rawMidY = (fromPos.y + toPos.y) / 2;
      const rawMidZ = (fromPos.z + toPos.z) / 2;

      const radialLen = Math.hypot(rawMidX, rawMidZ);
      const outwardPush = radialLen > 0.5 ? 1.06 : 1.0;
      const midX = rawMidX * outwardPush;
      const midY = rawMidY + 0.55 + (idx % 2) * 0.22;
      const midZ =
        rawMidZ * outwardPush + (radialLen <= 0.5 ? (idx % 2 === 0 ? 0.8 : -0.8) : 0);

      ringEdges.push({
        id: `${hop.transaction_id}:${idx}`,
        hop,
        fromId: hop.from_account_id,
        toId: hop.to_account_id,
        fromPos,
        toPos,
        controlPos: { x: midX, y: midY, z: midZ },
        colorHex: idx === 0 ? 0x38bdf8 : 0x6366f1,
      });
    });

    const uboAdded = new Map<string, Vec3>();
    const bankAdded = new Map<string, Vec3>();

    uniqueAccounts.forEach((accId, idx) => {
      const accPos = posMap.get(accId);
      const profile = investigation.kyc_profiles[accId];
      if (!accPos || !profile) {
        return;
      }

      const ownerKey = profile.ubo_entity_id ?? profile.entity_id;
      const ownerName = profile.ubo_entity_name ?? profile.entity_name;
      const isUbo = Boolean(profile.ubo_entity_id);

      if (ownerKey && (isUbo || profile.kyc_risk_tier === 'HIGH' || idx < 3)) {
        let ownerPos = uboAdded.get(ownerKey);
        if (!ownerPos) {
          ownerPos = {
            x: accPos.x * 0.48,
            y: 12.2 + (uboAdded.size % 2) * 1.8,
            z: accPos.z * 0.48,
          };
          uboAdded.set(ownerKey, ownerPos);
          overlayNodes.push({
            id: `owner:${ownerKey}`,
            kind: isUbo ? 'ubo' : 'entity',
            label: ownerName,
            sublabel: isUbo
              ? 'Beneficial Owner (UBO)'
              : `${profile.entity_type} Entity`,
            jurisdiction: profile.entity_jurisdiction,
            cloudPosition: ownerPos,
            ringPosition: ownerPos,
            colorHex: isUbo ? 0xa855f7 : 0xf43f5e,
            badgeColor: isUbo ? '#c084fc' : '#fb7185',
            radius: isUbo ? 1.04 : 0.8,
            isAnchor: false,
            isHighRisk: profile.is_pep_or_sanctioned,
          });
        }
        tethers.push({
          id: `tether-ubo-${accId}-${ownerKey}`,
          fromPos: ownerPos,
          toPos: accPos,
          label: isUbo ? ':CONTROLS / :OWNS' : ':OWNS',
          kind: 'ubo',
          colorHex: 0xa855f7,
        });
      }

      if (profile.bank_id && bankAdded.size < 5) {
        let bankPos = bankAdded.get(profile.bank_id);
        if (!bankPos) {
          bankPos = {
            x: accPos.x * 1.08,
            y: -10.5 - (bankAdded.size % 2) * 1.6,
            z: accPos.z * 1.08,
          };
          bankAdded.set(profile.bank_id, bankPos);
          overlayNodes.push({
            id: `bank:${profile.bank_id}`,
            kind: 'bank',
            label: profile.bank_name,
            sublabel: profile.bic_swift,
            jurisdiction: profile.bank_jurisdiction,
            cloudPosition: bankPos,
            ringPosition: bankPos,
            colorHex: 0x0ea5e9,
            badgeColor: '#38bdf8',
            radius: 0.76,
            isAnchor: false,
            isHighRisk: false,
          });
        }
        tethers.push({
          id: `tether-bank-${accId}-${profile.bank_id}`,
          fromPos: accPos,
          toPos: bankPos,
          label: ':HELD_AT',
          kind: 'bank',
          colorHex: 0x0ea5e9,
        });
      }
    });
  }

  const rawAccounts = universe?.accounts ?? [];
  const rawTxs = universe?.transactions ?? [];

  const bgAccounts =
    rawAccounts.length > 0
      ? rawAccounts
      : Array.from({ length: 360 }, (_, i) => ({
          account_id: `ACC_CLOUD_${i}`,
          bank_id: `BANK_${i % 12}`,
          currency: 'USD',
          is_flagged: i % 19 === 0,
        }));

  const bgPosMap = new Map<string, Vec3>();
  const filteredAccounts = bgAccounts.filter(
    (a) => !activeAccountSet.has(a.account_id)
  );
  const nodeCount = filteredAccounts.length;
  const nodePositions = new Float32Array(nodeCount * 3);
  const nodeColors = new Float32Array(nodeCount * 3);

  const goldenRatio = (1 + Math.sqrt(5)) / 2;

  filteredAccounts.forEach((acc, i) => {
    const theta = (2 * Math.PI * i) / goldenRatio;
    const phi = Math.acos(1 - (2 * (i + 0.5)) / Math.max(nodeCount, 1));
    const jitter = deterministicUnit(acc.account_id, 1);
    const radius = 32 + jitter * 68;

    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.cos(phi) * 0.6;
    const z = radius * Math.sin(phi) * Math.sin(theta);

    bgPosMap.set(acc.account_id, { x, y, z });
    nodePositions[i * 3] = x;
    nodePositions[i * 3 + 1] = y;
    nodePositions[i * 3 + 2] = z;

    if (acc.is_flagged) {
      nodeColors[i * 3] = 0.96;
      nodeColors[i * 3 + 1] = 0.32;
      nodeColors[i * 3 + 2] = 0.45;
    } else {
      const tint = (i % 5) * 0.05;
      nodeColors[i * 3] = 0.32 + tint;
      nodeColors[i * 3 + 1] = 0.62 + tint * 0.5;
      nodeColors[i * 3 + 2] = 0.98;
    }
  });

  const edgeSegments: number[] = [];
  rawTxs.forEach((tx) => {
    if (
      activeAccountSet.has(tx.from_account_id) &&
      activeAccountSet.has(tx.to_account_id)
    ) {
      return;
    }
    const p1 = bgPosMap.get(tx.from_account_id);
    const p2 = bgPosMap.get(tx.to_account_id);
    if (p1 && p2) {
      edgeSegments.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
  });

  for (let i = 0; i < Math.min(nodeCount - 3, 310); i += 1) {
    const targetIdx = (i + 3 + (i % 7)) % nodeCount;
    edgeSegments.push(
      nodePositions[i * 3],
      nodePositions[i * 3 + 1],
      nodePositions[i * 3 + 2],
      nodePositions[targetIdx * 3],
      nodePositions[targetIdx * 3 + 1],
      nodePositions[targetIdx * 3 + 2]
    );
  }

  return {
    ringNodes,
    overlayNodes,
    ringEdges,
    tethers,
    background: {
      nodePositions,
      nodeColors,
      edgePositions: new Float32Array(edgeSegments),
      nodeCount,
      edgeCount: edgeSegments.length / 6,
    },
  };
}
