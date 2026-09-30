import { parseObj } from '../src/core/parser';
import { analyzeMesh } from '../src/core/metrics';
import { exportObj } from '../src/core/exporter';
import { SAMPLES } from '../src/core/samples';

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) { failures++; console.log('  FAIL:', msg); }
};

for (const s of SAMPLES) {
  console.log('\n===', s.label, '===');
  const mesh = parseObj(s.obj, s.id + '.obj');
  const stats = analyzeMesh(mesh);
  const deg3 = stats.metrics.filter(m => m.degenerate3d).length;
  const degUv = stats.metrics.filter(m => m.degenerateUv).length;
  const flipped = stats.metrics.filter(m => m.flipped).length;
  const overlaps = stats.metrics.filter((_, i) => stats.overlap[i]).length;
  const seams = stats.edges.filter(e => e.seam).length;
  const nm = stats.edges.filter(e => e.nonManifold).length;
  const boundary = stats.edges.filter(e => e.boundary).length;
  console.log({
    verts: mesh.vertexCount, corners: mesh.corners.length,
    tris: mesh.triangles.length, faces: mesh.faces.length,
    uvs: mesh.uvCount, islands: stats.islands.length,
    deg3, degUv, flipped, overlaps, seams, nm, boundary,
    mirroredIsl: stats.islands.filter(i => i.mirrored).map(i => i.id),
  });

  if (s.id === 'mirrored') {
    assert(stats.islands.length === 2, `mirrored: 两片 3D 不相邻 => 2 个岛，实际 ${stats.islands.length}`);
    assert(flipped === 1, 'mirrored: 应有 1 个翻转三角形');
    assert(stats.islands.some(i => i.mirrored), 'mirrored: 应有岛判定镜像');
  }
  if (s.id === 'seams') {
    assert(seams === 12, `seams: 立方体应有 12 条接缝，实际 ${seams}`);
    assert(nm === 0, 'seams: 不应有非流形边');
    assert(stats.islands.length === 6, `seams: 应有 6 个 UV 岛，实际 ${stats.islands.length}`);
    assert(flipped === 0, `seams: 所有面绕序应一致，实际翻转 ${flipped}`);
  }
  if (s.id === 'nonmanifold') {
    assert(nm === 1, `nonmanifold: 应有 1 条非流形边，实际 ${nm}`);
    assert(stats.islands.length === 3, `nonmanifold: 3 个 UV 岛，实际 ${stats.islands.length}`);
  }
  if (s.id === 'degenerate') {
    assert(deg3 === 1, `degenerate: 应有 1 个 3D 退化三角形，实际 ${deg3}`);
    assert(degUv === 1, `degenerate: B 的 UV 也共线 => 1 个 UV 退化，实际 ${degUv}`);
    // A 与 D UV 完全重合（必重叠）；薄片 C 与 A 部分相交；退化 B 不参与
    assert(stats.overlap[0] === 1 && stats.overlap[3] === 1, 'degenerate: A 与 D 完全重叠');
    assert(stats.overlap[1] === 0, 'degenerate: 退化三角形不参与重叠检测');
    assert(overlaps >= 2, `degenerate: 至少 A、D 两个重叠三角形，实际 ${overlaps}`);
    // 面积畸变：C 极度压缩 => areaRatio 远大于 1
    const cRatio = stats.metrics[2].areaRatio;
    assert(cRatio !== null && cRatio > 2, `degenerate: C 面积比率应 >2，实际 ${cRatio}`);
    assert(stats.metrics[1].areaRatio === null, 'degenerate: 退化面不参与比率(null)');
    assert(stats.metrics[1].angleDistortion === null, 'degenerate: 退化面角度畸变也应为 null');
  }

  // 导出并重新解析：三角形数、每三角形 UV 必须保持
  const out = exportObj(mesh);
  const re = parseObj(out, 're.obj');
  assert(re.triangles.length === mesh.triangles.length, 'roundtrip: 三角形数一致');
  let uvDrift = 0;
  for (const t0 of mesh.triangles) {
    const t1 = re.triangles[t0.id];
    for (let k = 0; k < 3; k++) {
      const ci0 = t0.corners[k], ci1 = t1.corners[k];
      const u0a = mesh.uvs[mesh.corners[ci0].vt * 2], u0b = mesh.uvs[mesh.corners[ci0].vt * 2 + 1];
      const u1a = re.uvs[re.corners[ci1].vt * 2], u1b = re.uvs[re.corners[ci1].vt * 2 + 1];
      if (Math.abs(u0a - u1a) > 1e-5 || Math.abs(u0b - u1b) > 1e-5) uvDrift++;
    }
  }
  assert(uvDrift === 0, `roundtrip: UV 漂移角点 ${uvDrift}`);
}

// 稳定性身份检查：seams 立方体里 8 个空间角点各被 3 个相邻面复制
const seam = parseObj(SAMPLES.find(s => s.id === 'seams')!.obj);
const posCounts = new Map();
for (let vi = 0; vi < seam.vertexCount; vi++) {
  const k = `${seam.positions[vi*3]},${seam.positions[vi*3+1]},${seam.positions[vi*3+2]}`;
  posCounts.set(k, (posCounts.get(k) ?? 0) + 1);
}
const duplicatedLocs = [...posCounts.values()].filter(n => n === 3).length;
assert(duplicatedLocs === 8, `seams: 8 个空间角点位置各有 3 个独立 v，实际 ${duplicatedLocs}`);
assert(posCounts.size === 8, `seams: 只有 8 个不同空间位置，实际 ${posCounts.size}`);
assert(seam.vertexCount === 24, 'seams: 24 个稳定顶点身份（不焊接）');
assert(seam.corners.length === 36, 'seams: 角点总数 36（6 面 × 2 三角 × 3）');

console.log(failures === 0 ? '\nALL CORE TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
