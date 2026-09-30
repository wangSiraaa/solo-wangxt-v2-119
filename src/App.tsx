import { useEffect } from 'react';
import { AppProvider, useApp } from './state/AppContext';
import { Toolbar } from './components/Toolbar';
import { View3D } from './components/View3D';
import { View2D } from './components/View2D';
import { StatsPanel } from './components/StatsPanel';
import { SAMPLES } from './core/samples';

function Notice() {
  const { state, notify } = useApp();
  useEffect(() => {
    if (!state.notice) return;
    const t = setTimeout(() => notify(null), state.notice.kind === 'error' ? 6000 : 3500);
    return () => clearTimeout(t);
  }, [state.notice, notify]);
  if (!state.notice) return null;
  return <div className={`notice ${state.notice.kind}`}>{state.notice.text}</div>;
}

function Legend() {
  return (
    <div className="legend">
      <span><i className="sw boundary" /> 边界</span>
      <span><i className="sw seam" /> 共享边接缝</span>
      <span><i className="sw nonmanifold" /> 非流形边</span>
      <span><i className="sw flipped" /> 翻转</span>
      <span><i className="sw overlap" /> 岛间重叠</span>
      <span><i className="sw selected" /> 选中</span>
    </div>
  );
}

function EmptyState() {
  const { loadObjText } = useApp();
  return (
    <div className="empty">
      <h2>本地低模 UV 检查</h2>
      <p>
        载入一个 OBJ 子集（v / vt / vn / f，支持 n 边形与负索引），
        或从样例开始。顶点身份来自 v 行，接缝两侧角点可共享顶点但带不同 UV，
        工具绝不会按空间位置合并顶点。
      </p>
      <div className="sample-grid">
        {SAMPLES.map((s) => (
          <button key={s.id} onClick={() => loadObjText(s.obj, `${s.id}.obj`)}>
            <b>{s.label}</b>
            <small>{s.description}</small>
          </button>
        ))}
      </div>
      <p className="hint">
        xatlas WASM 自动展开为可选项，失败时原模型与原 UV 原样保留；
        工程存于浏览器 IndexedDB，无后端。导出的 OBJ 可在 Blender/Maya 等
        标准工具中重新载入验证。
      </p>
    </div>
  );
}

function Workspace() {
  const { state } = useApp();
  if (!state.mesh) return <EmptyState />;
  return (
    <div className="workspace">
      <div className="views">
        <View3D />
        <View2D />
        <Legend />
      </div>
      <StatsPanel />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <div className="app">
        <Toolbar />
        <Workspace />
        <Notice />
      </div>
    </AppProvider>
  );
}
