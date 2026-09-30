import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import type { ReactNode } from 'react';
import type { MeshData, MeshStats, ProjectRecord } from '../core/types';
import { parseObj } from '../core/parser';
import { analyzeMesh } from '../core/metrics';
import { exportObj } from '../core/exporter';
import { unwrapWithXAtlas } from '../core/unwrapping';
import {
  deleteProject,
  listProjects,
  loadProject,
  makeProjectId,
  saveProject,
} from '../core/storage';

export interface Notice {
  kind: 'info' | 'error' | 'success';
  text: string;
}

export interface AppState {
  mesh: MeshData | null;
  stats: MeshStats | null;
  objText: string;
  fileName: string;
  projectId: string | null;
  selectedFaceIds: Set<number>;
  checkerOn: boolean;
  checkerScale: number;
  showFlipped: boolean;
  showOverlap: boolean;
  unwrapping: boolean;
  notice: Notice | null;
  history: MeshData[];
}

type Action =
  | { type: 'load'; mesh: MeshData; stats: MeshStats; objText: string; fileName: string; projectId: string | null }
  | { type: 'replace-mesh'; mesh: MeshData; stats: MeshStats; notice?: Notice }
  | { type: 'select'; faceIds: Set<number> }
  | { type: 'toggle-face'; faceId: number }
  | { type: 'set-checker'; on: boolean; scale?: number }
  | { type: 'toggle-flag'; key: 'showFlipped' | 'showOverlap' }
  | { type: 'unwrapping'; on: boolean }
  | { type: 'notice'; notice: Notice | null }
  | { type: 'project-id'; id: string | null }
  | { type: 'undo' };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'load':
      return {
        ...state,
        mesh: action.mesh,
        stats: action.stats,
        objText: action.objText,
        fileName: action.fileName,
        projectId: action.projectId,
        selectedFaceIds: new Set(),
        unwrapping: false,
        history: [],
        notice: null,
      };
    case 'replace-mesh':
      return {
        ...state,
        mesh: action.mesh,
        stats: action.stats,
        history: state.mesh ? [...state.history, state.mesh].slice(-10) : state.history,
        notice: action.notice ?? state.notice,
      };
    case 'select':
      return { ...state, selectedFaceIds: action.faceIds };
    case 'toggle-face': {
      const next = new Set(state.selectedFaceIds);
      if (next.has(action.faceId)) next.delete(action.faceId);
      else next.add(action.faceId);
      return { ...state, selectedFaceIds: next };
    }
    case 'set-checker':
      return {
        ...state,
        checkerOn: action.on,
        checkerScale: action.scale ?? state.checkerScale,
      };
    case 'toggle-flag':
      return { ...state, [action.key]: !state[action.key] };
    case 'unwrapping':
      return { ...state, unwrapping: action.on };
    case 'notice':
      return { ...state, notice: action.notice };
    case 'project-id':
      return { ...state, projectId: action.id };
    case 'undo': {
      if (state.history.length === 0) return state;
      const prev = state.history[state.history.length - 1];
      return {
        ...state,
        mesh: prev,
        stats: analyzeMesh(prev),
        history: state.history.slice(0, -1),
        notice: { kind: 'info', text: '已撤销上一次 UV 替换' },
      };
    }
    default:
      return state;
  }
}

export interface AppContextValue {
  state: AppState;
  loadObjText: (text: string, fileName: string, projectId?: string | null) => void;
  selectFaces: (faceIds: Set<number>) => void;
  toggleFace: (faceId: number) => void;
  setChecker: (on: boolean, scale?: number) => void;
  toggleFlag: (key: 'showFlipped' | 'showOverlap') => void;
  runUnwrap: () => Promise<void>;
  exportCurrent: () => void;
  saveCurrent: () => Promise<void>;
  projects: ProjectRecord[];
  refreshProjects: () => Promise<void>;
  openProject: (id: string) => Promise<void>;
  removeProject: (id: string) => Promise<void>;
  notify: (n: Notice | null) => void;
  undo: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    mesh: null,
    stats: null,
    objText: '',
    fileName: '',
    projectId: null,
    selectedFaceIds: new Set<number>(),
    checkerOn: true,
    checkerScale: 8,
    showFlipped: true,
    showOverlap: true,
    unwrapping: false,
    notice: null,
    history: [] as MeshData[],
  }));

  const stateRef = useRef(state);
  stateRef.current = state;

  const [projects, setProjects] = useReducer(
    (_: ProjectRecord[], next: ProjectRecord[]) => next,
    [],
  );

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch {
      // IndexedDB 不可用时静默
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const notify = useCallback((n: Notice | null) => {
    dispatch({ type: 'notice', notice: n });
  }, []);

  const loadObjText = useCallback(
    (text: string, fileName: string, projectId: string | null = null) => {
      try {
        const mesh = parseObj(text, fileName);
        const stats = analyzeMesh(mesh);
        dispatch({
          type: 'load',
          mesh,
          stats,
          objText: text,
          fileName,
          projectId,
        });
      } catch (e) {
        dispatch({
          type: 'notice',
          notice: {
            kind: 'error',
            text: `解析失败：${e instanceof Error ? e.message : String(e)}`,
          },
        });
      }
    },
    [],
  );

  const selectFaces = useCallback((faceIds: Set<number>) => {
    dispatch({ type: 'select', faceIds });
  }, []);
  const toggleFace = useCallback((faceId: number) => {
    dispatch({ type: 'toggle-face', faceId });
  }, []);
  const setChecker = useCallback((on: boolean, scale?: number) => {
    dispatch({ type: 'set-checker', on, scale });
  }, []);
  const toggleFlag = useCallback((key: 'showFlipped' | 'showOverlap') => {
    dispatch({ type: 'toggle-flag', key });
  }, []);

  const runUnwrap = useCallback(async () => {
    const cur = stateRef.current.mesh;
    if (!cur || stateRef.current.unwrapping) return;
    dispatch({ type: 'unwrapping', on: true });
    dispatch({
      type: 'notice',
      notice: { kind: 'info', text: 'xatlas WASM 展开中…' },
    });
    try {
      const result = await unwrapWithXAtlas(cur);
      // 失败信号：NaN/空结果一律视为失败并保留原模型
      if (!Number.isFinite(result.utilization) || result.uvs.length !== cur.corners.length * 2) {
        throw new Error('xatlas 返回结果不完整');
      }
      const next: MeshData = {
        ...cur,
        uvs: result.uvs,
        uvCount: result.uvs.length / 2,
        hasUv: true,
        uvOrigin: 'obj',
        corners: cur.corners.map((c, ci) => ({ ...c, vt: ci })),
      };
      // 每个角点一个独立 vt 槽（接缝分裂后本来就不同）
      next.uvs = result.uvs;
      const stats = analyzeMesh(next);
      dispatch({
        type: 'replace-mesh',
        mesh: next,
        stats,
        notice: {
          kind: 'success',
          text: `自动展开完成：${result.chartCount} 个图，利用率 ${(result.utilization * 100).toFixed(0)}%`,
        },
      });
    } catch (e) {
      // 关键承诺：自动展开失败时原模型与原 UV 原封不动
      dispatch({
        type: 'notice',
        notice: {
          kind: 'error',
          text: `自动展开失败，已保留原模型：${e instanceof Error ? e.message : String(e)}`,
        },
      });
    } finally {
      dispatch({ type: 'unwrapping', on: false });
    }
  }, []);

  const exportCurrent = useCallback(() => {
    const cur = stateRef.current.mesh;
    if (!cur) return;
    const obj = exportObj(cur);
    const blob = new Blob([obj], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = cur.fileName.replace(/\.obj$/i, '') + '_uv.obj';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    dispatch({
      type: 'notice',
      notice: { kind: 'success', text: '已导出 OBJ，可用 Blender/Maya 等重新载入验证' },
    });
  }, []);

  const saveCurrent = useCallback(async () => {
    const cur = stateRef.current.mesh;
    if (!cur) return;
    const id = stateRef.current.projectId ?? makeProjectId();
    const text = exportObj(cur);
    const rec: ProjectRecord = {
      id,
      name: cur.fileName,
      updatedAt: Date.now(),
      objText: text,
      fileName: cur.fileName,
    };
    try {
      await saveProject(rec);
      dispatch({ type: 'project-id', id });
      dispatch({
        type: 'notice',
        notice: { kind: 'success', text: `工程已存入 IndexedDB（${id}）` },
      });
      await refreshProjects();
    } catch (e) {
      dispatch({
        type: 'notice',
        notice: { kind: 'error', text: `保存失败：${e instanceof Error ? e.message : String(e)}` },
      });
    }
  }, [refreshProjects]);

  const openProject = useCallback(async (id: string) => {
    try {
      const rec = await loadProject(id);
      if (!rec) return;
      loadObjText(rec.objText, rec.fileName, id);
    } catch (e) {
      dispatch({
        type: 'notice',
        notice: { kind: 'error', text: `打开工程失败：${e instanceof Error ? e.message : String(e)}` },
      });
    }
  }, [loadObjText]);

  const removeProject = useCallback(async (id: string) => {
    await deleteProject(id);
    if (stateRef.current.projectId === id) dispatch({ type: 'project-id', id: null });
    await refreshProjects();
  }, [refreshProjects]);

  const undo = useCallback(() => dispatch({ type: 'undo' }), []);

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      loadObjText,
      selectFaces,
      toggleFace,
      setChecker,
      toggleFlag,
      runUnwrap,
      exportCurrent,
      saveCurrent,
      projects,
      refreshProjects,
      openProject,
      removeProject,
      notify,
      undo,
    }),
    [state, projects, loadObjText, selectFaces, toggleFace, setChecker,
      toggleFlag, runUnwrap, exportCurrent, saveCurrent, refreshProjects,
      openProject, removeProject, notify, undo],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
