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
  readonly position: Vec3;
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

function computeAccountPositions3D(
  investigation: EnrichedCaseInvestigation
): ReadonlyMap<string, Vec3> {
  const accounts = investigation.evidence.account_ids;
  const hops = investigation.evidence.hops;
  const typology = investigation.evidence.typology;
  const map = new Map<string, Vec3>();

  if (typology === 'SCATTER_GATHER' && accounts.length >= 3) {
    const originId = hops[0]?.from_account_id ?? accounts[0];
    const sinkId =
      hops[hops.length - 1]?.to_account_id ?? accounts[accounts.length - 1];
    const mules = accounts.filter((a) => a !== originId && a !== sinkId);

    map.set(originId, { x: -32, y: 2, z: 0 });
    map.set(sinkId, { x: 32, y: -2, z: 0 });

    mules.forEach((accId, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(mules.length, 1);
      const ringRadius = 18;
      map.set(accId, {
        x: Math.sin(angle * 2) * 4,
        y: Math.cos(angle) * ringRadius,
        z: Math.sin(angle) * ringRadius,
      });
    });
    return map;
  }

  if (typology === 'RANDOM_WALK') {
    const count = accounts.length;
    accounts.forEach((accId, idx) => {
      const t = count > 1 ? idx / (count - 1) - 0.5 : 0;
      const waveAngle = idx * 0.95;
      map.set(accId, {
        x: t * 58,
        y: Math.sin(waveAngle) * 10,
        z: Math.cos(waveAngle) * 14,
      });
    });
    return map;
  }

  const count = Math.max(accounts.length, 1);
  const radius = count <= 4 ? 19 : 26;
  accounts.forEach((accId, idx) => {
    const angle = (2 * Math.PI * idx) / count - Math.PI / 2;
    const elevation = Math.sin(angle * 2) * 4.2;
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
  const activeAccountSet = new Set<string>(
    investigation?.evidence.account_ids ?? []
  );

  const ringNodes: RingNode3D[] = [];
  const overlayNodes: RingNode3D[] = [];
  const ringEdges: RingEdge3D[] = [];
  const tethers: OwnershipTether3D[] = [];

  if (investigation) {
    const posMap = computeAccountPositions3D(investigation);
    const anchorId = investigation.evidence.account_ids[0] ?? '';

    investigation.evidence.account_ids.forEach((accId) => {
      const pos = posMap.get(accId) ?? { x: 0, y: 0, z: 0 };
      const profile = investigation.kyc_profiles[accId];
      const isAnchor = accId === anchorId;
      const isHighRisk = Boolean(
        profile?.is_pep_or_sanctioned ||
          profile?.is_flagged ||
          profile?.kyc_risk_tier === 'HIGH' ||
          profile?.kyc_risk_tier === 'CRITICAL'
      );

      const colorHex = isAnchor
        ? 0x0b57d0
        : isHighRisk
          ? 0xd93025
          : 0x0284c7;
      const badgeColor = isAnchor
        ? '#0b57d0'
        : isHighRisk
          ? '#b3261e'
          : '#00639b';

      ringNodes.push({
        id: accId,
        kind: 'account',
        label: profile?.entity_name ?? accId,
        sublabel: accId,
        jurisdiction: profile?.bank_jurisdiction ?? 'US',
        position: pos,
        colorHex,
        badgeColor,
        radius: isAnchor ? 2.2 : 1.65,
        isAnchor,
        isHighRisk,
        profile,
      });
    });

    investigation.evidence.hops.forEach((hop, idx) => {
      const fromPos = posMap.get(hop.from_account_id) ?? { x: -10, y: 0, z: 0 };
      const toPos = posMap.get(hop.to_account_id) ?? { x: 10, y: 0, z: 0 };
      const midX = (fromPos.x + toPos.x) / 2;
      const midY = (fromPos.y + toPos.y) / 2 + 5.2 + (idx % 3) * 1.6;
      const midZ = (fromPos.z + toPos.z) / 2 + (idx % 2 === 0 ? 3.2 : -3.2);

      ringEdges.push({
        id: `${hop.transaction_id}:${idx}`,
        hop,
        fromPos,
        toPos,
        controlPos: { x: midX, y: midY, z: midZ },
        colorHex: idx === 0 ? 0x0b57d0 : 0x1a73e8,
      });
    });

    const uboAdded = new Map<string, Vec3>();
    const bankAdded = new Map<string, Vec3>();

    investigation.evidence.account_ids.forEach((accId, idx) => {
      const accPos = posMap.get(accId);
      const profile = investigation.kyc_profiles[accId];
      if (!accPos || !profile) {
        return;
      }

      const ownerKey = profile.ubo_entity_id ?? profile.entity_id;
      const ownerName = profile.ubo_entity_name ?? profile.entity_name;
      const isUbo = Boolean(profile.ubo_entity_id);

      if (ownerKey && (isUbo || profile.kyc_risk_tier === 'HIGH' || idx < 4)) {
        let ownerPos = uboAdded.get(ownerKey);
        if (!ownerPos) {
          ownerPos = {
            x: accPos.x * 0.5,
            y: 20 + (uboAdded.size % 2) * 4,
            z: accPos.z * 0.5,
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
            position: ownerPos,
            colorHex: isUbo ? 0x7c3aed : 0xb3261e,
            badgeColor: isUbo ? '#7c3aed' : '#b3261e',
            radius: isUbo ? 2.5 : 1.95,
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
          colorHex: 0x7c3aed,
        });
      }

      if (profile.bank_id && bankAdded.size < 6) {
        let bankPos = bankAdded.get(profile.bank_id);
        if (!bankPos) {
          bankPos = {
            x: accPos.x * 1.15,
            y: -16 - (bankAdded.size % 2) * 3,
            z: accPos.z * 1.15,
          };
          bankAdded.set(profile.bank_id, bankPos);
          overlayNodes.push({
            id: `bank:${profile.bank_id}`,
            kind: 'bank',
            label: profile.bank_name,
            sublabel: profile.bic_swift,
            jurisdiction: profile.bank_jurisdiction,
            position: bankPos,
            colorHex: 0x0284c7,
            badgeColor: '#0284c7',
            radius: 1.75,
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
          colorHex: 0x0284c7,
        });
      }
    });
  }

  const rawAccounts = universe?.accounts ?? [];
  const rawTxs = universe?.transactions ?? [];

  const bgAccounts =
    rawAccounts.length > 0
      ? rawAccounts
      : Array.from({ length: 340 }, (_, i) => ({
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
    const radius = 50 + jitter * 85;

    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.cos(phi) * 0.68;
    const z = radius * Math.sin(phi) * Math.sin(theta);

    bgPosMap.set(acc.account_id, { x, y, z });
    nodePositions[i * 3] = x;
    nodePositions[i * 3 + 1] = y;
    nodePositions[i * 3 + 2] = z;

    if (acc.is_flagged) {
      nodeColors[i * 3] = 0.86;
      nodeColors[i * 3 + 1] = 0.25;
      nodeColors[i * 3 + 2] = 0.2;
    } else {
      nodeColors[i * 3] = 0.22;
      nodeColors[i * 3 + 1] = 0.46;
      nodeColors[i * 3 + 2] = 0.82;
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

  for (let i = 0; i < Math.min(nodeCount - 3, 280); i += 1) {
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
