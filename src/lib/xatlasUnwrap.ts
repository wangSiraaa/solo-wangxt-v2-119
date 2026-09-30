import type { Mesh } from '../types';

/**
 * xatlas 自动展开（可选）。
 *
 * 身份策略（关键，需求：不能按空间位置合并顶点）：
 * - 向 xatlas 传入「按三角形角点展开」的位置数组（3×triCount 个点），
 *   不做任何空间焊接，每个输入角点身份独立。
 * - xatlas 内部可能按几何邻接重新焊接/拆分，但每个输出顶点带 xref，
 *   指回我们传入的输入角点；由输出三角形三个 xref 反查唯一定位原三角形，
 *   再把归一化 UV 写回每个「面·角点」。不同面的同位置角点仍可不同 UV。
 * - 异常 / NaN / 越界 / 角点覆盖不全都视为失败，调用方保留原模型。
 */

export interface UnwrapResult {
  ok: boolean;
  message: string;
  /** 成功时为新 UV 数组（长度 = 总角点数 × 2，顺序与面角点展平一致） */
  uvs?: Float32Array;
}

type XModule = Awaited<ReturnType<typeof import('xatlas-wasm')['default']>>;

export async function unwrapWithXAtlas(
  mesh: Mesh,
  onProgress?: (msg: string, pct: number) => void,
): Promise<UnwrapResult> {
  let mod: XModule;
  try {
    onProgress?.('加载 xatlas WASM…', 5);
    mod = await (await import('xatlas-wasm')).default();
  } catch (e) {
    return { ok: false, message: 'WASM 模块加载失败，已保留原模型：' + (e as Error).message };
  }

  // 1) 角点展开。triList[t] 记录输入三角形 t 的 (face, 三个面内角点下标)
  const triList: { face: number; corners: [number, number, number] }[] = [];
  mesh.faces.forEach((f, fi) => {
    for (let k = 0; k + 2 < f.corners.length; k++) {
      triList.push({ face: fi, corners: [0, k + 1, k + 2] });
    }
  });
  const triCount = triList.length;
  if (triCount === 0) return { ok: false, message: '没有可展开的三角形，已保留原模型。' };

  const positions = new Float32Array(triCount * 9);
  const hintUV = new Float32Array(triCount * 6);
  const indices = new Uint32Array(triCount * 3);
  triList.forEach(({ face, corners }, t) => {
    corners.forEach((ci, j) => {
      const vi = mesh.faces[face].corners[ci].vertex;
      positions.set([
        mesh.positions[vi*3], mesh.positions[vi*3+1], mesh.positions[vi*3+2],
      ], t*9 + j*3);
      const ui = mesh.faces[face].corners[ci].uv;
      if (ui >= 0) hintUV.set([mesh.uvs[ui*2], mesh.uvs[ui*2+1]], t*6 + j*2);
      indices[t*3+j] = t*3+j;
    });
  });
  if (!positions.every(isFinite))
    return { ok: false, message: '存在非有限顶点坐标，已保留原模型。' };

  const atlas = mod.createAtlas();
  try {
    const err = atlas.addMesh({ positions, indices, uvs: hintUV });
    if (err !== 0) {
      return { ok: false, message: `xatlas 拒绝网格（${mod.addMeshErrorString(err)}），已保留原模型。` };
    }
    onProgress?.('计算 charts…', 30);
    atlas.setProgressCallback((_cat, pct) => {
      onProgress?.('xatlas 展开中…', 30 + Math.round(pct * 0.6));
      return true;
    });
    // fixWinding=false：不悄悄改掉用户要检查的翻转
    atlas.generate(
      { fixWinding: false, useInputMeshUvs: false },
      { padding: 4, bilinear: true, rotateCharts: true },
    );
    onProgress?.('回映 UV 到角点…', 95);

    const out = atlas.getMesh(0);
    if (!out || out.vertexCount === 0 || out.indexCount === 0) {
      return { ok: false, message: 'xatlas 未产生有效输出（空/完全退化），已保留原模型。' };
    }
    const W = atlas.width || 1, H = atlas.height || 1;

    // 2) 遍历输出三角形：由 xref 反查 (输入三角形 t, 角点位置 j)，
    //    归一化 UV 收集到 (face, 面内角点) -> uv。
    const uvByFC = new Map<string, [number, number]>();
    const covered = new Uint8Array(triCount);
    for (let ot = 0; ot < out.indexCount / 3; ot++) {
      const ov = [0,1,2].map(j => out.vertices[out.indices[ot*3+j]]);
      const t = Math.floor(ov[0].xref / 3);
      const js = ov.map(v => v.xref % 3);
      if (!ov.every(v => Math.floor(v.xref / 3) === t) ||
          js.some(j => j < 0 || j > 2) || t < 0 || t >= triCount) {
        return { ok: false, message: 'xatlas 输出角点无法对应回原三角形（身份校验失败），已保留原模型。' };
      }
      const { face, corners } = triList[t];
      for (let j = 0; j < 3; j++) {
        const u = ov[j].uv[0] / W, v = ov[j].uv[1] / H;
        if (!isFinite(u) || !isFinite(v) || u < -0.01 || v < -0.01 ||
            u > 1.01 || v > 1.01) {
          return { ok: false, message: 'xatlas 产生 NaN/越界 UV（可能坐标尺度过大），已保留原模型。' };
        }
        const key = face + ':' + corners[js[j]];
        const prev = uvByFC.get(key);
        // 扇面共享角点（如四边形的 0 号角点）必须得到一致 UV
        if (prev && (Math.abs(prev[0]-u) > 1e-5 || Math.abs(prev[1]-v) > 1e-5)) {
          return { ok: false, message: '同一角点回映到不一致 UV，已保留原模型。' };
        }
        uvByFC.set(key, [u, v]);
      }
      covered[t] = 1;
    }
    for (let t = 0; t < triCount; t++) {
      if (!covered[t])
        return { ok: false, message: '部分原三角形在输出中缺失，已保留原模型。' };
    }

    // 3) 为每个「面·角点」分配独立 uvId（不焊接，缝两侧自然可有不同 UV）
    const total = mesh.faces.reduce((n, f) => n + f.corners.length, 0);
    const finalUV = new Float32Array(total * 2);
    let k = 0;
    for (let fi = 0; fi < mesh.faces.length; fi++) {
      for (let ci = 0; ci < mesh.faces[fi].corners.length; ci++) {
        const uv = uvByFC.get(fi + ':' + ci);
        if (!uv) return { ok: false, message: `角点(面${fi+1}#${ci+1})缺少 UV，已保留原模型。` };
        finalUV[k*2] = uv[0];
        finalUV[k*2+1] = uv[1];
        k++;
      }
    }
    return {
      ok: true,
      message: `xatlas 展开成功：${out.chartCount} 个 chart，${W}×${H}，所有角点已回映`,
      uvs: finalUV,
    };
  } catch (e) {
    return { ok: false, message: 'xatlas 运行异常，已保留原模型：' + (e as Error).message };
  } finally {
    try { atlas.destroy(); } catch { /* ignore */ }
  }
}
