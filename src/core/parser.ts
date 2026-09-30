import type { MeshData, ObjFace, Triangle, Vec3 } from './types';

/**
 * 解析一个受控的 OBJ 子集：
 *   v x y z [w]
 *   vt u v [w]
 *   vn x y z
 *   f  v [/vt[/vn]] ...        （空格或斜杠分隔，支持负索引、n 边形）
 *   o / g
 *
 * 刻意不做的事：
 *   - 不焊接、不按空间位置去重 —— 每个 v 行就是一个稳定顶点身份；
 *   - 不丢弃重复顶点 —— 接缝两侧角点可共享 v 却带不同 vt，也可直接是
 *     两个坐标相同的独立 v（导出后标准工具里依旧是两个角点）。
 */
export function parseObj(text: string, fileName = 'model.obj'): MeshData {
  const posList: number[] = [];
  const uvList: number[] = [];
  const nrmList: number[] = [];
  const faces: ObjFace[] = [];
  const corners: MeshData['corners'] = [];
  const triangles: Triangle[] = [];
  let group = 'default';

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sp = line.split(/\s+/);
    const tag = sp[0];

    if (tag === 'v' && sp.length >= 4) {
      posList.push(Number(sp[1]), Number(sp[2]), Number(sp[3]));
    } else if (tag === 'vt' && sp.length >= 3) {
      uvList.push(Number(sp[1]), Number(sp[2]));
    } else if (tag === 'vn' && sp.length >= 4) {
      nrmList.push(Number(sp[1]), Number(sp[2]), Number(sp[3]));
    } else if (tag === 'o' || tag === 'g') {
      group = sp.slice(1).join(' ') || 'default';
    } else if (tag === 'f' && sp.length >= 4) {
      const faceId = faces.length;
      const faceCornerIds: number[] = [];
      for (let k = 1; k < sp.length; k++) {
        const tok = sp[k];
        const parts = tok.split('/');
        const vi = resolveIndex(parts[0], posList.length / 3);
        const ti =
          parts[1] !== undefined && parts[1] !== ''
            ? resolveIndex(parts[1], uvList.length / 2)
            : -1;
        const ni =
          parts[2] !== undefined && parts[2] !== ''
            ? resolveIndex(parts[2], nrmList.length / 3)
            : -1;
        if (vi < 0) {
          throw new Error(`面 #${faceId + 1} 存在无法解析的顶点引用: "${tok}"`);
        }
        faceCornerIds.push(corners.length);
        corners.push({ v: vi, vt: ti, vn: ni });
      }
      // 索引上界校验（负索引 resolveIndex 已处理，正数可能超表）
      for (const ci of faceCornerIds) {
        const c = corners[ci];
        const vMax = posList.length / 3;
        const tMax = uvList.length / 2;
        const nMax = nrmList.length / 3;
        if (c.v >= vMax) {
          throw new Error(`面 #${faceId + 1} 引用了不存在的 v ${c.v + 1}`);
        }
        if (c.vt >= tMax) {
          throw new Error(`面 #${faceId + 1} 引用了不存在的 vt ${c.vt + 1}`);
        }
        if (c.vn >= nMax) {
          throw new Error(`面 #${faceId + 1} 引用了不存在的 vn ${c.vn + 1}`);
        }
      }
      const face: ObjFace = { id: faceId, cornerIds: faceCornerIds, group };
      faces.push(face);

      // 扇形三角化，每个三角形记住原始面 id
      for (let k = 1; k + 1 < faceCornerIds.length; k++) {
        triangles.push({
          id: triangles.length,
          faceId,
          corners: [faceCornerIds[0], faceCornerIds[k], faceCornerIds[k + 1]],
        });
      }
    }
  }

  if (faces.length === 0) {
    throw new Error('OBJ 中没有任何面（至少需要一行 f）');
  }

  const positions = Float64Array.from(posList);
  const hasUv = uvList.length >= 2;
  const uvs = hasUv ? Float64Array.from(uvList) : makePlanarUvs(positions);
  if (!hasUv) {
    // 无 vt：角点按顶点身份独立取平面 UV，接缝语义依旧成立。
    for (const c of corners) c.vt = c.v;
  }

  return {
    sourceObj: text,
    fileName,
    positions,
    uvs,
    normals: Float64Array.from(nrmList),
    faces,
    corners,
    triangles,
    cornerTri: buildCornerTri(triangles, corners.length),
    vertexCount: positions.length / 3,
    uvCount: uvs.length / 2,
    hasUv,
    uvOrigin: hasUv ? 'obj' : 'planar-fallback',
  };
}

function buildCornerTri(triangles: Triangle[], cornerCount: number): Int32Array {
  // 每个角点记录“最后一次出现”的三角形；选中逻辑走 face -> tris，
  // 这里主要用于拾取时从交点角点快速回溯。
  const map = new Int32Array(cornerCount).fill(-1);
  for (const t of triangles) {
    map[t.corners[0]] = t.id;
    map[t.corners[1]] = t.id;
    map[t.corners[2]] = t.id;
  }
  return map;
}

function resolveIndex(token: string, count: number): number {
  const n = parseInt(token, 10);
  if (!Number.isFinite(n)) return -1;
  return n > 0 ? n - 1 : count + n; // OBJ 负索引
}

/** 沿包围盒最大延展面做平面投影，生成 0..1 兜底 UV。 */
function makePlanarUvs(positions: Float64Array): Float64Array {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const span: Vec3 = {
    x: (maxX - minX) || 1,
    y: (maxY - minY) || 1,
    z: (maxZ - minZ) || 1,
  };
  const mins: Vec3 = { x: minX, y: minY, z: minZ };
  const axis = (['x', 'y', 'z'] as Array<'x' | 'y' | 'z'>)
    .map((a): { a: 'x' | 'y' | 'z'; s: number } => ({ a, s: span[a] }))
    .sort((x, y) => y.s - x.s)
    .map((o) => o.a);
  const uAxis = axis[0];
  const vAxis = axis[1];
  const off: Record<'x' | 'y' | 'z', number> = { x: 0, y: 1, z: 2 };
  const out = new Float64Array((positions.length / 3) * 2);
  for (let i = 0, j = 0; i < positions.length; i += 3, j += 2) {
    out[j] = (positions[i + off[uAxis]] - mins[uAxis]) / span[uAxis];
    // 翻转 V，使从展开面正面观察时绕序与 3D 一致（逆时针为正）。
    out[j + 1] = 1 - (positions[i + off[vAxis]] - mins[vAxis]) / span[vAxis];
  }
  return out;
}

/** 取角点当前活动 UV。 */
export function cornerUv(mesh: MeshData, ci: number): [number, number] {
  const c = mesh.corners[ci];
  const t = c.vt >= 0 ? c.vt : c.v;
  return [mesh.uvs[t * 2], mesh.uvs[t * 2 + 1]];
}

export function cornerPos(mesh: MeshData, ci: number): Vec3 {
  const v = mesh.corners[ci].v;
  return {
    x: mesh.positions[v * 3],
    y: mesh.positions[v * 3 + 1],
    z: mesh.positions[v * 3 + 2],
  };
}
