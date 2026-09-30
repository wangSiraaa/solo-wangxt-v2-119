/**
 * 内置样例 OBJ（受控子集：v / vt / f，三角面或四边面）。
 * 每个样例刻意覆盖一类检查场景；顶点身份显式：接缝通过“坐标重复的
 * 独立 v + 不同 vt”表达，不靠空间焊接。
 */

export interface SampleDef {
  id: string;
  label: string;
  description: string;
  obj: string;
}

const header = (name: string, note: string) => `# ${name}\n# ${note}\n`;

/**
 * 1) 镜像岛
 *    两片三角形在 3D 中朝相反法线方向（折纸），UV 却映射到同一块
 *    正方形，第二片绕序相反（CW）=> 翻转/镜像岛。
 */
const mirrored = `${header('镜像岛样例', '折边两侧映射到同一 UV 区域，第二片 UV 反向')}
v -1 0 0
v  0 0 0
v  0 1 0
v  0 0 0
v  1 0 0
v  0 1 0
vt 0 0
vt 1 0
vt 1 1
f 1/1 2/2 3/3
f 4/1 5/3 6/2
`;

/**
 * 2) 共享边接缝
 *    立方体，每个面使用 4 个独立 v 副本；每面 UV 放在 3 列 2 行的
 *    独立格子里 => 所有共享边两侧 UV 不同，全部是接缝。
 */
function cubeWithSeams(): string {
  const out: string[] = [
    header('共享边接缝样例', '立方体：相邻面顶点独立、每面独占 UV 格子，共享边均为接缝'),
  ];
  const P = (x: number, y: number, z: number): number[] => [x, y, z];
  // 每面 4 角，从面外侧看为逆时针
  const faceDefs: number[][][] = [
    [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1)],
    [P(1, -1, 1), P(-1, -1, 1), P(-1, 1, 1), P(1, 1, 1)],
    [P(1, -1, -1), P(1, -1, 1), P(1, 1, 1), P(1, 1, -1)],
    [P(-1, -1, 1), P(-1, -1, -1), P(-1, 1, -1), P(-1, 1, 1)],
    [P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1)],
    [P(-1, -1, 1), P(1, -1, 1), P(1, -1, -1), P(-1, -1, -1)],
  ];
  for (const fd of faceDefs) {
    for (const [x, y, z] of fd) {
      out.push(`v ${x * 0.5} ${y * 0.5} ${z * 0.5}`);
    }
  }
  const cells: Array<[number, number]> = [
    [0, 0], [2, 0], [4, 0], [0, 2], [2, 2], [4, 2],
  ];
  for (const [ox, oy] of cells) {
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]] as Array<[number, number]>) {
      out.push(`vt ${ox + u} ${oy + v}`);
    }
  }
  faceDefs.forEach((_, fi) => {
    const b = fi * 4 + 1;
    const tb = fi * 4 + 1;
    out.push(`f ${b}/${tb} ${b + 1}/${tb + 1} ${b + 2}/${tb + 2}`);
    out.push(`f ${b}/${tb} ${b + 2}/${tb + 2} ${b + 3}/${tb + 3}`);
  });
  return out.join('\n') + '\n';
}

/**
 * 3) 非流形边
 *    三片三角形共享同一条 3D 边（鳍片），该边邻接 3 个三角形。
 */
const nonManifold = `${header('非流形边样例', '三个三角形共享同一条 3D 边（鳍片结构）')}
v -1 0 0
v  1 0 0
v  0 0 -1
v  0 1 0
v  0 -1 0
vt 0 0
vt 1 0
vt 0.5 1
vt 2 0
vt 3 0
vt 2.5 1
vt 4 0
vt 5 0
vt 4.5 1
f 1/1 2/2 3/3
f 1/4 2/5 4/6
f 1/7 2/8 5/9
`;

/**
 * 4) 退化 / 拉伸 / 重叠混合
 *    A：正常面；B：3D 退化面（共线，不计比率）；
 *    C：UV 被极端纵向压缩 => 强面积/角度畸变；
 *    D：独立面，UV 与 A 完全重叠 => 岛间重叠。
 */
const degenerate = `${header('退化/拉伸/重叠混合样例', 'A 正常, B 3D退化(共线), C UV拉伸, D 与 A 岛间重叠')}
v 0 0 0
v 1 0 0
v 1 1 0
v 0 0 0
v 0.5 0 0
v 1 0 0
v 2 0 0
v 3 0 0
v 3 1 0
v 0 -1 0
v 1 -1 0
v 1 0 0
vt 0 0
vt 1 0
vt 1 1
vt 2 0
vt 2.5 0
vt 3 0
vt 0 0
vt 1 0
vt 1 0.02
f 1/1 2/2 3/3
f 4/4 5/5 6/6
f 7/7 8/8 9/9
f 10/1 11/2 12/3
`;

export const SAMPLES: SampleDef[] = [
  { id: 'mirrored', label: '镜像岛', description: '折边两侧映射到同一 UV 区域，绕序相反', obj: mirrored },
  { id: 'seams', label: '共享边接缝', description: '立方体：每面顶点独立、UV 各占一格，共享边全为接缝', obj: cubeWithSeams() },
  { id: 'nonmanifold', label: '非流形边', description: '三个三角形共享一条 3D 边', obj: nonManifold },
  { id: 'degenerate', label: '退化/拉伸/重叠', description: '退化面不计比率，另有强拉伸与岛间重叠', obj: degenerate },
];
