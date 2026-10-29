/**
 * Column, bar, line, area and combo charts: Pele's xychart renderer (MIT, © 2026 kepano), drawn at the tile's
 * size, with the report's number formats, without its title and legend (Dashier draws those), and with stacking
 * and areas, which Pele doesn't have.
 */
import { Area, Label, PAD, SMALL, TICK, TINY, aligned, esc, textAt, group, labelSvg, layoutLabel, measurer, num, pos, pt, seriesColor, sideTitle, svgDocument, tickLabels, valueAxis } from './svg';

export interface XYSeries {
  name: string;
  data: number[];
  line?: boolean;
  /** A line with the space under it filled. */
  area?: boolean;
  /** Its data labels' number format, when not the chart's (passed to `format`). */
  f?: any;
}

export interface XYData {
  horizontal: boolean;
  /** Category labels, in order. */
  cats: string[];
  /** Bars and lines; a series keeps the color of its place in this list, and lines are drawn over bars. */
  series: XYSeries[];
  /** The value axis title. */
  title: string;
  /** A fixed end of the value axis (the chart's minimum or maximum). */
  fixed?: { min?: number; max?: number };
  /** Axis ticks and data labels, with up to `digits` decimals. */
  format: (v: number, digits?: number, f?: any) => string;
  /** Data labels: past the end of each bar (inside it, stacked), above each point. */
  showValues?: boolean;
  /** Bars stack on each other, and so do areas; plain lines never do. */
  stacked: boolean;
  /** The category axis's title. */
  catTitle?: string;
  /** Axis labels (and the value axis's title) left out. */
  hideValueAxis?: boolean;
  hideCategoryAxis?: boolean;
  /** Gridlines are drawn unless false. */
  grid?: boolean;
  /** A bar's share of its category's room (default 0.7), its corner radius, and one color per bar (one series). */
  barWidth?: number;
  barRadius?: number;
  vary?: boolean;
  /** Line width (default 2); points always (true), never (false) or where they fit. */
  lineWidth?: number;
  markers?: boolean;
  /** Dashed lines across the plot at values, labelled at their end. */
  refs?: { value: number; label: string; color?: string }[];
}

interface Mark {
  at: number;
  label: Label;
}

const most = <T>(list: T[], of: (item: T) => number) => list.reduce((a, item) => Math.max(a, of(item)), 0);

/** Draws the chart; `hit` then finds the category under a point of the drawing (−1 for none). */
export function xyChart(d: XYData) {
  const { horizontal, cats, series, stacked } = d;
  const count = Math.max(cats.length, 1);
  let hitBox = { left: 0, top: 0, width: 0, height: 0 };
  // Stacked, each piece starts where the ones before it in its category end: positive values stack up from
  // zero and negative ones down, bars among bars and areas among areas.
  const starts = series.map(() => null as number[] | null);
  if (stacked) {
    const zeros = () => cats.map(() => 0);
    const ends = { bar: [zeros(), zeros()], area: [zeros(), zeros()] };
    series.forEach((s, k) => {
      if (s.line && !s.area) return;
      const [up, down] = s.area ? ends.area : ends.bar;
      starts[k] = s.data.map((v, i) => {
        if (!Number.isFinite(v)) return 0;
        const from = v >= 0 ? up[i] : down[i];
        v >= 0 ? (up[i] += v) : (down[i] += v);
        return from;
      });
    });
  }
  const startOf = (k: number, i: number) => starts[k]?.[i] ?? 0;

  const draw = (area: Area): string => {
    const { w: width, h: height } = area;
    const m = measurer(area.font);
    const text = (raw: string | undefined, size: number, max = 4000, limit = max) => layoutLabel(raw, m, size, max, limit);
    const lineHeight = text('0', SMALL).height;
    const lineWidth = d.lineWidth ?? 2;
    const tinyHeight = text('0', TINY).height;

    // The value range: taken from the data (stacked, the ends of the stacks), where bars and areas stand on
    // zero, and grown to whole steps.
    const bars = series.filter(s => !s.line).length;
    let lo = Infinity;
    let hi = -Infinity;
    series.forEach((s, k) => s.data.forEach((v, i) => Number.isFinite(v) && ((lo = Math.min(lo, (v += startOf(k, i)))), (hi = Math.max(hi, v)))));
    // reference lines stay in view
    for (const r of d.refs ?? []) (lo = Math.min(lo, r.value)), (hi = Math.max(hi, r.value));
    if (lo > hi) lo = hi = 0;
    if (bars > 0 || series.some(s => s.area)) (lo = Math.min(lo, 0)), (hi = Math.max(hi, 0));
    let axis = { lo, hi, ticks: [] as number[] };
    const valueMarks = (length: number, spacing: number): Mark[] => {
      axis = valueAxis(lo, hi, Math.floor(length / spacing), d.fixed);
      const shown = tickLabels(axis.ticks, d.format);
      return axis.ticks.map((v, i) => ({ at: (v - axis.lo) / (axis.hi - axis.lo), label: text(d.hideValueAxis ? '' : shown[i], SMALL) }));
    };

    // Places along the category axis are fractions of its length: categories sit in the middle of equal slots.
    const slot = 1 / count;
    const place = (i: number) => (i + 0.5) * slot;
    const valueTitle = text(d.hideValueAxis ? '' : d.title, SMALL, (horizontal ? width : height) * 0.8);
    const catTitle = text(d.catTitle, SMALL, (horizontal ? height : width) * 0.8);
    const wrapAt = horizontal ? width * 0.3 : Math.max(48, (width - 2 * PAD - 64) * slot - 8);
    // a long word is cut short: beside bars where it wraps, under columns past a slot (at least 120px)
    const categories = cats.map(c => text(d.hideCategoryAxis ? '' : c, SMALL, wrapAt, horizontal ? wrapAt : Math.max(wrapAt, 120)));
    const categoryWidth = most(categories, l => l.width);
    const categoryHeight = most(categories, l => l.height);

    // The labelled categories: labels that would run into each other are thinned out.
    const categoryMarks = (length: number): Mark[] => {
      const need = horizontal ? categoryHeight : categoryWidth + 12;
      const every = Math.max(1, Math.ceil(need / (length * slot)));
      const marks: Mark[] = [];
      for (let i = 0; i < cats.length; i += every) marks.push({ at: place(i), label: categories[i] });
      return marks;
    };

    // Room past the end of the value axis for what is written beside a point or a bar.
    const labelled = series.map(s => (d.showValues ? s.data.map(v => (Number.isFinite(v) ? d.format(v, undefined, s.f) : '')) : []));
    let pointLabelWidth = 0;
    let valueWidth = 0;
    let negWidth = 0;
    series.forEach((s, k) =>
      labelled[k].forEach((t, i) => {
        const w = m.width(t, TINY);
        if (s.line) pointLabelWidth = Math.max(pointLabelWidth, w);
        else if (horizontal) (valueWidth = Math.max(valueWidth, w)), s.data[i] < 0 && !stacked && (negWidth = Math.max(negWidth, w));
      })
    );

    const bottomLabelHeight = horizontal ? lineHeight : categoryHeight;
    const [bottomTitle, leftTitle] = horizontal ? [valueTitle, catTitle] : [catTitle, valueTitle];
    const bottomSpace = TICK + (bottomLabelHeight > 0 ? bottomLabelHeight + 4 : 0) + (bottomTitle.height > 0 ? bottomTitle.height + 4 : 0);
    // above the plot: room for point labels; across bars, for reference lines' labels
    const headroom = horizontal ? (d.refs?.length ? tinyHeight + 4 : 0) : pointLabelWidth > 0 || d.showValues ? tinyHeight + 4 : lineHeight / 2;
    const top = PAD + headroom;
    const plotHeight = Math.max(1, height - PAD - bottomSpace - top);
    const bottom = top + plotHeight;

    const leftMarks = horizontal ? categoryMarks(plotHeight) : valueMarks(plotHeight, 56);
    const leftLabelWidth = most(leftMarks, mark => mark.label.width);
    const left = PAD + (leftTitle.height > 0 ? leftTitle.height + 6 : 0) + (leftLabelWidth > 0 ? leftLabelWidth + 6 : 0) + TICK;
    const beside = Math.max(pointLabelWidth > 0 ? pointLabelWidth + 12 : 0, valueWidth > 0 ? valueWidth + 8 : 0);
    const reach = horizontal ? Math.min(width * 0.25, beside) : 0;
    let plotWidth = Math.max(1, width - PAD - left - reach);
    // labels left of negative bars: the axis reaches further left, so they stay off the category labels
    const f = negWidth && Math.min(0.4, (negWidth + 8) / plotWidth);
    if (f) lo = Math.min(lo, (lo - f * hi) / (1 - f));
    const bottomMarks = horizontal ? valueMarks(plotWidth, 80) : categoryMarks(plotWidth);
    if (reach === 0) {
      let over = 0;
      for (const mark of bottomMarks) over = Math.max(over, mark.at * plotWidth + mark.label.width / 2 - plotWidth);
      plotWidth = Math.max(1, plotWidth - over);
    }
    const right = left + plotWidth;
    hitBox = { left, top, width: plotWidth, height: plotHeight };

    const px = (c: number, v: number) => left + (horizontal ? v : c) * plotWidth;
    const py = (c: number, v: number) => (horizontal ? top + c * plotHeight : bottom - v * plotHeight);
    const point = (c: number, v: number) => pt(px(c, v), py(c, v));
    const scale = (value: number) => (value - axis.lo) / (axis.hi - axis.lo);
    const clamp = (v: number) => Math.min(Math.max(v, 0), 1);
    // a line across the plot at a place on the value axis
    const rule = (v: number) => (horizontal ? `M${pt(px(0, v), top)}V${num(bottom)}` : `M${pt(left, py(0, v))}H${num(right)}`);

    let grid = '';
    if (d.grid !== false) for (const mark of horizontal ? bottomMarks : leftMarks) grid += rule(mark.at);
    let axisPath = `M${pt(left, top)}V${num(bottom)}M${pt(left, bottom)}H${num(right)}`;
    let labels = '';
    for (const { at, label } of leftMarks) {
      const y = py(at, at);
      axisPath += `M${pt(left, y)}h${-TICK}`;
      labels += aligned(label, left - TICK - 6, y, 'end');
    }
    for (const { at, label } of bottomMarks) {
      const x = px(at, at);
      axisPath += `M${pt(x, bottom)}v${TICK}`;
      labels += aligned(label, x, bottom + TICK + 4 + label.height / 2, 'middle');
    }

    const span = (horizontal ? plotHeight : plotWidth) * slot;
    // side by side, a category's bars share 70% of its slot; stacked, its one bar takes all of that
    const across = stacked ? 1 : bars;
    const thickness = (span * (d.barWidth ?? 0.7)) / Math.max(across, 1);
    const gap = across > 1 ? Math.min(2, thickness * 0.2) : 0;
    const base = clamp(scale(0));
    // bars that go both ways get a line to stand on
    if (bars > 0 && base > 0 && base < 1) axisPath += rule(base);

    // Lines are drawn over the bars, as a bar would hide part of one under it.
    let barsOut = '';
    let linesOut = '';
    let outside = '';
    let inside = '';
    let areas = '';
    let pointLabels = '';
    let bar = 0;
    series.forEach((s, index) => {
      const color = seriesColor(index);
      const n = Math.min(s.data.length, count);
      if (!s.line) {
        const offset = stacked ? -thickness / 2 : (bar++ - (bars - 1) / 2) * thickness - (thickness - gap) / 2;
        let rects = '';
        for (let i = 0; i < n; i++) {
          const value = s.data[i];
          if (!Number.isFinite(value)) continue;
          const c = place(i);
          const below = startOf(index, i);
          const start = clamp(scale(below));
          const v = clamp(scale(value + below));
          const from = Math.min(start, v);
          const to = Math.max(start, v);
          const bx = horizontal ? px(c, from) : px(c, 0) + offset;
          const by = horizontal ? py(c, 0) + offset : py(c, to);
          const bw = horizontal ? (to - from) * plotWidth : thickness - gap;
          const bh = horizontal ? thickness - gap : (to - from) * plotHeight;
          const r = d.barRadius && Math.min(d.barRadius, bw / 2, bh / 2);
          rects += `<rect ${pos(bx, by)} width="${num(bw)}" height="${num(bh)}"${r ? ` rx="${num(r)}"` : ''}${d.vary ? ` fill="${seriesColor(i)}"` : ''}/>`;
          const label = labelled[index][i];
          if (!label) continue;
          const lw = m.width(label, TINY);
          // towards the end of the bar: 1 when it runs up or right from the baseline, -1 the other way
          const out = v >= start ? 1 : -1;
          let tx = bx + bw / 2;
          let ty = by + bh / 2;
          let anchor = 'middle';
          if (stacked) {
            // in the middle of its piece, when it fits there
            if (horizontal ? bw < lw + 4 || bh < tinyHeight : bh < tinyHeight || bw < lw + 2) continue;
          } else if (horizontal) {
            if (bh < TINY) continue;
            tx = (out > 0 ? bx + bw : bx) + out * 6;
            anchor = out > 0 ? 'start' : 'end';
          } else {
            if (lw + 2 > span / bars) continue;
            ty = (out > 0 ? by : by + bh) - out * (tinyHeight / 2 + 2);
          }
          const t = textAt(tx, ty, TINY, label, ` text-anchor="${anchor}"`);
          stacked ? (inside += t) : (outside += t);
        }
        barsOut += `<g class="c-series c-bars" data-s="${index}" fill="${color}">${rects}</g>`;
        return;
      }

      // An area is filled from its line down to where it starts (zero, or the area under it when stacked).
      if (s.area) {
        let edge = '';
        let under = '';
        let runs = '';
        for (let i = 0; i <= n; i++) {
          const value = s.data[i];
          if (i < n && Number.isFinite(value)) {
            const c = place(i);
            const below = startOf(index, i);
            edge += (edge ? 'L' : 'M') + point(c, clamp(scale(value + below)));
            under = 'L' + point(c, clamp(scale(below))) + under;
          } else if (edge) {
            runs += edge + under + 'Z';
            edge = under = '';
          }
        }
        if (runs) areas += `<path class="c-area" data-s="${index}" d="${runs}" fill="${color}" fill-opacity="0.3" stroke="none"/>`;
      }
      // A line is cut where it leaves the value range, so it stays inside the plot.
      let path = '';
      let dots = '';
      let pen = false;
      let pc = 0;
      let pv = NaN;
      for (let i = 0; i < n; i++) {
        const value = s.data[i] + startOf(index, i);
        if (!Number.isFinite(value)) {
          pv = NaN;
          continue;
        }
        const c = place(i);
        const v = scale(value);
        const visible = v >= 0 && v <= 1;
        if (pv !== pv) {
          if (visible) path += 'M' + point(c, v);
          pen = visible;
        } else {
          const dv = v - pv;
          let t0 = 0;
          let t1 = 1;
          if (dv !== 0) {
            const a = -pv / dv;
            const b = (1 - pv) / dv;
            t0 = Math.max(t0, Math.min(a, b));
            t1 = Math.min(t1, Math.max(a, b));
          } else if (!visible) t0 = 2;
          if (t0 <= t1) {
            if (!pen || t0 > 0) path += 'M' + point(pc + (c - pc) * t0, pv + dv * t0);
            path += 'L' + point(pc + (c - pc) * t1, pv + dv * t1);
          }
          pen = visible;
        }
        pc = c;
        pv = v;
        if (!visible) continue;
        const cx = px(c, v);
        const cy = py(c, v);
        if (d.markers || (d.markers !== false && span >= 12 && !s.area)) dots += `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(Math.max(3, lineWidth + 1))}"/>`;
        const label = text(labelled[index][i], TINY);
        if (label.height > 0) {
          const half = label.width / 2;
          pointLabels += horizontal
            ? aligned(label, cx + 10, cy, 'start')
            : aligned(label, Math.max(Math.min(cx, right - half), left + half), cy - 6 - label.height / 2, 'middle');
        }
      }
      linesOut +=
        `<g class="c-series c-line" data-s="${index}" fill="${color}">` +
        (path ? `<path d="${path}" fill="none" stroke="${color}" stroke-width="${lineWidth}" stroke-linecap="round" stroke-linejoin="round"/>` : '') +
        dots +
        '</g>';
    });

    const titles = (leftTitle.height > 0 ? sideTitle(leftTitle, top + plotHeight / 2) : '') + (bottomTitle.height > 0 ? labelSvg(bottomTitle, left + plotWidth / 2, height - PAD - bottomTitle.height / 2) : '');

    // reference lines: dashed across the plot, labelled at their far end
    let refs = '';
    for (const r of d.refs ?? []) {
      const v = clamp(scale(r.value));
      const color = r.color ?? 'var(--_fg)';
      const [x, y, anchor] = horizontal ? [px(0, v) + 4, top - tinyHeight / 2 - 2, 'start'] : [right, py(0, v) - tinyHeight / 2 - 2, 'end'];
      // a halo in the tile's color keeps the label readable over bars of its own color
      refs +=
        `<path d="${rule(v)}" stroke="${color}" stroke-dasharray="5 4" fill="none"/>` +
        textAt(x, y, TINY, esc(r.label), ` text-anchor="${anchor}" fill="${color}" stroke="var(--_bg)" stroke-width="3" paint-order="stroke"`);
    }

    return svgDocument(
      'xychart',
      area,
      (grid ? `<path class="c-grid" d="${grid}" stroke="var(--_a)"/>` : '') +
        `<g class="c-plot">${areas}${barsOut}${linesOut}</g>` +
        group(`class="c-ref-lines" font-size="${TINY}"`, refs) +
        `<path class="c-axis" d="${axisPath}" fill="none" stroke="var(--_b)"/>` +
        `<g class="c-axis-labels" font-size="${SMALL}" fill="var(--_m)">${labels}</g>` +
        group(`class="c-axis-titles" font-size="${SMALL}"`, titles) +
        group(`class="c-data-labels" font-size="${TINY}" fill="var(--_m)"`, outside) +
        group(`class="c-data-labels" font-size="${TINY}" fill="var(--_bg)"`, inside) +
        group(`class="c-point-labels" font-size="${TINY}" fill="var(--_m)"`, pointLabels)
    );
  };

  /** The category under (x, y) in the last drawing, or −1 off the plot. */
  const hit = (x: number, y: number): number => {
    const b = hitBox;
    if (x < b.left || x > b.left + b.width || y < b.top || y > b.top + b.height) return -1;
    const i = Math.floor((horizontal ? (y - b.top) / b.height : (x - b.left) / b.width) * count);
    return i >= 0 && i < cats.length ? i : -1;
  };

  return { draw, hit };
}
