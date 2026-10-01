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
    const grad = ctx.createRadialGradient(32, 32, 1.5, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.22, 'rgba(255, 255, 255, 0.65)');
    grad.addColorStop(0.55, 'rgba(255, 255, 255, 0.12)');
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
  const wirePillRef = useRef<HTMLDivElement | null>(null);
  const uboPillRef = useRef<HTMLDivElement | null>(null);
  const shieldPillRef = useRef<HTMLDivElement | null>(null);
  const patternMorphRef = useRef<number>(1);
  const zoomControlRef = useRef<{
    zoomBy: (delta: number) => void;
    resetView: () => void;
  } | null>(null);

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
  const selectedNodeIdRef = useRef(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;
  const onSelectNodeIdRef = useRef(onSelectNodeId);
  onSelectNodeIdRef.current = onSelectNodeId;
  const interceptResultRef = useRef(interceptResult);
  interceptResultRef.current = interceptResult;

  // Three.js scene graph handles
  const cloudGroupRef = useRef<THREE.Group | null>(null);
  const ringGroupRef = useRef<THREE.Group | null>(null);
  const overlayGroupRef = useRef<THREE.Group | null>(null);
  const shieldGroupRef = useRef<THREE.Group | null>(null);
  const bgPointsMatRef = useRef<THREE.PointsMaterial | null>(null);
  const bgLinesMatRef = useRef<THREE.LineBasicMaterial | null>(null);
  const nodeBundlesRef = useRef<NodeMeshBundle[]>([]);
  const edgeMeshesRef = useRef<THREE.Mesh[]>([]);
  const arrowMeshesRef = useRef<THREE.Mesh[]>([]);
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
    scene.fog = new THREE.FogExp2(0x050811, 0.0038);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.5, 650);
    camera.position.set(0, 30, 112);

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

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.25);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0x38bdf8, 2.2);
    keyLight.position.set(42, 75, 55);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xa855f7, 1.45);
    rimLight.position.set(-45, -25, -40);
    scene.add(rimLight);

    const polarGrid = new THREE.PolarGridHelper(
      34,
      12,
      5,
      64,
      0x1e293b,
      0x0f172a
    );
    polarGrid.position.y = -13;
    scene.add(polarGrid);

    // Subtle expanding GQL radar ring on the floor plane
    const radarGeo = new THREE.RingGeometry(16.8, 17.35, 64);
    radarGeo.rotateX(-Math.PI / 2);
    const radarMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const radarRing = new THREE.Mesh(radarGeo, radarMat);
    radarRing.position.y = -12.9;
    scene.add(radarRing);

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
    let pointerDownX = 0;
    let pointerDownY = 0;
    let prevX = 0;
    let prevY = 0;
    let userAzimuthOffset = 0;
    let userPolarOffset = 0;
    let userZoomOffset = 0;

    zoomControlRef.current = {
      zoomBy: (delta: number) => {
        userZoomOffset = clamp(userZoomOffset + delta, -28, 70);
      },
      resetView: () => {
        userAzimuthOffset = 0;
        userPolarOffset = 0;
        userZoomOffset = 0;
      },
    };

    let dampedIsolate = 0;
    let dampedRightBias = 0;
    let dampedOverlay = 0;
    let dampedDistance = 112;
    let dampedPolar = 1.16;
    let dampedAzimuth = 0.32;
    const dampedTarget = new THREE.Vector3(0, 0, 0);
    const projVec = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();

    const domElem = renderer.domElement;
    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      pointerDownX = e.clientX;
      pointerDownY = e.clientY;
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
      userPolarOffset = clamp(userPolarOffset - dy * 0.0055, -0.52, 0.52);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!isDragging) {
        return;
      }
      isDragging = false;
      const moveDist = Math.hypot(
        e.clientX - pointerDownX,
        e.clientY - pointerDownY
      );
      if (moveDist < 6 && dampedIsolate > 0.45) {
        const rect = domElem.getBoundingClientRect();
        pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointerNdc, camera);
        const meshes = nodeBundlesRef.current.map((b) => b.coreMesh);
        const hits = raycaster.intersectObjects(meshes, false);
        if (hits.length > 0) {
          const hitMesh = hits[0].object;
          const found = nodeBundlesRef.current.find(
            (b) => b.coreMesh === hitMesh
          );
          if (found) {
            onSelectNodeIdRef.current(found.node.id);
          }
        }
      }
    };

    domElem.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

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
      const isWireBlocked = Boolean(
        interceptResultRef.current &&
          (interceptResultRef.current.decision === 'HELD' ||
            interceptResultRef.current.decision === 'BLOCK_HOLD_COMPLIANCE')
      );

      // Smooth 3D morph when switching among the 8 laundering patterns
      patternMorphRef.current += (1 - patternMorphRef.current) * 0.095;
      const morphT = patternMorphRef.current;

      // 1. Compute continuous isolation factor (0 = disguised in cloud, 1 = isolated ring)
      const targetIsolate = isFreeOrbit
        ? 1
        : smoothstep(0.02, 0.19, rawScroll);
      dampedIsolate += (targetIsolate - dampedIsolate) * 0.085;
      const effectiveIsolate = dampedIsolate * (0.35 + 0.65 * morphT);

      // Subtle radar pulse on the floor
      const pulsePhase = (clockTime * 0.42) % 1;
      radarRing.scale.setScalar(0.65 + pulsePhase * 0.85);
      radarMat.opacity = (1 - pulsePhase) * 0.26 * dampedIsolate;

      // 2. Background Cloud Expansion & Opacity
      cloudGroup.rotation.y += 0.001 * (1.2 - dampedIsolate * 0.65);
      cloudGroup.rotation.x = Math.sin(clockTime * 0.22) * 0.04;
      const cloudScale = 1 + dampedIsolate * 0.78;
      cloudGroup.scale.setScalar(cloudScale);

      if (bgPointsMatRef.current && bgLinesMatRef.current) {
        bgPointsMatRef.current.opacity = 0.82 - dampedIsolate * 0.72;
        bgLinesMatRef.current.opacity = 0.14 - dampedIsolate * 0.12;
      }

      // 3. Morph Ring Nodes from Cloud Scatter Position -> Isolated Ring Position
      nodeBundlesRef.current.forEach((bundle, idx) => {
        const { cloudPosition, ringPosition } = bundle.node;
        const driftY =
          Math.sin(clockTime * 1.4 + idx * 0.9) * 0.16 * effectiveIsolate;

        const x =
          cloudPosition.x +
          (ringPosition.x - cloudPosition.x) * effectiveIsolate;
        const y =
          cloudPosition.y +
          (ringPosition.y - cloudPosition.y) * effectiveIsolate +
          driftY;
        const z =
          cloudPosition.z +
          (ringPosition.z - cloudPosition.z) * effectiveIsolate;

        bundle.group.position.set(x, y, z);
        const nodeScale = (0.68 + effectiveIsolate * 0.32) * (0.7 + 0.3 * morphT);
        bundle.group.scale.setScalar(nodeScale);
        (bundle.haloSprite.material as THREE.SpriteMaterial).opacity =
          0.22 + effectiveIsolate * 0.58;
      });

      // 4. Reveal Sleek 3D Transfer Tubes, Arrowheads & Pulses
      const tubeReveal = smoothstep(0.4, 0.95, effectiveIsolate);
      const totalEdges = edgeMeshesRef.current.length;

      edgeMeshesRef.current.forEach((mesh, idx) => {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const arrowMesh = arrowMeshesRef.current[idx];
        const arrowMat = arrowMesh
          ? (arrowMesh.material as THREE.MeshBasicMaterial)
          : null;
        const isLastEdge = idx === totalEdges - 1;

        mesh.visible = tubeReveal > 0.02;
        if (arrowMesh) {
          arrowMesh.visible = tubeReveal > 0.05;
        }

        if (isWireBlocked && isLastEdge) {
          // Blocked closing wire turns crimson red
          mat.color.setHex(0xf43f5e);
          mat.emissive.setHex(0xf43f5e);
          mat.emissiveIntensity = 1.15;
          mat.opacity = tubeReveal * 0.96;
          if (arrowMat) {
            arrowMat.color.setHex(0xf43f5e);
            arrowMat.opacity = tubeReveal;
          }
        } else if (curChapter === 3) {
          if (idx === curHopIdx) {
            // Active hop blazes cyan (or emerald green on the final Clean Cash-Out hop!)
            const activeColor = isLastEdge ? 0x10b981 : 0x38bdf8;
            mat.color.setHex(activeColor);
            mat.emissive.setHex(activeColor);
            mat.emissiveIntensity = 1.2;
            mat.opacity = tubeReveal * 0.98;
            if (arrowMat) {
              arrowMat.color.setHex(activeColor);
              arrowMat.opacity = tubeReveal;
            }
          } else if (idx < curHopIdx) {
            // Completed hops stay illuminated in indigo so the laundering trail accumulates!
            mat.color.setHex(0x6366f1);
            mat.emissive.setHex(0x4f46e5);
            mat.emissiveIntensity = 0.55;
            mat.opacity = tubeReveal * 0.72;
            if (arrowMat) {
              arrowMat.color.setHex(0x818cf8);
              arrowMat.opacity = tubeReveal * 0.78;
            }
          } else {
            // Future hops remain dim until reached
            mat.color.setHex(0x334155);
            mat.emissive.setHex(0x1e293b);
            mat.emissiveIntensity = 0.12;
            mat.opacity = tubeReveal * 0.2;
            if (arrowMat) {
              arrowMat.color.setHex(0x475569);
              arrowMat.opacity = tubeReveal * 0.25;
            }
          }
        } else {
          const baseColor = idx === 0 ? 0x38bdf8 : isLastEdge ? 0x10b981 : 0x6366f1;
          mat.color.setHex(baseColor);
          mat.emissive.setHex(baseColor);
          mat.emissiveIntensity = 0.62;
          mat.opacity = tubeReveal * 0.8;
          if (arrowMat) {
            arrowMat.color.setHex(
              idx === 0 ? 0x38bdf8 : isLastEdge ? 0x10b981 : 0x818cf8
            );
            arrowMat.opacity = tubeReveal * 0.88;
          }
        }
      });

      pulseItemsRef.current.forEach((p) => {
        p.mesh.visible = tubeReveal > 0.2;
        p.glowSprite.visible = tubeReveal > 0.2;
        const isActiveHop = curChapter === 3 && p.hopIdx === curHopIdx;
        const isFutureHop = curChapter === 3 && p.hopIdx > curHopIdx;

        // Freeze pulse motion when wire is intercepted in Act 5
        if (!isWireBlocked) {
          const stepSpeed = isActiveHop
            ? p.speed * 1.85
            : isFutureHop
              ? p.speed * 0.4
              : p.speed;
          p.offset = (p.offset + stepSpeed) % 1;
        }

        const pt = p.curve.getPointAt(p.offset);
        p.mesh.position.copy(pt);
        p.glowSprite.position.copy(pt);
        const s =
          (isActiveHop ? 1.4 : isFutureHop ? 0.55 : 0.85) * tubeReveal;
        p.mesh.scale.setScalar(s);
        p.glowSprite.scale.setScalar(s * 2.35);
      });

      // 5. Elevated UBO & Bank Layer (Chapter 4 or manual toggle)
      const shouldShowOverlay =
        curChapter === 4 || showOwnershipRef.current || showBankRef.current;
      const targetOverlay = shouldShowOverlay ? 1 : 0;
      dampedOverlay += (targetOverlay - dampedOverlay) * 0.08;
      if (overlayGroupRef.current) {
        overlayGroupRef.current.visible = dampedOverlay > 0.02;
        overlayGroupRef.current.position.y = (1 - dampedOverlay) * 6;
      }

      if (shieldGroupRef.current) {
        shieldGroupRef.current.rotation.y += 0.018;
      }

      // 6. Camera Choreography & Right-Side Viewport Centering
      const w = mountRef.current?.clientWidth || window.innerWidth;
      const h = mountRef.current?.clientHeight || window.innerHeight;
      const targetRightBias = isFreeOrbit ? 0 : dampedIsolate;
      dampedRightBias += (targetRightBias - dampedRightBias) * 0.08;

      if (dampedRightBias > 0.005 && w > 900) {
        const pixelShiftRight = Math.round(-w * 0.185 * dampedRightBias);
        camera.setViewOffset(w, h, pixelShiftRight, 0, w, h);
      } else {
        camera.clearViewOffset();
      }

      let desiredTargetX = 0;
      let desiredTargetY = 0;
      let desiredTargetZ = 0;
      let desiredDistance = 112 - dampedIsolate * 36; // 112 -> 76
      let desiredPolar = 1.14 - dampedIsolate * 0.12;

      if (curChapter === 3 && curData.ringEdges.length > 0 && !isFreeOrbit) {
        const edge =
          curData.ringEdges[curHopIdx] ?? curData.ringEdges[0];
        if (edge) {
          desiredTargetX = (edge.fromPos.x + edge.toPos.x) * 0.22;
          desiredTargetY = (edge.fromPos.y + edge.toPos.y) * 0.22 + 0.5;
          desiredTargetZ = (edge.fromPos.z + edge.toPos.z) * 0.22;
          desiredDistance = 64;
          desiredPolar = 1.04;
        }
      } else if (curChapter === 4 && !isFreeOrbit) {
        desiredTargetY = 1.8;
        desiredDistance = 82;
        desiredPolar = 1.2;
      } else if (curChapter === 5 && !isFreeOrbit) {
        desiredDistance = 72;
        desiredPolar = 1.0;
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
        dampedAzimuth += 0.0015 * (1.25 - dampedIsolate * 0.55);
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

      // 7. Direct-DOM 60fps Floating Callout Positioning
      if (mountRef.current) {
        const activeEdge = curData.ringEdges[curHopIdx];
        const minX = !isFreeOrbit && w > 960 ? 520 : 40;

        nodeBundlesRef.current.forEach((bundle) => {
          const el = labelElsRef.current.get(bundle.node.id);
          if (!el) {
            return;
          }
          if (dampedIsolate < 0.64) {
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
            return;
          }

          const isSelected = selectedNodeIdRef.current === bundle.node.id;
          const isHopEndpoint =
            curChapter === 3 &&
            activeEdge &&
            (activeEdge.fromId === bundle.node.id ||
              activeEdge.toId === bundle.node.id);

          // Show both Dirty Cash In (isAnchor) AND Clean Cash-Out (isCashOut) in Acts 2, 4, 5!
          const shouldDisplay =
            curChapter === 3
              ? Boolean(isHopEndpoint || isSelected)
              : Boolean(
                  bundle.node.isAnchor ||
                    bundle.node.isCashOut ||
                    isSelected
                );

          if (!shouldDisplay) {
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
            return;
          }

          projVec.copy(bundle.group.position);
          projVec.y += bundle.node.radius + 0.85;
          projVec.project(camera);

          const screenX = (projVec.x * 0.5 + 0.5) * w;
          const screenY = (-projVec.y * 0.5 + 0.5) * h;
          const inBounds =
            projVec.z < 1 &&
            projVec.z > -1 &&
            screenX > minX &&
            screenX < w - 36 &&
            screenY > 74 &&
            screenY < h - 32;

          if (!inBounds) {
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
            return;
          }

          el.style.opacity = String(
            0.96 * smoothstep(0.64, 0.92, dampedIsolate)
          );
          el.style.pointerEvents = 'auto';
          el.style.transform = `translate3d(${screenX.toFixed(1)}px, ${screenY.toFixed(1)}px, 0) translate(-50%, -100%)`;
        });

        // 7b. Floating 3D Wire Amount Pill at Active Hop Midpoint (Act 3)
        const wireEl = wirePillRef.current;
        if (wireEl) {
          if (curChapter === 3 && activeEdge && dampedIsolate > 0.68) {
            projVec.set(
              activeEdge.controlPos.x,
              activeEdge.controlPos.y + 1.05,
              activeEdge.controlPos.z
            );
            projVec.project(camera);
            const sx = (projVec.x * 0.5 + 0.5) * w;
            const sy = (-projVec.y * 0.5 + 0.5) * h;
            if (
              projVec.z < 1 &&
              projVec.z > -1 &&
              sx > minX &&
              sx < w - 40 &&
              sy > 76 &&
              sy < h - 36
            ) {
              wireEl.style.opacity = '0.98';
              wireEl.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%)`;
            } else {
              wireEl.style.opacity = '0';
            }
          } else {
            wireEl.style.opacity = '0';
          }
        }

        // 7c. Floating 3D Beneficial Owner (UBO) Pill (Act 4 or UBO Overlay Toggle)
        const uboEl = uboPillRef.current;
        const primaryUbo = curData.overlayNodes.find(
          (n) => n.kind === 'ubo' || n.kind === 'entity'
        );
        if (uboEl) {
          if (
            primaryUbo &&
            dampedOverlay > 0.55 &&
            dampedIsolate > 0.68
          ) {
            projVec.set(
              primaryUbo.ringPosition.x,
              primaryUbo.ringPosition.y +
                (1 - dampedOverlay) * 6 +
                primaryUbo.radius +
                1.0,
              primaryUbo.ringPosition.z
            );
            projVec.project(camera);
            const sx = (projVec.x * 0.5 + 0.5) * w;
            const sy = (-projVec.y * 0.5 + 0.5) * h;
            if (
              projVec.z < 1 &&
              projVec.z > -1 &&
              sx > minX &&
              sx < w - 40 &&
              sy > 70 &&
              sy < h - 36
            ) {
              uboEl.style.opacity = String(dampedOverlay);
              uboEl.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
            } else {
              uboEl.style.opacity = '0';
            }
          } else {
            uboEl.style.opacity = '0';
          }
        }

        // 7d. Floating 3D Interception Shield Badge (Act 5 when wire is blocked)
        const shieldEl = shieldPillRef.current;
        if (shieldEl && shieldGroupRef.current) {
          if (isWireBlocked && dampedIsolate > 0.65) {
            projVec.copy(shieldGroupRef.current.position);
            projVec.y += 2.1;
            projVec.project(camera);
            const sx = (projVec.x * 0.5 + 0.5) * w;
            const sy = (-projVec.y * 0.5 + 0.5) * h;
            if (
              projVec.z < 1 &&
              projVec.z > -1 &&
              sx > minX &&
              sx < w - 40 &&
              sy > 70 &&
              sy < h - 36
            ) {
              shieldEl.style.opacity = '1';
              shieldEl.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
            } else {
              shieldEl.style.opacity = '0';
            }
          } else {
            shieldEl.style.opacity = '0';
          }
        }
      }
    };

    animate();

    return () => {
      window.cancelAnimationFrame(frameId);
      domElem.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
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

    // Trigger smooth 3D unfold morph on pattern switch
    patternMorphRef.current = 0.22;

    // 1. Background Cloud (Crisp Starlight Particles + Subtle Web)
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
      size: 1.35,
      map: glowTex ?? undefined,
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
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
      opacity: 0.13,
      blending: THREE.AdditiveBlending,
    });
    bgLinesMatRef.current = lineMat;
    cloudGroup.add(new THREE.LineSegments(lineGeo, lineMat));

    // 2. Foreground Laundering Ring Nodes & Sleek Fiber-Optic 3D Tubes
    ringGroup.clear();
    nodeBundlesRef.current = [];
    edgeMeshesRef.current = [];
    arrowMeshesRef.current = [];
    pulseItemsRef.current = [];

    sceneData.ringNodes.forEach((node) => {
      const group = new THREE.Group();
      group.position.set(
        node.cloudPosition.x,
        node.cloudPosition.y,
        node.cloudPosition.z
      );

      const sphereGeo = new THREE.SphereGeometry(node.radius, 24, 24);
      const sphereMat = new THREE.MeshStandardMaterial({
        color: node.colorHex,
        emissive: node.colorHex,
        emissiveIntensity: node.isAnchor || node.isCashOut ? 0.95 : 0.65,
        roughness: 0.15,
        metalness: 0.35,
      });
      const coreMesh = new THREE.Mesh(sphereGeo, sphereMat);
      group.add(coreMesh);

      if (node.isAnchor || node.isCashOut || node.isHighRisk) {
        const ringGeo = new THREE.RingGeometry(
          node.radius * 1.35,
          node.radius * 1.52,
          32
        );
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
          color: node.colorHex,
          transparent: true,
          opacity: 0.68,
          side: THREE.DoubleSide,
        });
        group.add(new THREE.Mesh(ringGeo, ringMat));
      }

      const spriteMat = new THREE.SpriteMaterial({
        map: glowTex ?? undefined,
        color: node.colorHex,
        transparent: true,
        opacity: 0.68,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const haloSprite = new THREE.Sprite(spriteMat);
      haloSprite.scale.setScalar(node.radius * 3.1);
      group.add(haloSprite);

      ringGroup.add(group);
      nodeBundlesRef.current.push({
        group,
        coreMesh,
        haloSprite,
        node,
      });
    });

    const upAxis = new THREE.Vector3(0, 1, 0);
    const totalEdges = sceneData.ringEdges.length;

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

      // Sleek, thin fiber-optic conduit
      const tubeGeo = new THREE.TubeGeometry(curve, 32, 0.095, 10, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: edge.colorHex,
        emissive: edge.colorHex,
        emissiveIntensity: 0.65,
        transparent: true,
        opacity: 0.8,
      });
      const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
      ringGroup.add(tubeMesh);
      edgeMeshesRef.current.push(tubeMesh);

      // Sleek directional cone arrowhead at t = 0.76 along the hop
      const arrowPos = curve.getPointAt(0.76);
      const tangent = curve.getTangentAt(0.76).normalize();
      const arrowGeo = new THREE.ConeGeometry(0.22, 0.58, 12);
      const arrowMat = new THREE.MeshBasicMaterial({
        color: edge.colorHex,
        transparent: true,
        opacity: 0.9,
      });
      const arrowMesh = new THREE.Mesh(arrowGeo, arrowMat);
      arrowMesh.position.copy(arrowPos);
      arrowMesh.quaternion.setFromUnitVectors(upAxis, tangent);
      ringGroup.add(arrowMesh);
      arrowMeshesRef.current.push(arrowMesh);

      const isLastEdge = idx === totalEdges - 1;
      const pulseColor =
        idx === 0 ? 0x38bdf8 : isLastEdge ? 0x10b981 : 0xf59e0b;
      const pulseGeo = new THREE.SphereGeometry(0.22, 12, 12);
      const pulseMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
      ringGroup.add(pulseMesh);

      const pulseGlowMat = new THREE.SpriteMaterial({
        map: glowTex ?? undefined,
        color: pulseColor,
        transparent: true,
        opacity: 0.9,
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
        speed: 0.0046 + (idx % 3) * 0.0009,
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
              node.radius * 1.25,
              node.radius * 1.25,
              node.radius * 1.25
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
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
      });
      overlayGroup.add(new THREE.Line(tetherGeo, tetherMat));
    });

    // 4. Pre-Settlement Interception Shield
    shieldGroup.clear();
    if (interceptResult && sceneData.ringEdges.length >= 1) {
      const lastEdge = sceneData.ringEdges[sceneData.ringEdges.length - 1];
      const shieldGeo = new THREE.OctahedronGeometry(1.45, 1);
      const shieldMat = new THREE.MeshBasicMaterial({
        color: 0xf43f5e,
        wireframe: true,
      });
      const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
      shieldGroup.position.set(
        lastEdge.controlPos.x,
        lastEdge.controlPos.y + 0.6,
        lastEdge.controlPos.z
      );
      shieldGroup.add(shieldMesh);
    }
  }, [sceneData, interceptResult]);

  const totalHops = sceneData.ringEdges.length;
  const activeEdge = sceneData.ringEdges[activeHopIndex];
  const isLastHop = activeHopIndex === Math.max(0, totalHops - 1);
  const primaryUbo = sceneData.overlayNodes.find(
    (n) => n.kind === 'ubo' || n.kind === 'entity'
  );

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

          let roleTitle = node.label;
          if (activeChapter === 3 && activeEdge?.fromId === node.id) {
            roleTitle =
              activeHopIndex === 0
                ? `Dirty Cash In • ${node.label}`
                : `Sender • ${node.label}`;
          } else if (activeChapter === 3 && activeEdge?.toId === node.id) {
            roleTitle = isLastHop
              ? `Clean Cash-Out • ${node.label}`
              : `Mule Hop ${activeHopIndex + 1} • ${node.label}`;
          } else if (node.isAnchor && node.isCashOut) {
            roleTitle = `Dirty In & Clean Return • ${node.label}`;
          } else if (node.isAnchor) {
            roleTitle = `1. Dirty Cash In • ${node.label}`;
          } else if (node.isCashOut) {
            roleTitle = `3. Clean Cash-Out • ${node.label}`;
          }

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
              } ${node.isCashOut && !node.isAnchor ? 'm3-node3d-pill--cashout' : ''} ${
                node.isHighRisk ? 'm3-node3d-pill--danger' : ''
              } ${isSelected || isHopEndpoint ? 'm3-node3d-pill--active' : ''}`}
              style={{ opacity: 0, pointerEvents: 'none' }}
            >
              <span
                className="m3-node3d-pill__dot"
                style={{
                  background: node.badgeColor,
                  boxShadow: `0 0 8px ${node.badgeColor}`,
                }}
              />
              <span className="m3-node3d-pill__text">
                <strong>{roleTitle}</strong>
                {(isSelected || isHopEndpoint || node.isAnchor || node.isCashOut) && (
                  <small>{node.jurisdiction}</small>
                )}
              </span>
            </button>
          );
        })}

        {/* Floating 3D Wire Amount Pill at Active Hop Midpoint (Act 3) */}
        <div
          ref={wirePillRef}
          className={`m3-wire3d-pill ${
            isLastHop ? 'm3-wire3d-pill--cashout' : ''
          }`}
          style={{ opacity: 0, pointerEvents: 'none' }}
        >
          {activeEdge && (
            <>
              <span className="m3-wire3d-pill__stage">
                {activeHopIndex === 0
                  ? 'PLACEMENT'
                  : isLastHop
                    ? 'CLEAN CASH-OUT'
                    : `LAYERING HOP ${activeHopIndex + 1}`}
              </span>
              <strong className="mono-num">
                $
                {activeEdge.hop.amount_paid.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                {isLastHop ? '✓' : '→'}
              </strong>
            </>
          )}
        </div>

        {/* Floating 3D Beneficial Owner (UBO) Pill (Act 4) */}
        <div
          ref={uboPillRef}
          className="m3-ubo3d-pill"
          style={{ opacity: 0, pointerEvents: 'none' }}
        >
          {primaryUbo && (
            <>
              <span className="m3-ubo3d-pill__tag">SHARED BENEFICIAL OWNER</span>
              <strong>
                {primaryUbo.label} ({primaryUbo.jurisdiction})
              </strong>
            </>
          )}
        </div>

        {/* Floating 3D Interception Badge (Act 5) */}
        <div
          ref={shieldPillRef}
          className="m3-shield3d-pill"
          style={{ opacity: 0, pointerEvents: 'none' }}
        >
          <span>⛔ WIRE BLOCKED BEFORE CLEAN PAYOUT</span>
        </div>
      </div>

      {/* Bottom-Right 3D Camera Zoom & Orbit Controls */}
      <div className="m3-universe3d-controls">
        <button
          type="button"
          className="m3-universe3d-ctrl-btn"
          title="Zoom In"
          onClick={() => zoomControlRef.current?.zoomBy(-10)}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            add
          </span>
        </button>
        <button
          type="button"
          className="m3-universe3d-ctrl-btn"
          title="Zoom Out"
          onClick={() => zoomControlRef.current?.zoomBy(10)}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
            remove
          </span>
        </button>
        <button
          type="button"
          className="m3-universe3d-ctrl-btn"
          title="Reset 3D Camera View"
          onClick={() => zoomControlRef.current?.resetView()}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
            center_focus_strong
          </span>
          <span>Reset View</span>
        </button>
      </div>
    </div>
  );
}
