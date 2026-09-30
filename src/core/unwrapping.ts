import type createXAtlas from 'xatlas-wasm';
import type { MeshData } from './types';
import { cornerPos } from './parser';

type XAtlasModule = Awaited<ReturnType<typeof createXAtlas>>;

let modulePromise: Promise<XAtlasModule> | null = null;

/** 懒加载 WASM（含在单个 ESM 内），加载失败由调用方捕获并保留原模型。 */
export function loadXAtlas(): Promise<XAtlasModule> {
  if (!modulePromise) {
    modulePromise = import('xatlas-wasm').then((m) =>
      (m.default ?? (m as unknown as { default: typeof createXAtlas }))(),
    );
  }
  return modulePromise;
}

export interface UnwrapResult {
  uvs: Float64Array; // 每角点 UV：length = cornerCount * 2，已归一化到 ~[0,1]
  chartCount: number;
  utilization: number;
}

const POS_EPS_SQ = 1e-12;

/**
 * 调用 xatlas 重新展开。
 *
 * 身份映射策略：
 *  - 输入按“角点位置”焊接（仅给 xatlas 用），xref 记录焊接点代表的角点；
 *  - xatlas 输出三角形顺序与输入一致，输出顶点带 xref 指回焊接点；
 *  - 焊接点 -> 全部同位置角点，因此输出 UV 按角点身份精确分发，
 *    接缝两侧自然得到不同 UV（绝不做空间合并来改模型）。
 *  任一步骤失败都抛错，调用方保证原样保留当前模型。
 */
export async function unwrapWithXAtlas(mesh: MeshData): Promise<UnwrapResult> {
  const xa = await loadXAtlas();

  // 1) 角点 -> 焊接点
  const cornerWeld = new Int32Array(mesh.corners.length);
  const weldPos: number[] = [];

  for (let ci = 0; ci < mesh.corners.length; ci++) {
    const p = cornerPos(mesh, ci);
    let found = -1;
    for (let w = 0; w < weldPos.length; w += 3) {
      const dx = weldPos[w] - p.x;
      const dy = weldPos[w + 1] - p.y;
      const dz = weldPos[w + 2] - p.z;
      if (dx * dx + dy * dy + dz * dz <= POS_EPS_SQ) {
        found = w / 3;
        break;
      }
    }
    if (found < 0) {
      found = weldPos.length / 3;
      weldPos.push(p.x, p.y, p.z);
    }
    cornerWeld[ci] = found;
  }

  // 2) 三角形索引（扇形三角化后的全部三角形）
  const triCount = mesh.triangles.length;
  const indices = new Uint32Array(triCount * 3);
  for (const t of mesh.triangles) {
    indices[t.id * 3] = cornerWeld[t.corners[0]];
    indices[t.id * 3 + 1] = cornerWeld[t.corners[1]];
    indices[t.id * 3 + 2] = cornerWeld[t.corners[2]];
  }
  const positions = Float32Array.from(weldPos);

  // 3) 生成
  const atlas = xa.createAtlas();
  try {
    const err = atlas.addMesh({ positions, indices });
    if (err !== xa.AddMeshError.Success) {
      throw new Error(
        `xatlas 拒绝该网格：${xa.addMeshErrorString(err)}（非流形或索引非法）`,
      );
    }
    atlas.addMeshJoin();
    atlas.generate(
      {
        // 低模检查场景：倾向少接缝、尊重法线硬边
        normalSeamWeight: 4.0,
        textureSeamWeight: 0.5,
        fixWinding: false,
        maxIterations: 2,
      },
      { padding: 4, bilinear: true, rotateCharts: true },
    );
    const out = atlas.getMesh(0);

    // 防御：输出三角形数必须与输入一致（顺序映射的前提）
    if (out.indexCount !== indices.length) {
      throw new Error(
        `xatlas 输出三角形数变化（${indices.length / 3} -> ${out.indexCount / 3}），放弃映射`,
      );
    }

    const W = Math.max(1, atlas.width);
    const H = Math.max(1, atlas.height);

    // 4) 输出点 UV -> 焊接点
    const weldUv: Array<[number, number] | null> = new Array(
      weldPos.length / 3,
    ).fill(null);
    for (const v of out.vertices) {
      // xref: 输入焊接点下标。多个输出点可指向同一焊接点（接缝分裂），
      // 这里先占位，真正分发按“输出三角形角点”进行。
      if (v.xref < 0 || v.xref >= weldUv.length) continue;
      const u = v.uv[0] / W;
      const vv = v.uv[1] / H;
      if (weldUv[v.xref] === null) weldUv[v.xref] = [u, vv];
    }

    // 5) 按三角形顺序，把每个角点对应输出点的 UV 分发下去
    const cornerUvs = new Float64Array(mesh.corners.length * 2);
    for (let t = 0; t < triCount; t++) {
      const tri = mesh.triangles[t];
      for (let k = 0; k < 3; k++) {
        const outVert = out.indices[t * 3 + k];
        const ov = out.vertices[outVert];
        const u = ov.uv[0] / W;
        const v = ov.uv[1] / H;
        const ci = tri.corners[k];
        cornerUvs[ci * 2] = u;
        cornerUvs[ci * 2 + 1] = v;
      }
    }

    // 任何未覆盖的角点（理论上不应出现）回落到焊接点 UV
    for (let ci = 0; ci < mesh.corners.length; ci++) {
      if (!Number.isFinite(cornerUvs[ci * 2])) {
        const w = cornerWeld[ci];
        const uv = weldUv[w];
        if (uv) {
          cornerUvs[ci * 2] = uv[0];
          cornerUvs[ci * 2 + 1] = uv[1];
        }
      }
    }

    const util = atlas.getUtilization(0);
    return { uvs: cornerUvs, chartCount: atlas.chartCount, utilization: util };
  } finally {
    atlas.destroy();
  }
}
