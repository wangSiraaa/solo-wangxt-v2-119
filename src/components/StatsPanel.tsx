import { useMemo } from 'react';
import { useApp } from '../state/AppContext';
import type { TriMetrics } from '../core/types';

function fmt(n: number | null | undefined, digits = 3): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

/** 面积比率 -> 百分比纹素密度偏差：ratio=1 => 0%，ratio=2 => +100%。 */
function densityPct(r: number | null): string {
  if (r === null) return '退化';
  const pct = (r - 1) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
}

function aggregate(ms: TriMetrics[]) {
  const valid = ms.filter((m) => m.areaRatio !== null);
  if (valid.length === 0) {
    return { count: ms.length, valid: 0, maxRatio: null, maxAngle: null };
  }
  let maxRatio = 0;
  let maxAngle = 0;
  for (const m of valid) {
    maxRatio = Math.max(maxRatio, m.areaRatio!);
    maxAngle = Math.max(maxAngle, m.angleDistortion ?? 0);
  }
  return { count: ms.length, valid: valid.length, maxRatio, maxAngle };
}

export function StatsPanel() {
  const { state, selectFaces } = useApp();
  const { mesh, stats, selectedFaceIds } = state;

  const summary = useMemo(() => {
    if (!mesh || !stats) return null;
    const triInFace = new Map<number, number[]>();
    mesh.triangles.forEach((t) => {
      const list = triInFace.get(t.faceId);
      if (list) list.push(t.id);
      else triInFace.set(t.faceId, [t.id]);
    });

    let deg3 = 0;
    let degUv = 0;
    let flipped = 0;
    let overlap = 0;
    const ratioValid: number[] = [];
    const angles: number[] = [];
    let minR = Infinity;
    let maxR = -Infinity;
    for (const m of stats.metrics) {
      if (m.degenerate3d) deg3++;
      if (m.degenerateUv) degUv++;
      if (m.flipped) flipped++;
      if (m.areaRatio !== null) {
        ratioValid.push(m.areaRatio);
        minR = Math.min(minR, m.areaRatio);
        maxR = Math.max(maxR, m.areaRatio);
      }
      if (m.angleDistortion !== null) angles.push(m.angleDistortion);
    }
    for (let i = 0; i < stats.overlap.length; i++) if (stats.overlap[i]) overlap++;

    const boundary = stats.edges.filter((e) => e.boundary).length;
    const seam = stats.edges.filter((e) => e.seam).length;
    const nm = stats.edges.filter((e) => e.nonManifold).length;
    const mirroredIsl = stats.islands.filter((i) => i.mirrored).length;

    // 异常面收集（点击定位）
    const faceSetOf = (triIds: number[]) => {
      const s = new Set<number>();
      triIds.forEach((id) => s.add(mesh.triangles[id].faceId));
      return s;
    };
    const flippedTris = stats.metrics.map((m, i) => (m.flipped ? i : -1)).filter((i) => i >= 0);
    const overlapTris = [...stats.overlap].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    const degTris = stats.metrics
      .map((m, i) => (m.degenerate3d || m.degenerateUv ? i : -1))
      .filter((i) => i >= 0);

    return {
      triInFace,
      deg3, degUv, flipped, overlap,
      minR: minR === Infinity ? null : minR,
      maxR: maxR === -Infinity ? null : maxR,
      maxAngle: angles.length ? Math.max(...angles) : null,
      boundary, seam, nm, mirroredIsl,
      islands: stats.islands.length,
      flippedFaces: faceSetOf(flippedTris),
      overlapFaces: faceSetOf(overlapTris),
      degFaces: faceSetOf(degTris),
    };
  }, [mesh, stats]);

  const selectedAgg = useMemo(() => {
    if (!mesh || !stats || selectedFaceIds.size === 0) return null;
    const triIds: number[] = [];
    mesh.faces.forEach((f) => {
      if (selectedFaceIds.has(f.id)) {
        mesh.triangles.forEach((t) => {
          if (t.faceId === f.id) triIds.push(t.id);
        });
      }
    });
    const agg = aggregate(triIds.map((id) => stats.metrics[id]));
    // 单三角时给出个体数值
    const one = triIds.length === 1 ? stats.metrics[triIds[0]] : null;
    return { agg, one, triCount: triIds.length };
  }, [mesh, stats, selectedFaceIds]);

  if (!mesh || !stats || !summary) {
    return <aside className="panel">尚未载入模型。</aside>;
  }

  const chip = (ok: boolean) => (ok ? 'bad' : 'ok');

  return (
    <aside className="panel">
      <section>
        <h3>拓扑</h3>
        <Row k="顶点身份 (v)" v={mesh.vertexCount} />
        <Row k="角点 (corner)" v={mesh.corners.length} hint="接缝两侧可为同 v 不同 vt" />
        <Row k="原始面 / 三角形" v={`${mesh.faces.length} / ${mesh.triangles.length}`} />
        <Row k="UV 顶点 (vt)" v={mesh.uvCount} />
        <Row k="UV 来源" v={mesh.uvOrigin === 'obj' ? 'OBJ/编辑' : '平面回退'} />
      </section>

      <section>
        <h3>边（按顶点身份+空间近邻）</h3>
        <Row k="UV 岛" v={summary.islands} />
        <Row k="边界边" v={summary.boundary} />
        <Row k="共享边接缝" v={summary.seam} cls={summary.seam ? 'warn' : 'ok'} />
        <Row k="非流形边" v={summary.nm} cls={chip(summary.nm === 0)}
          hint="≥3 个三角形共享的 3D 边" />
      </section>

      <section>
        <h3>UV 健康</h3>
        <IssueRow
          label="翻转三角形 / 镜像岛"
          value={`${summary.flipped} / ${summary.mirroredIsl}`}
          bad={summary.flipped > 0}
          onLocate={() => summary.flippedFaces.size && selectFaces(summary.flippedFaces)}
        />
        <IssueRow
          label="岛间重叠三角形"
          value={summary.overlap}
          bad={summary.overlap > 0}
          onLocate={() => summary.overlapFaces.size && selectFaces(summary.overlapFaces)}
        />
        <IssueRow
          label="退化（3D / UV）"
          value={`${summary.deg3} / ${summary.degUv}`}
          bad={summary.deg3 + summary.degUv > 0}
          onLocate={() => summary.degFaces.size && selectFaces(summary.degFaces)}
          hint="退化面不参与比率与角度计算"
        />
      </section>

      <section>
        <h3>面积畸变（纹素密度）</h3>
        <Row k="全局相对尺度" v={fmt(stats.globalScale, 4)} hint="中位 3D/UV 面积比" />
        <Row
          k="最小 / 最大比率"
          v={`${fmt(summary.minR)}× / ${fmt(summary.maxR)}×`}
          cls={summary.maxR !== null && (summary.maxR > 2 || summary.minR! < 0.5) ? 'warn' : 'ok'}
        />
        <p className="hint">比率 1× = 与中位密度一致；0.5× 偏稀，2× 偏密。</p>
      </section>

      <section>
        <h3>角度畸变</h3>
        <Row
          k="全模型最大内角偏差"
          v={`${fmt(summary.maxAngle, 1)}°`}
          cls={summary.maxAngle !== null && summary.maxAngle > 15 ? 'warn' : 'ok'}
        />
        <p className="hint">对应 3D/UV 内角最大差值；0° 为保角映射。</p>
      </section>

      <section>
        <h3>选中面{selectedFaceIds.size > 0 ? `（${selectedFaceIds.size} 面 / ${selectedAgg?.triCount ?? 0} 三角）` : ''}</h3>
        {!selectedAgg && <p className="hint">在任一视图点选面；Shift+点击加选。</p>}
        {selectedAgg?.one && (
          <>
            <Row
              k="面积畸变比率"
              v={selectedAgg.one.areaRatio === null ? '退化' : `${fmt(selectedAgg.one.areaRatio)}×`}
              hint={densityPct(selectedAgg.one.areaRatio)}
            />
            <Row
              k="角度畸变"
              v={selectedAgg.one.angleDistortion === null ? '退化' : `${fmt(selectedAgg.one.angleDistortion, 1)}°`}
            />
            <Row k="3D / UV 面积" v={`${fmt(selectedAgg.one.area3d, 5)} / ${fmt(selectedAgg.one.areaUv, 5)}`} />
            <Row k="翻转" v={selectedAgg.one.flipped ? '是' : '否'}
              cls={selectedAgg.one.flipped ? 'bad' : 'ok'} />
          </>
        )}
        {selectedAgg && !selectedAgg.one && (
          <>
            <Row k="最大面积比率" v={`${fmt(selectedAgg.agg.maxRatio)}×`} />
            <Row k="最大角度畸变" v={`${fmt(selectedAgg.agg.maxAngle, 1)}°`} />
            <p className="hint">多选显示聚合峰值；点单一面查看个体数值。</p>
          </>
        )}
      </section>
    </aside>
  );
}

function Row({ k, v, cls, hint }: { k: string; v: string | number; cls?: string; hint?: string }) {
  return (
    <div className={`row ${cls ?? ''}`}>
      <span className="k">{k}</span>
      <span className="v" title={hint}>{v}</span>
    </div>
  );
}

function IssueRow({
  label, value, bad, onLocate, hint,
}: {
  label: string;
  value: string | number;
  bad: boolean;
  onLocate: () => void;
  hint?: string;
}) {
  return (
    <div className={`row issue ${bad ? 'bad' : 'ok'}`} title={hint}>
      <span className="k">{label}</span>
      <span className="v">
        {value}
        {bad && (
          <button className="locate" onClick={onLocate}>定位</button>
        )}
      </span>
    </div>
  );
}
