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
  const radius = 32 + u3 * 46;
  return {
    x: radius * Math.sin(phi) * Math.cos(theta),
    y: radius * Math.cos(phi) * 0.65,
    z: radius * Math.sin(phi) * Math.sin(theta),
  };
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

    map.set(originId, { x: -26, y: 2, z: 0 });
    map.set(sinkId, { x: 26, y: -2, z: 0 });

    mules.forEach((accId, idx) => {
      const angle = (2 * Math.PI * idx) / Math.max(mules.length, 1);
      const ringRadius = 15.5;
      map.set(accId, {
        x: Math.sin(angle * 2) * 3.5,
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
        x: t * 48,
        y: Math.sin(waveAngle) * 8.5,
        z: Math.cos(waveAngle) * 11.5,
      });
    });
    return map;
  }

  const count = Math.max(accounts.length, 1);
  const radius = count <= 4 ? 16 : 22;
  accounts.forEach((accId, idx) => {
    const angle = (2 * Math.PI * idx) / count - Math.PI / 2;
    const elevation = Math.sin(angle * 2) * 3.6;
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

    investigation.evidence.account_ids.forEach((accId, idx) => {
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
          : 0x6366f1;
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
        radius: isAnchor ? 1.85 : 1.35,
        isAnchor,
        isHighRisk,
        profile,
      });
    });

    investigation.evidence.hops.forEach((hop, idx) => {
      const fromPos = posMap.get(hop.from_account_id) ?? { x: -10, y: 0, z: 0 };
      const toPos = posMap.get(hop.to_account_id) ?? { x: 10, y: 0, z: 0 };
      const midX = (fromPos.x + toPos.x) / 2;
      const midY = (fromPos.y + toPos.y) / 2 + 4.2 + (idx % 3) * 1.4;
      const midZ = (fromPos.z + toPos.z) / 2 + (idx % 2 === 0 ? 2.6 : -2.6);

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

    investigation.evidence.account_ids.forEach((accId, idx) => {
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
            x: accPos.x * 0.45,
            y: 17 + (uboAdded.size % 2) * 3.5,
            z: accPos.z * 0.45,
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
            radius: isUbo ? 2.1 : 1.6,
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
            x: accPos.x * 1.12,
            y: -14 - (bankAdded.size % 2) * 2.5,
            z: accPos.z * 1.12,
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
            radius: 1.45,
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
    const radius = 34 + jitter * 72;

    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.cos(phi) * 0.65;
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
