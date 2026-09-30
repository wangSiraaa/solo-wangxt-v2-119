import * as THREE from 'three';
import type { MeshData, MeshStats } from '../core/types';
import { cornerPos, cornerUv } from '../core/parser';

/**
 * 所有渲染几何都按角点展开（非索引）：接缝两侧即使共享同一个 v 身份，
 * 也各自作为独立顶点存在 —— 这与“不能按空间位置合并顶点”一致。
 */
export function buildNonIndexedPositions(mesh: MeshData): Float32Array {
  const out = new Float32Array(mesh.triangles.length * 9);
  let o = 0;
  for (const t of mesh.triangles) {
    for (const ci of t.corners) {
      const p = cornerPos(mesh, ci);
      out[o++] = p.x;
      out[o++] = p.y;
      out[o++] = p.z;
    }
  }
  return out;
}

export function buildUvAttribute(mesh: MeshData, checkerScale: number): Float32Array {
  const out = new Float32Array(mesh.triangles.length * 6);
  let o = 0;
  for (const t of mesh.triangles) {
    for (const ci of t.corners) {
      const [u, v] = cornerUv(mesh, ci);
      out[o++] = u * checkerScale;
      out[o++] = v * checkerScale;
    }
  }
  return out;
}

/** 三角形 id 顶点色属性：默认白，异常类型着色（由着色器决定使用与否）。 */
export function buildFlagColors(
  mesh: MeshData,
  stats: MeshStats,
  showFlipped: boolean,
  showOverlap: boolean,
): Float32Array {
  const out = new Float32Array(mesh.triangles.length * 9).fill(1);
  for (const t of mesh.triangles) {
    const m = stats.metrics[t.id];
    let color: [number, number, number] | null = null;
    if (m.degenerate3d || m.degenerateUv) color = [0.35, 0.35, 0.4];
    else if (showOverlap && stats.overlap[t.id]) color = [1.0, 0.55, 0.05];
    else if (showFlipped && m.flipped) color = [1.0, 0.25, 0.35];
    if (color) {
      for (let k = 0; k < 3; k++) {
        out[t.id * 9 + k * 3] = color[0];
        out[t.id * 9 + k * 3 + 1] = color[1];
        out[t.id * 9 + k * 3 + 2] = color[2];
      }
    }
  }
  return out;
}

/** 给定选中面集合，构造用于叠加高亮的非索引几何（三角形 id 顺序不变）。 */
export function buildSelectionOverlay(
  mesh: MeshData,
  selectedFaceIds: Set<number>,
  sourcePositions: Float32Array,
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [];
  for (const t of mesh.triangles) {
    if (!selectedFaceIds.has(t.faceId)) continue;
    for (let k = 0; k < 3; k++) {
      pos.push(
        sourcePositions[t.id * 9 + k * 3],
        sourcePositions[t.id * 9 + k * 3 + 1],
        sourcePositions[t.id * 9 + k * 3 + 2],
      );
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

export interface UvEdgeBuffers {
  boundary: THREE.BufferGeometry;
  seam: THREE.BufferGeometry;
  nonManifold: THREE.BufferGeometry;
  regular: THREE.BufferGeometry;
}

/** UV 空间线框，按 3D 拓扑分类（分类永远用顶点身份，不用坐标）。 */
export function buildUvEdges(mesh: MeshData, stats: MeshStats): UvEdgeBuffers {
  const buckets: Record<keyof UvEdgeBuffers, number[]> = {
    boundary: [],
    seam: [],
    nonManifold: [],
    regular: [],
  };

  // 每条边的每个出现都画一段 UV 线段：接缝处因此自然出现双线
  for (const e of stats.edges) {
    for (const { ca, cb } of e.occurrences) {
      const [u0, v0] = cornerUv(mesh, ca);
      const [u1, v1] = cornerUv(mesh, cb);
      let kind: keyof UvEdgeBuffers;
      if (e.nonManifold) kind = 'nonManifold';
      else if (e.boundary) kind = 'boundary';
      else if (e.seam) kind = 'seam';
      else kind = 'regular';
      buckets[kind].push(u0, v0, 0, u1, v1, 0);
    }
  }

  const mk = (arr: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    return g;
  };
  return {
    boundary: mk(buckets.boundary),
    seam: mk(buckets.seam),
    nonManifold: mk(buckets.nonManifold),
    regular: mk(buckets.regular),
  };
}

export function buildUvSelection(
  mesh: MeshData,
  selectedFaceIds: Set<number>,
): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const t of mesh.triangles) {
    if (!selectedFaceIds.has(t.faceId)) continue;
    for (let k = 0; k < 3; k++) {
      const [u, v] = cornerUv(mesh, t.corners[k]);
      pos.push(u, v, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** UV 三角形填充（用于 2D 视图拾取与岛底色），带按岛/状态的顶点色。 */
export function buildUvFills(
  mesh: MeshData,
  stats: MeshStats,
  opts: { showFlipped: boolean; showOverlap: boolean },
): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const islandOfTri = new Int32Array(mesh.triangles.length).fill(-1);
  stats.islands.forEach((isl) => {
    for (const t of isl.triIds) islandOfTri[t] = isl.id;
  });

  for (const t of mesh.triangles) {
    const m = stats.metrics[t.id];
    let rgb: [number, number, number];
    if (m.degenerate3d || m.degenerateUv) rgb = [0.32, 0.32, 0.38];
    else if (opts.showOverlap && stats.overlap[t.id]) rgb = [1.0, 0.55, 0.1];
    else if (opts.showFlipped && m.flipped) rgb = [1.0, 0.35, 0.45];
    else rgb = islandColor(islandOfTri[t.id]);

    for (let k = 0; k < 3; k++) {
      const [u, v] = cornerUv(mesh, t.corners[k]);
      pos.push(u, v, 0);
      col.push(rgb[0], rgb[1], rgb[2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingBox();
  return g;
}

function islandColor(id: number): [number, number, number] {
  // 稳定的浅色调色板（HSL 均匀分布）
  const h = (id * 0.61803398875) % 1;
  const c = new THREE.Color().setHSL(h, 0.45, 0.72);
  return [c.r, c.g, c.b];
}

/** 程序化棋盘纹理，在 0..1 UV 空间内重复 divisions 次。 */
export function makeCheckerTexture(divisions: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cell = size / divisions;
  for (let y = 0; y < divisions; y++) {
    for (let x = 0; x < divisions; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#e8e8ee' : '#5a5f72';
      ctx.fillRect(x * cell, y * cell, Math.ceil(cell), Math.ceil(cell));
    }
  }
  ctx.strokeStyle = '#3a3d49';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
