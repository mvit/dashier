/** Treemaps: Pele's squarified treemap (MIT, © 2026 kepano), filling the tile, with the report's number format. */
import { Area, LEAST, PAD, ROUNDED, SIZE, SMALL, TINY, esc, fitText, group, measurer, num, pos, seriesColor, svgDocument, textAt } from './svg';

const HEADER = 28;
const SIDE = 6;
const GAP = 4;
const LINE = 1.25;

/** A leaf with a value, or a section of leaves. */
export interface TreeNode {
  name: string;
  value?: number;
  children?: TreeNode[];
}

interface Box {
  node: TreeNode;
  /** The node's place in the input (its tooltip), counted parents first. */
  index: number;
  parent: Box | undefined;
  /** Position among the top-level nodes, which picks the color. */
  series: number;
  value: number;
  children: Box[];
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Lays out boxes in the rectangle as one squarified treemap: rows are added along the shorter side, and a row
 * stops growing when another box would make its boxes less square.
 */
function squarify(boxes: Box[], total: number, x: number, y: number, w: number, h: number): void {
  let rest = total;
  let from = 0;
  while (from < boxes.length) {
    const scale = (w * h) / rest;
    const side = Math.min(w, h);
    let sum = boxes[from].value * scale;
    const largest = sum;
    let worst = Math.max((side * side * largest) / (sum * sum), (sum * sum) / (side * side * largest));
    let to = from + 1;
    while (to < boxes.length) {
      const smallest = boxes[to].value * scale;
      const next = sum + smallest;
      const ratio = Math.max((side * side * largest) / (next * next), (next * next) / (side * side * smallest));
      if (ratio > worst) break;
      (worst = ratio), (sum = next), to++;
    }
    const thickness = sum / side;
    let offset = 0;
    for (let i = from; i < to; i++) {
      const b = boxes[i];
      const length = i === to - 1 ? side - offset : (b.value * scale) / thickness;
      const bx = w >= h ? x : x + offset;
      const by = w >= h ? y + offset : y;
      const x0 = Math.round(bx + GAP / 2);
      const y0 = Math.round(by + GAP / 2);
      (b.x = x0), (b.y = y0);
      b.w = Math.round(bx + (w >= h ? thickness : length) - GAP / 2) - x0;
      b.h = Math.round(by + (w >= h ? length : thickness) - GAP / 2) - y0;
      offset += length;
      rest -= b.value;
    }
    if (w >= h) (x += thickness), (w -= thickness);
    else (y += thickness), (h -= thickness);
    from = to;
  }
}

/** Every node as a box with its total, in the order of data-i (top level first, then each box's children). */
function tree(roots: TreeNode[]): Box[] {
  let index = 0;
  const box = (node: TreeNode, parent: Box | undefined, series: number): Box => ({
    node, index: index++, parent, series, value: node.children === undefined && Number.isFinite(node.value) && node.value! > 0 ? node.value! : 0,
    children: [], x: 0, y: 0, w: 0, h: 0
  });
  const all = roots.map((node, i) => box(node, undefined, i));
  for (let i = 0; i < all.length; i++) {
    for (const node of all[i].node.children ?? []) {
      const child = box(node, all[i], all[i].series);
      all[i].children.push(child);
      all.push(child);
    }
  }
  for (let i = all.length - 1; i >= 0; i--) if (all[i].parent) all[i].parent!.value += all[i].value;
  return all;
}

/** The boxes of `all` (from tree) that get a size, placed afresh in width × height, parents before their children. */
function layout(all: Box[], width: number, height: number): Box[] {
  const placed: Box[] = [];
  const place = (children: Box[], x: number, y: number, w: number, h: number) => {
    if (w <= 0 || h <= 0) return;
    const shown = children.filter(b => b.value > 0).sort((a, b) => b.value - a.value);
    const total = shown.reduce((a, b) => a + b.value, 0);
    if (!shown.length || !Number.isFinite(total)) return;
    squarify(shown, total, x - GAP / 2, y - GAP / 2, w + GAP, h + GAP);
    for (const b of shown) if (b.w > 0 && b.h > 0) placed.push(b);
  };
  place(all.filter(b => !b.parent), 0, 0, width, height);
  for (let i = 0; i < placed.length; i++) {
    const b = placed[i];
    if (b.children.length) place(b.children, b.x + SIDE, b.y + HEADER, b.w - 2 * SIDE, b.h - HEADER - SIDE);
  }
  return placed;
}

/** `format` writes values on the boxes. Boxes carry data-i: their node's place, counted parents first. */
export function treemapChart(roots: TreeNode[], format: (v: number) => string) {
  // totals are worked out once; each drawing only places the boxes
  const all = tree(roots);
  const nodes = all.map(b => ({ name: b.node.name, value: b.value }));

  const draw = (area: Area): string => {
    const m = measurer(area.font);
    const boxes = layout(all, area.w - 2 * PAD, area.h - 2 * PAD);
    let sections = '';
    let leaves = '';
    for (const b of boxes) {
      const color = seriesColor(b.series);
      const [x, y] = [PAD + b.x, PAD + b.y];
      const name = b.node.name.trim();
      const value = format(b.value);
      const rect = `<rect ${pos(x, y)} width="${num(b.w)}" height="${num(b.h)}" fill="${color}"`;
      if (b.node.children !== undefined) {
        let text = '';
        if (b.h >= HEADER) {
          const room = b.w - 2 * SIDE - 4;
          const valueWidth = m.width(value, TINY);
          const withValue = room - valueWidth - 12 >= 3 * SMALL;
          const label = fitText(name, withValue ? room - valueWidth - 12 : room, SMALL, SMALL, m, true);
          const baseline = y + HEADER / 2 + 1;
          if (label) text += textAt(x + SIDE + 2, baseline, SMALL, esc(label.text), ' font-weight="bold"');
          if (withValue) text += textAt(x + b.w - SIDE - 2, baseline, TINY, esc(value), ` class="c-value" font-size="${TINY}" text-anchor="end" fill="var(--_m)"`);
        }
        // a section is a tint of its color
        sections += `<g class="c-node c-section" data-i="${b.index}">${rect} fill-opacity="0.12" stroke="${color}"${ROUNDED}/>${text}</g>`;
        continue;
      }
      let text = '';
      const room = b.w - 8;
      const tallest = Math.min(SIZE, Math.floor((b.h - 4) / LINE));
      const label = tallest >= LEAST ? fitText(name, room, tallest, LEAST, m) : undefined;
      if (label) {
        const cy = y + b.h / 2;
        const line = (at: number, size: number, body: string, attrs = '') => textAt(x + b.w / 2, at, size, esc(body), `${attrs} font-size="${num(size)}"`);
        const valueSize = Math.max(LEAST, Math.round(label.size * 0.8));
        const lines = (label.size + valueSize) * LINE;
        if (lines <= b.h - 4 && m.width(value, valueSize) <= room) {
          const first = cy - lines / 2 + (label.size * LINE) / 2;
          const second = cy + lines / 2 - (valueSize * LINE) / 2;
          text = line(first, label.size, label.text) + line(second, valueSize, value, ' class="c-value"');
        } else text = line(cy, label.size, label.text);
      }
      leaves += `<g class="c-node c-leaf" data-i="${b.index}">${rect}${ROUNDED}/>${text}</g>`;
    }
    return svgDocument(
      'treemap',
      area,
      group(`class="c-sections" font-size="${SMALL}"`, sections) + group('class="c-leaves" text-anchor="middle" fill="var(--_bg)"', leaves)
    );
  };
  return { draw, nodes };
}
