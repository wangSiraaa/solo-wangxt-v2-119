import { useEffect, useRef } from 'react';
import type { Mesh, OverlayMode } from '../types';
import { heatColor, type Analysis } from '../lib/analysis';

interface Props {
  mesh: Mesh;
  analysis: Analysis;
  selection: Set<number>;
  overlay: OverlayMode;
  checker: boolean;
  onPick: (faceIds: number[], additive: boolean) => void;
}

interface ViewState {
  scale: number;
  // UV(0,0) 在画布上的像素坐标
  ox: number; oy: number;
  hover: number | null; // 三角形下标
}

const CYAN = '#49d6ff';
const SEAM = '#ffd23b';
const NONMAN = '#b14aed';
const BOUND = '#66ddaa';

export default function ViewUV({ mesh, analysis, selection, overlay, checker, onPick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vs = useRef<ViewState>({ scale: 1, ox: 0, oy: 0, hover: null });
  const live = useRef({ onPick, selection, overlay, checker });
  live.current = { onPick, selection, overlay, checker };
  // 拖拽平移
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const down = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // 初次/模型变化时适配视图
  useEffect(() => {
    fitView(canvasRef.current!, vs.current, mesh);
  }, [mesh]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;

    const toUV = (clientX: number, clientY: number) => {
      const r = canvas.getBoundingClientRect();
      const x = clientX - r.left, y = clientY - r.top;
      const v = vs.current;
      return { u: (x - v.ox) / v.scale, v: (y - v.oy) / v.scale, x, y };
    };

    const draw = () => drawUV(ctx, canvas.getBoundingClientRect(), mesh, analysis,
      vs.current, live.current.selection, live.current.overlay, live.current.checker);

    const resize = () => {
      const dpr = Math.min(devicePixelRatio, 2);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

    const onMove = (e: PointerEvent) => {
      if (drag.current) {
        const d = drag.current;
        vs.current.ox = d.ox + (e.clientX - d.x);
        vs.current.oy = d.oy + (e.clientY - d.y);
        schedule();
        return;
      }
      const p = toUV(e.clientX, e.clientY);
      vs.current.hover = pickTri(mesh, analysis, p.u, p.v);
      canvas.style.cursor = vs.current.hover !== null ? 'pointer' : 'crosshair';
      schedule();
    };
    const onDown = (e: PointerEvent) => {
      down.current = { x: e.clientX, y: e.clientY };
      drag.current = { x: e.clientX, y: e.clientY, ox: vs.current.ox, oy: vs.current.oy };
      canvas.setPointerCapture(e.pointerId);
    };
    const onUp = (e: PointerEvent) => {
      const moved = Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y);
      drag.current = null;
      if (moved > 4) return;
      const p = toUV(e.clientX, e.clientY);
      const triIdx = pickTri(mesh, analysis, p.u, p.v);
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      live.current.onPick(triIdx !== null ? [analysis.tris[triIdx].face] : [], additive);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const v = vs.current;
      const before = { u: (mx - v.ox) / v.scale, v: (my - v.oy) / v.scale };
      v.scale *= e.deltaY < 0 ? 1.12 : 1 / 1.12;
      v.scale = Math.max(10, Math.min(4000, v.scale));
      v.ox = mx - before.u * v.scale;
      v.oy = my - before.v * v.scale;
      schedule();
    };

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [mesh, analysis]);

  // 选择/叠加变化仅需重绘
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    drawUV(ctx, canvas.getBoundingClientRect(), mesh, analysis,
      vs.current, selection, overlay, checker);
  }, [selection, overlay, checker, mesh, analysis]);

  return (
    <div className="viewuv-wrap">
      <canvas ref={canvasRef} className="viewuv" />
      <div className="uv-hud">
        <button title="适配视图" onClick={() => {
          fitView(canvasRef.current!, vs.current, mesh);
          const c = canvasRef.current!;
          drawUV(c.getContext('2d')!, c.getBoundingClientRect(), mesh, analysis,
            vs.current, live.current.selection, live.current.overlay, live.current.checker);
        }}>⛶ 适配</button>
        <button title="实际尺寸 (1 UV = 画布宽)" onClick={() => {
          const c = canvasRef.current!;
          const r = c.getBoundingClientRect();
          vs.current.scale = r.height * 0.9;
          vs.current.ox = r.width / 2 - vs.current.scale * 0.5;
          vs.current.oy = r.height / 2 - vs.current.scale * 0.5;
          const ctx = c.getContext('2d')!;
          drawUV(ctx, c.getBoundingClientRect(), mesh, analysis,
            vs.current, live.current.selection, live.current.overlay, live.current.checker);
        }}>1:1</button>
      </div>
    </div>
  );
}

/* ---------------- 绘制 ---------------- */

function drawUV(
  ctx: CanvasRenderingContext2D, rect: DOMRect,
  mesh: Mesh, a: Analysis, v: ViewState,
  selection: Set<number>, overlay: OverlayMode, checker: boolean,
) {
  const W = rect.width, H = rect.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#14171c';
  ctx.fillRect(0, 0, W, H);

  // 0..1 UV 方块背景
  const x0 = v.ox, y0 = v.oy, s = v.scale;
  if (checker) drawChecker(ctx, x0, y0, s);
  else {
    ctx.fillStyle = '#1d2128';
    ctx.fillRect(x0, y0, s, s);
  }
  // 边框
  ctx.strokeStyle = '#4a5566';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x0, y0, s, s);
  // 0.5 参考线
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0 + s*0.5, y0); ctx.lineTo(x0 + s*0.5, y0 + s);
  ctx.moveTo(x0, y0 + s*0.5); ctx.lineTo(x0 + s, y0 + s*0.5);
  ctx.stroke();

  // 三角形填充
  for (let i = 0; i < a.tris.length; i++) {
    const t = a.tris[i];
    const pts = triPixels(mesh, t, v);
    if (!pts) continue;
    const fill = triFill(t, overlay, selection.has(t.face), i === v.hover);
    if (fill) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      ctx.lineTo(pts[1][0], pts[1][1]);
      ctx.lineTo(pts[2][0], pts[2][1]);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
  }

  // 边：按 3D 边分类着色（seam / nonmanifold / boundary）
  // 用「面·角点」枚举，映射到 uvId 对，粗线画标记边
  ctx.lineWidth = 2;
  const drawn = new Set<string>();
  mesh.faces.forEach((f) => {
    f.corners.forEach((c, ci) => {
      const d = f.corners[(ci + 1) % f.corners.length];
      if (c.vertex < 0 || d.vertex < 0 || c.uv < 0 || d.uv < 0) return;
      const va = Math.min(c.vertex, d.vertex), vb = Math.max(c.vertex, d.vertex);
      const key = va + '_' + vb + '_' + Math.min(c.uv,d.uv) + '_' + Math.max(c.uv,d.uv);
      if (drawn.has(key)) return;
      drawn.add(key);
      const edge = a.edgeByKey.get(va + '_' + vb);
      if (!edge || edge.kind === 'interior') return;
      const selected = edge.faces.some(x => selection.has(x));
      let color = edge.kind === 'nonmanifold' ? NONMAN
        : edge.kind === 'seam' ? SEAM
        : edge.kind === 'hardseam' ? '#4a6a8a'
        : edge.kind === 'boundary' ? BOUND : '#39404b';
      if (selected) color = CYAN;
      ctx.strokeStyle = color;
      ctx.lineWidth = edge.kind === 'nonmanifold' ? 3.5
        : edge.kind === 'hardseam' ? 1.4 : 2.5;
      const p1 = uvToPx(mesh.uvs[c.uv*2], mesh.uvs[c.uv*2+1], v);
      const p2 = uvToPx(mesh.uvs[d.uv*2], mesh.uvs[d.uv*2+1], v);
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
    });
  });

  // 选中面的三角形轮廓 + 普通细边
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  for (let i = 0; i < a.tris.length; i++) {
    const t = a.tris[i];
    const pts = triPixels(mesh, t, v);
    if (!pts) continue;
    if (selection.has(t.face)) continue; // 选中稍后画
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    ctx.lineTo(pts[1][0], pts[1][1]);
    ctx.lineTo(pts[2][0], pts[2][1]);
    ctx.closePath();
    ctx.stroke();
  }
  if (selection.size) {
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 2;
    for (let i = 0; i < a.tris.length; i++) {
      const t = a.tris[i];
      if (!selection.has(t.face)) continue;
      const pts = triPixels(mesh, t, v);
      if (!pts) continue;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      ctx.lineTo(pts[1][0], pts[1][1]);
      ctx.lineTo(pts[2][0], pts[2][1]);
      ctx.closePath();
      ctx.stroke();
    }
  }

  // 岛编号
  ctx.font = 'bold 12px system-ui';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  const islandCenters = new Map<number, { n: number; u: number; w: number }>();
  for (const t of a.tris) {
    if (t.island < 0) continue;
    const c = triCenterUV(mesh, t);
    const cur = islandCenters.get(t.island) ?? { n: 0, u: 0, w: 0 };
    cur.n++; cur.u += c[0]; cur.w += c[1];
    islandCenters.set(t.island, cur);
  }
  islandCenters.forEach((c, id) => {
    const p = uvToPx(c.u / c.n, c.w / c.n, v);
    if (p[0] < 0 || p[1] < 0 || p[0] > W || p[1] > H) return;
    ctx.fillStyle = 'rgba(12,14,18,0.7)';
    ctx.beginPath(); ctx.arc(p[0], p[1], 9, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#dfe7f2';
    ctx.fillText(String(id), p[0], p[1] + 4);
  });
}

function drawChecker(ctx: CanvasRenderingContext2D, x0: number, y0: number, s: number) {
  // 8x8 棋盘，仅在 0..1 方块内
  const n = 8, step = s / n;
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, s, s); ctx.clip();
  ctx.fillStyle = '#232730';
  ctx.fillRect(x0, y0, s, s);
  // 世界坐标计算瓦片，保证缩放平移时棋盘贴合 UV
  const uStart = Math.floor((-x0) / step) - 1;
  const uEnd = Math.ceil((ctx.canvas.width - x0) / step) + 1;
  const vStart = Math.floor((-y0) / step) - 1;
  const vEnd = Math.ceil((ctx.canvas.height - y0) / step) + 1;
  for (let i = uStart; i < uEnd; i++) for (let j = vStart; j < vEnd; j++) {
    // 画布行 j 向下增长，UV 的 v 向上：第 j 行对应 v 单元 (n-1-j)
    const parity = (i + (n - 1 - j)) & 1;
    ctx.fillStyle = parity === 0 ? '#3c4350' : '#232730';
    ctx.fillRect(x0 + i*step, y0 + j*step, step + 0.6, step + 0.6);
  }
  ctx.restore();
}

function uvToPx(u: number, w: number, v: ViewState): [number, number] {
  return [v.ox + u * v.scale, v.oy + (1 - w) * v.scale];
}

function triPixels(mesh: Mesh, t: Analysis['tris'][number], v: ViewState): [number,number][] | null {
  const c = mesh.faces[t.face].corners;
  const out: [number, number][] = [];
  for (const ci of [t.a, t.b, t.c]) {
    const ui = c[ci].uv;
    if (ui < 0) return null;
    out.push(uvToPx(mesh.uvs[ui*2], mesh.uvs[ui*2+1], v));
  }
  return out;
}

function triCenterUV(mesh: Mesh, t: Analysis['tris'][number]): [number, number] {
  const c = mesh.faces[t.face].corners;
  let u = 0, w = 0;
  for (const ci of [t.a, t.b, t.c]) {
    const ui = c[ci].uv;
    if (ui >= 0) { u += mesh.uvs[ui*2]; w += mesh.uvs[ui*2+1]; }
  }
  return [u/3, w/3];
}

function cssRGB(rgb: [number, number, number], alpha: number) {
  return `rgba(${rgb.map(x => Math.round(x*255)).join(',')},${alpha})`;
}

function triFill(
  t: Analysis['tris'][number], overlay: OverlayMode,
  selected: boolean, hover: boolean,
): string | null {
  let rgb: [number, number, number] | null = null;
  let alpha = 0.85;
  if (overlay === 'issues') {
    if (t.flags.has('degenerate3d')) rgb = [0.616,0.306,0.929];
    else if (t.flags.has('degenerateUv')) rgb = [0.553,0.431,0.388];
    else if (t.flags.has('flipped')) rgb = [1,0.329,0.439];
    else if (t.flags.has('overlap')) rgb = [1,0.655,0.149];
    else if (t.flags.has('badDensity')) rgb = [0.902,0.29,0.098];
    else rgb = [0.44,0.49,0.57];
  } else if (overlay === 'area' && isFinite(t.densityRatio)) {
    rgb = heatColor((Math.log2(t.densityRatio) + 1) / 2);
  } else if (overlay === 'angle' && isFinite(t.angleDistortion)) {
    rgb = heatColor(Math.log2(t.angleDistortion) / 2);
  } else {
    rgb = t.flags.has('degenerate3d') ? [0.36,0.27,0.44]
      : t.flags.has('degenerateUv') ? [0.33,0.27,0.25]
      : [0.52,0.59,0.7];
    alpha = 0.5;
  }
  if (!rgb) return null;
  if (hover) alpha = Math.min(1, alpha + 0.15);
  if (selected) return cssRGB([0.286,0.839,1], 0.95);
  return cssRGB(rgb, alpha);
}

/* ---------------- 拾取 ---------------- */

function pickTri(mesh: Mesh, a: Analysis, u: number, w: number): number | null {
  // 从后往前（后画的在上），简化为逆序遍历；退化为点/线的跳过
  for (let i = a.tris.length - 1; i >= 0; i--) {
    const t = a.tris[i];
    if (t.flags.has('degenerateUv')) continue;
    const c = mesh.faces[t.face].corners;
    const p: [number, number][] = [];
    let ok = true;
    for (const ci of [t.a, t.b, t.c]) {
      const ui = c[ci].uv;
      if (ui < 0) { ok = false; break; }
      p.push([mesh.uvs[ui*2], mesh.uvs[ui*2+1]]);
    }
    if (ok && pointInTri(u, w, p)) return i;
  }
  return null;
}

function pointInTri(x: number, y: number, p: [number,number][]): boolean {
  const d1 = (x-p[0][0])*(p[1][1]-p[0][1]) - (p[1][0]-p[0][0])*(y-p[0][1]);
  const d2 = (x-p[1][0])*(p[2][1]-p[1][1]) - (p[2][0]-p[1][0])*(y-p[1][1]);
  const d3 = (x-p[2][0])*(p[0][1]-p[2][1]) - (p[0][0]-p[2][0])*(y-p[2][1]);
  const hasNeg = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
  const hasPos = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
  return !(hasNeg && hasPos);
}

function fitView(canvas: HTMLCanvasElement, v: ViewState, mesh: Mesh) {
  let minU = Infinity, minW = Infinity, maxU = -Infinity, maxW = -Infinity;
  for (let i = 0; i < mesh.uvs.length / 2; i++) {
    minU = Math.min(minU, mesh.uvs[i*2]); maxU = Math.max(maxU, mesh.uvs[i*2]);
    minW = Math.min(minW, mesh.uvs[i*2+1]); maxW = Math.max(maxW, mesh.uvs[i*2+1]);
  }
  if (!isFinite(minU)) { minU=0; minW=0; maxU=1; maxW=1; }
  const rect = canvas.getBoundingClientRect();
  const pad = 40;
  const sw = Math.max(rect.width - pad*2, 50), sh = Math.max(rect.height - pad*2, 50);
  const du = Math.max(maxU-minU, 1e-6), dw = Math.max(maxW-minW, 1e-6);
  v.scale = Math.min(sw / du, sh / dw);
  const cx = (minU+maxU)/2, cy = (minW+maxW)/2;
  v.ox = rect.width/2 - cx*v.scale;
  // V 翻转：screenY = oy + (1-w)*scale；令中心 cy 落在画布垂直中点
  v.oy = rect.height/2 - (1-cy)*v.scale;
}
