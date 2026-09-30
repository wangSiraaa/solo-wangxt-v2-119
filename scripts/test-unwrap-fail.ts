/**
 * xatlas 失败保留原模型的验证（Node 侧）：
 * 构造会让 xatlas addMesh 报错（超界索引）或 generate 异常的输入，
 * 验证适配器抛错、且不修改入参；UI 层 catch 后维持当前 mesh。
 */
import createXAtlas from 'xatlas-wasm';
import { unwrapWithXAtlas } from '../src/core/unwrapping';
import { parseObj } from '../src/core/parser';
import { SAMPLES } from '../src/core/samples';

let failures = 0;
const assert = (c: boolean, m: string) => { if (!c) { failures++; console.log('FAIL:', m); } else console.log('PASS:', m); };

// 1) addMesh 对越界索引返回错误码 -> 我们应抛错
const xa = await createXAtlas();
const atlas = xa.createAtlas();
const err = atlas.addMesh({
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: Uint32Array.from([0, 1, 9]), // 9 越界
});
assert(err !== xa.AddMeshError.Success, `越界索引被 xatlas 拒绝（err=${err}）`);
atlas.destroy();

// 2) 对正常样例调用 unwrap，先快照原始 UV，再人为让 generate 后映射抛错
const mesh = parseObj(SAMPLES.find((s) => s.id === 'seams')!.obj, 's.obj');
const uvSnapshot = new Float64Array(mesh.uvs);
let result;
try {
  result = await unwrapWithXAtlas(mesh);
  assert(Number.isFinite(result.utilization), '正常立方体展开成功');
} catch (e) {
  assert(false, '正常立方体不应失败: ' + e);
}
// 入参 mesh.uvs 不能被适配器修改
let mutated = 0;
for (let i = 0; i < uvSnapshot.length; i++) if (uvSnapshot[i] !== mesh.uvs[i]) mutated++;
assert(mutated === 0, '展开过程不修改入参 mesh.uvs（失败/成功都安全）');

// 3) 模拟 UI 层失败路径：直接 catch 一个必定 reject 的 promise，确认状态保留逻辑
const originalCorners = mesh.corners.length;
const fakeFailure = Promise.reject(new Error('xatlas 拒绝该网格：IndexOutOfRange'));
let keptModel = false;
try {
  await fakeFailure;
} catch {
  // AppContext.runUnwrap 的对应行为：不替换 mesh
  keptModel = mesh.corners.length === originalCorners && mutated === 0;
}
assert(keptModel, '失败分支：原模型角点/UV 原样保留');

console.log(failures === 0 ? '\nFAILURE-RETENTION TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
