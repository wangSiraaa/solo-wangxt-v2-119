import { useRef } from 'react';
import { useApp } from '../state/AppContext';
import { SAMPLES } from '../core/samples';

export function Toolbar() {
  const {
    state, loadObjText, runUnwrap, exportCurrent, saveCurrent,
    projects, openProject, removeProject, setChecker, toggleFlag, undo,
  } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    const text = await file.text();
    loadObjText(text, file.name);
  };

  return (
    <header className="toolbar">
      <div className="brand">低模 UV 检查器</div>

      <button onClick={() => fileRef.current?.click()}>载入 OBJ</button>
      <input
        ref={fileRef}
        type="file"
        accept=".obj,text/plain"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = '';
        }}
      />

      <span className="sep" />

      <div className="dropdown">
        <button>样例 ▾</button>
        <div className="menu">
          {SAMPLES.map((s) => (
            <button
              key={s.id}
              title={s.description}
              onClick={() => loadObjText(s.obj, `${s.id}.obj`)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <button
        className="primary"
        disabled={!state.mesh || state.unwrapping}
        onClick={() => void runUnwrap()}
        title="调用 xatlas WASM 重新展开；失败时自动保留原模型"
      >
        {state.unwrapping ? '展开中…' : 'xatlas 自动展开'}
      </button>
      <button disabled={state.history.length === 0} onClick={undo}>
        撤销 ({state.history.length})
      </button>

      <span className="sep" />

      <label className="chk">
        <input
          type="checkbox"
          checked={state.checkerOn}
          onChange={(e) => setChecker(e.target.checked)}
        />
        棋盘
      </label>
      <select
        value={state.checkerScale}
        onChange={(e) => setChecker(state.checkerOn, Number(e.target.value))}
        title="0..1 UV 内棋盘格数"
      >
        {[4, 8, 16, 32].map((n) => (
          <option key={n} value={n}>{n}×{n}</option>
        ))}
      </select>

      <label className="chk">
        <input
          type="checkbox"
          checked={state.showFlipped}
          onChange={() => toggleFlag('showFlipped')}
        />
        翻转
      </label>
      <label className="chk">
        <input
          type="checkbox"
          checked={state.showOverlap}
          onChange={() => toggleFlag('showOverlap')}
        />
        重叠
      </label>

      <span className="sep" />

      <button disabled={!state.mesh} onClick={exportCurrent}
        title="导出非索引 v/vt OBJ，标准工具可重新载入验证">
        导出 UV OBJ
      </button>
      <button disabled={!state.mesh} onClick={() => void saveCurrent()}>
        存工程
      </button>

      <div className="spacer" />

      <div className="dropdown align-right">
        <button>工程库 ({projects.length}) ▾</button>
        <div className="menu">
          {projects.length === 0 && <div className="menu-empty">IndexedDB 暂无存档</div>}
          {projects.map((p) => (
            <div key={p.id} className="menu-item">
              <button
                className="proj-open"
                title={`${new Date(p.updatedAt).toLocaleString()}\n${p.id}`}
                onClick={() => void openProject(p.id)}
              >
                {p.name}
                <small>{new Date(p.updatedAt).toLocaleString()}</small>
              </button>
              <button className="proj-del" onClick={() => void removeProject(p.id)}>×</button>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}
