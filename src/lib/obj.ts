import type { Mesh, Face } from '../types';

/**
 * OBJ 子集解析器。
 * 支持：v / vt / f（`v`、`v/vt`、`v//vn`、`v/vt/vn`、负索引）。
 * 忽略：vn、g/o/usemtl/mtllib/s/l 等。
 *
 * 关键：完全保留文件给出的角点结构——同位置不焊接，
 * 接缝两侧可以引用不同 vt（即使位置相同也各自独立）。
 */
export function parseOBJ(text: string, name = 'model.obj'): Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const faces: Face[] = [];
  const errors: string[] = [];

  const lines = text.split(/\r?\n/);
  lines.forEach((raw, li) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const [cmd, ...rest] = line.split(/\s+/);
    switch (cmd) {
      case 'v': {
        if (rest.length < 3) { errors.push(`第${li+1}行: v 需要 3 个分量`); return; }
        positions.push(+rest[0], +rest[1], +rest[2]);
        break;
      }
      case 'vt': {
        if (rest.length < 2) { errors.push(`第${li+1}行: vt 需要至少 2 个分量`); return; }
        uvs.push(+rest[0], +rest[1]);
        break;
      }
      case 'f': {
        if (rest.length < 3) { errors.push(`第${li+1}行: 面至少需要 3 个角点`); return; }
        const corners = rest.map((tok) => {
          const parts = tok.split('/');
          const v = resolveIndex(+parts[0], positions.length / 3);
          // parts[1] 可以是空字符串（v//vn）或不存在（v）
          const vt = parts.length >= 2 && parts[1] !== ''
            ? resolveIndex(+parts[1], uvs.length / 2) : -1;
          return { vertex: v, uv: vt };
        });
        if (corners.some(c => c.vertex < 0 || c.uv < -1)) {
          errors.push(`第${li+1}行: 索引越界，已跳过该面`);
          return;
        }
        faces.push({ corners });
        break;
      }
      default:
        // vn / g / o / usemtl / mtllib / s / l / p 等忽略
        break;
    }
  });

  if (!faces.length) throw new Error('未解析到任何面（f）。仅支持 v/vt/f 子集。' +
    (errors.length ? '\n' + errors.join('\n') : ''));
  if (errors.length) console.warn('[OBJ parse]', errors.join('\n'));

  const mesh: Mesh = {
    name,
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    faces,
  };

  // 面中没有任何 vt 时，给一个「平面展开」占位 UV，保证 UV 视图可用
  const hasAnyUv = faces.some(f => f.corners.some(c => c.uv >= 0));
  if (!hasAnyUv) assignPlanarFallback(mesh);

  return mesh;
}

function resolveIndex(i: number, count: number): number {
  if (Number.isNaN(i)) return -1;
  // OBJ 规范：正整数为绝对 1-based 索引（可前向引用），仅负数为相对索引
  return i < 0 ? count + i : i - 1;
}

/** 对完全没有 UV 的模型，按最大轴平面投影生成每角点独立 UV（不焊接） */
function assignPlanarFallback(mesh: Mesh) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of mesh.faces) for (const c of f.corners) {
    const x = mesh.positions[c.vertex*3], y = mesh.positions[c.vertex*3+1];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const sx = maxX - minX || 1, sy = maxY - minY || 1;
  mesh.uvs = new Float32Array(mesh.faces.reduce((n, f) => n + f.corners.length, 0) * 2);
  let k = 0;
  for (const f of mesh.faces) for (const c of f.corners) {
    const x = mesh.positions[c.vertex*3], y = mesh.positions[c.vertex*3+1];
    mesh.uvs[k*2] = (x - minX) / sx;
    mesh.uvs[k*2+1] = (y - minY) / sy;
    c.uv = k++;
  }
}

/**
 * OBJ 导出：保留原始多边形面与每角点 (v, vt)。
 * 重新编号压缩（仅输出被使用的 v/vt），导出文件可被 Blender/Maya/
 * 3ds Max/xatlas 等标准工具重新载入。
 */
export function exportOBJ(mesh: Mesh): string {
  // 被引用的稳定顶点/UV 身份（ID，不去重坐标——同位置不同角点必须保留为不同 v）
  const usedV = new Set<number>();
  const usedVT = new Set<number>();
  for (const f of mesh.faces) for (const c of f.corners) {
    usedV.add(c.vertex);
    if (c.uv >= 0) usedVT.add(c.uv);
  }
  const vMap = new Map<number, number>();
  const vtMap = new Map<number, number>();
  // 按数值升序重编号，保持原始 ID 相对顺序（默认字典序会让 10<2）
  [...usedV].sort((a, b) => a - b).forEach((v, i) => vMap.set(v, i + 1));
  [...usedVT].sort((a, b) => a - b).forEach((v, i) => vtMap.set(v, i + 1));

  const fmt = (x: number) => {
    // 保留 7 位小数（单精度 0.2 等也能在 1e-5 容差内往返），去掉 -0
    const s = (Math.round(x * 1e7) / 1e7).toFixed(7).replace(/\.?0+$/, '');
    return s === '-0' ? '0' : s;
  };
  const out: string[] = [`# 低模 UV 检查台导出 · ${new Date().toISOString()}`, '# 每角点保留独立 v/vt，缝两侧可有不同 UV'];

  // 每个被引用的顶点 ID 输出一行（坐标可能重复，但身份独立）
  const sortedV = [...usedV].sort((a, b) => a - b);
  const sortedVT = [...usedVT].sort((a, b) => a - b);
  for (const v of sortedV) {
    out.push(`v ${fmt(mesh.positions[v*3])} ${fmt(mesh.positions[v*3+1])} ${fmt(mesh.positions[v*3+2])}`);
  }
  for (const vt of sortedVT) {
    out.push(`vt ${fmt(mesh.uvs[vt*2])} ${fmt(mesh.uvs[vt*2+1])}`);
  }
  for (const f of mesh.faces) {
    const toks = f.corners.map((c) => {
      const vi = vMap.get(c.vertex)!;
      return c.uv >= 0 ? `${vi}/${vtMap.get(c.uv)!}` : `${vi}`;
    });
    out.push('f ' + toks.join(' '));
  }
  return out.join('\n') + '\n';
}

/**
 * 回环验证：解析刚导出的 OBJ，核对每个原角点的 (位置, UV) 都能对应回来。
 * 返回不匹配角点数量（0 = 完全可由标准工具重新载入）。
 */
export function verifyRoundTrip(mesh: Mesh): { ok: boolean; detail: string } {
  const text = exportOBJ(mesh);
  let re: Mesh;
  try { re = parseOBJ(text, 'roundtrip.obj'); }
  catch (e) { return { ok: false, detail: '回环解析失败: ' + (e as Error).message }; }

  // 去重后的位置集合应当一致（导出会对相同坐标去重并按值排序重编号）。
  // 单精度 + 7 位小数导出，用容差最近邻匹配。
  const ptsA: number[][] = [];
  for (let i = 0; i < mesh.positions.length / 3; i++)
    ptsA.push([mesh.positions[i*3], mesh.positions[i*3+1], mesh.positions[i*3+2]]);
  const ptsB: number[][] = [];
  for (let i = 0; i < re.positions.length / 3; i++)
    ptsB.push([re.positions[i*3], re.positions[i*3+1], re.positions[i*3+2]]);
  const close = (p: number[], q: number[]) =>
    Math.abs(p[0]-q[0]) <= 1e-5 && Math.abs(p[1]-q[1]) <= 1e-5 && Math.abs(p[2]-q[2]) <= 1e-5;
  if (ptsA.length !== ptsB.length)
    return { ok: false, detail: `去重顶点数变化 ${ptsA.length}→${ptsB.length}` };
  for (const p of ptsA) {
    if (!ptsB.some(q => close(p, q)))
      return { ok: false, detail: `导出丢失顶点 (${p.map(x=>x.toFixed(4)).join(',')})` };
  }

  // 每个角点：按「值」比较（相同空间坐标在导出时会去重重编号，
  // 不能比下标），并核对该角点的 UV 值一致。
  let bad = 0;
  const pv = (arr: Float32Array, i: number) =>
    [arr[i*3], arr[i*3+1], arr[i*3+2]];
  const close3 = (a: number[], b: number[]) =>
    Math.abs(a[0]-b[0]) <= 1e-5 && Math.abs(a[1]-b[1]) <= 1e-5 && Math.abs(a[2]-b[2]) <= 1e-5;
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const a = mesh.faces[fi].corners, b = re.faces[fi].corners;
    if (a.length !== b.length) { bad += a.length; continue; }
    for (let ci = 0; ci < a.length; ci++) {
      if (!close3(pv(mesh.positions, a[ci].vertex), pv(re.positions, b[ci].vertex))) {
        bad++; continue;
      }
      // UV 值（不按身份，直接按该角点携带的值）
      if (a[ci].uv >= 0) {
        if (b[ci].uv < 0) { bad++; continue; }
        const ua = [mesh.uvs[a[ci].uv*2], mesh.uvs[a[ci].uv*2+1]];
        const ub = [re.uvs[b[ci].uv*2], re.uvs[b[ci].uv*2+1]];
        if (Math.abs(ua[0]-ub[0]) > 1e-5 || Math.abs(ua[1]-ub[1]) > 1e-5) bad++;
      } else if (b[ci].uv >= 0) bad++;
    }
  }
  return bad === 0
    ? { ok: true, detail: `回环一致：${mesh.faces.length} 面，所有角点位置/UV 对应` }
    : { ok: false, detail: `回环发现 ${bad} 个角点不一致` };
}
