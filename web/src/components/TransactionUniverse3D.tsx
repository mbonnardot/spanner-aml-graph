import { useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import * as THREE from 'three';
import { buildUniverse3DSceneData } from '../utils/universe3dLayout';
import type { RingNode3D } from '../utils/universe3dLayout';
import type {
  EnrichedCaseInvestigation,
  GraphUniverseResponse,
  InterceptionResult,
} from '../types/aml';

interface TransactionUniverse3DProps {
  readonly universe: GraphUniverseResponse | null;
  readonly investigation: EnrichedCaseInvestigation | null;
  readonly scrollProgressRef: MutableRefObject<number>;
  readonly activeChapter: 1 | 2 | 3 | 4 | 5;
  readonly activeHopIndex: number;
  readonly showOwnershipOverlay: boolean;
  readonly showBankOverlay: boolean;
  readonly selectedNodeId: string | null;
  readonly onSelectNodeId: (id: string) => void;
  readonly interceptResult: InterceptionResult | null;
  readonly interactiveOrbit: boolean;
}

interface PulseItem {
  readonly mesh: THREE.Mesh;
  readonly glowSprite: THREE.Sprite;
  readonly curve: THREE.CatmullRomCurve3;
  readonly hopIdx: number;
  readonly speed: number;
  offset: number;
}

interface NodeMeshBundle {
  readonly group: THREE.Group;
  readonly coreMesh: THREE.Mesh;
  readonly haloSprite: THREE.Sprite;
  readonly node: RingNode3D;
}

function createRadialGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.28, 'rgba(255, 255, 255, 0.72)');
    grad.addColorStop(0.65, 'rgba(255, 255, 255, 0.16)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function TransactionUniverse3D({
  universe,
  investigation,
  scrollProgressRef,
  activeChapter,
  activeHopIndex,
  showOwnershipOverlay,
  showBankOverlay,
  selectedNodeId,
  onSelectNodeId,
  interceptResult,
  interactiveOrbit,
}: TransactionUniverse3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const labelElsRef = useRef<Map<string, HTMLButtonElement>>(new Map());

  const sceneData = useMemo(
    () => buildUniverse3DSceneData(universe, investigation),
    [universe, investigation]
  );

  // Live reactive refs read inside the 60fps animation loop without rebuilding meshes
  const sceneDataRef = useRef(sceneData);
  sceneDataRef.current = sceneData;
  const activeChapterRef = useRef(activeChapter);
  activeChapterRef.current = activeChapter;
  const activeHopIndexRef = useRef(activeHopIndex);
  activeHopIndexRef.current = activeHopIndex;
  const showOwnershipRef = useRef(showOwnershipOverlay);
  showOwnershipRef.current = showOwnershipOverlay;
  const showBankRef = useRef(showBankOverlay);
  showBankRef.current = showBankOverlay;
  const interactiveOrbitRef = useRef(interactiveOrbit);
  interactiveOrbitRef.current = interactiveOrbit;

  // Three.js scene graph handles
  const cloudGroupRef = useRef<THREE.Group | null>(null);
  const ringGroupRef = useRef<THREE.Group | null>(null);
  const overlayGroupRef = useRef<THREE.Group | null>(null);
  const shieldGroupRef = useRef<THREE.Group | null>(null);
  const bgPointsMatRef = useRef<THREE.PointsMaterial | null>(null);
  const bgLinesMatRef = useRef<THREE.LineBasicMaterial | null>(null);
  const nodeBundlesRef = useRef<NodeMeshBundle[]>([]);
  const edgeMeshesRef = useRef<THREE.Mesh[]>([]);
  const pulseItemsRef = useRef<PulseItem[]>([]);
  const glowTexRef = useRef<THREE.CanvasTexture | null>(null);

  // Initialize WebGLRenderer & 60fps continuous interpolation loop ONCE
  useEffect(() => {
    const container = mountRef.current;
    if (!container) {
      return;
    }

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050811, 0.0042);

    const camera = new THREE.PerspectiveCamera(44, width / height, 0.5, 600);
    camera.position.set(0, 26, 98);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    glowTexRef.current = createRadialGlowTexture();

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0x38bdf8, 2.2);
    keyLight.position.set(40, 70, 50);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xa855f7, 1.5);
    rimLight.position.set(-45, -25, -40);
    scene.add(rimLight);

    const polarGrid = new THREE.PolarGridHelper(
      44,
      16,
      6,
      64,
      0x1e293b,
      0x0f172a
    );
    polarGrid.position.y = -16;
    scene.add(polarGrid);

    const cloudGroup = new THREE.Group();
    const ringGroup = new THREE.Group();
    const overlayGroup = new THREE.Group();
    const shieldGroup = new THREE.Group();
    scene.add(cloudGroup);
    scene.add(ringGroup);
    scene.add(overlayGroup);
    scene.add(shieldGroup);

    cloudGroupRef.current = cloudGroup;
    ringGroupRef.current = ringGroup;
    overlayGroupRef.current = overlayGroup;
    shieldGroupRef.current = shieldGroup;

    // Smooth damped animation state
    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let userAzimuthOffset = 0;
    let userPolarOffset = 0;
    let userZoomOffset = 0;

    let dampedIsolate = 0;
    let dampedOverlay = 0;
    let dampedDistance = 98;
    let dampedPolar = 1.18;
    let dampedAzimuth = 0.35;
    const dampedTarget = new THREE.Vector3(0, 0, 0);
    const projVec = new THREE.Vector3();

    const domElem = renderer.domElement;
    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      prevX = e.clientX;
      prevY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) {
        return;
      }
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      prevX = e.clientX;
      prevY = e.clientY;
      userAzimuthOffset -= dx * 0.0055;
      userPolarOffset = clamp(userPolarOffset - dy * 0.0055, -0.55, 0.55);
    };
    const onPointerUp = () => {
      isDragging = false;
    };
    const onWheel = (e: WheelEvent) => {
      if (!interactiveOrbitRef.current) {
        return;
      }
      e.preventDefault();
      userZoomOffset = clamp(userZoomOffset + e.deltaY * 0.04, -26, 65);
    };

    domElem.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    domElem.addEventListener('wheel', onWheel, { passive: false });

    const onResize = () => {
      if (!mountRef.current) {
        return;
      }
      const w = mountRef.current.clientWidth || window.innerWidth;
      const h = mountRef.current.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    let frameId = 0;
    let clockTime = 0;

    const animate = () => {
      frameId = window.requestAnimationFrame(animate);
      clockTime += 0.016;

      const isFreeOrbit = interactiveOrbitRef.current;
      const rawScroll = isFreeOrbit ? 0.28 : scrollProgressRef.current;
      const curChapter = activeChapterRef.current;
      const curHopIdx = activeHopIndexRef.current;
      const curData = sceneDataRef.current;

      // 1. Compute continuous isolation factor (0 = disguised in cloud, 1 = isolated ring)
      const targetIsolate = isFreeOrbit
        ? 1
        : smoothstep(0.02, 0.20, rawScroll);
      dampedIsolate += (targetIsolate - dampedIsolate) * 0.085;

      // 2. Background Cloud Expansion & Opacity
      cloudGroup.rotation.y += 0.0012 * (1.25 - dampedIsolate * 0.7);
      cloudGroup.rotation.x = Math.sin(clockTime * 0.25) * 0.05;
      const cloudScale = 1 + dampedIsolate * 0.85;
      cloudGroup.scale.setScalar(cloudScale);

      if (bgPointsMatRef.current && bgLinesMatRef.current) {
        bgPointsMatRef.current.opacity = 0.88 - dampedIsolate * 0.79;
        bgLinesMatRef.current.opacity = 0.18 - dampedIsolate * 0.155;
      }

      // 3. Morph Ring Nodes from Cloud Scatter Position -> Isolated Ring Position
      nodeBundlesRef.current.forEach((bundle, idx) => {
        const { cloudPosition, ringPosition } = bundle.node;
        const driftY =
          Math.sin(clockTime * 1.6 + idx * 0.9) * 0.35 * dampedIsolate;

        const x =
          cloudPosition.x +
          (ringPosition.x - cloudPosition.x) * dampedIsolate;
        const y =
          cloudPosition.y +
          (ringPosition.y - cloudPosition.y) * dampedIsolate +
          driftY;
        const z =
          cloudPosition.z +
          (ringPosition.z - cloudPosition.z) * dampedIsolate;

        bundle.group.position.set(x, y, z);
        const nodeScale = 0.55 + dampedIsolate * 0.45;
        bundle.group.scale.setScalar(nodeScale);
        (bundle.haloSprite.material as THREE.SpriteMaterial).opacity =
          0.25 + dampedIsolate * 0.65;
      });

      // 4. Reveal 3D Transfer Tubes & Pulses once nodes converge into ring
      const tubeReveal = smoothstep(0.42, 0.96, dampedIsolate);
      edgeMeshesRef.current.forEach((mesh, idx) => {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mesh.visible = tubeReveal > 0.02;
        if (curChapter === 3) {
          if (idx === curHopIdx) {
            mat.color.setHex(0x38bdf8);
            mat.emissive.setHex(0x38bdf8);
            mat.emissiveIntensity = 1.1;
            mat.opacity = tubeReveal;
          } else {
            mat.color.setHex(0x334155);
            mat.emissive.setHex(0x1e293b);
            mat.emissiveIntensity = 0.15;
            mat.opacity = tubeReveal * 0.28;
          }
        } else {
          const baseColor = idx === 0 ? 0x38bdf8 : 0x6366f1;
          mat.color.setHex(baseColor);
          mat.emissive.setHex(baseColor);
          mat.emissiveIntensity = 0.55;
          mat.opacity = tubeReveal * 0.82;
        }
      });

      pulseItemsRef.current.forEach((p) => {
        p.mesh.visible = tubeReveal > 0.2;
        p.glowSprite.visible = tubeReveal > 0.2;
        const isActiveHop = curChapter === 3 && p.hopIdx === curHopIdx;
        p.offset =
          (p.offset + (isActiveHop ? p.speed * 1.9 : p.speed)) % 1;
        const pt = p.curve.getPointAt(p.offset);
        p.mesh.position.copy(pt);
        p.glowSprite.position.copy(pt);
        const s = (isActiveHop ? 1.55 : 0.95) * tubeReveal;
        p.mesh.scale.setScalar(s);
        p.glowSprite.scale.setScalar(s * 4.5);
      });

      // 5. Elevated UBO & Bank Layer (Chapter 4 or manual toggle)
      const shouldShowOverlay =
        curChapter === 4 || showOwnershipRef.current || showBankRef.current;
      const targetOverlay = shouldShowOverlay ? 1 : 0;
      dampedOverlay += (targetOverlay - dampedOverlay) * 0.08;
      if (overlayGroupRef.current) {
        overlayGroupRef.current.visible = dampedOverlay > 0.02;
        overlayGroupRef.current.position.y = (1 - dampedOverlay) * 8;
      }

      if (shieldGroupRef.current) {
        shieldGroupRef.current.rotation.y += 0.02;
      }

      // 6. Camera Choreography (Target & Spherical Distance)
      // Shift lookAt target slightly left (-10) when cards are on the left so the 3D ring sits cleanly on the right!
      const cardOffsetX = isFreeOrbit ? 0 : -10.5 * dampedIsolate;
      let desiredTargetX = cardOffsetX;
      let desiredTargetY = 0;
      let desiredTargetZ = 0;
      let desiredDistance = 98 - dampedIsolate * 46;
      let desiredPolar = 1.18 - dampedIsolate * 0.14;

      if (curChapter === 3 && curData.ringEdges.length > 0 && !isFreeOrbit) {
        const edge =
          curData.ringEdges[curHopIdx] ?? curData.ringEdges[0];
        if (edge) {
          desiredTargetX =
            (edge.fromPos.x + edge.toPos.x) * 0.35 + cardOffsetX * 0.7;
          desiredTargetY = (edge.fromPos.y + edge.toPos.y) * 0.35 + 1.5;
          desiredTargetZ = (edge.fromPos.z + edge.toPos.z) * 0.35;
          desiredDistance = 38;
          desiredPolar = 1.06;
        }
      } else if (curChapter === 4 && !isFreeOrbit) {
        desiredTargetY = 3.5;
        desiredDistance = 58;
        desiredPolar = 1.24;
      } else if (curChapter === 5 && !isFreeOrbit) {
        desiredDistance = 46;
        desiredPolar = 0.98;
      }

      dampedTarget.x += (desiredTargetX - dampedTarget.x) * 0.07;
      dampedTarget.y += (desiredTargetY - dampedTarget.y) * 0.07;
      dampedTarget.z += (desiredTargetZ - dampedTarget.z) * 0.07;
      dampedDistance +=
        (desiredDistance + userZoomOffset - dampedDistance) * 0.07;
      dampedPolar = clamp(
        dampedPolar + (desiredPolar + userPolarOffset - dampedPolar) * 0.07,
        0.28,
        Math.PI - 0.28
      );

      if (!isDragging) {
        dampedAzimuth += 0.0018 * (1.3 - dampedIsolate * 0.55);
      }
      const totalAzimuth = dampedAzimuth + userAzimuthOffset;

      const camX =
        dampedTarget.x +
        dampedDistance * Math.sin(dampedPolar) * Math.sin(totalAzimuth);
      const camY =
        dampedTarget.y + dampedDistance * Math.cos(dampedPolar);
      const camZ =
        dampedTarget.z +
        dampedDistance * Math.sin(dampedPolar) * Math.cos(totalAzimuth);

      camera.position.set(camX, camY, camZ);
      camera.lookAt(dampedTarget);

      renderer.render(scene, camera);

      // 7. Direct-DOM 60fps Floating Callout Positioning (Zero React state lag)
      if (mountRef.current) {
        const w = mountRef.current.clientWidth || window.innerWidth;
        const h = mountRef.current.clientHeight || window.innerHeight;
        const activeEdge = curData.ringEdges[curHopIdx];

        nodeBundlesRef.current.forEach((bundle, idx) => {
          const el = labelElsRef.current.get(bundle.node.id);
          if (!el) {
            return;
          }
          if (dampedIsolate < 0.62) {
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
            return;
          }

          const isHopEndpoint =
            curChapter === 3 &&
            activeEdge &&
            (activeEdge.fromId === bundle.node.id ||
              activeEdge.toId === bundle.node.id);

          // Show callouts only for key nodes so the 3D scene stays clean and uncluttered
          const shouldDisplay =
            bundle.node.isAnchor ||
            bundle.node.isHighRisk ||
            isHopEndpoint ||
            curData.ringNodes.length <= 5 ||
            idx % 2 === 0;

          if (!shouldDisplay) {
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
            return;
          }

          projVec.copy(bundle.group.position);
          projVec.y += bundle.node.radius + 1.4;
          projVec.project(camera);

          const screenX = (projVec.x * 0.5 + 0.5) * w;
          const screenY = (-projVec.y * 0.5 + 0.5) * h;
          const inBounds =
            projVec.z < 1 &&
            projVec.z > -1 &&
            screenX > 40 &&
            screenX < w - 40 &&
            screenY > 70 &&
            screenY < h - 30;

          if (!inBounds) {
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
            return;
          }

          const opacity =
            curChapter === 3 && !isHopEndpoint && !bundle.node.isAnchor
              ? 0.42
              : 0.96;
          el.style.opacity = String(opacity * smoothstep(0.62, 0.9, dampedIsolate));
          el.style.pointerEvents = 'auto';
          el.style.transform = `translate3d(${screenX.toFixed(1)}px, ${screenY.toFixed(1)}px, 0) translate(-50%, -100%)`;
        });
      }
    };

    animate();

    return () => {
      window.cancelAnimationFrame(frameId);
      domElem.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      domElem.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    };
  }, [scrollProgressRef]);

  // Build Three.js Geometries ONLY when sceneData (scenario) or interceptResult changes
  useEffect(() => {
    const cloudGroup = cloudGroupRef.current;
    const ringGroup = ringGroupRef.current;
    const overlayGroup = overlayGroupRef.current;
    const shieldGroup = shieldGroupRef.current;
    const glowTex = glowTexRef.current;

    if (!cloudGroup || !ringGroup || !overlayGroup || !shieldGroup) {
      return;
    }

    // 1. Background Cloud (Additive Glowing Particles + Subtle Web)
    cloudGroup.clear();
    const ptsGeo = new THREE.BufferGeometry();
    ptsGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(sceneData.background.nodePositions, 3)
    );
    ptsGeo.setAttribute(
      'color',
      new THREE.BufferAttribute(sceneData.background.nodeColors, 3)
    );
    const ptsMat = new THREE.PointsMaterial({
      size: 3.6,
      map: glowTex ?? undefined,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    bgPointsMatRef.current = ptsMat;
    cloudGroup.add(new THREE.Points(ptsGeo, ptsMat));

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(sceneData.background.edgePositions, 3)
    );
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
    });
    bgLinesMatRef.current = lineMat;
    cloudGroup.add(new THREE.LineSegments(lineGeo, lineMat));

    // 2. Foreground Laundering Ring Nodes & Curved 3D Tubes
    ringGroup.clear();
    nodeBundlesRef.current = [];
    edgeMeshesRef.current = [];
    pulseItemsRef.current = [];

    sceneData.ringNodes.forEach((node) => {
      const group = new THREE.Group();
      group.position.set(
        node.cloudPosition.x,
        node.cloudPosition.y,
        node.cloudPosition.z
      );

      const sphereGeo = new THREE.SphereGeometry(node.radius, 28, 28);
      const sphereMat = new THREE.MeshStandardMaterial({
        color: node.colorHex,
        emissive: node.colorHex,
        emissiveIntensity: node.isAnchor ? 0.9 : 0.6,
        roughness: 0.18,
        metalness: 0.3,
      });
      const coreMesh = new THREE.Mesh(sphereGeo, sphereMat);
      group.add(coreMesh);

      const spriteMat = new THREE.SpriteMaterial({
        map: glowTex ?? undefined,
        color: node.colorHex,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const haloSprite = new THREE.Sprite(spriteMat);
      haloSprite.scale.setScalar(node.radius * 5.2);
      group.add(haloSprite);

      ringGroup.add(group);
      nodeBundlesRef.current.push({
        group,
        coreMesh,
        haloSprite,
        node,
      });
    });

    sceneData.ringEdges.forEach((edge, idx) => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(edge.fromPos.x, edge.fromPos.y, edge.fromPos.z),
        new THREE.Vector3(
          edge.controlPos.x,
          edge.controlPos.y,
          edge.controlPos.z
        ),
        new THREE.Vector3(edge.toPos.x, edge.toPos.y, edge.toPos.z),
      ]);

      const tubeGeo = new THREE.TubeGeometry(curve, 36, 0.24, 12, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: edge.colorHex,
        emissive: edge.colorHex,
        emissiveIntensity: 0.65,
        transparent: true,
        opacity: 0.85,
      });
      const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
      ringGroup.add(tubeMesh);
      edgeMeshesRef.current.push(tubeMesh);

      const pulseColor = idx === 0 ? 0x38bdf8 : 0xf59e0b;
      const pulseGeo = new THREE.SphereGeometry(0.48, 14, 14);
      const pulseMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
      ringGroup.add(pulseMesh);

      const pulseGlowMat = new THREE.SpriteMaterial({
        map: glowTex ?? undefined,
        color: pulseColor,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glowSprite = new THREE.Sprite(pulseGlowMat);
      ringGroup.add(glowSprite);

      pulseItemsRef.current.push({
        mesh: pulseMesh,
        glowSprite,
        curve,
        hopIdx: idx,
        speed: 0.0048 + (idx % 3) * 0.001,
        offset: (idx * 0.19) % 1,
      });
    });

    // 3. Elevated UBO & Bank Layer
    overlayGroup.clear();
    sceneData.overlayNodes.forEach((node) => {
      const geo =
        node.kind === 'ubo'
          ? new THREE.OctahedronGeometry(node.radius, 0)
          : new THREE.BoxGeometry(
              node.radius * 1.3,
              node.radius * 1.3,
              node.radius * 1.3
            );
      const mat = new THREE.MeshStandardMaterial({
        color: node.colorHex,
        emissive: node.colorHex,
        emissiveIntensity: 0.75,
        roughness: 0.2,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(
        node.ringPosition.x,
        node.ringPosition.y,
        node.ringPosition.z
      );
      overlayGroup.add(mesh);
    });

    sceneData.tethers.forEach((tether) => {
      const tetherGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(tether.fromPos.x, tether.fromPos.y, tether.fromPos.z),
        new THREE.Vector3(tether.toPos.x, tether.toPos.y, tether.toPos.z),
      ]);
      const tetherMat = new THREE.LineBasicMaterial({
        color: tether.colorHex,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
      });
      overlayGroup.add(new THREE.Line(tetherGeo, tetherMat));
    });

    // 4. Pre-Settlement Interception Shield
    shieldGroup.clear();
    if (interceptResult && sceneData.ringNodes.length >= 2) {
      const firstNode = sceneData.ringNodes[0];
      const lastNode = sceneData.ringNodes[sceneData.ringNodes.length - 1];
      const midX =
        (firstNode.ringPosition.x + lastNode.ringPosition.x) / 2;
      const midY =
        (firstNode.ringPosition.y + lastNode.ringPosition.y) / 2 + 3.5;
      const midZ =
        (firstNode.ringPosition.z + lastNode.ringPosition.z) / 2;

      const shieldGeo = new THREE.OctahedronGeometry(2.6, 1);
      const shieldMat = new THREE.MeshBasicMaterial({
        color: 0xf43f5e,
        wireframe: true,
      });
      const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
      shieldGroup.position.set(midX, midY, midZ);
      shieldGroup.add(shieldMesh);
    }
  }, [sceneData, interceptResult]);

  const activeEdge = sceneData.ringEdges[activeHopIndex];

  return (
    <div className="m3-universe3d-stage">
      <div ref={mountRef} className="m3-universe3d-canvas" />

      {/* Direct-DOM 60fps Projected Callout Pills */}
      <div className="m3-universe3d-labels">
        {sceneData.ringNodes.map((node) => {
          const isSelected = selectedNodeId === node.id;
          const isHopEndpoint =
            activeChapter === 3 &&
            activeEdge &&
            (activeEdge.fromId === node.id || activeEdge.toId === node.id);

          return (
            <button
              key={node.id}
              ref={(el) => {
                if (el) {
                  labelElsRef.current.set(node.id, el);
                } else {
                  labelElsRef.current.delete(node.id);
                }
              }}
              type="button"
              onClick={() => onSelectNodeId(node.id)}
              className={`m3-node3d-pill ${
                node.isAnchor ? 'm3-node3d-pill--anchor' : ''
              } ${node.isHighRisk ? 'm3-node3d-pill--danger' : ''} ${
                isSelected || isHopEndpoint ? 'm3-node3d-pill--active' : ''
              }`}
              style={{ opacity: 0, pointerEvents: 'none' }}
            >
              <span
                className="m3-node3d-pill__dot"
                style={{
                  background: node.badgeColor,
                  boxShadow: `0 0 10px ${node.badgeColor}`,
                }}
              />
              <span className="m3-node3d-pill__text">
                <strong>{node.label}</strong>
                <small>
                  {node.sublabel} • {node.jurisdiction}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
