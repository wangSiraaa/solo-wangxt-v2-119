import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const errors = [];
const exe = execSync('ls /home/node/.cache/ms-playwright/chromium-*/chrome-linux-*/chrome',
  { encoding: 'utf8' }).trim().split('\n')[0];
process.env.LD_LIBRARY_PATH =
  execSync("find /tmp/chromelibs/root -name '*.so*' -type f -printf '%h\\n' | sort -u | tr '\\n' ':'",
    { encoding: 'utf8' }) + (process.env.LD_LIBRARY_PATH ?? '');
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on('console', msg => {
  if (msg.type() === 'error' && !msg.text().includes('favicon')) errors.push('CONSOLE ERROR: ' + msg.text());
});
page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message));

const BASE = process.env.BASE_URL || 'http://localhost:5173/';
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

console.log('canvas count:', await page.locator('canvas').count());

// WebGL 画布应有非空模型像素
const glPixels = await page.evaluate(() => {
  const c = document.querySelector('.view3d canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const samples = [];
  for (const [fx, fy] of [[.5,.5],[.4,.45],[.6,.55],[.45,.6],[.55,.4],[.5,.65],[.35,.5]]) {
    const px = new Uint8Array(4);
    gl.readPixels((c.width*fx)|0, (c.height*fy)|0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    samples.push(Array.from(px).join(','));
  }
  return {
    nonEmpty: samples.some(s => s !== '0,0,0,0' && s !== '27,30,36,255'),
    distinct: [...new Set(samples)].slice(0, 5),
  };
});
console.log('3d pixels:', JSON.stringify(glPixels));

const uvNonEmpty = await page.evaluate(() => {
  const c = document.querySelector('.viewuv');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4)
    if (!(d[i]===0x14 && d[i+1]===0x17 && d[i+2]===0x1c)) n++;
  return n;
});
console.log('uv non-background pixels:', uvNonEmpty);

async function selectSample(id) {
  await page.selectOption('header select', id);
  await page.waitForTimeout(350);
}
async function metric(label) {
  return page.evaluate((label) => {
    const card = [...document.querySelectorAll('.metric')]
      .find(c => c.querySelector('.m-label')?.textContent.includes(label));
    return card ? card.textContent.replace(/\s+/g, ' ').trim() : `(${label} not found)`;
  }, label);
}
async function selectedHeader() {
  return page.evaluate(() =>
    [...document.querySelectorAll('.stats h3')].map(h=>h.textContent).find(t=>t.includes('选中面')) ?? null);
}

await selectSample('cube');
console.log('[cube]', await metric('UV 岛'), '|', await metric('硬边接缝'), '|', await metric('翻转三角'));
await selectSample('mirror');
console.log('[mirror]', await metric('翻转三角'), '|', await metric('重叠三角'));
await selectSample('seam');
console.log('[seam]', await metric('平面接缝边'), '|', await metric('非流形边'));
await selectSample('nonmanifold');
console.log('[nonmanifold]', await metric('非流形边'), '|', await metric('3D 退化面'));
await selectSample('mixed');
console.log('[mixed]', await metric('翻转三角'), '|', await metric('重叠三角'),
  '|', await metric('3D 退化面'), '|', await metric('UV 退化面'));

// 选择同步：网格扫描点选 UV 三角
await selectSample('cube');
const uvBox = await page.locator('.viewuv').boundingBox();
let pickedAt = null;
for (let gy = 1; gy <= 9 && !pickedAt; gy++)
  for (let gx = 1; gx <= 9 && !pickedAt; gx++) {
    await page.mouse.click(uvBox.x + uvBox.width*gx/10, uvBox.y + uvBox.height*gy/10);
    await page.waitForTimeout(90);
    const h = await selectedHeader();
    if (h && !h.includes('（0）')) { pickedAt = [gx/10, gy/10]; console.log('[pick uv]', h, '@', pickedAt); }
  }
if (!pickedAt) console.log('[pick uv] FAILED');
else {
  console.log('[sync] 选中详情行数:', await page.locator('.selrow').count());
  // Shift 加选
  await page.keyboard.down('Shift');
  let added = false;
  for (let gy = 9; gy >= 1 && !added; gy--)
    for (let gx = 9; gx >= 1 && !added; gx--) {
      if (Math.abs(gx/10 - pickedAt[0]) < 0.11 && Math.abs(gy/10 - pickedAt[1]) < 0.11) continue;
      await page.mouse.click(uvBox.x + uvBox.width*gx/10, uvBox.y + uvBox.height*gy/10);
      await page.waitForTimeout(90);
      const h = await selectedHeader();
      if (h && h.includes('2')) { console.log('[shift-add]', h); added = true; }
    }
  await page.keyboard.up('Shift');
  if (!added) console.log('[shift-add] (same face / none)');
  // 点空白取消
  await page.mouse.click(uvBox.x + 6, uvBox.y + 6);
  await page.waitForTimeout(100);
  const h = await selectedHeader();
  console.log('[deselect]', h);
}

// xatlas 自动展开（真实 WASM）
await selectSample('mirror');
await page.click('button:has-text("自动展开")');
await page.waitForFunction(() => {
  const t = document.querySelector('.toast');
  return t && (t.textContent.includes('展开成功') || t.textContent.includes('保留原模型'));
}, { timeout: 60000 });
console.log('[xatlas]', await page.locator('.toast').innerText());
await page.waitForTimeout(500);
const postFlip = await metric('翻转三角');
const postOverlap = await metric('重叠三角');
const postIsland = await metric('UV 岛');
console.log('[xatlas post]', postFlip, '|', postOverlap, '|', postIsland);
if (!postOverlap.startsWith('重叠三角0')) throw new Error('展开后重叠应消除');
if (!postIsland.startsWith('UV 岛2')) throw new Error('应展开为 2 个独立岛');

// 失败保留：导入超大坐标 OBJ，展开应失败且保留原模型（面数/岛不变）
await page.selectOption('header select', 'cube'); await page.waitForTimeout(200);
await page.setInputFiles('header input[type=file]', '/tmp/huge.obj');
await page.waitForTimeout(400);
const beforeName = await page.locator('.sample-desc b').innerText();
await page.click('button:has-text("自动展开")');
await page.waitForFunction(() => {
  const t = document.querySelector('.toast');
  return t && (t.textContent.includes('NaN') || t.textContent.includes('保留原模型') || t.textContent.includes('展开成功'));
}, { timeout: 60000 });
const failToast = await page.locator('.toast').innerText();
await page.waitForTimeout(300);
const afterName = await page.locator('.sample-desc b').innerText();
console.log('[xatlas fail] toast:', failToast);
console.log('[xatlas fail] 模型保留:', beforeName === afterName ? 'yes (huge.obj 未被替换)' : 'NO');
if (!failToast.includes('保留原模型')) throw new Error('超大坐标应失败并保留原模型');
if (beforeName !== afterName) throw new Error('失败后不应替换模型');

// IndexedDB（切回立方体，便于断言稳定存档名）
await page.selectOption('header select', 'cube'); await page.waitForTimeout(400);
await page.waitForTimeout(900);
const stored = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('uv-inspector'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return new Promise((res, rej) => {
    const tx = db.transaction('projects').objectStore('projects').get('current');
    tx.onsuccess = () => res(tx.result?.mesh?.name ?? null);
    tx.onerror = () => rej(tx.error);
  });
});
console.log('[indexeddb] stored:', stored);

// 导出 OBJ 下载并回环
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 5000 }),
  page.click('button:has-text("导出 OBJ")'),
]);
const content = fs.readFileSync(await download.path(), 'utf8');
console.log('[export] lines:', content.split('\n').length,
  'v:', /^v /m.test(content), 'vt:', /^vt /m.test(content), 'f:', /^f /m.test(content));
console.log('[export toast]', await page.locator('.toast').innerText().catch(() => 'no toast'));

console.log('\n=== JS ERRORS ===');
console.log(errors.length ? errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
