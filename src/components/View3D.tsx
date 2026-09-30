import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Mesh, OverlayMode } from '../types';
import { heatColor, type Analysis, type TriFlag } from '../lib/analysis';
import { makeCheckerTexture } from '../lib/checker';

interface Props {
  mesh: Mesh;
  analysis: Analysis;
  selection: Set<number>;
  overlay: OverlayMode;
  checker: boolean;
  showEdges: boolean;
  onPick: (faceIds: number[], additive: boolean) => void;
}

const FLAG_COLOR: Record<TriFlag, THREE.ColorRepresentation> = {
  flipped: 0xff5470,
  overlap: 0xffa726,
  degenerate3d: 0x9d4edd,
  degenerateUv: 0x8d6e63,
  badDensity: 0xe64a19,
};

export default function View3D(
  { mesh, analysis, selection, overlay, checker, showEdges, onPick }: Props,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  // 分析结果在拾取回调中需要最新值
  const analysisRef = useRef(analysis);
  const live = useRef({ selection, overlay, checker, showEdges, onPick });
  live.current = { selection, overlay, checker, showEdges, onPick };

  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    geom: THREE.BufferGeometry;
    meshObj: THREE.Mesh;
    edgeLines: THREE.LineSegments;
    checkerTex: THREE.CanvasTexture;
  } | null>(null);

  // 初始化一次
  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1b1e24);
    const camera = new THREE.PerspectiveCamera(
      50, mount.clientWidth / mount.clientHeight, 0.01, 1000);
    camera.position.set(3, 2.2, 3.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x333844, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(4, 6, 3);
    scene.add(key);
    scene.add(new THREE.GridHelper(10, 20, 0x3a4150, 0x2a2f38));

    const geom = new THREE.BufferGeometry();
    const checkerTex = makeCheckerTexture();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      metalness: 0.0,
      side: THREE.DoubleSide,
      map: checkerTex,
    });
    const meshObj = new THREE.Mesh(geom, mat);
    scene.add(meshObj);

    const edgeGeom = new THREE.BufferGeometry();
    const edgeLines = new THREE.LineSegments(
      edgeGeom, new THREE.LineBasicMaterial({ vertexColors: true }));
    scene.add(edgeLines);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0, downY = 0;
    const onPointerDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; };
    const onPointerUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return; // 拖拽不拾取
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(meshObj, false);
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (hits.length) {
        const triIdx = hits[0].face!.a / 3; // 非索引：角点/3 = 三角形
        live.current.onPick([analysisRef.current.tris[triIdx].face], additive);
      } else {
        live.current.onPick([], additive);
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    let raf = 0;
    const animate = () => { raf = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
    animate();

    stateRef.current = {
      renderer, scene, camera, controls, geom, meshObj, edgeLines, checkerTex,
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      geom.dispose();
      edgeGeom.dispose();
      mat.dispose();
      checkerTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // mesh 变化：重建非索引角点几何（绝不按位置焊接）
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    analysisRef.current = analysis;
    buildGeometry(s.geom, mesh, analysis);
    buildEdgeGeometry(s.edgeLines.geometry as THREE.BufferGeometry, mesh, analysis);

    const box = new THREE.Box3().setFromBufferAttribute(
      s.geom.getAttribute('position') as THREE.BufferAttribute);
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length() || 1;
      s.controls.target.copy(center);
      s.camera.position.copy(center).add(
        new THREE.Vector3(0.7, 0.55, 0.9).normalize().multiplyScalar(size * 1.6));
      s.camera.near = size / 100; s.camera.far = size * 100;
      s.camera.updateProjectionMatrix();
    }
  }, [mesh, analysis]);

  // 颜色/材质随叠加、选择、棋盘变化（不重建几何）
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;
    const mat = s.meshObj.material as THREE.MeshStandardMaterial;
    mat.map = checker ? s.checkerTex : null;
    mat.needsUpdate = true;
    paintFaces(s.geom, analysis, selection, overlay);
    s.edgeLines.visible = showEdges;
    paintEdges(s.edgeLines.geometry as THREE.BufferGeometry, analysis, selection);
  }, [selection, overlay, checker, showEdges, mesh, analysis]);

  return <div ref={mountRef} className="view3d" />;
}

/* ---------------- 非索引（角点）几何 ---------------- */

function buildGeometry(geom: THREE.BufferGeometry, mesh: Mesh, a: Analysis) {
  const triCount = a.tris.length;
  const pos = new Float32Array(triCount * 9);
  const uv = new Float32Array(triCount * 6);
  const color = new Float32Array(triCount * 9);
  a.tris.forEach((t, i) => {
    const c = mesh.faces[t.face].corners;
    [t.a, t.b, t.c].forEach((ci, j) => {
      const vi = c[ci].vertex;
      pos.set([mesh.positions[vi*3], mesh.positions[vi*3+1], mesh.positions[vi*3+2]], i*9+j*3);
      const ui = c[ci].uv;
      if (ui >= 0) uv.set([mesh.uvs[ui*2], mesh.uvs[ui*2+1]], i*6+j*2);
    });
  });
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geom.setAttribute('color', new THREE.BufferAttribute(color, 3));
  // 非索引几何：按三角形平均 → 平直法线，符合低模观感
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
}

function baseColor(t: Analysis['tris'][number], overlay: OverlayMode): THREE.Color {
  if (overlay === 'issues') {
    if (t.flags.has('degenerate3d')) return new THREE.Color(FLAG_COLOR.degenerate3d);
    if (t.flags.has('degenerateUv')) return new THREE.Color(FLAG_COLOR.degenerateUv);
    if (t.flags.has('flipped')) return new THREE.Color(FLAG_COLOR.flipped);
    if (t.flags.has('overlap')) return new THREE.Color(FLAG_COLOR.overlap);
    if (t.flags.has('badDensity')) return new THREE.Color(FLAG_COLOR.badDensity);
    return new THREE.Color(0x6f7d92);
  }
  if (overlay === 'area' && isFinite(t.densityRatio)) {
    const k = (Math.log2(t.densityRatio) + 1) / 2; // 0.5×~2×
    return new THREE.Color(...heatColor(k));
  }
  if (overlay === 'angle' && isFinite(t.angleDistortion)) {
    const k = Math.log2(t.angleDistortion) / 2;    // 1×~4×
    return new THREE.Color(...heatColor(k));
  }
  if (t.flags.has('degenerate3d')) return new THREE.Color(0x5b4670);
  if (t.flags.has('degenerateUv')) return new THREE.Color(0x54463f);
  return new THREE.Color(0x8fa0b8);
}

function paintFaces(
  geom: THREE.BufferGeometry, a: Analysis,
  selection: Set<number>, overlay: OverlayMode,
) {
  const color = geom.getAttribute('color') as THREE.BufferAttribute;
  a.tris.forEach((t, i) => {
    const c = new THREE.Color(baseColor(t, overlay));
    if (selection.has(t.face)) c.lerp(new THREE.Color(0x49d6ff), 0.55);
    for (let j = 0; j < 3; j++) color.setXYZ(i*3+j, c.r, c.g, c.b);
  });
  color.needsUpdate = true;
}

/* ---------------- 边叠加：接缝/非流形/边界 ---------------- */

function edgeColor(kind: string, selected: boolean): THREE.Color {
  if (selected) return new THREE.Color(0x49d6ff);
  switch (kind) {
    case 'nonmanifold': return new THREE.Color(0xb14aed);
    case 'seam': return new THREE.Color(0xffd23b);
    case 'hardseam': return new THREE.Color(0x4a6a8a);
    case 'boundary': return new THREE.Color(0x66ddaa);
    default: return new THREE.Color(0x2f3540);
  }
}

/** 只画非常规内部边；内部边位置仍占位以保证索引一致 */
function buildEdgeGeometry(edgeGeom: THREE.BufferGeometry, mesh: Mesh, a: Analysis) {
  const marked = [...a.edgeByKey.values()].filter(e => e.kind !== 'interior');
  const pos = new Float32Array(marked.length * 6);
  const color = new Float32Array(marked.length * 6);
  marked.forEach((e, i) => {
    pos.set([mesh.positions[e.va*3], mesh.positions[e.va*3+1], mesh.positions[e.va*3+2],
             mesh.positions[e.vb*3], mesh.positions[e.vb*3+1], mesh.positions[e.vb*3+2]], i*6);
  });
  edgeGeom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  edgeGeom.setAttribute('color', new THREE.BufferAttribute(color, 3));
}

function paintEdges(edgeGeom: THREE.BufferGeometry, a: Analysis, selection: Set<number>) {
  const marked = [...a.edgeByKey.values()].filter(e => e.kind !== 'interior');
  const color = edgeGeom.getAttribute('color') as THREE.BufferAttribute;
  marked.forEach((e, i) => {
    const selected = e.faces.some(f => selection.has(f));
    const col = edgeColor(e.kind, selected);
    color.setXYZ(i*2, col.r, col.g, col.b);
    color.setXYZ(i*2+1, col.r, col.g, col.b);
  });
  color.needsUpdate = true;
}
