import { parseOBJ } from './obj';
import type { Mesh } from '../types';

/**
 * 内置样例。所有样例严格遵循「角点独立、不按空间位置焊接」：
 * 接缝 / 镜像两侧即便位置相同，也以不同角点携带不同 vt。
 */

export interface Sample {
  id: string;
  label: string;
  desc: string;
  build: () => Mesh;
}

/* 1) 健康立方体：盒式展开，6 个 UV 岛，密度均匀，无翻转/重叠 */
function sampleCube(): Mesh {
  // 每个面独立 4 个 UV（共 24 个），即使坐标相同也不共享 vt，
  // 从而在 UV 分析中呈现 6 个互不相连的岛（标准盒展开）。
  const vt: number[] = [];
  const cell = (cu: number, cv: number): number[] => {
    const take = (u: number, w: number) => {
      const i = vt.length / 2;
      vt.push(u, w);
      return i + 1; // OBJ 1-based
    };
    return [take(cu,cv), take(cu+1,cv), take(cu+1,cv+1), take(cu,cv+1)];
  };

  const v: string[] = [
    'v -1 -1  1','v  1 -1  1','v  1 1  1','v -1 1 1',
    'v -1 -1 -1','v  1 -1 -1','v  1 1 -1','v -1 1 -1',
  ];
  const f: string[] = [];
  const quad = (a:number,b:number,c:number,d:number, t:number[]) =>
    f.push(`f ${a}/${t[0]} ${b}/${t[1]} ${c}/${t[2]} ${d}/${t[3]}`);

  quad(1,2,3,4, cell(0,0)); // +Z
  quad(6,5,8,7, cell(2,0)); // -Z
  quad(2,6,7,3, cell(1,0)); // +X
  quad(5,1,4,8, cell(2,1)); // -X
  quad(4,3,7,8, cell(0,1)); // +Y
  quad(5,6,2,1, cell(1,1)); // -Y

  const lines = ['# 健康立方体：盒式展开，6 个 UV 岛，密度均匀', ...v];
  for (let i = 0; i < vt.length; i += 2) lines.push(`vt ${vt[i]} ${vt[i+1]}`);
  lines.push(...f);
  return parseOBJ(lines.join('\n'), 'cube_healthy.obj');
}

/* 2) 镜像岛：左右两翼在 UV 中镜像重叠，右翼翻转；脊线为共享边接缝 */
function sampleMirror(): Mesh {
  // 左翼 y=0：1(-1,0,0) 2(0,0,-1) 3(0,0,1)，3D 法线朝 -Y
  // 右翼略上仰 y=0.2：4(1,.2,0) 5(0,.2,-1) 6(0,.2,1)，面绕序同样取 -Y
  // UV：两翼共用同一区域，右翼把两个脊线 UV 互换 → 镜像 + 翻转，
  // 且共享的两个 UV 点在两翼中并非同一条 UV 边。
  return parseOBJ(`# 镜像岛：右翼 UV 是左翼的镜像，面积重叠且右翼翻转
v -1 0.0 0
v  0 0.0 -1
v  0 0.0 1
v  1 0.2 0
v  0 0.2 -1
v  0 0.2 1
vt 0.1 0.2
vt 0.9 0.1
vt 0.9 0.9
# 左翼：正向
f 1/1 2/2 3/3
# 右翼（3D 绕序与左翼一致朝 -Y，UV 绕序反转 → 镜像翻转）
f 4/1 6/3 5/2
`, 'mirror_islands.obj');
}

/* 3) 共享边接缝：同一平面上的两个面片共一条边，UV 各自成岛且密度不同 */
function sampleSeam(): Mesh {
  // 两面都在 y=0 平面：底面 1x1（左），右半是 1x1 的延续但 UV 缩在窄条，
  // 关键：共享边 (2)-(4) 两侧 3D 共面，但引用不同 vt → 平面接缝 seam。
  return parseOBJ(`# 共享边接缝：左右两片共面、共边 (2)-(4)，UV 不连续且密度不同
v 0 0 0
v 1 0 0
v 0 0 1
v 1 0 1
v 2 0 0
v 2 0 1
vt 0.05 0.1
vt 0.55 0.1
vt 0.55 0.9
vt 0.05 0.9
vt 0.62 0.35
vt 0.92 0.35
vt 0.92 0.65
vt 0.62 0.65
# 左片：满铺大方块
f 1/1 2/2 4/3 3/4
# 右片（共面续接，脊线 2-4）：UV 挤在右侧窄条 → 平面接缝 + 密度异常
f 2/5 5/6 6/7 4/8
`, 'shared_edge_seam.obj');
}

/* 4) 非流形边（三面共一条边）+ 一个 3D 退化面（UV 正常） */
function sampleNonmanifold(): Mesh {
  // 三个三角共享 3D 边 1-2（分别位于 +Z、+Y、-Y 方向），UV 摆成三个不重叠扇区。
  return parseOBJ(`# 非流形：三个三角共享边 (1)-(2)；T4 为 3D 退化面但 UV 正常
v 0 0 0
v 1 0 0
v 0.5 0 1
v 0.5 1 0
v 0.5 -1 0
v 2 0 0
v 2 0 0
v 3 0 0
vt 0.02 0.50
vt 0.30 0.50
vt 0.16 0.90
vt 0.36 0.50
vt 0.64 0.50
vt 0.50 0.90
vt 0.70 0.50
vt 0.98 0.50
vt 0.84 0.90
vt 0.10 0.05
vt 0.30 0.05
vt 0.20 0.18
# 三个共边三角，UV 各自独立扇区，3D 绕序均使边 1->2 在左
f 1/1 2/2 3/3
f 4/4 2/5 1/6
f 1/7 2/8 5/9
# 3D 退化：顶点 6、7 完全同点；UV 是正常小三角 → 仅 3D 退化
f 6/10 7/11 8/12
`, 'nonmanifold_degenerate.obj');
}

/* 5) 混合问题：UV 重叠、拉伸、翻转、UV 退化 */
function sampleMixed(): Mesh {
  return parseOBJ(`# 混合问题场：重叠(A/B) · 拉伸(C) · 翻转(D) · UV退化(E)
v 0 0 0
v 1 0 0
v 1 0 1
v 0 0 1
v 0 1.01 0
v 1 1.01 0
v 1 1.01 1
v 0 1.01 1
v 0.0 2 0.2
v 2.0 2 0.2
v 2.0 2 0.35
v 0.0 2 0.35
v 0.2 3 0
v 0.8 3 0
v 0.5 3 0.9
v 0 3 2
v 1 3 2
v 1 3 2.0000001
vt 0.2 0.2
vt 0.8 0.2
vt 0.8 0.8
vt 0.2 0.8
vt 0.02 0.02
vt 0.18 0.02
vt 0.18 0.06
vt 0.02 0.06
vt 0.25 0.86
vt 0.55 0.86
vt 0.40 0.98
vt 0.05 0.85
vt 0.15 0.85
# A：UV 方块
f 1/1 2/2 3/3 4/4
# B：3D 在上方，UV 与 A 完全相同 → 面积重叠
f 5/1 6/2 7/3 8/4
# C：3D 2x0.15 细条，UV 挤在左下角微小区域 → 严重密度压缩
f 9/5 10/6 11/7 12/8
# D：3D 正向三角，UV 绕序反转 → 翻转（独立区域，不与它岛重叠）
f 13/9 15/11 14/10
# E：3D 正常三角，两个 UV 点重合 → UV 退化（不参与比率）
f 16/12 17/12 18/13
`, 'mixed_issues.obj');
}

/* 6) UV 退化单列：正常几何但全岛 UV 挤成一条线 */
function sampleUvDegenerate(): Mesh {
  return parseOBJ(`# UV 退化：3D 为正常三角，UV 三点共线
v 0 0 0
v 1 0 0
v 0.5 0 1
vt 0.1 0.5
vt 0.9 0.5
vt 0.5 0.5
f 1/1 2/2 3/3
`, 'uv_degenerate.obj');
}

export const SAMPLES: Sample[] = [
  { id: 'cube', label: '健康立方体',
    desc: '盒式展开，6 个岛，密度均匀：作为无问题基线', build: sampleCube },
  { id: 'mirror', label: '镜像岛 + 翻转',
    desc: '两翼 UV 镜像重叠，右翼翻转，脊线是共享边接缝', build: sampleMirror },
  { id: 'seam', label: '共享边接缝',
    desc: '两片面共一条 3D 边但 UV 不连续，密度也不同', build: sampleSeam },
  { id: 'nonmanifold', label: '非流形边 + 3D退化',
    desc: '三面共一条边；另有 3D 退化面（UV 正常，不参与比率）', build: sampleNonmanifold },
  { id: 'mixed', label: '混合问题',
    desc: '重叠 / 拉伸 / 翻转 / UV 退化 集中在一个场景', build: sampleMixed },
  { id: 'uvdegen', label: '纯 UV 退化',
    desc: '正常 3D 三角但 UV 三点共线', build: sampleUvDegenerate },
];
