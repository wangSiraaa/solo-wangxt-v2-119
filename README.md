# 低模 UV 检查台 · Low-poly UV Inspector

本地运行的低多边形 UV 检查工具：React + TypeScript + Three.js，xatlas 的
WASM 构建做可选自动展开，IndexedDB 存工程，**无后端、无外部上传**。

## 运行

```bash
npm install
npm run dev      # 开发
npm run build    # 类型检查 + 生产构建
npm run preview  # 预览生产包
```

### 浏览器冒烟测试（可选）

```bash
npx playwright install chromium   # 首次
npm run dev                       # 终端 A
BASE_URL=http://localhost:5173/ npm run smoke   # 终端 B
```

## 功能对照

| 需求 | 实现 |
| --- | --- |
| 3D 模型 + 2D UV 双视图 | 左 Three.js 3D（轨道相机/平直着色），右 Canvas2D UV（平移/缩放/1:1） |
| xatlas WASM 可选自动展开 | `xatlas-wasm` 动态 import（按需下载），失败/NaN/越界一律**保留原模型** |
| IndexedDB 存工程，无后端 | 防抖自动保存当前模型到 IndexedDB，启动时恢复，可手动清除 |
| 稳定顶点与面身份的 OBJ 子集 | `positions`/`uvs`/`faces` 均以下标为稳定 ID；支持 `v`/`vt`/`f`、负索引、无 UV |
| 接缝两侧可有不同 UV，不按空间位置合并 | 每个「面·角点」独立携带 `(vertex, uv)`；渲染、分析、xatlas 输入、导出全程不焊接 |
| 选中面两视图同步 | 单一 `selection: Set<faceId>`，点选 / Shift 加选，两视图共用 |
| 棋盘纹理辅助 | 3D 棋盘贴图 + 2D 棋盘底图（带 +U 红标，可直接看出翻转） |
| 面积畸变 | 相对中位 texel 密度比（Jacobian 行列式），独立显示最小/最大/中位 |
| 角度畸变 | Jacobian 奇异值比 σmax/σmin，与面积畸变分列 |
| 退化面不参与普通比率 | 3D 退化 / UV 退化分别标记，NaN 排除出角度与密度统计 |
| 镜像岛样例 | 两翼 UV 镜像面积重叠 + 一翼翻转；「镜像选中岛」按钮可现场制造 |
| 共享边接缝样例 | 两片共面、共边但 UV 不连续；另以二面角区分「硬边接缝（盒展开正常）」 |
| 非流形边样例 | 三个三角形共享同一条 3D 边，紫线标出 |
| 导出可由标准工具重载 | 导出保留每角点 `v/vt`（坐标可重复但身份独立），「回环校验」自解析核对 |

## 判定口径

- **翻转**：UV 有符号面积与 3D 面绕序相反。
- **重叠**：两非邻接三角形在 UV 空间交叠面积超过较小三角形的 5%
  （仅边/角相切不计；同一条 UV 边且对应同一条 3D 边视为剖分邻接）。
- **平面接缝 seam**：两面共边、3D 近似共面（二面角 ≤ 25°）但 UV 位置不连续。
- **硬边接缝 hardseam**：UV 不连续但位于明显折边上，盒展开的正常情况，弱色显示。
- **非流形**：同一条 3D 边被 ≥3 个面共享。
- **面积畸变**：`density = sqrt(|uvArea| / area3d)`，显示 `density / median(density)`。
- **角度畸变**：在 3D 三角形平面建正交基求 UV→3D 的 2×2 Jacobian，
  `σmax/σmin = 1` 为无角度变形。
- **退化**：3D 面积或 UV 面积 ≈ 0，单独标记，不进入任何比率统计。

## xatlas 身份保真策略

向 xatlas 传入**按三角形角点展开**的位置数组（每三角形 3 个独立点，不焊接）。
xatlas 输出的每个顶点带 `xref` 指回输入角点；由输出三角形三个 `xref`
反查唯一的原三角形，再把归一化 UV 写回每个「面·角点」。任一步校验失败
（xref 无法对应、同角点回映不一致、NaN、越界、三角形缺失）都放弃结果、
保留原模型与原 UV。
