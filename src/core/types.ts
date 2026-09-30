/**
 * 核心数据模型。
 *
 * 设计要点（对应需求）：
 * - 顶点身份是 OBJ 顶点（v），角点（corner）才携带 UV/法线索引。
 * - 接缝两侧的角点引用同一个顶点身份，但可以有不同 UV —— 因此永远不按
 *   空间位置合并顶点，渲染几何采用非索引展开。
 * - 多边形面以扇形三角化，每个三角形记住它来自哪一个原始面（faceId），
 *   从而“选中面”在三视图里都能稳定同步。
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

/** 角点：一个面环上的一个顶点引用。 */
export interface Corner {
  /** OBJ v 索引（0 起），稳定顶点身份。 */
  v: number;
  /** OBJ vt 索引（0 起），-1 表示无 UV。 */
  vt: number;
  /** OBJ vn 索引（0 起），-1 表示无法线。 */
  vn: number;
}

/** OBJ 面（支持 n 边形，扇形三角化）。 */
export interface ObjFace {
  /** 稳定面身份，解析顺序决定。 */
  id: number;
  /** 角点在 MeshData.corners 中的下标。 */
  cornerIds: number[];
  /** 所属组/对象名（o / g）。 */
  group: string;
}

/** 扇形三角化后的三角形，归属于一个面。 */
export interface Triangle {
  id: number;
  faceId: number;
  /** 长度 3，角点在 corners 数组中的下标。 */
  corners: [number, number, number];
}

export interface MeshData {
  /** 原始 OBJ 文本（未做任何归一化修改），用于导出与重新载入。 */
  sourceObj: string;
  fileName: string;
  positions: Float64Array; // length = vertexCount * 3
  uvs: Float64Array; // length = uvCount * 2，可能为空
  normals: Float64Array; // length = normalCount * 3，可能为空
  faces: ObjFace[];
  /** 全部角点的扁平存储。 */
  corners: Corner[];
  triangles: Triangle[];
  /** 每个角点对应的三角形下标（corners.length）。 */
  cornerTri: Int32Array;
  vertexCount: number;
  uvCount: number;
  hasUv: boolean;
  /** UV 来源说明。 */
  uvOrigin: 'obj' | 'planar-fallback';
}

/** 每个三角形的分析指标。退化面的比率字段为 null（不参与普通比率）。 */
export interface TriMetrics {
  area3d: number;
  areaUv: number;
  /** 3D 有向面积（两倍）符号，与 UV 有向面积比较判断翻转。 */
  signed3d: number;
  signedUv: number;
  degenerate3d: boolean;
  degenerateUv: boolean;
  flipped: boolean;
  /** 面积畸变：sqrt(a3d / aUvNorm)，已按全局尺度归一。null = 退化。 */
  areaRatio: number | null;
  /** 角度畸变（度）：3D/UV 对应内角最大偏差。null = 退化。 */
  angleDistortion: number | null;
}

export interface EdgeOccurrence {
  /** 邻接三角形 id。 */
  tri: number;
  /** 该侧两端的角点下标（在 MeshData.corners 中）。 */
  ca: number;
  cb: number;
}

export interface EdgeInfo {
  key: string;
  /** 端点的空间等价类 id（同位置重复 v 归为一类）。 */
  a: number;
  b: number;
  /** 每条出现：边界 1 条、流形共享 2 条、非流形 >=3。 */
  occurrences: EdgeOccurrence[];
  boundary: boolean;
  nonManifold: boolean;
  /** 共享边：两侧顶点身份或 UV 不同 => 接缝。 */
  seam: boolean;
}

export interface IslandInfo {
  id: number;
  triIds: number[];
  mirrored: boolean;
  /** 与其他岛重叠的三角形数。 */
  overlapTriCount: number;
}

export interface MeshStats {
  metrics: TriMetrics[];
  edges: EdgeInfo[];
  islands: IslandInfo[];
  /** 三角形 i 是否与任何其他岛重叠。 */
  overlap: Uint8Array;
  /** 全局归一化尺度：median(area3d / areaUv) 的平方根。 */
  globalScale: number;
  bounds3d: { min: Vec3; max: Vec3 };
}

export interface ProjectRecord {
  id: string;
  name: string;
  updatedAt: number;
  objText: string;
  fileName: string;
}
