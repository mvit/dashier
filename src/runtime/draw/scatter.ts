/**
 * Scatter charts. Pele has none, so this one is Dashier's own, drawn like the rest: plain arithmetic and one SVG
 * string, with Pele's axes and markup (svg.ts).
 *
 * Speed comes from two things. Points are projected onto a grid of CELL×CELL pixel cells and only the first
 * point of each series in a cell is kept: a plot can't show more points apart than it has cells, so 2M rows
 * (about 10,000 dots at 800×450) redraw in ~15 ms. And every series is one <path> of zero-length round-capped
 * segments, not an element per point. The same grid answers tooltips: the point drawn nearest the pointer.
 */
import { ChartElement } from '../../types/model';
import { Frame, reader } from '../frames';
import { datePartLabel } from '../dates';
import { ChartContext, ChartFormat, ChartSpec, Tip, formatCompact, formatFull, keyOf, keyReader, legendOf, reducer, valueOf } from '../charts';
import { Area, PAD, SMALL, TICK, TINY, esc, labelSvg, layoutLabel, measurer, num, pt, seriesColor, sideTitle, svgDocument, textAt, tickLabels, valueAxis } from './svg';

/** Points kept per series: at most one in each CELL×CELL pixel cell (a dot is DOT px wide, so a point left out is under one that is drawn). */
const CELL = 3;
/** Diameter of a point, px. */
const DOT = 7;
/** Legend entries; more legend values share "Other". */
const MAX_SERIES = 20;
/** Data labels (the detail's names) are drawn only when this few points are shown. */
const MAX_LABELS = 60;
const toNum = (v: unknown) => (typeof v === 'number' ? v : v == null || v === '' ? NaN : Number(v));

/** The points: x and y values, each one's series, and (with details) its name. */
export interface ScatterPoints {
  n: number;
  xs: Float64Array;
  ys: Float64Array;
  series: Uint16Array;
  names: string[] | null;
  seriesNames: string[];
}

/**
 * One point per row, or with a detail field (or a measure) one per detail value and legend value, x and y
 * summarized over its rows. Points without a numeric x and y are left out.
 */
export function scatterPoints(el: ChartElement, frame: Frame, ctx: ChartContext = {}): ScatterPoints | null {
  const { x, y, group, detail } = el.mapping || {};
  if (!x || !y) return null;
  const xm = ctx.measure?.(x), ym = ctx.measure?.(y);
  const ser = group ? keyReader(frame, keyOf(group, el.dateParts?.group)) : null;
  const seriesNames: string[] = [];
  const seriesIndex = new Map<string, number>();
  const seriesOf = (k: number) => {
    if (!ser) return 0;
    let g = String(ser(k) ?? '—');
    if (!seriesIndex.has(g) && seriesNames.length >= MAX_SERIES - 1) g = 'Other';
    let i = seriesIndex.get(g);
    if (i === undefined) seriesIndex.set(g, (i = seriesNames.push(g) - 1));
    return i;
  };
  // the legend's names as shown (none without a legend field)
  const named = () => seriesNames.map(s => datePartLabel(s, el.dateParts?.group));

  if (!detail && !xm && !ym) {
    const rx = reader(frame, x), ry = reader(frame, y);
    if (!rx || !ry) return null;
    const xs = new Float64Array(frame.length), ys = new Float64Array(frame.length), series = new Uint16Array(frame.length);
    let n = 0;
    for (let k = 0; k < frame.length; k++) {
      const a = toNum(rx(k)), b = toNum(ry(k));
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      (xs[n] = a), (ys[n] = b), (series[n] = seriesOf(k)), n++;
    }
    return { n, xs, ys, series, names: null, seriesNames: named() };
  }

  // summarized: the rows of each (detail, legend) pair, then x and y over them
  const det = detail ? keyReader(frame, keyOf(detail, el.dateParts?.detail)) : null;
  const cells = new Map<string, { name: string; s: number; pos: number[] }>();
  for (let k = 0; k < frame.length; k++) {
    const name = det ? String(det(k) ?? '—') : '';
    const s = seriesOf(k);
    const key = `${s}\u0000${name}`;
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { name, s, pos: [] }));
    c.pos.push(k);
  }
  const fx = reducer(frame, xm?.fn ?? x, el.xSummary?.aggregate || 'sum');
  const fy = reducer(frame, ym?.fn ?? y, el.summary?.aggregate || 'sum');
  const xs = new Float64Array(cells.size), ys = new Float64Array(cells.size), series = new Uint16Array(cells.size);
  const names: string[] = [];
  let n = 0;
  for (const c of cells.values()) {
    const a = fx(c.pos) ?? NaN, b = fy(c.pos) ?? NaN;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    (xs[n] = a), (ys[n] = b), (series[n] = c.s), names.push(datePartLabel(c.name, el.dateParts?.detail)), n++;
  }
  return { n, xs, ys, series, names: detail ? names : null, seriesNames: named() };
}

/** What the last drawing put where: the plot box and, per grid cell, the point drawn there (−1 for none). */
interface Drawn {
  left: number;
  top: number;
  cols: number;
  rows: number;
  at: Int32Array;
  pxs: Float32Array;
  pys: Float32Array;
}

export function buildScatter(el: ChartElement, frame: Frame, ctx: ChartContext = {}): ChartSpec | null {
  const pts = scatterPoints(el, frame, ctx);
  if (!pts || !pts.n) return null;
  const { x, y, detail } = el.mapping;
  const opt = el.options || {};
  const summarized = !!pts.names || !!ctx.measure?.(x!) || !!ctx.measure?.(y!);
  const xv = valueOf(ctx, x!, el.xSummary?.aggregate || 'sum');
  const yv = valueOf(ctx, y!, el.summary?.aggregate || 'sum');
  // a plain field per row reads as itself; summarized, as "Sum of …" (or the measure's name)
  const xName = summarized ? xv.label : x!;
  const yName = summarized ? yv.label : y!;
  const xFmt: ChartFormat = xv.format;
  const yFmt: ChartFormat = opt.format ?? yv.format;
  const { n, xs, ys, series, names, seriesNames } = pts;

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    if (xs[i] < x0) x0 = xs[i];
    if (xs[i] > x1) x1 = xs[i];
    if (ys[i] < y0) y0 = ys[i];
    if (ys[i] > y1) y1 = ys[i];
  }
  let drawn: Drawn | null = null;

  const draw = (area: Area): string => {
    const { w, h } = area;
    const m = measurer(area.font);
    const text = (raw: string, size: number, max = 4000) => layoutLabel(raw, m, size, max);
    // Laid out as Pele lays out an xychart's axes: titles outside the tick labels, ticks 4px long.
    const lineHeight = text('0', SMALL).height;
    const xTitle = text(xName, SMALL, w * 0.8);
    const yTitle = text(opt.yAxisLabel || yName, SMALL, h * 0.8);
    const labelled = opt.showValues && names ? text('0', TINY).height + 4 : lineHeight / 2;
    const top = PAD + labelled;
    const ph = Math.max(10, h - PAD - (TICK + lineHeight + 4 + (xTitle.height ? xTitle.height + 4 : 0)) - top);
    const yt = valueAxis(y0, y1, Math.floor(ph / 56), { min: opt.min, max: opt.max });
    const yLabels = tickLabels(yt.ticks, (v, d) => formatCompact(v, yFmt, d)).map(t => text(t, SMALL));
    const left = PAD + (yTitle.height ? yTitle.height + 6 : 0) + Math.max(0, ...yLabels.map(l => l.width)) + 6 + TICK;
    let pw = Math.max(10, w - PAD - left);
    const xt = valueAxis(x0, x1, Math.floor(pw / 80));
    const xLabels = tickLabels(xt.ticks, (v, d) => formatCompact(v, xFmt, d)).map(t => text(t, SMALL));
    pw = Math.max(10, pw - Math.max(0, (xLabels[xLabels.length - 1]?.width ?? 0) / 2 - PAD));
    const sx = (v: number) => left + ((v - xt.lo) / (xt.hi - xt.lo)) * pw;
    const sy = (v: number) => top + ph - ((v - yt.lo) / (yt.hi - yt.lo)) * ph;

    // points: the first of each series per cell, as one path per series
    const cols = Math.ceil(pw / CELL) + 1, rows = Math.ceil(ph / CELL) + 1;
    const taken = new Uint32Array(cols * rows); // a bit per series (series past 31 share the last bit)
    const at = new Int32Array(cols * rows).fill(-1);
    const pxs = new Float32Array(n), pys = new Float32Array(n);
    const paths: string[][] = seriesNames.length ? seriesNames.map(() => []) : [[]];
    const shown: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = sx(xs[i]), q = sy(ys[i]);
      if (p < left - 0.5 || p > left + pw + 0.5 || q < top - 0.5 || q > top + ph + 0.5) continue; // outside a fixed min/max
      const cell = Math.floor((q - top) / CELL) * cols + Math.floor((p - left) / CELL);
      const bit = 1 << Math.min(series[i], 31);
      if (taken[cell] & bit) continue;
      taken[cell] |= bit;
      at[cell] = i;
      (pxs[i] = p), (pys[i] = q);
      paths[series[i]].push(`M${num(p)} ${num(q)}h0`);
      if (shown.length <= MAX_LABELS) shown.push(i);
    }
    drawn = { left, top, cols, rows, at, pxs, pys };

    const bottom = top + ph;
    let grid = '';
    let axis = `M${pt(left, top)}V${num(bottom)}H${num(left + pw)}`;
    let ticks = '';
    yt.ticks.forEach((v, i) => {
      const y = sy(v);
      grid += `M${pt(left, y)}H${num(left + pw)}`;
      axis += `M${pt(left, y)}h${-TICK}`;
      ticks += textAt(left - TICK - 6, y, SMALL, esc(yLabels[i].lines[0]), ' text-anchor="end"');
    });
    xt.ticks.forEach((v, i) => {
      const x = sx(v);
      grid += `M${pt(x, top)}V${num(bottom)}`;
      axis += `M${pt(x, bottom)}v${TICK}`;
      ticks += textAt(x, bottom + TICK + 4 + lineHeight / 2, SMALL, esc(xLabels[i].lines[0]), ' text-anchor="middle"');
    });
    const titles = labelSvg(xTitle, left + pw / 2, h - PAD - xTitle.height / 2) + (yTitle.height ? sideTitle(yTitle, top + ph / 2) : '');
    const labels =
      opt.showValues && names && shown.length <= MAX_LABELS
        ? `<g class="c-point-labels" font-size="${TINY}" fill="var(--_m)">${shown
            .map(i => {
              // right of the point, or left of it when it would run past the tile
              const right = pxs[i] + DOT / 2 + 3 + text(names[i], TINY).width <= w - PAD;
              return textAt(pxs[i] + (right ? 1 : -1) * (DOT / 2 + 3), pys[i], TINY, esc(names[i]), right ? '' : ' text-anchor="end"');
            })
            .join('')}</g>`
        : '';

    return svgDocument(
      'scatter',
      area,
      `<path class="c-grid" d="${grid}" stroke="var(--_a)"/>` +
        `<g class="c-plot">${paths
          .map((d, s) => (d.length ? `<path class="c-points" data-s="${s}" d="${d.join('')}" fill="none" stroke="${seriesColor(s)}" stroke-width="${DOT}" stroke-linecap="round" stroke-opacity="0.75"/>` : ''))
          .join('')}</g>` +
        `<path class="c-axis" d="${axis}" fill="none" stroke="var(--_b)"/>` +
        `<g class="c-axis-labels" font-size="${SMALL}" fill="var(--_m)">${ticks}</g>` +
        `<g class="c-axis-titles" font-size="${SMALL}">${titles}</g>${labels}`
    );
  };

  return {
    draw,
    names: seriesNames.length ? seriesNames : [yName],
    legend: seriesNames.length ? legendOf(opt, seriesNames) : [],
    tip: (_target, _svg, pt): Tip | null => {
      const d = drawn;
      if (!d) return null;
      // the drawn point nearest the pointer, within a dot and a bit
      const cx = Math.floor((pt.x - d.left) / CELL), cy = Math.floor((pt.y - d.top) / CELL);
      const reach = Math.ceil(DOT / CELL);
      let best = -1, bestD = (DOT / 2 + 3) ** 2;
      for (let r = cy - reach; r <= cy + reach; r++) {
        if (r < 0 || r >= d.rows) continue;
        for (let c = cx - reach; c <= cx + reach; c++) {
          if (c < 0 || c >= d.cols) continue;
          const i = d.at[r * d.cols + c];
          if (i < 0) continue;
          const dist = (d.pxs[i] - pt.x) ** 2 + (d.pys[i] - pt.y) ** 2;
          if (dist <= bestD) (best = i), (bestD = dist);
        }
      }
      if (best < 0) return null;
      const s = seriesNames[series[best]];
      return {
        title: names?.[best] ?? s ?? (detail ? '' : 'Point'),
        rows: [
          { label: xName, value: formatFull(xs[best], xFmt), color: seriesColor(series[best]) },
          { label: yName, value: formatFull(ys[best], yFmt) },
          ...(names && s !== undefined ? [{ label: el.mapping.group!, value: s }] : [])
        ]
      };
    }
  };
}
