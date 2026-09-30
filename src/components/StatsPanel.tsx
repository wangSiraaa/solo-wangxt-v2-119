import { summarize, type Analysis, type TriAnalysis } from '../lib/analysis';

interface Props {
  analysis: Analysis;
  selection: Set<number>;
}

function fmt(x: number, d = 3): string {
  if (!isFinite(x)) return '—';
  return x.toFixed(d);
}

function flagLabel(t: TriAnalysis): string[] {
  const out: string[] = [];
  if (t.flags.has('degenerate3d')) out.push('3D退化');
  if (t.flags.has('degenerateUv')) out.push('UV退化');
  if (t.flags.has('flipped')) out.push('翻转');
  if (t.flags.has('overlap')) out.push(`重叠×${t.overlaps.length}`);
  if (t.flags.has('badDensity')) out.push('密度异常');
  return out;
}

export default function StatsPanel({ analysis, selection }: Props) {
  const s = summarize(analysis);
  const selTris = analysis.tris.filter(t => selection.has(t.face));

  return (
    <div className="stats">
      <h3>分析摘要</h3>
      <div className="grid2">
        <Metric label="面（稳定 ID）" value={String(s.faces)} />
        <Metric label="三角形" value={String(s.triangles)} />
        <Metric label="UV 岛" value={String(s.islands)} tone={s.islands > 1 ? 'ok' : undefined} />
        <Metric label="平面接缝边" value={String(s.seams)} tone={s.seams ? 'warn' : 'ok'} note="共面处断开" />
        <Metric label="硬边接缝" value={String(s.hardseams)} note="盒展开正常" />
        <Metric label="非流形边" value={String(s.nonmanifold)} tone={s.nonmanifold ? 'bad' : 'ok'} />
        <Metric label="重叠三角" value={String(s.overlapTris)} tone={s.overlapTris ? 'bad' : 'ok'} />
        <Metric label="翻转三角" value={String(s.flipped)} tone={s.flipped ? 'bad' : 'ok'} />
        <Metric label="3D 退化面" value={String(s.degenerate3d)} tone={s.degenerate3d ? 'warn' : 'ok'} />
        <Metric label="UV 退化面" value={String(s.degenerateUv)} tone={s.degenerateUv ? 'warn' : 'ok'} note="不参与比率" />
      </div>

      <h3>面积畸变（texel 密度）</h3>
      <p className="hint">
        相对中位的密度比。1 = 与中位一致；&lt;1 纹理被放大（拉伸/糊），&gt;1 被压缩。
        退化面不参与。
      </p>
      <div className="grid2">
        <Metric label="最小密度比" value={fmt(s.densityMin)}
          tone={s.densityMin < 0.75 ? 'warn' : 'ok'} />
        <Metric label="最大密度比" value={fmt(s.densityMax)}
          tone={s.densityMax > 1.33 ? 'warn' : 'ok'} />
        <Metric label="中位密度 d" value={fmt(analysis.medianDensity, 4)} />
        <Metric label="密度(最小/中位)" value={fmt(s.densityMin)} />
      </div>

      <h3>角度畸变（保角 σmax/σmin）</h3>
      <p className="hint">
        Jacobian 奇异值之比。1.000 = 无角度变形；越大棋盘格越歪斜。退化面不参与。
      </p>
      <div className="grid2">
        <Metric label="最差角度畸变" value={fmt(s.angleMax)}
          tone={s.angleMax > 1.5 ? 'warn' : 'ok'} />
      </div>

      <div className="legend">
        <Legend c="#ff5470" t="翻转" />
        <Legend c="#ffa726" t="重叠" />
        <Legend c="#ffd23b" t="接缝边" />
        <Legend c="#b14aed" t="非流形/3D退化" />
        <Legend c="#8d6e63" t="UV退化" />
        <Legend c="#66ddaa" t="边界" />
      </div>

      <h3>选中面（{selection.size}）{selection.size > 0 && <span className="muted"> · 点击空白取消</span>}</h3>
      {selection.size === 0 && <p className="hint">在任一视图点选面；Shift/⌘ 点选可加选。</p>}
      <div className="sellist">
        {selTris.slice(0, 40).map((t, i) => (
          <div key={i} className="selrow">
            <b>面 {t.face + 1}</b>
            <span className="tri">△{t.triIndex + 1}</span>
            {isFinite(t.angleDistortion) && <span>角度 {fmt(t.angleDistortion)}</span>}
            {isFinite(t.densityRatio) && <span>密度比 {fmt(t.densityRatio)}</span>}
            {t.island >= 0 && <span>岛 {t.island}</span>}
            {flagLabel(t).map(f => <em key={f} className="flag">{f}</em>)}
          </div>
        ))}
        {selTris.length > 40 && <p className="hint">…其余 {selTris.length - 40} 个三角形省略</p>}
      </div>
    </div>
  );
}

function Metric({ label, value, tone, note }:
  { label: string; value: string; tone?: 'ok' | 'warn' | 'bad'; note?: string }) {
  return (
    <div className={'metric ' + (tone ?? '')}>
      <div className="m-label">{label}</div>
      <div className="m-value">{value}{note && <small> {note}</small>}</div>
    </div>
  );
}

function Legend({ c, t }: { c: string; t: string }) {
  return <span className="legend-item"><i style={{ background: c }} />{t}</span>;
}
