/**
 * 核心数据模型。
 *
 * 关键约束（需求）：OBJ 的每个「面·角点」(corner) 都是独立身份，
 * 即使两个角点的空间位置完全相同（接缝两侧、镜像岛），它们仍可携带
 * 不同的 UV，绝不按空间位置合并顶点。
 *
 * - positions 的下标 = 稳定顶点身份（OBJ `v` 行序，从 0 开始）
 * - faces 的下标 = 稳定面身份（OBJ `f` 行序）
 * - 面用扇面三角化，三角形 (faceIndex, 0..triCount-1) 也是稳定身份
 */

export interface FaceCorner {
  /** 指向 positions 的稳定顶点 ID（OBJ `f v`） */
  vertex: number;
  /** 指向 uvs 的稳定 UV  ID（OBJ `f vt`）；-1 表示该角点无 UV */
  uv: number;
}

export interface Face {
  /** 角点（CCW 序），长度 >= 3 */
  corners: FaceCorner[];
}

export interface Mesh {
  /** 稳定顶点位置，flat [x,y,z, ...] */
  positions: Float32Array;
  /** 稳定 UV 坐标，flat [u,v, ...] */
  uvs: Float32Array;
  /** 稳定面列表 */
  faces: Face[];
  /** 源文件名 */
  name: string;
}

/** 选择集：面 ID -> true */
export type Selection = Set<number>;

export type OverlayMode = 'none' | 'area' | 'angle' | 'issues';

export interface ProjectDoc {
  version: 1;
  savedAt: number;
  mesh: {
    name: string;
    positions: Float32Array;
    uvs: Float32Array;
    faces: { corners: { vertex: number; uv: number }[] }[];
  };
}
