/** Radar charts: Pele's radar renderer (MIT, © 2026 kepano), fitted into the tile, without its legend and title. */
import { Area, Label, PAD, SMALL, group, labelSvg, layoutLabel, measurer, num, pt, seriesColor, svgDocument } from './svg';

const TICKS = 5;
const LABEL_FACTOR = 1.05;
const TENSION = 0.17;

interface Point {
  x: number;
  y: number;
}

/** A closed Catmull-Rom spline through the points, as cubic Bézier segments. */
function closedRoundCurve(points: Point[]): string {
  const n = points.length;
  let d = 'M' + pt(points[0].x, points[0].y);
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [points[(i - 1 + n) % n], points[i], points[(i + 1) % n], points[(i + 2) % n]];
    d +=
      ` C${pt(p1.x + (p2.x - p0.x) * TENSION, p1.y + (p2.y - p0.y) * TENSION)} ${pt(p2.x - (p3.x - p1.x) * TENSION, p2.y - (p3.y - p1.y) * TENSION)} ${pt(p2.x, p2.y)}`;
  }
  return d + ' Z';
}

/** One curve per series over the axes, scaled from `low` (0 unless set) at the center to `high` (the largest value unless set). */
export function radarChart(axes: string[], curves: number[][], low = 0, high?: number) {
  const count = axes.length;
  const unit: Point[] = axes.map((_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });
  const span = (high ?? Math.max(...curves.flat(), 0)) - low || 1;

  return (area: Area): string => {
    const m = measurer(area.font);
    const labels: Label[] = axes.map(a => layoutLabel(a, m, SMALL, Math.max(60, area.w / 4)));
    // Each label hangs off its axis on the side away from the center; the chart is drawn around the origin.
    const layout = (radius: number) => {
      let [x0, x1, y0, y1] = [-radius - PAD, radius + PAD, -radius - PAD, radius + PAD];
      const at = unit.map((u, i) => {
        const l = labels[i];
        const r = radius * LABEL_FACTOR + 6;
        const cx = u.x * r + (u.x > 0.01 ? l.width / 2 : u.x < -0.01 ? -l.width / 2 : 0);
        const cy = u.y * r + (u.y > 0.01 ? l.height / 2 : u.y < -0.01 ? -l.height / 2 : 0);
        (x0 = Math.min(x0, cx - l.width / 2)), (x1 = Math.max(x1, cx + l.width / 2));
        (y0 = Math.min(y0, cy - l.height / 2)), (y1 = Math.max(y1, cy + l.height / 2));
        return { cx, cy };
      });
      return { at, x0, x1, y0, y1 };
    };
    // as Pele fits a chart to a width: draw, then give up the overflow, a few times
    let radius = Math.max(8, Math.min(area.w, area.h) / 2 - PAD);
    let box = layout(radius);
    for (let round = 0; round < 3; round++) {
      const over = Math.max(box.x1 - box.x0 - area.w, box.y1 - box.y0 - area.h);
      if (over <= 0.5 || radius <= 8) break;
      box = layout((radius = Math.max(8, radius - over / 2)));
    }

    let grid = '';
    for (let i = 0; i < TICKS; i++) grid += `<circle r="${num((radius * (i + 1)) / TICKS)}"/>`;
    let spokes = '';
    let labelsOut = '';
    unit.forEach((u, i) => {
      spokes += 'M0,0L' + pt(u.x * radius, u.y * radius);
      labelsOut += `<g class="c-axis-label" data-i="${i}">${labelSvg(labels[i], box.at[i].cx, box.at[i].cy)}</g>`;
    });
    let shapes = '';
    curves.forEach((entries, index) => {
      const points = entries.map((v, i) => {
        const r = (radius * Math.min(Math.max(v - low, 0), span)) / span;
        return { x: unit[i].x * r, y: unit[i].y * r };
      });
      const color = seriesColor(index);
      shapes += `<path class="c-curve" data-i="${index}" fill="${color}" stroke="${color}" d="${closedRoundCurve(points)}"/>`;
    });

    const origin = `translate(${pt((area.w - (box.x1 - box.x0)) / 2 - box.x0, (area.h - (box.y1 - box.y0)) / 2 - box.y0)})`;
    return svgDocument(
      'radar',
      area,
      `<g transform="${origin}">` +
        `<g class="c-graticule" fill="none" stroke="var(--_a)">${grid}</g>` +
        `<path class="c-axes" d="${spokes}" fill="none" stroke="var(--_b)"/>` +
        group('class="c-curves" fill-opacity="0.2" stroke-width="1.5" stroke-linejoin="round"', shapes) +
        `<g class="c-axis-labels" font-size="${SMALL}">${labelsOut}</g></g>`
    );
  };
}

