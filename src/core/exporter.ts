import type { MeshData } from './types';

/**
 * 以“非索引逐角点”形式导出：每个三角形角点各占一行 v / vt，
 * 面用独立的序号引用。这样：
 *  - 接缝两侧可以有相同位置、不同 UV（共享边接缝、镜像岛都保留）；
 *  - 不依赖任何工具的焊接/去重策略，Blender、Maya、任意 OBJ 加载器
 *    都能读回一致的三角网格与 UV；
 *  - 三角形顺序稳定，面身份（解析序）通过行顺序可复核。
 *
 * vt 以 6 位小数写入，数值相同的角点合并为同一 vt 行，既保持接缝，
 * 又避免纯浮点抖动制造出多余的 UV 顶点。
 */
export function exportObj(mesh: MeshData): string {
  const lines: string[] = [];
  lines.push('# 低模 UV 检查器导出');
  lines.push(`# 来源: ${mesh.fileName}`);
  lines.push(`# 三角面: ${mesh.triangles.length}  原始面: ${mesh.faces.length}`);
  lines.push(`# UV 来源: ${mesh.uvOrigin === 'obj' ? 'OBJ/编辑后' : '平面回退'}`);
  lines.push('o LowpolyUVExport');

  const f6 = (n: number) => {
    const s = n.toFixed(6);
    return s === '-0.000000' ? '0.000000' : s;
  };

  // 先算 vt 表（按舍入字符串去重），因为 OBJ 要求所有 v 行先于 vt 行。
  const vtKeyToIndex = new Map<string, number>();
  const vtValues: Array<[number, number]> = [];
  const cornerVt = new Int32Array(mesh.corners.length);
  for (let ci = 0; ci < mesh.corners.length; ci++) {
    const c = mesh.corners[ci];
    const t = c.vt >= 0 ? c.vt : c.v;
    const u = mesh.uvs[t * 2];
    const v = mesh.uvs[t * 2 + 1];
    const key = `${f6(u)}/${f6(v)}`;
    let idx = vtKeyToIndex.get(key);
    if (idx === undefined) {
      idx = vtValues.length + 1; // OBJ 1-based
      vtKeyToIndex.set(key, idx);
      vtValues.push([u, v]);
    }
    cornerVt[ci] = idx;
  }

  // 每个角点一行 v（保留接缝处的独立角点，绝不空间合并）
  for (let ci = 0; ci < mesh.corners.length; ci++) {
    const c = mesh.corners[ci];
    lines.push(
      `v ${f6(mesh.positions[c.v * 3])} ${f6(mesh.positions[c.v * 3 + 1])} ${f6(mesh.positions[c.v * 3 + 2])}`,
    );
  }
  for (const [u, v] of vtValues) {
    lines.push(`vt ${f6(u)} ${f6(v)}`);
  }

  // 面：三角形 -> f v1/vt1 v2/vt2 v3/vt3（角点 v 序号 = ci+1）
  for (const t of mesh.triangles) {
    const refs = t.corners.map((ci) => `${ci + 1}/${cornerVt[ci]}`);
    lines.push(`f ${refs.join(' ')}`);
  }

  return lines.join('\n') + '\n';
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
