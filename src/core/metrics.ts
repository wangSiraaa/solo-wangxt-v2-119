import { cornerPos, cornerUv } from './parser';
import type {
  EdgeInfo,
  IslandInfo,
  MeshData,
  MeshStats,
  TriMetrics,
  Vec3,
} from './types';

const EPS = 1e-10;

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function len(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function analyzeMesh(mesh: MeshData): MeshStats {
  const n = mesh.triangles.length;
  const metrics: TriMetrics[] = new Array(n);

  let min: Vec3 = { x: Infinity, y: Infinity, z: Infinity };
  let max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const p = { x: mesh.positions[i], y: mesh.positions[i + 1], z: mesh.positions[i + 2] };
    min = { x: Math.min(min.x, p.x), y: Math.min(min.y, p.y), z: Math.min(min.z, p.z) };
    max = { x: Math.max(max.x, p.x), y: Math.max(max.y, p.y), z: Math.max(max.z, p.z) };
  }
  const diag = Math.max(len(sub(max, min)), EPS);

  // UV 包围盒对角线，用于相对退化阈值（UV 可在任意尺度/平移下）。
  let uMin = Infinity, vMin = Infinity, uMax = -Infinity, vMax = -Infinity;
  for (let i = 0; i < mesh.uvs.length; i += 2) {
    uMin = Math.min(uMin, mesh.uvs[i]);
    uMax = Math.max(uMax, mesh.uvs[i]);
    vMin = Math.min(vMin, mesh.uvs[i + 1]);
    vMax = Math.max(vMax, mesh.uvs[i + 1]);
  }
  const uvDiag = Math.max(Math.hypot(uMax - uMin, vMax - vMin), EPS);

  const rawRatios: number[] = [];

  for (const t of mesh.triangles) {
    const [c0, c1, c2] = t.corners;
    const p0 = cornerPos(mesh, c0);
    const p1 = cornerPos(mesh, c1);
    const p2 = cornerPos(mesh, c2);
    const [u0, v0] = cornerUv(mesh, c0);
    const [u1, v1] = cornerUv(mesh, c1);
    const [u2, v2] = cornerUv(mesh, c2);

    const e1 = sub(p1, p0);
    const e2 = sub(p2, p0);
    const n3 = cross(e1, e2);
    const area3d = len(n3) / 2;
    const signedUv = ((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) / 2;
    const areaUv = Math.abs(signedUv);

    // 退化用“最短高 / 最长边”形状判据（相对量，尺度无关）：
    // 共线三点或两个角点重合时该比值趋零。1x0.02 的薄片不退化。
    const degenerate3d = triangleSliver(p0, p1, p2, diag) < 1e-7;
    const degenerateUv = triangleSliver2(u0, v0, u1, v1, u2, v2, uvDiag) < 1e-7;

    // 翻转：以该三角形自身的平面规范基表达，3D 绕序恒为正；
    // UV 有向面积为负即表示 3D→UV 映射反向（镜像）。
    // 退化三角形无法定义方向，不参与翻转统计。
    const flipped = !degenerate3d && !degenerateUv && signedUv < 0;

    if (!degenerate3d && !degenerateUv) {
      rawRatios.push(area3d / areaUv);
    }

    let angleDistortion: number | null = null;
    if (!degenerate3d && !degenerateUv) {
      const a3 = triAngles3(p0, p1, p2);
      const a2 = triAngles2(u0, v0, u1, v1, u2, v2);
      let worst = 0;
      for (let k = 0; k < 3; k++) {
        worst = Math.max(worst, Math.abs(a3[k] - a2[k]));
      }
      angleDistortion = (worst * 180) / Math.PI;
    }

    metrics[t.id] = {
      area3d,
      areaUv,
      signed3d: 1, // 规范基下恒正，保留字段供调试
      signedUv,
      degenerate3d,
      degenerateUv,
      flipped,
      areaRatio: null,
      angleDistortion,
    };
  }

  // 全局纹素尺度归一：中位数，避免个别极端三角形拉偏基准。
  const globalScale = median(rawRatios) || 1;
  for (const m of metrics) {
    if (!m.degenerate3d && !m.degenerateUv) {
      m.areaRatio = Math.sqrt((m.area3d / m.areaUv) / globalScale);
    }
  }

  const edges = buildEdges(mesh, diag);
  const islands = buildIslands(mesh, metrics, diag);
  const overlap = detectOverlap(mesh, islands, metrics);
  for (const isl of islands) {
    let c = 0;
    for (const t of isl.triIds) if (overlap[t]) c++;
    isl.overlapTriCount = c;
  }

  return {
    metrics,
    edges,
    islands,
    overlap,
    globalScale: Math.sqrt(globalScale),
    bounds3d: { min, max },
  };
}

/**
 * 薄片指标：三角形最短高 / 最长边（0 = 退化共线，~1 = 等边）。
 * 尺度无关，避免“很小但形状正常”的三角形被误判。
 */
function sliverFromEdges(area: number, edges: number[]): number {
  const longest = Math.max(...edges);
  if (longest === 0) return 0;
  return (2 * area) / (longest * longest);
}
function triangleSliver(a: Vec3, b: Vec3, c: Vec3, diag: number): number {
  const area = len(cross(sub(b, a), sub(c, a))) / 2;
  const edges = [len(sub(a, b)), len(sub(b, c)), len(sub(c, a))];
  // 两点重合（绝对塌缩，例如坐标完全相同的独立 v）也要算退化
  if (Math.min(...edges) <= 1e-9 * diag) return 0;
  return sliverFromEdges(area, edges);
}
function triangleSliver2(
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number,
  diag: number,
): number {
  const area = Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) / 2;
  const edges = [
    Math.hypot(x1 - x0, y1 - y0),
    Math.hypot(x2 - x1, y2 - y1),
    Math.hypot(x0 - x2, y0 - y2),
  ];
  if (Math.min(...edges) <= 1e-9 * diag) return 0;
  return sliverFromEdges(area, edges);
}

function median(xs: number[]): number {  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function triAngles3(a: Vec3, b: Vec3, c: Vec3): [number, number, number] {
  return [
    angleAt(a, b, c),
    angleAt(b, a, c),
    angleAt(c, a, b),
  ];
}
function angleAt(apex: Vec3, x: Vec3, y: Vec3): number {
  const u = sub(x, apex);
  const v = sub(y, apex);
  const d = dot(u, v) / (len(u) * len(v));
  return Math.acos(Math.min(1, Math.max(-1, d)));
}
function triAngles2(
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number,
): [number, number, number] {
  const a = (x: number, y: number, ux: number, uy: number, vx: number, vy: number) => {
    const d = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
    return Math.acos(Math.min(1, Math.max(-1, d)) + 0 * x + 0 * y);
  };
  return [
    a(x0, y0, x1 - x0, y1 - y0, x2 - x0, y2 - y0),
    a(x1, y1, x0 - x1, y0 - y1, x2 - x1, y2 - y1),
    a(x2, y2, x0 - x2, y0 - y2, x1 - x2, y1 - y2),
  ];
}

/**
 * 边配对按“空间位置”而不是顶点 id —— 因为 OBJ 子集允许接缝两侧是
 * 坐标相同的独立 v 行（这是稳定身份的体现，不能把它们合并）。
 * 配对只用于拓扑统计；接缝判定优先比较顶点身份与 UV。
 */
function buildEdges(mesh: MeshData, diag: number): EdgeInfo[] {
  const tol = 1e-7 * diag;
  const tolSq = tol * tol;

  // 顶点身份 -> 空间等价类（只构建一次近邻并查集）
  const eq = spatialEquivalence(mesh, tolSq);

  interface LocalOcc {
    tri: number;
    ca: number;
    cb: number;
    va: number;
    vb: number;
  }
  const map = new Map<string, LocalOcc[]>();
  for (const t of mesh.triangles) {
    const pairs: Array<[number, number]> = [
      [t.corners[0], t.corners[1]],
      [t.corners[1], t.corners[2]],
      [t.corners[2], t.corners[0]],
    ];
    for (const [ci, cj] of pairs) {
      const va = mesh.corners[ci].v;
      const vb = mesh.corners[cj].v;
      const ea = eq[va];
      const eb = eq[vb];
      const a = Math.min(ea, eb);
      const b = Math.max(ea, eb);
      const key = `${a}_${b}`;
      let occ = map.get(key);
      if (!occ) {
        occ = [];
        map.set(key, occ);
      }
      occ.push(
        ea === a
          ? { tri: t.id, ca: ci, cb: cj, va, vb }
          : { tri: t.id, ca: cj, cb: ci, va: vb, vb: va },
      );
    }
  }

  const out: EdgeInfo[] = [];
  for (const [key, occ] of map) {
    const [sa, sb] = key.split('_').map(Number);
    const boundary = occ.length === 1;
    const nonManifold = occ.length >= 3;
    let seam = false;
    if (occ.length === 2) {
      // 1) 顶点身份不同（重复 v 副本）=> 作者已显式切开，是接缝。
      const idSplit =
        occ[0].va !== occ[1].va || occ[0].vb !== occ[1].vb;
      // 2) 即便身份相同，UV 身份/坐标不同也是接缝。
      const uvSplit =
        uvDiffers(mesh, occ[0].ca, occ[1].ca) ||
        uvDiffers(mesh, occ[0].cb, occ[1].cb);
      seam = idSplit || uvSplit;
    }
    out.push({
      key,
      a: sa,
      b: sb,
      occurrences: occ.map((o) => ({ tri: o.tri, ca: o.ca, cb: o.cb })),
      boundary,
      nonManifold,
      seam,
    });
  }
  return out;
}

/**
 * 给每个顶点身份分配一个空间等价类 id。
 * 小规模低模直接 O(n²)；用精确坐标先分组再对残差做点距比较。
 */
function spatialEquivalence(mesh: MeshData, tolSq: number): Int32Array {
  const n = mesh.vertexCount;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const nx = parent[x];
      parent[x] = r;
      x = nx;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = mesh.positions[i * 3] - mesh.positions[j * 3];
      const dy = mesh.positions[i * 3 + 1] - mesh.positions[j * 3 + 1];
      const dz = mesh.positions[i * 3 + 2] - mesh.positions[j * 3 + 2];
      if (dx * dx + dy * dy + dz * dz <= tolSq) union(i, j);
    }
  }
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = find(i);
  return out;
}

function uvDiffers(mesh: MeshData, ci: number, cj: number): boolean {
  const a = mesh.corners[ci];
  const b = mesh.corners[cj];
  if (a.vt >= 0 && b.vt >= 0 && a.vt === b.vt) return false;
  const [au, av] = cornerUv(mesh, ci);
  const [bu, bv] = cornerUv(mesh, cj);
  return Math.hypot(au - bu, av - bv) > 1e-6;
}

/**
 * UV 岛：三角形之间必须【同时】满足
 *   - 3D 上共享边（空间近邻，允许重复 v 副本）；
 *   - 该共享边两端 UV 一致（vt 身份相同或坐标相同）。
 * 仅 UV 坐标重合（镜像重叠、叠放的不同岛）不会因此并岛。
 */
function buildIslands(
  mesh: MeshData,
  metrics: TriMetrics[],
  diag: number,
): IslandInfo[] {
  const uvCoordKeyOf = (ci: number): string => {
    const [u, v] = cornerUv(mesh, ci);
    return `p${u.toFixed(6)}_${v.toFixed(6)}`;
  };

  const parent = new Int32Array(mesh.triangles.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const nx = parent[x];
      parent[x] = r;
      x = nx;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  const tol = 1e-7 * diag;
  const tolSq = tol * tol;
  const samePos = (ci: number, cj: number): boolean => {
    const a = mesh.corners[ci].v;
    const b = mesh.corners[cj].v;
    if (a === b) return true;
    const dx = mesh.positions[a * 3] - mesh.positions[b * 3];
    const dy = mesh.positions[a * 3 + 1] - mesh.positions[b * 3 + 1];
    const dz = mesh.positions[a * 3 + 2] - mesh.positions[b * 3 + 2];
    return dx * dx + dy * dy + dz * dz <= tolSq;
  };

  // 收集按空间近邻归一化后的 3D 边出现
  const edgeMap = new Map<string, Array<{ tri: number; ca: number; cb: number }>>();
  for (const t of mesh.triangles) {
    const pairs: Array<[number, number]> = [
      [t.corners[0], t.corners[1]],
      [t.corners[1], t.corners[2]],
      [t.corners[2], t.corners[0]],
    ];
    for (const [ci, cj] of pairs) {
      const p0 = cornerPos(mesh, ci);
      const p1 = cornerPos(mesh, cj);
      const key = [q(p0, tol), q(p1, tol)].sort().join('|');
      const list = edgeMap.get(key);
      if (list) list.push({ tri: t.id, ca: ci, cb: cj });
      else edgeMap.set(key, [{ tri: t.id, ca: ci, cb: cj }]);
    }
  }

  for (const occ of edgeMap.values()) {
    for (let i = 0; i < occ.length; i++) {
      for (let j = i + 1; j < occ.length; j++) {
        const A = occ[i];
        const B = occ[j];
        // 对齐端点方向
        const direct = samePos(A.ca, B.ca) && samePos(A.cb, B.cb);
        const swapped = samePos(A.ca, B.cb) && samePos(A.cb, B.ca);
        if (!direct && !swapped) continue;
        const uvMatch = (x: number, y: number) => {
          const cx = mesh.corners[x];
          const cy = mesh.corners[y];
          if (cx.vt >= 0 && cy.vt >= 0 && cx.vt === cy.vt) return true;
          return uvCoordKeyOf(x) === uvCoordKeyOf(y);
        };
        const matched = direct
          ? uvMatch(A.ca, B.ca) && uvMatch(A.cb, B.cb)
          : uvMatch(A.ca, B.cb) && uvMatch(A.cb, B.ca);
        if (matched) union(A.tri, B.tri);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (const t of mesh.triangles) {
    const root = find(t.id);
    const list = groups.get(root);
    if (list) list.push(t.id);
    else groups.set(root, [t.id]);
  }

  const islands: IslandInfo[] = [];
  let id = 0;
  for (const [, triIds] of groups) {
    let flipped = 0;
    for (const tid of triIds) {
      const m = metrics[tid];
      if (!m.degenerate3d && !m.degenerateUv && m.flipped) flipped++;
    }
    // 岛内只要有三角形翻转即判为镜像岛：展开结果中一片反向 UV 对整
    // 张贴图就是镜像；多数决会漏掉“一正一反”两张面的折纸情形。
    islands.push({ id: id++, triIds, mirrored: flipped > 0, overlapTriCount: 0 });
  }
  return islands;
}

function q(p: Vec3, tol: number): string {
  const f = (x: number) => Math.round(x / tol).toString();
  return `${f(p.x)},${f(p.y)},${f(p.z)}`;
}

/**
 * 岛间 2D 重叠检测：包围盒分桶 + Sutherland–Hodgman 求交面积。
 * 仅边界接触（交叠面积≈0）不算重叠。
 */
function detectOverlap(
  mesh: MeshData,
  islands: IslandInfo[],
  metrics: TriMetrics[],
): Uint8Array {
  const n = mesh.triangles.length;
  const flags = new Uint8Array(n);

  interface Tri2 {
    id: number;
    island: number;
    u: [number, number, number];
    v: [number, number, number];
    minU: number; minV: number; maxU: number; maxV: number;
  }
  const tri2: Tri2[] = [];
  let gMinU = Infinity, gMinV = Infinity, gMaxU = -Infinity, gMaxV = -Infinity;
  for (const isl of islands) {
    for (const tid of isl.triIds) {
      const m = metrics[tid];
      if (m.degenerate3d || m.degenerateUv) continue;
      const t = mesh.triangles[tid];
      const us = [0, 1, 2].map((k) => cornerUv(mesh, t.corners[k]));
      const u: [number, number, number] = [us[0][0], us[1][0], us[2][0]];
      const v: [number, number, number] = [us[0][1], us[1][1], us[2][1]];
      const minU = Math.min(...u), maxU = Math.max(...u);
      const minV = Math.min(...v), maxV = Math.max(...v);
      gMinU = Math.min(gMinU, minU); gMaxU = Math.max(gMaxU, maxU);
      gMinV = Math.min(gMinV, minV); gMaxV = Math.max(gMaxV, maxV);
      tri2.push({ id: tid, island: isl.id, u, v, minU, minV, maxU, maxV });
    }
  }

  // 均匀网格分桶（32 格），候选对大幅减少
  const N = 32;
  const w = Math.max(gMaxU - gMinU, EPS);
  const h = Math.max(gMaxV - gMinV, EPS);
  const buckets: Tri2[][] = Array.from({ length: N * N }, () => []);
  for (const tr of tri2) {
    const x0 = Math.min(N - 1, Math.max(0, Math.floor(((tr.minU - gMinU) / w) * N)));
    const x1 = Math.min(N - 1, Math.max(0, Math.floor(((tr.maxU - gMinU) / w) * N)));
    const y0 = Math.min(N - 1, Math.max(0, Math.floor(((tr.minV - gMinV) / h) * N)));
    const y1 = Math.min(N - 1, Math.max(0, Math.floor(((tr.maxV - gMinV) / h) * N)));
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) buckets[y * N + x].push(tr);
    }
  }

  const tested = new Set<number>();
  for (const bucket of buckets) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const A = bucket[i];
        const B = bucket[j];
        if (A.island === B.island) continue;
        const pairKey = A.id < B.id ? A.id * n + B.id : B.id * n + A.id;
        if (tested.has(pairKey)) continue;
        tested.add(pairKey);
        if (
          A.maxU < B.minU || B.maxU < A.minU ||
          A.maxV < B.minV || B.maxV < A.minV
        ) {
          continue;
        }
        const area = triIntersectionArea(A, B);
        if (area > 1e-9) {
          flags[A.id] = 1;
          flags[B.id] = 1;
        }
      }
    }
  }
  return flags;
}

type Pt = [number, number];

function clipPolyByTri(poly: Pt[], tri: { u: number[]; v: number[] }): Pt[] {
  // 规范化裁剪三角形为逆时针，使“内侧”恒为边的左侧（叉积 >= 0）。
  const signed =
    (tri.u[1] - tri.u[0]) * (tri.v[2] - tri.v[0]) -
    (tri.u[2] - tri.u[0]) * (tri.v[1] - tri.v[0]);
  const order = signed >= 0 ? [0, 1, 2] : [0, 2, 1];
  let out = poly;
  for (let k = 0; k < 3; k++) {
    const e0 = order[k];
    const e1 = order[(k + 1) % 3];
    const a: Pt = [tri.u[e0], tri.v[e0]];
    const b: Pt = [tri.u[e1], tri.v[e1]];
    const next: Pt[] = [];
    const inside = (p: Pt) =>
      (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    for (let i = 0; i < out.length; i++) {
      const cur = out[i];
      const prev = out[(i + out.length - 1) % out.length];
      const inCur = inside(cur);
      const inPrev = inside(prev);
      if (inCur) {
        if (!inPrev) next.push(lineIntersect(prev, cur, a, b));
        next.push(cur);
      } else if (inPrev) {
        next.push(lineIntersect(prev, cur, a, b));
      }
    }
    out = next;
    if (out.length === 0) break;
  }
  return out;
}

function lineIntersect(p: Pt, q: Pt, a: Pt, b: Pt): Pt {
  const r: Pt = [q[0] - p[0], q[1] - p[1]];
  const s: Pt = [b[0] - a[0], b[1] - a[1]];
  const t =
    ((a[0] - p[0]) * s[1] - (a[1] - p[1]) * s[0]) /
    (r[0] * s[1] - r[1] * s[0]);
  return [p[0] + t * r[0], p[1] + t * r[1]];
}

function polyArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

function triIntersectionArea(
  A: { u: number[]; v: number[] },
  B: { u: number[]; v: number[] },
): number {
  const polyA: Pt[] = [
    [A.u[0], A.v[0]],
    [A.u[1], A.v[1]],
    [A.u[2], A.v[2]],
  ];
  return polyArea(clipPolyByTri(polyA, B));
}
