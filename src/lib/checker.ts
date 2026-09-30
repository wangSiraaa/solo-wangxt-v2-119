import * as THREE from 'three';

/** 生成棋盘格 CanvasTexture，辅助判断拉伸/翻转/密度 */
export function makeCheckerTexture(
  size = 256,
  cells = 8,
  c1 = '#e8e8e8',
  c2 = '#5a6472',
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const step = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? c1 : c2;
      ctx.fillRect(x * step, y * step, step, step);
    }
  }
  // U/V 轴标记：左下角红色三角指 +U，便于直接看出翻转
  ctx.fillStyle = '#d23b3b';
  ctx.beginPath();
  ctx.moveTo(0, size); ctx.lineTo(size / 8, size); ctx.lineTo(0, size - size / 8);
  ctx.closePath(); ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
