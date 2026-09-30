import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useApp } from '../state/AppContext';
import {
  buildFlagColors,
  buildNonIndexedPositions,
  buildSelectionOverlay,
  makeCheckerTexture,
} from '../three/geometry';
import type { MeshData } from '../core/types';

export function View3D() {
  const { state, selectFaces, toggleFace } = useApp();
  const mountRef = useRef<HTMLDivElement>(null);

  const worldRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    mesh: THREE.Mesh;
    overlay: THREE.Mesh;
    wire: THREE.LineSegments;
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2;
    positions: Float32Array | null;
    frame: number;
    downX: number;
    downY: number;
    meshData: MeshData | null;
  } | null>(null);

  // 初始化场景（一次）
  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#20222a');

    const camera = new THREE.PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      0.01,
      1000,
    );
    camera.position.set(2.4, 1.8, 3.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xaac4ff, 0.5);
    fill.position.set(-3, -1, -2);
    scene.add(fill);

    const geo = new THREE.BufferGeometry();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.75,
      metalness: 0,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    const overlay = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x42c7ff,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthTest: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    overlay.renderOrder = 2;
    scene.add(overlay);

    const wire = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x1b1d24 }),
    );
    scene.add(wire);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const world = {
      renderer, scene, camera, controls, mesh, overlay, wire,
      raycaster, pointer, positions: null as Float32Array | null,
      frame: 0, downX: 0, downY: 0, meshData: null as MeshData | null,
    };
    worldRef.current = world;

    const animate = () => {
      world.frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(world.frame);
      ro.disconnect();
      controls.dispose();
      geo.dispose();
      mat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      worldRef.current = null;
    };
  }, []);

  // 模型/标记变化时重建几何
  const { mesh: meshData, stats } = state;
  useEffect(() => {
    const world = worldRef.current;
    if (!world || !meshData || !stats) return;

    const positions = buildNonIndexedPositions(meshData);
    world.positions = positions;
    world.meshData = meshData;
    const geo = world.mesh.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const colors = buildFlagColors(
      meshData,
      stats,
      state.showFlipped,
      state.showOverlap,
    );
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // 棋盘纹理
    const mat = world.mesh.material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    mat.map = null;
    if (state.checkerOn) {
      const tex = makeCheckerTexture(state.checkerScale);
      const uvs = new Float32Array(positions.length / 3 * 2);
      let o = 0;
      for (const t of meshData.triangles) {
        for (const ci of t.corners) {
          const c = meshData.corners[ci];
          const vt = c.vt >= 0 ? c.vt : c.v;
          uvs[o++] = meshData.uvs[vt * 2];
          uvs[o++] = meshData.uvs[vt * 2 + 1];
        }
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      mat.map = tex;
      mat.color.set(0xffffff);
      mat.vertexColors = false;
      mat.needsUpdate = true;
    } else {
      mat.vertexColors = true;
      mat.needsUpdate = true;
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    geo.computeBoundingBox();

    // 深色三角形线框（非索引，相邻面有重复线段，低模无妨）
    const linePos: number[] = [];
    for (const t of meshData.triangles) {
      const cs = t.corners.map((ci) => {
        const c = meshData.corners[ci];
        return [
          meshData.positions[c.v * 3],
          meshData.positions[c.v * 3 + 1],
          meshData.positions[c.v * 3 + 2],
        ];
      });
      linePos.push(...cs[0], ...cs[1], ...cs[1], ...cs[2], ...cs[2], ...cs[0]);
    }
    world.wire.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(linePos, 3),
    );

    // 取景：首次或换模型时居中
    const box = geo.boundingBox!;
    const center = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2 || 1;
    world.camera.position.copy(center).add(new THREE.Vector3(1.6 * r, 1.1 * r, 2.0 * r));
    world.camera.near = r / 100;
    world.camera.far = r * 100;
    world.camera.updateProjectionMatrix();
    world.controls.target.copy(center);
    world.controls.update();
  }, [meshData, stats, state.checkerOn, state.checkerScale, state.showFlipped, state.showOverlap]);

  // 选择集 -> 覆盖网格
  useEffect(() => {
    const world = worldRef.current;
    if (!world || !meshData || !world.positions) return;
    const g = buildSelectionOverlay(meshData, state.selectedFaceIds, world.positions);
    world.overlay.geometry.dispose();
    world.overlay.geometry = g;
  }, [state.selectedFaceIds, meshData]);

  // 拾取：区分单击与拖动（拖动交给 OrbitControls）
  useEffect(() => {
    const world = worldRef.current;
    const el = world?.renderer.domElement;
    if (!world || !el) return;

    const setPointer = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      world.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      world.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };
    const onDown = (e: PointerEvent) => {
      world.downX = e.clientX;
      world.downY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - world.downX, e.clientY - world.downY) > 4) return;
      const data = world.meshData;
      if (!data) return;
      setPointer(e);
      world.raycaster.setFromCamera(world.pointer, world.camera);
      const hits = world.raycaster.intersectObject(world.mesh, false);
      if (hits.length === 0) {
        selectFaces(new Set());
        return;
      }
      // 非索引几何：faceIndex 即三角形在 BufferGeometry 中的顺序，
      // 也就是 mesh.triangles 的下标。
      const triId = hits[0].faceIndex!;
      const faceId = data.triangles[triId]?.faceId;
      if (faceId === undefined) return;
      if (e.shiftKey) toggleFace(faceId);
      else selectFaces(new Set([faceId]));
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, [selectFaces, toggleFace]);

  const label = useMemo(() => {
    if (!meshData) return '未载入模型';
    return `${meshData.fileName} · ${meshData.faces.length} 面 / ${meshData.triangles.length} 三角 / ${meshData.vertexCount} 顶点身份`;
  }, [meshData]);

  return (
    <div className="view view3d" ref={mountRef}>
      <div className="view-label">3D 模型 — {label}</div>
    </div>
  );
}
