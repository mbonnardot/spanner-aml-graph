import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import gsap from 'gsap';
import { buildUniverse3DSceneData } from '../utils/universe3dLayout';
import type { RingNode3D } from '../utils/universe3dLayout';
import type {
  EnrichedCaseInvestigation,
  GraphUniverseResponse,
  InterceptionResult,
} from '../types/aml';

interface ProjectedLabel {
  readonly id: string;
  readonly node: RingNode3D;
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
  readonly scale: number;
}

interface TransactionUniverse3DProps {
  readonly universe: GraphUniverseResponse | null;
  readonly investigation: EnrichedCaseInvestigation | null;
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
  readonly curve: THREE.CatmullRomCurve3;
  readonly hopIdx: number;
  readonly speed: number;
  offset: number;
}

export function TransactionUniverse3D({
  universe,
  investigation,
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
  const [projectedLabels, setProjectedLabels] = useState<readonly ProjectedLabel[]>([]);

  const sceneData = useMemo(
    () => buildUniverse3DSceneData(universe, investigation),
    [universe, investigation]
  );

  // Refs for Three.js objects mutated in animation loop / GSAP tweens
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const lookAtRef = useRef<{ x: number; y: number; z: number }>({
    x: 0,
    y: 0,
    z: 0,
  });
  const orbitStateRef = useRef<{
    isDragging: boolean;
    prevX: number;
    prevY: number;
    azimuth: number;
    polar: number;
    distance: number;
    autoRotateSpeed: number;
  }>({
    isDragging: false,
    prevX: 0,
    prevY: 0,
    azimuth: 0.45,
    polar: 1.12,
    distance: 108,
    autoRotateSpeed: 0.0022,
  });

  const bgPointsMatRef = useRef<THREE.PointsMaterial | null>(null);
  const bgLinesMatRef = useRef<THREE.LineBasicMaterial | null>(null);
  const ringGroupRef = useRef<THREE.Group | null>(null);
  const overlayGroupRef = useRef<THREE.Group | null>(null);
  const edgeMeshesRef = useRef<THREE.Mesh[]>([]);
  const pulseItemsRef = useRef<PulseItem[]>([]);
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

  // Initialize Three.js WebGLRenderer, Scene, Camera, Lights, and Animation Loop
  useEffect(() => {
    const container = mountRef.current;
    if (!container) {
      return;
    }

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xf0f4f9, 0.0038);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 600);
    camera.position.set(45, 36, 95);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.35);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x0b57d0, 1.6);
    dirLight1.position.set(45, 80, 55);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x7c3aed, 0.9);
    dirLight2.position.set(-50, -30, -40);
    scene.add(dirLight2);

    // Subtle spatial reference grid on the floor plane
    const polarGrid = new THREE.PolarGridHelper(48, 16, 6, 64, 0xcbd5e1, 0xe2e8f0);
    polarGrid.position.y = -19;
    scene.add(polarGrid);

    const cloudGroup = new THREE.Group();
    const ringGroup = new THREE.Group();
    const overlayGroup = new THREE.Group();
    scene.add(cloudGroup);
    scene.add(ringGroup);
    scene.add(overlayGroup);

    ringGroupRef.current = ringGroup;
    overlayGroupRef.current = overlayGroup;

    // Pointer interaction for manual 3D orbit
    const domElem = renderer.domElement;
    const onPointerDown = (e: PointerEvent) => {
      orbitStateRef.current.isDragging = true;
      orbitStateRef.current.prevX = e.clientX;
      orbitStateRef.current.prevY = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!orbitStateRef.current.isDragging) {
        return;
      }
      const dx = e.clientX - orbitStateRef.current.prevX;
      const dy = e.clientY - orbitStateRef.current.prevY;
      orbitStateRef.current.prevX = e.clientX;
      orbitStateRef.current.prevY = e.clientY;
      orbitStateRef.current.azimuth -= dx * 0.0055;
      orbitStateRef.current.polar = Math.max(
        0.25,
        Math.min(Math.PI - 0.25, orbitStateRef.current.polar - dy * 0.0055)
      );
    };
    const onPointerUp = () => {
      orbitStateRef.current.isDragging = false;
    };
    const onWheel = (e: WheelEvent) => {
      if (!interactiveOrbit) {
        return;
      }
      e.preventDefault();
      orbitStateRef.current.distance = Math.max(
        24,
        Math.min(165, orbitStateRef.current.distance + e.deltaY * 0.05)
      );
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
    let frameTick = 0;
    const projVec = new THREE.Vector3();

    const animate = () => {
      frameId = window.requestAnimationFrame(animate);
      frameTick += 1;

      // Gentle ambient rotation of the background galaxy cloud
      cloudGroup.rotation.y += 0.0009;
      cloudGroup.rotation.x = Math.sin(frameTick * 0.002) * 0.04;

      // Update camera position from spherical orbit coordinates around lookAtRef
      if (!orbitStateRef.current.isDragging) {
        orbitStateRef.current.azimuth += orbitStateRef.current.autoRotateSpeed;
      }
      const { azimuth, polar, distance } = orbitStateRef.current;
      const target = lookAtRef.current;

      const camX =
        target.x + distance * Math.sin(polar) * Math.sin(azimuth);
      const camY = target.y + distance * Math.cos(polar);
      const camZ =
        target.z + distance * Math.sin(polar) * Math.cos(azimuth);

      camera.position.set(camX, camY, camZ);
      camera.lookAt(target.x, target.y, target.z);

      // Animate glowing payment pulses along each 3D curved transfer hop
      const currentHopIdx = activeHopIndexRef.current;
      const currentChapter = activeChapterRef.current;
      pulseItemsRef.current.forEach((p) => {
        const isFocusedHop =
          currentChapter === 3 && p.hopIdx === currentHopIdx;
        p.offset = (p.offset + (isFocusedHop ? p.speed * 2.1 : p.speed)) % 1;
        const pt = p.curve.getPointAt(p.offset);
        p.mesh.position.copy(pt);
        const s = isFocusedHop ? 1.65 : 1.0;
        p.mesh.scale.set(s, s, s);
      });

      renderer.render(scene, camera);

      // Every 2 frames, project 3D ring nodes to 2D screen coordinates for M3 HTML pills
      if (frameTick % 2 === 0 && mountRef.current) {
        const w = mountRef.current.clientWidth || window.innerWidth;
        const h = mountRef.current.clientHeight || window.innerHeight;
        const curData = sceneDataRef.current;
        const includeOverlay =
          currentChapter === 4 ||
          showOwnershipRef.current ||
          showBankRef.current;

        const nodesToProject = includeOverlay
          ? [...curData.ringNodes, ...curData.overlayNodes]
          : curData.ringNodes;

        const nextLabels: ProjectedLabel[] = nodesToProject.map((node) => {
          projVec.set(node.position.x, node.position.y + 2.4, node.position.z);
          projVec.project(camera);
          const screenX = (projVec.x * 0.5 + 0.5) * w;
          const screenY = (-projVec.y * 0.5 + 0.5) * h;
          const isInFront = projVec.z < 1.0 && projVec.z > -1.0;
          const dist = camera.position.distanceTo(
            new THREE.Vector3(node.position.x, node.position.y, node.position.z)
          );
          const scale = Math.max(0.72, Math.min(1.15, 68 / Math.max(dist, 25)));
          return {
            id: node.id,
            node,
            x: screenX,
            y: screenY,
            visible:
              isInFront &&
              screenX > 30 &&
              screenX < w - 30 &&
              screenY > 40 &&
              screenY < h - 30,
            scale,
          };
        });
        setProjectedLabels(nextLabels);
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
  }, [interactiveOrbit]);

  // Rebuild 3D meshes whenever sceneData or interceptResult changes
  useEffect(() => {
    const ringGroup = ringGroupRef.current;
    const overlayGroup = overlayGroupRef.current;
    if (!ringGroup || !overlayGroup) {
      return;
    }

    const parentScene = ringGroup.parent;
    if (!parentScene) {
      return;
    }

    // 1. Rebuild Background Cloud in cloudGroup (child 3 of scene)
    const cloudGroup = parentScene.children.find(
      (c) => c instanceof THREE.Group && c !== ringGroup && c !== overlayGroup
    ) as THREE.Group | undefined;

    if (cloudGroup) {
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
        size: 1.85,
        vertexColors: true,
        transparent: true,
        opacity: activeChapter === 1 ? 0.82 : 0.16,
      });
      bgPointsMatRef.current = ptsMat;
      cloudGroup.add(new THREE.Points(ptsGeo, ptsMat));

      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute(
        'position',
        new THREE.BufferAttribute(sceneData.background.edgePositions, 3)
      );
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x64748b,
        transparent: true,
        opacity: activeChapter === 1 ? 0.22 : 0.04,
      });
      bgLinesMatRef.current = lineMat;
      cloudGroup.add(new THREE.LineSegments(lineGeo, lineMat));
    }

    // 2. Rebuild Foreground Laundering Ring Nodes & Curved 3D Tubes
    ringGroup.clear();
    edgeMeshesRef.current = [];
    pulseItemsRef.current = [];

    sceneData.ringNodes.forEach((node) => {
      const sphereGeo = new THREE.SphereGeometry(node.radius, 28, 28);
      const sphereMat = new THREE.MeshStandardMaterial({
        color: node.colorHex,
        roughness: 0.25,
        metalness: 0.15,
        emissive: node.colorHex,
        emissiveIntensity: node.isAnchor ? 0.38 : 0.22,
      });
      const mesh = new THREE.Mesh(sphereGeo, sphereMat);
      mesh.position.set(node.position.x, node.position.y, node.position.z);
      ringGroup.add(mesh);

      // Outer orbital halo ring around anchor or high-risk nodes
      if (node.isAnchor || node.isHighRisk) {
        const ringGeo = new THREE.RingGeometry(
          node.radius * 1.35,
          node.radius * 1.62,
          32
        );
        const ringMat = new THREE.MeshBasicMaterial({
          color: node.colorHex,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.55,
        });
        const halo = new THREE.Mesh(ringGeo, ringMat);
        halo.position.set(node.position.x, node.position.y, node.position.z);
        halo.rotation.x = Math.PI / 2;
        ringGroup.add(halo);
      }
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

      const tubeGeo = new THREE.TubeGeometry(curve, 32, 0.34, 12, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: edge.colorHex,
        emissive: edge.colorHex,
        emissiveIntensity: 0.28,
        transparent: true,
        opacity: 0.86,
      });
      const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
      ringGroup.add(tubeMesh);
      edgeMeshesRef.current.push(tubeMesh);

      // Travelling payment pulse sphere along the 3D curve
      const pulseGeo = new THREE.SphereGeometry(0.75, 16, 16);
      const pulseMat = new THREE.MeshBasicMaterial({
        color: idx === 0 ? 0xf59e0b : 0x0b57d0,
      });
      const pulseMesh = new THREE.Mesh(pulseGeo, pulseMat);
      ringGroup.add(pulseMesh);
      pulseItemsRef.current.push({
        mesh: pulseMesh,
        curve,
        hopIdx: idx,
        speed: 0.0055 + (idx % 3) * 0.0012,
        offset: (idx * 0.17) % 1,
      });
    });

    // If Chapter 5 has an active interception result, draw a pulsing crimson block shield
    if (interceptResult && sceneData.ringNodes.length >= 2) {
      const firstNode = sceneData.ringNodes[0];
      const lastNode = sceneData.ringNodes[sceneData.ringNodes.length - 1];
      const midX = (firstNode.position.x + lastNode.position.x) / 2;
      const midY = (firstNode.position.y + lastNode.position.y) / 2 + 4;
      const midZ = (firstNode.position.z + lastNode.position.z) / 2;

      const shieldGeo = new THREE.OctahedronGeometry(2.8, 1);
      const shieldMat = new THREE.MeshBasicMaterial({
        color: 0xd93025,
        wireframe: true,
      });
      const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
      shieldMesh.position.set(midX, midY, midZ);
      ringGroup.add(shieldMesh);
    }

    // 3. Rebuild Elevated UBO / Entity & Bank Overlay Group
    overlayGroup.clear();
    sceneData.overlayNodes.forEach((node) => {
      const geo =
        node.kind === 'ubo'
          ? new THREE.OctahedronGeometry(node.radius, 0)
          : new THREE.BoxGeometry(
              node.radius * 1.4,
              node.radius * 1.4,
              node.radius * 1.4
            );
      const mat = new THREE.MeshStandardMaterial({
        color: node.colorHex,
        emissive: node.colorHex,
        emissiveIntensity: 0.35,
        roughness: 0.2,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(node.position.x, node.position.y, node.position.z);
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
        opacity: 0.65,
      });
      overlayGroup.add(new THREE.Line(tetherGeo, tetherMat));
    });
  }, [sceneData, interceptResult, activeChapter]);

  // GSAP Camera & Material Choreography triggered by activeChapter, activeHopIndex, or overlays
  useEffect(() => {
    const orbit = orbitStateRef.current;
    const target = lookAtRef.current;
    const bgPtsMat = bgPointsMatRef.current;
    const bgLinesMat = bgLinesMatRef.current;
    const overlayGroup = overlayGroupRef.current;

    const showOverlays =
      activeChapter === 4 || showOwnershipOverlay || showBankOverlay;
    if (overlayGroup) {
      overlayGroup.visible = showOverlays;
    }

    // Highlight active hop tube in Chapter 3
    edgeMeshesRef.current.forEach((mesh, idx) => {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (activeChapter === 3) {
        if (idx === activeHopIndex) {
          mat.color.setHex(0xf59e0b);
          mat.emissive.setHex(0xf59e0b);
          mat.emissiveIntensity = 0.75;
          mat.opacity = 1.0;
        } else {
          mat.color.setHex(0x94a3b8);
          mat.emissive.setHex(0x64748b);
          mat.emissiveIntensity = 0.1;
          mat.opacity = 0.32;
        }
      } else {
        mat.color.setHex(idx === 0 ? 0x0b57d0 : 0x1a73e8);
        mat.emissive.setHex(idx === 0 ? 0x0b57d0 : 0x1a73e8);
        mat.emissiveIntensity = 0.32;
        mat.opacity = activeChapter === 1 ? 0.45 : 0.9;
      }
    });

    if (bgPtsMat && bgLinesMat) {
      gsap.to(bgPtsMat, {
        opacity: activeChapter === 1 ? 0.85 : 0.14,
        duration: 1.1,
        ease: 'power2.out',
      });
      gsap.to(bgLinesMat, {
        opacity: activeChapter === 1 ? 0.24 : 0.035,
        duration: 1.1,
        ease: 'power2.out',
      });
    }

    if (activeChapter === 1) {
      // Chapter 1: Wide galaxy orbit of all 3,267 transactions
      gsap.to(target, { x: 0, y: 0, z: 0, duration: 1.3, ease: 'power3.out' });
      gsap.to(orbit, {
        distance: 112,
        polar: 1.15,
        autoRotateSpeed: 0.0024,
        duration: 1.4,
        ease: 'power3.out',
      });
    } else if (activeChapter === 2) {
      // Chapter 2: Swoop in & isolate the detected laundering ring
      gsap.to(target, { x: 0, y: 0, z: 0, duration: 1.2, ease: 'power3.out' });
      gsap.to(orbit, {
        distance: 56,
        polar: 1.02,
        autoRotateSpeed: 0.0014,
        duration: 1.3,
        ease: 'power3.out',
      });
    } else if (activeChapter === 3) {
      // Chapter 3: Zoom directly onto the active Hop edge in 3D space
      const edge =
        sceneData.ringEdges[activeHopIndex] ?? sceneData.ringEdges[0];
      if (edge) {
        const midX = (edge.fromPos.x + edge.toPos.x) / 2;
        const midY = (edge.fromPos.y + edge.toPos.y) / 2 + 2;
        const midZ = (edge.fromPos.z + edge.toPos.z) / 2;
        gsap.to(target, {
          x: midX,
          y: midY,
          z: midZ,
          duration: 0.95,
          ease: 'power3.out',
        });
        gsap.to(orbit, {
          distance: 36,
          polar: 1.08,
          azimuth: Math.atan2(midX, midZ) + 0.5,
          autoRotateSpeed: 0.0005,
          duration: 0.95,
          ease: 'power3.out',
        });
      }
    } else if (activeChapter === 4) {
      // Chapter 4: Isometric elevation revealing the UBO Puppet Master & Banks
      gsap.to(target, { x: 0, y: 5, z: 0, duration: 1.2, ease: 'power3.out' });
      gsap.to(orbit, {
        distance: 68,
        polar: 1.24,
        autoRotateSpeed: 0.0015,
        duration: 1.25,
        ease: 'power3.out',
      });
    } else if (activeChapter === 5) {
      // Chapter 5: Pre-settlement interception gate & Gemini SAR
      const anchor = sceneData.ringNodes[0];
      gsap.to(target, {
        x: anchor ? anchor.position.x * 0.45 : 0,
        y: 0,
        z: anchor ? anchor.position.z * 0.45 : 0,
        duration: 1.1,
        ease: 'power3.out',
      });
      gsap.to(orbit, {
        distance: 48,
        polar: 0.96,
        autoRotateSpeed: 0.001,
        duration: 1.2,
        ease: 'power3.out',
      });
    }
  }, [
    activeChapter,
    activeHopIndex,
    showOwnershipOverlay,
    showBankOverlay,
    sceneData,
  ]);

  return (
    <div className="m3-universe3d-stage">
      <div ref={mountRef} className="m3-universe3d-canvas" />

      {/* Projected 3D-to-2D Floating Material 3 Node Pills */}
      {activeChapter >= 2 && (
        <div className="m3-universe3d-labels">
          {projectedLabels.map((item) => {
            if (!item.visible) {
              return null;
            }
            const isSelected = selectedNodeId === item.node.id;
            const activeEdge = sceneData.ringEdges[activeHopIndex];
            const isHopEndpoint =
              activeChapter === 3 &&
              activeEdge &&
              (activeEdge.hop.from_account_id === item.node.id ||
                activeEdge.hop.to_account_id === item.node.id);

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.node.kind === 'account') {
                    onSelectNodeId(item.node.id);
                  }
                }}
                className={`m3-node3d-pill ${
                  item.node.isAnchor ? 'm3-node3d-pill--anchor' : ''
                } ${item.node.isHighRisk ? 'm3-node3d-pill--danger' : ''} ${
                  item.node.kind === 'ubo' ? 'm3-node3d-pill--ubo' : ''
                } ${isSelected || isHopEndpoint ? 'm3-node3d-pill--active' : ''}`}
                style={{
                  transform: `translate3d(${item.x}px, ${item.y}px, 0) translate(-50%, -100%) scale(${item.scale})`,
                }}
              >
                <span
                  className="m3-node3d-pill__dot"
                  style={{ background: item.node.badgeColor }}
                />
                <span className="m3-node3d-pill__text">
                  <strong>{item.node.label}</strong>
                  <small>
                    {item.node.sublabel} • {item.node.jurisdiction}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
