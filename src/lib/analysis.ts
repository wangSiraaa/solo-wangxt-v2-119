import type { Mesh } from '../types';

/**
 * 网格几何分析：所有计算只依赖 Mesh 的稳定身份，不做任何空间焊接。
 * 退化面（3D 退化 或 UV 退化）单独标记，不参与普通比率统计。
 */

export interface TriInfo {
  face: number;     // 所属稳定面 ID
  triIndex: number; // 面内三角序（扇面）
  a: number; b: number; c: number; // corners 下标
}

export type TriFlag =
  | 'degenerate3d'   // 3D 退化：共点/共线
  | 'degenerateUv'   // UV 退化：三点重合/共线
  | 'flipped'        // UV 取向与 3D 面绕序相反（镜像）
  | 'overlap'        // 与其它三角形在 UV 空间面积重叠
  | 'badDensity';    // 密度为 0 / 非有限

export interface TriAnalysis extends TriInfo {
  uvArea2: number;        // UV 有符号面积 ×2（负=翻转）
  area3d: number;         // 3D 面积（恒正）
  angleDistortion: number; // σmax/σmin，1=完美；退化 NaN
  densityRatio: number;   // d/median(d)；退化 NaN
  density: number;        // sqrt(|uvArea|/area3d)
  flags: Set<TriFlag>;
  island: number;         // UV 岛 ID，-1 = 无法归属
  overlaps: number[];
}

export type EdgeKind =
  | 'interior'   // 恰好两面共边且 UV 连续
  | 'boundary'   // 仅一面
  | 'seam'       // 两面共边、UV 不连续，且两面在 3D 中近似共面（平面接缝=问题）
  | 'hardseam'   // UV 不连续但位于明显硬折边上（盒展开的正常接缝）
  | 'nonmanifold'; // >=3 面共边

export interface EdgeInfo {
  va: number; vb: number; // 排序后的顶点身份
  faces: number[];
  kind: EdgeKind;
  /** 两侧面法线夹角（度），仅两面时有意义 */
  dihedral: number;
}

export interface Analysis {
  tris: TriAnalysis[];
  edges: EdgeInfo[];
  edgeByKey: Map<string, EdgeInfo>;
  islands: number[][];
  medianDensity: number;
}

const EPS3 = 1e-12;
const EPSUV = 1e-10;

/** 扇面三角化，保留稳定 (face, triIndex) 身份 */
export function triangulate(mesh: Mesh): TriInfo[] {
  const out: TriInfo[] = [];
  for (let f = 0; f < mesh.faces.length; f++) {
    const c = mesh.faces[f].corners;
    for (let k = 0; k + 2 < c.length; k++) {
      out.push({ face: f, triIndex: k, a: 0, b: k + 1, c: k + 2 });
    }
  }
  return out;
}

function v3(i: number, m: Mesh) {
  return [m.positions[i*3], m.positions[i*3+1], m.positions[i*3+2]];
}
function sub(a: number[], b: number[]) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function dot(a: number[], b: number[]) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function cross(a: number[], b: number[]) {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function norm(a: number[]) { return Math.hypot(a[0], a[1], a[2]); }
function scale(a: number[], s: number) { return [a[0]*s, a[1]*s, a[2]*s]; }

/**
 * 主分析入口。
 */
export function analyze(mesh: Mesh): Analysis {
  const infos = triangulate(mesh);
  const tris: TriAnalysis[] = infos.map((t) => {
    const cn = mesh.faces[t.face].corners;
    const [ia, ib, ic] = [cn[t.a].vertex, cn[t.b].vertex, cn[t.c].vertex];
    const [ua, ub, uc] = [cn[t.a].uv, cn[t.b].uv, cn[t.c].uv];

    const A = v3(ia, mesh), B = v3(ib, mesh), C = v3(ic, mesh);
    const ab = sub(B, A), ac = sub(C, A);
    const n = cross(ab, ac);
    const nlen = norm(n);
    const area3d = nlen / 2;

    const hasUv = ua >= 0 && ub >= 0 && uc >= 0;
    const uvA = hasUv ? [mesh.uvs[ua*2], mesh.uvs[ua*2+1]] : [0, 0];
    const uvB = hasUv ? [mesh.uvs[ub*2], mesh.uvs[ub*2+1]] : [0, 0];
    const uvC = hasUv ? [mesh.uvs[uc*2], mesh.uvs[uc*2+1]] : [0, 0];
    // 有符号面积 ×2：>0 表示 UV 绕序与 (A,B,C) 在 UV 平面一致
    const uvArea2 = hasUv
      ? (uvB[0]-uvA[0])*(uvC[1]-uvA[1]) - (uvB[1]-uvA[1])*(uvC[0]-uvA[0])
      : 0;
    const uvArea = Math.abs(uvArea2) / 2;

    const flags = new Set<TriFlag>();
    let angleDistortion = NaN;
    let density = NaN;

    if (nlen <= EPS3 || area3d <= EPS3) flags.add('degenerate3d');
    if (!hasUv || uvArea <= EPSUV) flags.add('degenerateUv');

    if (!flags.has('degenerate3d') && !flags.has('degenerateUv')) {
      // 3D 面内正交基：e1∥ab，e2 = n̂×e1（与 ab,ac 同向取向）
      const lab = norm(ab);
      const e1 = scale(ab, 1 / lab);
      const e2 = cross(scale(n, 1 / nlen), e1);
      // 3D 点 B、C 在 (e1,e2) 中的坐标
      const pbx = lab, pby = 0;
      const pcx = dot(ac, e1), pcy = dot(ac, e2);
      // UV 相对坐标
      const qbx = uvB[0]-uvA[0], qby = uvB[1]-uvA[1];
      const qcx = uvC[0]-uvA[0], qcy = uvC[1]-uvA[1];
      // P = J Q  →  J = P Q^-1（UV→3D 的 Jacobian）
      const detQ = qbx*qcy - qby*qcx; // = uvArea2
      if (Math.abs(detQ) > EPSUV && lab > 0) {
        const inv = 1 / detQ;
        const j11 = (pbx*qcy - pcx*qby) * inv;
        const j12 = (pcx*qbx - pbx*qcx) * inv;
        const j21 = (pby*qcy - pcy*qby) * inv;
        const j22 = (pcy*qbx - pby*qcx) * inv;
        // J^T J 的迹与行列式 → 奇异值
        const tr = j11*j11+j12*j12+j21*j21+j22*j22;
        const det = j11*j22-j12*j21;
        const disc = Math.max(tr*tr - 4*det*det, 0);
        const sMax2 = (tr + Math.sqrt(disc)) / 2;
        const sMin2 = (tr - Math.sqrt(disc)) / 2;
        if (sMin2 > 1e-20 && isFinite(tr) && isFinite(det)) {
          angleDistortion = Math.sqrt(sMax2 / sMin2);
          density = Math.sqrt(uvArea / area3d);
        } else {
          flags.add('degenerateUv');
        }
      } else {
        flags.add('degenerateUv');
      }
      if (uvArea2 < 0) flags.add('flipped');
    }

    if (!isFinite(density) || density <= 0) {
      if (!flags.has('degenerate3d') && !flags.has('degenerateUv')) flags.add('badDensity');
    }

    return {
      ...t, uvArea2, area3d, angleDistortion, density,
      densityRatio: NaN, flags, island: -1, overlaps: [],
    };
  });

  // 密度中位（仅非退化面参与普通比率计算）
  const validD = tris.filter(t => isFinite(t.density) && t.density > 0)
                     .map(t => t.density).sort((x, y) => x - y);
  const medianDensity = validD.length
    ? validD[Math.floor(validD.length / 2)] : 1;
  for (const t of tris) {
    if (isFinite(t.density) && t.density > 0) t.densityRatio = t.density / medianDensity;
  }

  const islands = buildIslands(mesh, tris);
  detectOverlaps(mesh, tris);
  const edgeByKey = buildEdges(mesh);

  return { tris, edges: [...edgeByKey.values()], edgeByKey, islands, medianDensity };
}

/* ---------- UV 岛：按 UV 身份（uv 下标）并查集 ---------- */

class DSU {
  p: Int32Array;
  constructor(n: number) { this.p = new Int32Array(n).fill(-1); }
  find(x: number): number {
    let r = x;
    while (this.p[r] >= 0) r = this.p[r];
    while (this.p[x] >= 0) { const y = this.p[x]; this.p[x] = r; x = y; }
    return r;
  }
  union(a: number, b: number) {
    a = this.find(a); b = this.find(b);
    if (a === b) return;
    if (this.p[a] > this.p[b]) [a, b] = [b, a];
    this.p[a] += this.p[b]; this.p[b] = a;
  }
}

function buildIslands(mesh: Mesh, tris: TriAnalysis[]) {
  const dsu = new DSU(tris.length);
  // 每个 uvId 第一次出现的三角形
  const uvOwner = new Map<number, number>();
  tris.forEach((t, i) => {
    if (t.flags.has('degenerateUv')) return;
    for (const ci of [t.a, t.b, t.c]) {
      const u = mesh.faces[t.face].corners[ci].uv;
      if (u < 0) continue;
      const o = uvOwner.get(u);
      if (o === undefined) uvOwner.set(u, i);
      else dsu.union(i, o);
    }
  });
  const groups = new Map<number, number[]>();
  tris.forEach((t, i) => {
    if (t.flags.has('degenerateUv')) return;
    const r = dsu.find(i);
    let g = groups.get(r);
    if (!g) { g = []; groups.set(r, g); }
    g.push(i);
    t.island = -2; // 稍后编号
  });
  const islands = [...groups.values()];
  islands.forEach((g, id) => g.forEach(i => { tris[i].island = id; }));
  return islands;
}

/* ---------- UV 三角形重叠：SAT，空间哈希加速 ---------- */

function triUV(mesh: Mesh, t: TriInfo): number[] {
  const cn = mesh.faces[t.face].corners;
  const out: number[] = [];
  for (const ci of [t.a, t.b, t.c]) {
    const u = cn[ci].uv;
    out.push(mesh.uvs[u*2], mesh.uvs[u*2+1]);
  }
  return out;
}

function triArea2(p: number[]): number {
  return Math.abs(
    (p[2]-p[0])*(p[5]-p[1]) - (p[3]-p[1])*(p[4]-p[0])) / 2;
}

function cross2(ax:number,ay:number,bx:number,by:number) { return ax*by-ay*bx; }

function sub2(ax:number,ay:number,bx:number,by:number): [number,number] {
  return [ax-bx, ay-by];
}

function segInter(p1:[number,number],p2:[number,number],
                  p3:[number,number],p4:[number,number]): [number,number] | null {
  const x12 = sub2(p2[0],p2[1],p1[0],p1[1]);
  const x34 = sub2(p4[0],p4[1],p3[0],p3[1]);
  const denom = cross2(x12[0],x12[1],x34[0],x34[1]);
  if (Math.abs(denom) < 1e-15) return null;
  const x13 = sub2(p3[0],p3[1],p1[0],p1[1]);
  const t = cross2(x13[0],x13[1],x34[0],x34[1]) / denom;
  const u = cross2(x13[0],x13[1],x12[0],x12[1]) / denom;
  if (t < -1e-9 || t > 1+1e-9 || u < -1e-9 || u > 1+1e-9) return null;
  return [p1[0]+t*x12[0], p1[1]+t*x12[1]];
}

/** 两三角形交叠多边形面积（Sutherland–Hodgman 裁剪），单位为 UV² */
function triIntersectionArea(p: number[], q: number[]): number {
  type Pt = [number, number];
  const subj: Pt[] = [[p[0],p[1]],[p[2],p[3]],[p[4],p[5]]];
  const triIn: Pt[] = [[q[0],q[1]],[q[2],q[3]],[q[4],q[5]]];
  // 裁剪要求两多边形绕序一致；镜像翻转时 q 绕序相反，需反转。
  const signed = (r: Pt[]) =>
    (r[1][0]-r[0][0])*(r[2][1]-r[0][1]) - (r[1][1]-r[0][1])*(r[2][0]-r[0][0]);
  const tri = (signed(subj) < 0) !== (signed(triIn) < 0)
    ? [triIn[0], triIn[2], triIn[1]] : triIn;
  // 先粗判包围盒
  const maxA = Math.max;
  if (maxA(subj[0][0],subj[1][0],subj[2][0]) < Math.min(tri[0][0],tri[1][0],tri[2][0]) - 1e-12) return 0;
  if (maxA(subj[0][1],subj[1][1],subj[2][1]) < Math.min(tri[0][1],tri[1][1],tri[2][1]) - 1e-12) return 0;
  if (maxA(tri[0][0],tri[1][0],tri[2][0]) < Math.min(subj[0][0],subj[1][0],subj[2][0]) - 1e-12) return 0;
  if (maxA(tri[0][1],tri[1][1],tri[2][1]) < Math.min(subj[0][1],subj[1][1],subj[2][1]) - 1e-12) return 0;

  let output = subj;
  for (let i = 0; i < 3; i++) {
    const a = tri[i], b = tri[(i+1)%3];
    const input = output;
    output = [];
    if (input.length === 0) break;
    const side = (pt: Pt) => cross2(b[0]-a[0], b[1]-a[1], pt[0]-a[0], pt[1]-a[1]);
    for (let k = 0; k < input.length; k++) {
      const cur = input[k], prv = input[(k+input.length-1)%input.length];
      const curIn = side(cur) >= -1e-12, prvIn = side(prv) >= -1e-12;
      if (curIn) {
        if (!prvIn) { const hit = segInter(prv, cur, a, b); if (hit) output.push(hit); }
        output.push(cur);
      } else if (prvIn) {
        const hit = segInter(prv, cur, a, b); if (hit) output.push(hit);
      }
    }
  }
  if (output.length < 3) return 0;
  // 鞋带公式
  let area = 0;
  for (let i = 0; i < output.length; i++) {
    const j = (i+1) % output.length;
    area += output[i][0]*output[j][1] - output[j][0]*output[i][1];
  }
  return Math.abs(area) / 2;
}

function detectOverlaps(mesh: Mesh, tris: TriAnalysis[]) {
  const valid = tris
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => !t.flags.has('degenerateUv'));
  const uvsOf = valid.map(({ t }) => triUV(mesh, t));
  const uvEdgesOf = valid.map(({ t }) => {
    const corners = [t.a, t.b, t.c];
    const uids = corners.map(ci => mesh.faces[t.face].corners[ci].uv);
    const vids = corners.map(ci => mesh.faces[t.face].corners[ci].vertex);
    // 每条边：排序后的 (uvId 对) 与对应的 3D 顶点身份对。
    // 只有 UV 边与 3D 边都对应同一条，才是同一剖分的邻接三角形。
    const edges = new Map<string, string>();
    for (let k = 0; k < 3; k++) {
      const k2 = (k + 1) % 3;
      const uvk = uids[k] < uids[k2] ? uids[k] + '|' + uids[k2] : uids[k2] + '|' + uids[k];
      const v3a = vids[k], v3b = vids[k2];
      const vk = v3a < v3b ? v3a + '|' + v3b : v3b + '|' + v3a;
      edges.set(uvk, vk);
    }
    return { uids, edges };
  });

  // 统一网格
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of uvsOf) for (let k = 0; k < 3; k++) {
    minX = Math.min(minX, p[k*2]); maxX = Math.max(maxX, p[k*2]);
    minY = Math.min(minY, p[k*2+1]); maxY = Math.max(maxY, p[k*2+1]);
  }
  if (!isFinite(minX)) return;
  const cell = Math.max((maxX-minX), (maxY-minY)) / 32 || 1;
  const grid = new Map<string, number[]>();
  const key = (cx: number, cy: number) => cx + ',' + cy;
  valid.forEach((_item, vi) => {
    const p = uvsOf[vi];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      x0=Math.min(x0,p[k*2]); x1=Math.max(x1,p[k*2]);
      y0=Math.min(y0,p[k*2+1]); y1=Math.max(y1,p[k*2+1]);
    }
    for (let cx = Math.floor(x0/cell); cx <= Math.floor(x1/cell); cx++)
      for (let cy = Math.floor(y0/cell); cy <= Math.floor(y1/cell); cy++) {
        const k = key(cx, cy);
        let arr = grid.get(k);
        if (!arr) { arr = []; grid.set(k, arr); }
        arr.push(vi);
      }
  });

  const checked = new Set<string>();
  for (let vi = 0; vi < valid.length; vi++) {
    const { t, i } = valid[vi];
    const seen = new Set<number>();
    const p = uvsOf[vi];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      x0=Math.min(x0,p[k*2]); x1=Math.max(x1,p[k*2]);
      y0=Math.min(y0,p[k*2+1]); y1=Math.max(y1,p[k*2+1]);
    }
    for (let cx = Math.floor(x0/cell); cx <= Math.floor(x1/cell); cx++)
      for (let cy = Math.floor(y0/cell); cy <= Math.floor(y1/cell); cy++) {
        for (const vj of grid.get(key(cx, cy)) ?? []) seen.add(vj);
      }
    for (const vj of seen) {
      if (vj === vi) continue;
      const lo = Math.min(vi, vj), hi = Math.max(vi, vj);
      const ck = lo + '-' + hi;
      if (checked.has(ck)) continue;
      checked.add(ck);
      // 邻接判定：存在同一条 UV 边（同 uvId 对）且其对应的 3D 边也相同。
      // 镜像错边时两三角虽共享 UV 点，但 UV 边对应的 3D 边不同 → 不是邻接，继续重叠检测。
      let sharedEdge = false;
      for (const [uvk, vk] of uvEdgesOf[vi].edges) {
        if (uvEdgesOf[vj].edges.get(uvk) === vk) { sharedEdge = true; break; }
      }
      if (sharedEdge) continue;
      // 有意义的面积重叠：交叠面积占较小三角形 5% 以上。
      // 仅边/角相切（如镜像错边的退化交叠、相邻岛挤压）不计入。
      const inter = triIntersectionArea(uvsOf[vi], uvsOf[vj]);
      const aMin = Math.min(triArea2(uvsOf[vi]), triArea2(uvsOf[vj]));
      if (aMin > 1e-12 && inter / aMin > 0.05) {
        const { t: tj, i: ij } = valid[vj];
        t.flags.add('overlap'); tj.flags.add('overlap');
        t.overlaps.push(ij); tj.overlaps.push(i);
      }
    }
  }
}

/* ---------- 3D 边分类：以稳定顶点身份为键 ---------- */

function edgeKey(a: number, b: number) {
  return a < b ? a + '_' + b : b + '_' + a;
}

function buildEdges(mesh: Mesh): Map<string, EdgeInfo> {
  const map = new Map<string, { va: number; vb: number; faces: number[] }>();
  mesh.faces.forEach((f, fi) => {
    f.corners.forEach((c, i) => {
      const d = f.corners[(i + 1) % f.corners.length];
      const va = Math.min(c.vertex, d.vertex);
      const vb = Math.max(c.vertex, d.vertex);
      if (va === vb) return; // 退化边（共点）忽略
      const k = va + '_' + vb;
      let e = map.get(k);
      if (!e) { e = { va, vb, faces: [] }; map.set(k, e); }
      if (!e.faces.includes(fi)) e.faces.push(fi);
    });
  });

  const result = new Map<string, EdgeInfo>();
  for (const [k, e] of map) {
    let kind: EdgeKind;
    let dihedral = 0;
    if (e.faces.length >= 3) {
      kind = 'nonmanifold';
    } else if (e.faces.length === 1) {
      kind = 'boundary';
    } else {
      // 两面：以「是否共享同一 UV 身份 (uvId)」判断连续性。
      // 这与 UV 岛的并查集口径一致：共享 vt 即在同一 chart；
      // 盒展开各面即使摆放在相邻单元格、坐标恰好相接，仍是独立岛 → 接缝。
      const uvCont = sameUvOnEdge(mesh, e.faces[0], e.faces[1], e.va, e.vb);
      if (uvCont) {
        kind = 'interior';
      } else {
        dihedral = faceDihedral(mesh, e.faces[0], e.faces[1]);
        // 法线夹角大（硬折边）→ 盒展开的正常接缝；近似共面 → 平面接缝（问题）
        kind = dihedral > 25 ? 'hardseam' : 'seam';
      }
    }
    result.set(k, { ...e, kind, dihedral });
  }
  return result;
}

/** 面（扇面三角形聚合）法线，取前三个不共线角点 */
function faceNormal(mesh: Mesh, fi: number): number[] | null {
  const c = mesh.faces[fi].corners;
  for (let k = 1; k + 1 < c.length; k++) {
    const A = v3(c[0].vertex, mesh);
    const ab = sub(v3(c[k].vertex, mesh), A);
    const ac = sub(v3(c[k+1].vertex, mesh), A);
    const n = cross(ab, ac);
    const l = norm(n);
    if (l > 1e-12) return scale(n, 1 / l);
  }
  return null;
}

function faceDihedral(mesh: Mesh, f1: number, f2: number): number {
  const n1 = faceNormal(mesh, f1), n2 = faceNormal(mesh, f2);
  if (!n1 || !n2) return 0;
  const c = Math.max(-1, Math.min(1, dot(n1, n2)));
  return Math.acos(c) * 180 / Math.PI;
}

/**
 * 在两个面中找到 (va,vb) 边两端角点，比较两端是否共享同一 UV **身份**
 * （同一 uvId，含方向反转）。无 vt 或身份不同即视为接缝。
 */
function sameUvOnEdge(mesh: Mesh, f1: number, f2: number, va: number, vb: number): boolean {
  const uvEnds = (fi: number): [number, number] | null => {
    const c = mesh.faces[fi].corners;
    for (let i = 0; i < c.length; i++) {
      const x = c[i], y = c[(i + 1) % c.length];
      if (x.vertex === va && y.vertex === vb) return [x.uv, y.uv];
      if (x.vertex === vb && y.vertex === va) return [y.uv, x.uv];
    }
    return null;
  };
  const p = uvEnds(f1), q = uvEnds(f2);
  if (!p || !q) return false;
  if (p[0] < 0 || p[1] < 0 || q[0] < 0 || q[1] < 0) return false;
  return p[0] === q[0] && p[1] === q[1];
}

/** 面列表 → 边类型（供视图查询） */
export function edgeOf(mesh: Mesh, edges: Map<string, EdgeInfo>,
                      fi: number, ci: number): EdgeInfo | null {
  const c = mesh.faces[fi].corners[ci];
  const d = mesh.faces[fi].corners[(ci + 1) % mesh.faces[fi].corners.length];
  if (c.vertex === d.vertex) return null;
  return edges.get(edgeKey(c.vertex, d.vertex)) ?? null;
}

/** 收集分析摘要 */
export interface Summary {
  faces: number;
  triangles: number;
  degenerate3d: number;
  degenerateUv: number;
  flipped: number;
  overlapTris: number;
  seams: number;
  hardseams: number;
  nonmanifold: number;
  islands: number;
  /** 非退化面的角度畸变范围（max/median） */
  angleMax: number;
  /** 非退化面密度比率的最小/最大 */
  densityMin: number;
  densityMax: number;
}

export function summarize(a: Analysis): Summary {
  const s: Summary = {
    faces: 0, triangles: a.tris.length,
    degenerate3d: 0, degenerateUv: 0, flipped: 0, overlapTris: 0,
    seams: 0, hardseams: 0, nonmanifold: 0, islands: 0,
    angleMax: 1, densityMin: Infinity, densityMax: 0,
  };
  const faceSet = new Set<number>();
  for (const t of a.tris) {
    faceSet.add(t.face);
    if (t.flags.has('degenerate3d')) s.degenerate3d++;
    if (t.flags.has('degenerateUv')) s.degenerateUv++;
    if (t.flags.has('flipped')) s.flipped++;
    if (t.flags.has('overlap')) s.overlapTris++;
    if (!t.flags.has('degenerate3d') && !t.flags.has('degenerateUv')) {
      s.angleMax = Math.max(s.angleMax, t.angleDistortion);
      s.densityMin = Math.min(s.densityMin, t.densityRatio);
      s.densityMax = Math.max(s.densityMax, t.densityRatio);
    }
  }
  s.faces = faceSet.size;
  const islandIds = new Set(a.tris.filter(t => t.island >= 0).map(t => t.island));
  s.islands = islandIds.size;
  for (const e of a.edgeByKey.values()) {
    if (e.kind === 'seam') s.seams++;
    if (e.kind === 'hardseam') s.hardseams++;
    if (e.kind === 'nonmanifold') s.nonmanifold++;
  }
  if (!isFinite(s.densityMin)) s.densityMin = 1;
  return s;
}

/** 热色：t∈[0,1]，绿→黄→红 */
export function heatColor(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  if (t < 0.5) {
    const k = t / 0.5;
    return [0.2 + 0.8*k, 0.8, 0.25*(1-k)];
  }
  const k = (t - 0.5) / 0.5;
  return [1, 0.8*(1-k) + 0.15*k, 0.1*k];
}
