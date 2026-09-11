import React, { useState, useRef, useCallback } from "react";

/* ---------------------------------------------------------------------- *
 * charts.jsx — the small set of chart forms this dashboard needs, as
 * inline SVG. No charting library: the whole set is four forms, and a
 * dependency would cost more bundle than it saves.
 *
 * Colour roles come from CSS custom properties defined in index.css
 * (.viz-root). The categorical slots are used in fixed order and are
 * never cycled or reassigned by rank, so a colour always means the same
 * thing across every chart on the page.
 * ---------------------------------------------------------------------- */

const C = {
  s1: "var(--series-1)", s2: "var(--series-2)", s3: "var(--series-3)", s4: "var(--series-4)",
  good: "var(--status-good)", warning: "var(--status-warning)",
  serious: "var(--status-serious)", critical: "var(--status-critical)",
  grid: "var(--viz-grid)", axis: "var(--viz-axis)",
  ink: "var(--viz-ink)", muted: "var(--viz-muted)", surface: "var(--viz-surface)",
};

/* ------------------------------ tooltip ------------------------------- */
function useTooltip() {
  const [tip, setTip] = useState(null);
  const wrapRef = useRef(null);
  const show = useCallback((e, content) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const node = tip ? (
    <div
      className="pointer-events-none absolute z-20 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg"
      style={{
        left: Math.max(4, Math.min(tip.x + 12, (wrapRef.current?.clientWidth || 400) - 190)),
        top: Math.max(4, tip.y - 8),
        minWidth: 130, maxWidth: 240,
      }}
    >
      {tip.content}
    </div>
  ) : null;
  return { wrapRef, show, hide, node };
}

export function ChartFrame({ title, subtitle, legend, children, right }) {
  /* .viz-root wraps the whole frame, not just the plot: the legend swatches
     are painted with the same --series-* custom properties as the marks, so
     if the class sits below the legend those swatches resolve to nothing and
     render invisible — which is exactly what happened the first time. */
  return (
    <div className="viz-root rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </div>
      {legend && <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 mb-1">{legend}</div>}
      <div className="relative mt-2">{children}</div>
    </div>
  );
}

export function LegendItem({ color, label, shape = "square" }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      {shape === "line" ? (
        <span style={{ background: color }} className="inline-block w-3.5 h-0.5 rounded-full" />
      ) : (
        <span style={{ background: color }} className="inline-block w-2.5 h-2.5 rounded-sm" />
      )}
      {label}
    </span>
  );
}

const shortDate = (iso) => (iso || "").slice(5).replace("-", "/");

/* ===================================================================== *
 * 1. Capacity chart — committed hours per day against available hours.
 *    Both series are hours, so they share one axis. The capacity line is
 *    a threshold, not a second scale.
 * ===================================================================== */
export function CapacityChart({ series, height = 190 }) {
  const { wrapRef, show, hide, node } = useTooltip();
  if (!series.length) return <Empty />;

  const W = 720, H = height, padL = 38, padR = 8, padT = 10, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxVal = Math.max(...series.map((d) => Math.max(d.committedHours, d.capacityHours)), 1);
  const yMax = Math.ceil(maxVal / 10) * 10;
  const y = (v) => padT + plotH - (v / yMax) * plotH;
  const step = plotW / series.length;
  const barW = Math.max(6, Math.min(30, step - 8));
  const ticks = [0, yMax / 2, yMax];

  return (
    <div ref={wrapRef} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img"
           aria-label="Committed hours per day against available technician hours">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={C.grid} strokeWidth="1" />
            <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize="9" fill={C.muted}>{Math.round(t)}h</text>
          </g>
        ))}
        {series.map((d, i) => {
          const cx = padL + i * step + step / 2;
          const over = d.committedHours > d.capacityHours;
          const top = y(d.committedHours);
          const h = Math.max(1, padT + plotH - top);
          return (
            <g key={d.date}
               onMouseMove={(e) => show(e, (
                 <div>
                   <div className="font-medium text-slate-900">{d.date}</div>
                   <div className="text-slate-600">{d.jobs} jobs · {d.techs} techs</div>
                   <div className="text-slate-600">Committed {d.committedHours}h of {d.capacityHours}h</div>
                   <div className={over ? "font-medium" : "text-slate-600"} style={{ color: over ? C.critical : undefined }}>
                     {d.utilisationPct == null ? "—" : d.utilisationPct + "% utilisation"}
                   </div>
                   {d.overloadedTechs > 0 && <div style={{ color: C.critical }}>{d.overloadedTechs} tech(s) over capacity</div>}
                 </div>
               ))}
               onMouseLeave={hide}>
              <rect x={cx - step / 2} y={padT} width={step} height={plotH} fill="transparent" />
              <rect x={cx - barW / 2} y={top} width={barW} height={h} rx="4"
                    fill={over ? C.critical : C.s1} />
              {/* capacity marker for this day */}
              <line x1={cx - barW / 2 - 3} x2={cx + barW / 2 + 3} y1={y(d.capacityHours)} y2={y(d.capacityHours)}
                    stroke={C.ink} strokeWidth="2" strokeLinecap="round" opacity="0.75" />
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} stroke={C.axis} strokeWidth="1" />
        {series.map((d, i) =>
          (series.length <= 16 || i % 2 === 0) ? (
            <text key={d.date} x={padL + i * step + step / 2} y={H - 8} textAnchor="middle" fontSize="9" fill={C.muted}>
              {shortDate(d.date)}
            </text>
          ) : null
        )}
      </svg>
      {node}
    </div>
  );
}

/* ===================================================================== *
 * 2. Load heatmap — technician × day, coloured by load against capacity.
 *    Diverging: capacity (100%) is the meaningful midpoint, under is blue,
 *    over is red, and a cell at exactly capacity reads as neutral.
 * ===================================================================== */
const DIVERGING = {
  under3: "#1c5cab", under2: "#3987e5", under1: "#9ec5f4",
  mid: "#e0dfd8",
  over1: "#f0a3a3", over2: "#d03b3b", over3: "#9b2020",
};
function loadColor(pct) {
  if (pct == null) return "transparent";
  if (pct <= 40) return DIVERGING.under3;
  if (pct <= 65) return DIVERGING.under2;
  if (pct <= 85) return DIVERGING.under1;
  if (pct <= 100) return DIVERGING.mid;
  if (pct <= 120) return DIVERGING.over1;
  if (pct <= 150) return DIVERGING.over2;
  return DIVERGING.over3;
}
function loadInk(pct) {
  if (pct == null) return C.muted;
  return pct <= 65 || pct > 120 ? "#ffffff" : "#0b0b0b";
}

export function LoadHeatmap({ rows, dates, techs }) {
  const { wrapRef, show, hide, node } = useTooltip();
  if (!techs.length) return <Empty />;
  const byKey = new Map(rows.map((r) => [`${r.date}||${r.tech}`, r]));
  const cell = 26, labelW = 96, headH = 20;

  return (
    <div ref={wrapRef} className="relative overflow-x-auto">
      <div style={{ minWidth: labelW + dates.length * cell }}>
        <div className="flex" style={{ paddingLeft: labelW, height: headH }}>
          {dates.map((d, i) => (
            <div key={d} style={{ width: cell }} className="text-[9px] text-slate-400 text-center leading-none pt-1">
              {i % 2 === 0 ? shortDate(d) : ""}
            </div>
          ))}
        </div>
        {techs.map((t) => (
          <div key={t} className="flex items-center" style={{ height: cell }}>
            <div style={{ width: labelW }} className="text-xs text-slate-700 truncate pr-2">{t}</div>
            {dates.map((d) => {
              const r = byKey.get(`${d}||${t}`);
              return (
                <div key={d} style={{ width: cell, height: cell, padding: 1 }}
                     onMouseMove={(e) => show(e, r ? (
                       <div>
                         <div className="font-medium text-slate-900">{t} · {d}</div>
                         <div className="text-slate-600">{r.jobs} jobs across {r.properties} building(s)</div>
                         <div className="text-slate-600">Work {Math.round(r.taskMinutes / 6) / 10}h + travel {Math.round(r.travelMinutes / 6) / 10}h</div>
                         <div className="text-slate-600">Shift {Math.round(r.shiftMinutes / 60)}h</div>
                         <div className="font-medium" style={{ color: r.loadPct > 100 ? C.critical : C.ink }}>
                           {r.loadPct}% load{r.isFloor ? " (at least — some jobs have no estimate)" : ""}
                         </div>
                       </div>
                     ) : <div className="text-slate-500">{t} · {d}<br />Not scheduled</div>)}
                     onMouseLeave={hide}>
                  <div className="w-full h-full rounded-sm flex items-center justify-center text-[9px] font-medium"
                       style={{
                         background: r ? loadColor(r.loadPct) : "transparent",
                         border: r ? "none" : "1px solid var(--viz-empty)",
                         color: r ? loadInk(r.loadPct) : "transparent",
                       }}>
                    {r && r.loadPct >= 100 ? Math.round(r.loadPct / 10) * 10 : ""}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {node}
    </div>
  );
}

export function HeatmapScale() {
  const steps = [
    ["≤40%", DIVERGING.under3], ["65%", DIVERGING.under2], ["85%", DIVERGING.under1],
    ["at capacity", DIVERGING.mid], ["120%", DIVERGING.over1], ["150%", DIVERGING.over2], [">150%", DIVERGING.over3],
  ];
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {steps.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1 text-[10px] text-slate-500">
          <span className="inline-block w-3.5 h-3.5 rounded-sm border border-slate-200" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

/* ===================================================================== *
 * 3. Rate line — a percentage over time, with a crosshair.
 * ===================================================================== */
export function RateLine({ series, valueKey, label, color = C.s1, target, height = 160, format = (v) => `${v}%` }) {
  const { wrapRef, show, hide, node } = useTooltip();
  const pts = series.filter((d) => d[valueKey] != null);
  if (pts.length < 2) return <Empty message="Not enough data yet to draw a trend." />;

  const W = 720, H = height, padL = 34, padR = 10, padT = 10, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const x = (i) => padL + (plotW * i) / Math.max(1, series.length - 1);
  const y = (v) => padT + plotH - (Math.min(v, 100) / 100) * plotH;
  const path = pts.map((d) => `${x(series.indexOf(d))},${y(d[valueKey])}`).join(" ");

  return (
    <div ref={wrapRef} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img" aria-label={label}>
        {[0, 50, 100].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={C.grid} strokeWidth="1" />
            <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize="9" fill={C.muted}>{t}%</text>
          </g>
        ))}
        {target != null && (
          <>
            <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke={C.good} strokeWidth="1.5" opacity="0.5" />
            <text x={W - padR} y={y(target) - 4} textAnchor="end" fontSize="9" fill={C.good}>target {target}%</text>
          </>
        )}
        <polyline points={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((d) => {
          const i = series.indexOf(d);
          return (
            <g key={d.date}
               onMouseMove={(e) => show(e, (
                 <div>
                   <div className="font-medium text-slate-900">{d.date}</div>
                   <div className="text-slate-600">{label}: <span className="font-medium">{format(d[valueKey])}</span></div>
                   <div className="text-slate-600">{d.jobs} jobs scheduled</div>
                 </div>
               ))}
               onMouseLeave={hide}>
              <rect x={x(i) - 12} y={padT} width={24} height={plotH} fill="transparent" />
              <circle cx={x(i)} cy={y(d[valueKey])} r="4" fill={color} stroke={C.surface} strokeWidth="2" />
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} stroke={C.axis} strokeWidth="1" />
        {series.map((d, i) =>
          (series.length <= 16 || i % 2 === 0) ? (
            <text key={d.date} x={x(i)} y={H - 7} textAnchor="middle" fontSize="9" fill={C.muted}>{shortDate(d.date)}</text>
          ) : null
        )}
      </svg>
      {node}
    </div>
  );
}

/* ===================================================================== *
 * 4. Horizontal bars — one series, one colour, values direct-labelled.
 * ===================================================================== */
export function HBars({ items, max, unit = "", colorFor }) {
  if (!items.length) return <Empty />;
  const top = max || Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-2">
          <div className="w-40 shrink-0 text-xs text-slate-600 truncate" title={it.label}>{it.label}</div>
          <div className="flex-1 h-4 rounded-sm" style={{ background: "var(--viz-track)" }}>
            <div className="h-4 rounded-sm" style={{
              width: `${Math.max(1, (it.value / top) * 100)}%`,
              background: colorFor ? colorFor(it) : C.s1,
            }} />
          </div>
          <div className="w-32 shrink-0 text-xs text-slate-700 text-right tabular-nums">
            {it.display != null ? it.display : `${it.value}${unit}`}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ===================================================================== *
 * 5. Stacked daily bars — components of one total, sharing one axis.
 * ===================================================================== */
export function StackedDailyBars({ series, stacks, height = 180, unit = "" }) {
  const { wrapRef, show, hide, node } = useTooltip();
  if (!series.length) return <Empty />;

  const W = 720, H = height, padL = 44, padR = 8, padT = 10, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const totals = series.map((d) => stacks.reduce((s, st) => s + (d[st.key] || 0), 0));
  const yMax = Math.max(1, Math.ceil(Math.max(...totals) / 100) * 100);
  const y = (v) => padT + plotH - (v / yMax) * plotH;
  const step = plotW / series.length;
  const barW = Math.max(6, Math.min(30, step - 8));

  return (
    <div ref={wrapRef} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} role="img" aria-label="Daily cost by component">
        {[0, yMax / 2, yMax].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={C.grid} strokeWidth="1" />
            <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize="9" fill={C.muted}>{Math.round(t)}</text>
          </g>
        ))}
        {series.map((d, i) => {
          const cx = padL + i * step + step / 2;
          let cursor = 0;
          return (
            <g key={d.date}
               onMouseMove={(e) => show(e, (
                 <div>
                   <div className="font-medium text-slate-900">{d.date}</div>
                   {stacks.map((st) => (
                     <div key={st.key} className="text-slate-600 flex items-center gap-1.5">
                       <span className="inline-block w-2 h-2 rounded-sm" style={{ background: st.color }} />
                       {st.label}: {unit}{Math.round(d[st.key] || 0)}
                     </div>
                   ))}
                   <div className="text-slate-900 font-medium mt-0.5">Total {unit}{Math.round(totals[i])}</div>
                   <div className="text-slate-500">{d.jobs} jobs · {unit}{d.costPerJob} per job</div>
                 </div>
               ))}
               onMouseLeave={hide}>
              <rect x={cx - step / 2} y={padT} width={step} height={plotH} fill="transparent" />
              {stacks.map((st, si) => {
                const v = d[st.key] || 0;
                if (v <= 0) return null;
                const h = (v / yMax) * plotH;
                const yTop = y(cursor + v);
                cursor += v;
                const isTop = si === stacks.length - 1;
                return (
                  <rect key={st.key} x={cx - barW / 2} y={yTop} width={barW}
                        height={Math.max(1, h - 2)} rx={isTop ? 4 : 0} fill={st.color} />
                );
              })}
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} stroke={C.axis} strokeWidth="1" />
        {series.map((d, i) =>
          (series.length <= 16 || i % 2 === 0) ? (
            <text key={d.date} x={padL + i * step + step / 2} y={H - 8} textAnchor="middle" fontSize="9" fill={C.muted}>
              {shortDate(d.date)}
            </text>
          ) : null
        )}
      </svg>
      {node}
    </div>
  );
}

/* ===================================================================== *
 * 6. Work-mix stacked bar — a single part-to-whole row, direct-labelled.
 * ===================================================================== */
export function MixBar({ segments, total }) {
  if (!total) return <Empty />;
  return (
    <div>
      <div className="flex gap-0.5 h-7 rounded-md overflow-hidden">
        {segments.filter((s) => s.value > 0).map((s) => {
          const share = (s.value / total) * 100;
          return (
            <div key={s.label} title={`${s.label}: ${s.value} (${Math.round(share)}%)`}
                 className="flex items-center justify-center text-[10px] font-medium text-white"
                 style={{ width: `${share}%`, background: s.color }}>
              {share >= 9 ? `${Math.round(share)}%` : ""}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {segments.filter((s) => s.value > 0).map((s) => (
          <LegendItem key={s.label} color={s.color} label={`${s.label} · ${s.value}`} />
        ))}
      </div>
    </div>
  );
}

export const SERIES_COLORS = C;

function Empty({ message = "No data in this range." }) {
  return <div className="text-xs text-slate-400 py-6 text-center">{message}</div>;
}
