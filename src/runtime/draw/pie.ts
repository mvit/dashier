/** Pie and donut charts: Pele's pie renderer (MIT, © 2026 kepano), filling the tile, without its legend and title. */
import { Area, PAD, SMALL, group, measurer, num, pt, seriesColor, svgDocument, textAt } from './svg';

const OUTSIDE = 28;
const TEXT_POSITION = 0.75;

const point = (angle: number, radius: number) => pt(Math.sin(angle) * radius, -Math.cos(angle) * radius);

function slice(start: number, end: number, outer: number, inner: number): string {
  if (end - start >= Math.PI * 2 - 1e-9) {
    const ring = (r: number, sweep: number) => `M0,${num(-r)}A${num(r)},${num(r)} 0 1 ${sweep} 0,${num(r)}A${num(r)},${num(r)} 0 1 ${sweep} 0,${num(-r)}Z`;
    return ring(outer, 1) + (inner > 0 ? ring(inner, 0) : '');
  }
  const large = end - start > Math.PI ? 1 : 0;
  if (inner <= 0) return `M0,0L${point(start, outer)}A${num(outer)},${num(outer)} 0 ${large} 1 ${point(end, outer)}Z`;
  return `M${point(start, outer)}A${num(outer)},${num(outer)} 0 ${large} 1 ${point(end, outer)}L${point(end, inner)}A${num(inner)},${num(inner)} 0 ${large} 0 ${point(start, inner)}Z`;
}

/**
 * Slices in order, each with its share of the total written on it (or beside it when it's too thin). A donut
 * has a hole of `hole` times the radius.
 */
export function pieChart(values: number[], hole = 0) {
  const sum = values.reduce((a, v) => a + v, 0);
  // a share under 1% gets no slice, as in Mermaid
  const shares = values.map(v => {
    const share = sum > 0 ? v / sum : 0;
    return share * 100 >= 1 && (share * 100).toFixed(0) !== '0' ? share : 0;
  });

  return (area: Area): string => {
    const m = measurer(area.font);
    const label = (share: number) => (share * 100).toFixed(0) + '%';
    // a slice too thin for its percentage gets the label outside the rim, which needs a margin
    const narrowAt = (radius: number) =>
      shares.map(share => share > 0 && share < 0.5 && 2 * radius * TEXT_POSITION * Math.sin(share * Math.PI) < m.width(label(share), SMALL) + 6);
    let radius = Math.max(4, (Math.min(area.w, area.h) - 2 * PAD) / 2);
    let narrow = narrowAt(radius);
    if (narrow.includes(true)) narrow = narrowAt((radius = Math.max(4, radius - OUTSIDE)));

    let slices = '';
    let inside = '';
    let outside = '';
    let angle = 0;
    const rim = radius + OUTSIDE / 2;
    const placed: { x: number; y: number; width: number }[] = [];
    const clear = (x: number, y: number, width: number) =>
      placed.every(o => Math.abs(x - o.x) >= (width + o.width) / 2 + 2 || Math.abs(y - o.y) >= SMALL + 2);
    shares.forEach((share, index) => {
      if (share === 0) return;
      const end = angle + share * Math.PI * 2;
      slices += `<path class="c-slice" data-i="${index}" d="${slice(angle, end, radius, hole * radius)}" fill="${seriesColor(index)}"/>`;
      const mid = (angle + end) / 2;
      const text = label(share);
      if (narrow[index]) {
        // walk around the rim until the label is clear of the ones already placed
        const width = m.width(text, SMALL);
        let at = mid;
        for (let step = 0; step < 360 && !clear(Math.sin(at) * rim, -Math.cos(at) * rim, width); step++) at += 2 / rim;
        const x = Math.sin(at) * rim;
        const y = -Math.cos(at) * rim;
        placed.push({ x, y, width });
        outside += textAt(x, y, SMALL, text);
      } else {
        // on a donut, in the middle of the ring
        const r = hole > 0 ? (radius * (1 + hole)) / 2 : radius * TEXT_POSITION;
        inside += textAt(Math.sin(mid) * r, -Math.cos(mid) * r, SMALL, text);
      }
      angle = end;
    });
    if (!slices) slices = `<circle class="c-slice" r="${num(radius)}" fill="none" stroke="var(--_b)"/>`;

    const at = `transform="translate(${num(area.w / 2)},${num(area.h / 2)})"`;
    return svgDocument(
      'pie',
      area,
      `<g class="c-slices" ${at} stroke="var(--_bg)" stroke-width="1" stroke-linejoin="round">${slices}</g>` +
        group(`class="c-slice-labels" ${at} font-size="${SMALL}" text-anchor="middle" fill="var(--_bg)"`, inside) +
        group(`class="c-slice-labels" ${at} font-size="${SMALL}" text-anchor="middle"`, outside)
    );
  };
}
