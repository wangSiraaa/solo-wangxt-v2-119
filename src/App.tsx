import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Mesh, OverlayMode, Selection } from './types';
import { analyze } from './lib/analysis';
import { parseOBJ, exportOBJ, verifyRoundTrip } from './lib/obj';
import { SAMPLES } from './lib/samples';
import { unwrapWithXAtlas } from './lib/xatlasUnwrap';
import { saveProject, loadProject, clearProject } from './lib/storage';
import View3D from './components/View3D';
import ViewUV from './components/ViewUV';
import StatsPanel from './components/StatsPanel';

interface Toast { kind: 'ok' | 'err' | 'info'; text: string; }

export default function App() {
  const [mesh, setMesh] = useState<Mesh>(() => SAMPLES[0].build());
  const [selection, setSelection] = useState<Selection>(new Set());
  const [overlay, setOverlay] = useState<OverlayMode>('issues');
  const [checker, setChecker] = useState(true);
  const [showEdges, setShowEdges] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState<{ msg: string; pct: number } | null>(null);
  const [autosave, setAutosave] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number>(0);

  const analysis = useMemo(() => analyze(mesh), [mesh]);

  const showToast = useCallback((kind: Toast['kind'], text: string) => {
    setToast({ kind, text });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  // 启动：尝试从 IndexedDB 恢复工程
  useEffect(() => {
    loadProject().then(m => {
      if (m) { setMesh(m); showToast('ok', `已从本地 IndexedDB 恢复工程：${m.name}`); }
    }).catch(() => { /* 隐私模式等：忽略 */ });
  }, [showToast]);

  // 自动保存（防抖）
  useEffect(() => {
    if (!autosave) return;
    const h = window.setTimeout(() => {
      saveProject(mesh).catch(() => setAutosave(false));
    }, 700);
    return () => window.clearTimeout(h);
  }, [mesh, autosave]);

  // 选择同步：两个视图共用同一个 selection
  const handlePick = useCallback((faceIds: number[], additive: boolean) => {
    setSelection(prev => {
      if (faceIds.length === 0) return additive ? prev : new Set();
      const next = additive ? new Set(prev) : new Set<number>();
      const fid = faceIds[0];
      if (additive && next.has(fid)) next.delete(fid);
      else next.add(fid);
      return next;
    });
  }, []);

  const loadMesh = useCallback((m: Mesh, msg?: string) => {
    setMesh(m);
    setSelection(new Set());
    if (msg) showToast('ok', msg);
  }, [showToast]);

  const openFiles = useCallback((files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    file.text().then(text => {
      try {
        const m = parseOBJ(text, file.name);
        loadMesh(m, `已载入 ${file.name}：${m.faces.length} 面，${m.positions.length/3} 顶点，${m.uvs.length/2} UV`);
      } catch (e) {
        showToast('err', (e as Error).message);
      }
    });
  }, [loadMesh, showToast]);

  // 自动展开：失败保留原模型（mesh 状态不变）
  const runUnwrap = useCallback(async () => {
    if (busy) return;
    setBusy({ msg: '准备…', pct: 0 });
    const r = await unwrapWithXAtlas(mesh, (msg, pct) => setBusy({ msg, pct }));
    setBusy(null);
    if (r.ok && r.uvs) {
      // 展开结果按「面角点」独立编号：重写每个 corner.uv
      const next: Mesh = {
        ...mesh,
        uvs: r.uvs,
        faces: mesh.faces.map((f, fi) => {
          let offset = 0;
          for (let k = 0; k < fi; k++) offset += mesh.faces[k].corners.length;
          return { corners: f.corners.map((c, ci) => ({ vertex: c.vertex, uv: offset + ci })) };
        }),
      };
      loadMesh(next, r.message);
    } else {
      showToast('err', r.message);
    }
  }, [mesh, busy, loadMesh, showToast]);

  // 镜像选中面所属的 UV 岛（围绕其包围盒中心做 U 翻转）
  const mirrorIslands = useCallback(() => {
    if (selection.size === 0) { showToast('info', '请先选中要镜像的岛（点选其中任意面）'); return; }
    const islandIds = new Set(
      analysis.tris.filter(t => selection.has(t.face) && t.island >= 0).map(t => t.island));
    if (islandIds.size === 0) { showToast('info', '选中面没有有效 UV 岛'); return; }

    // 收集这些岛用到的 uvId
    const uvIds = new Set<number>();
    analysis.tris.forEach(t => {
      if (!islandIds.has(t.island)) return;
      const c = mesh.faces[t.face].corners;
      for (const ci of [t.a, t.b, t.c]) if (c[ci].uv >= 0) uvIds.add(c[ci].uv);
    });
    let minU = Infinity, maxU = -Infinity;
    uvIds.forEach(id => { minU = Math.min(minU, mesh.uvs[id*2]); maxU = Math.max(maxU, mesh.uvs[id*2]); });
    const center = (minU + maxU) / 2;

    const uvs = new Float32Array(mesh.uvs);
    uvIds.forEach(id => { uvs[id*2] = 2*center - uvs[id*2]; });
    loadMesh({ ...mesh, uvs }, `已沿 U 轴镜像 ${islandIds.size} 个 UV 岛（注意翻转/重叠检测）`);
  }, [analysis, mesh, selection, loadMesh, showToast]);

  const doExport = useCallback(() => {
    const blob = new Blob([exportOBJ(mesh)], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = mesh.name.replace(/\.obj$/i, '') + '_uv.obj';
    a.click();
    URL.revokeObjectURL(a.href);
    const v = verifyRoundTrip(mesh);
    showToast(v.ok ? 'ok' : 'err', '已导出 OBJ。' + v.detail);
  }, [mesh, showToast]);

  const checkRoundTrip = useCallback(() => {
    showToast(verifyRoundTrip(mesh).ok ? 'ok' : 'err', verifyRoundTrip(mesh).detail);
  }, [mesh, showToast]);

  return (
    <div className="app" onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); openFiles(e.dataTransfer.files); }}>
      <header className="topbar">
        <div className="brand">▦ 低模 UV 检查台</div>
        <select title="内置样例" defaultValue="" onChange={e => {
          const s = SAMPLES.find(x => x.id === e.target.value);
          if (s) loadMesh(s.build(), `${s.label}：${s.desc}`);
          e.target.value = '';
        }}>
          <option value="">载入样例…</option>
          {SAMPLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button onClick={() => fileRef.current?.click()}>导入 OBJ</button>
        <input ref={fileRef} type="file" accept=".obj,.txt" hidden
          onChange={e => { openFiles(e.target.files); e.target.value = ''; }} />
        <button className="primary" onClick={runUnwrap} disabled={!!busy}>
          {busy ? `${busy.msg} ${busy.pct}%` : '⚡ xatlas 自动展开'}
        </button>
        <button onClick={mirrorIslands}>镜像选中岛 (U)</button>
        <span className="sep" />
        <label className="chk"><input type="checkbox" checked={checker}
          onChange={e => setChecker(e.target.checked)} />棋盘纹理</label>
        <label className="chk"><input type="checkbox" checked={showEdges}
          onChange={e => setShowEdges(e.target.checked)} />特征边</label>
        <span className="sep" />
        <div className="seg">
          {(['issues','area','angle','none'] as OverlayMode[]).map(m => (
            <button key={m} className={overlay === m ? 'on' : ''}
              onClick={() => setOverlay(m)}>
              {m === 'issues' ? '问题' : m === 'area' ? '面积畸变' : m === 'angle' ? '角度畸变' : '无叠加'}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button onClick={checkRoundTrip}>回环校验</button>
        <button onClick={doExport}>导出 OBJ</button>
        <label className="chk" title="把工程自动写入 IndexedDB">
          <input type="checkbox" checked={autosave}
            onChange={e => setAutosave(e.target.checked)} />自动保存
        </label>
        <button title="清除本地工程" onClick={() => {
          clearProject().then(() => showToast('info', '已清除本地 IndexedDB 工程'));
        }}>清除存档</button>
      </header>

      <div className="sample-desc">
        <b>{mesh.name}</b> · {mesh.faces.length} 面 / {mesh.positions.length/3} 顶点 / {mesh.uvs.length/2} UV ·
        角点总数 {mesh.faces.reduce((n,f)=>n+f.corners.length,0)}（按角点保留身份，不按空间位置焊接）
      </div>

      <main className="panes">
        <section className="pane">
          <h2>3D 模型</h2>
          <View3D mesh={mesh} analysis={analysis} selection={selection}
            overlay={overlay} checker={checker} showEdges={showEdges} onPick={handlePick} />
        </section>
        <section className="pane">
          <h2>2D UV</h2>
          <ViewUV mesh={mesh} analysis={analysis} selection={selection}
            overlay={overlay} checker={checker} onPick={handlePick} />
        </section>
        <aside className="pane side">
          <StatsPanel analysis={analysis} selection={selection} />
        </aside>
      </main>

      {toast && <div className={'toast ' + toast.kind}>{toast.text}</div>}
      {busy && <div className="busybar"><div style={{ width: busy.pct + '%' }} /></div>}
    </div>
  );
}
