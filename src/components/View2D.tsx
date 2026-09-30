import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useApp } from '../state/AppContext';
import {
  buildUvEdges,
  buildUvFills,
  buildUvSelection,
} from '../three/geometry';
import type { MeshData } from '../core/types';

export function View2D() {
  const { state, selectFaces, toggleFace } = useApp();
  const mountRef = useRef<HTMLDivElement>(null);

  const worldRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    controls: OrbitControls;
    fills: THREE.Mesh;
    edgeLayer: THREE.Group;
    selection: THREE.Mesh;
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2;
    meshData: MeshData | null;
    frame: number;
    downX: number;
    downY: number;
    zoomFit: () => void;
    lastFitMesh: MeshData | null;
  } | null>(null);

  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#17181e');

    const aspect = mount.clientWidth / mount.clientHeight;
    const view = 2.6;
    const camera = new THREE.OrthographicCamera(
      -view * aspect, view * aspect, view, -view, -10, 10,
    );
    camera.position.set(0.5, 0.5, 5);
    camera.lookAt(0.5, 0.5, 0);
    camera.zoom = 0.9;
    camera.updateProjectionMatrix();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false;
    controls.enableDamping = true;
    controls.target.set(0.5, 0.5, 0);
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    // 0..1 纹理范围框与刻度网格
    const grid = makeGrid(1, 10);
    scene.add(grid);

    const fillGeo = new THREE.BufferGeometry();
    const fills = new THREE.Mesh(
      fillGeo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.55,
      }),
    );
    scene.add(fills);

    const edgeLayer = new THREE.Group();
    scene.add(edgeLayer);
    const selection = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x42c7ff,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    selection.renderOrder = 3;
    scene.add(selection);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const zoomFit = () => {
      const bb = fills.geometry.boundingBox;
      if (!bb) return;
      if (!isFinite(bb.min.x)) return;
      const cx = (bb.min.x + bb.max.x) / 2;
      const cy = (bb.min.y + bb.max.y) / 2;
      const w = Math.max(bb.max.x - bb.min.x, 0.2);
      const h = Math.max(bb.max.y - bb.min.y, 0.2);
      const a = mount.clientWidth / mount.clientHeight;
      const z = Math.min((2 * view) / (w * 1.3), (2 * view * a) / (h * 1.3), 40);
      camera.zoom = Math.max(0.05, z);
      controls.target.set(cx, cy, 0);
      camera.position.set(cx, cy, 5);
      camera.updateProjectionMatrix();
      controls.update();
    };

    const world = {
      renderer, scene, camera, controls, fills, edgeLayer, selection,
      raycaster, pointer, meshData: null as MeshData | null,
      frame: 0, downX: 0, downY: 0, zoomFit, lastFitMesh: null as MeshData | null,
    };
    worldRef.current = world;

    // 暴露给双击自适应
    renderer.domElement.addEventListener('dblclick', zoomFit);

    const animate = () => {
      world.frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      const a = w / h;
      camera.left = -view * a;
      camera.right = view * a;
      camera.top = view;
      camera.bottom = -view;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(world.frame);
      ro.disconnect();
      renderer.domElement.removeEventListener('dblclick', zoomFit);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      worldRef.current = null;
    };
  }, []);

  const { mesh: meshData, stats } = state;

  // 重建填充与分类边
  useEffect(() => {
    const world = worldRef.current;
    if (!world || !meshData || !stats) return;
    world.meshData = meshData;

    const fg = buildUvFills(meshData, stats, {
      showFlipped: state.showFlipped,
      showOverlap: state.showOverlap,
    });
    world.fills.geometry.dispose();
    world.fills.geometry = fg;

    // 重建边层
    const layer = world.edgeLayer;
    layer.children.forEach((c) => {
      (c as THREE.LineSegments).geometry?.dispose();
    });
    layer.clear();
    const edges = buildUvEdges(meshData, stats);
    const addEdges = (geo: THREE.BufferGeometry, color: number, opacity: number, order: number) => {
      const line = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({
          color,
          transparent: opacity < 1,
          opacity,
          depthTest: false,
        }),
      );
      line.renderOrder = order;
      layer.add(line);
    };
    addEdges(edges.regular, 0x2e3140, 0.55, 1);
    addEdges(edges.boundary, 0xdfe3ee, 0.9, 2);
    addEdges(edges.seam, 0xffb02e, 1.0, 2);
    addEdges(edges.nonManifold, 0xff3b5c, 1.0, 3);

    // 换模型（而非仅切换标记）时自动取景到 UV 包围盒
    if (world.lastFitMesh !== meshData) {
      world.lastFitMesh = meshData;
      world.zoomFit();
    }
  }, [meshData, stats, state.showFlipped, state.showOverlap]);

  // 选择高亮
  useEffect(() => {
    const world = worldRef.current;
    if (!world || !meshData) return;
    world.selection.geometry.dispose();
    world.selection.geometry = buildUvSelection(meshData, state.selectedFaceIds);
  }, [state.selectedFaceIds, meshData]);

  // 拾取（平移与点选区分）
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
      const hits = world.raycaster.intersectObject(world.fills, false);
      if (hits.length === 0) {
        selectFaces(new Set());
        return;
      }
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

  return (
    <div className="view view2d" ref={mountRef}>
      <div className="view-label">
        2D UV — V 向上（OBJ 原生方向）· 双击自适应 · 拖动平移/滚轮缩放
      </div>
    </div>
  );
}

function makeGrid(size: number, divs: number): THREE.Group {
  const g = new THREE.Group();
  const minorPos: number[] = [];
  for (let i = 0; i <= divs; i++) {
    const t = (i / divs) * size;
    minorPos.push(0, t, 0, size, t, 0);
    minorPos.push(t, 0, 0, t, size, 0);
  }
  const minor = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute(minorPos, 3),
    ),
    new THREE.LineBasicMaterial({ color: 0x2a2c36, transparent: true, opacity: 0.7 }),
  );
  const border = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.Float32BufferAttribute([
        0, 0, 0, size, 0, 0,
        size, 0, 0, size, size, 0,
        size, size, 0, 0, size, 0,
        0, size, 0, 0, 0, 0,
      ], 3),
    ),
    new THREE.LineBasicMaterial({ color: 0x566080 }),
  );
  g.add(minor, border);
  return g;
}
