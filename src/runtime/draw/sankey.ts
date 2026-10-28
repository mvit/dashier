/** Sankey charts: Pele's sankey layout and renderer (MIT, © 2026 kepano), fitted into the tile. */
import { Area, PAD, SMALL, esc, measurer, num, pos, pt, seriesColor, svgDocument, textAt } from './svg';

const PASSES = 6;
const NODE_WIDTH = 10;
const NODE_PADDING = 12 + 15; // and room for the value under a label
const LABEL_GAP = 6;

export interface Flow {
  source: number;
  target: number;
  value: number;
}

interface PlacedNode {
  value: number;
  x: number;
  y: number;
  height: number;
}

interface PlacedLink extends Flow {
  thickness: number;
  sourceY: number;
  targetY: number;
}

// Most nodes have a handful of bands, and the built-in sort is slow to start on short lists.
function sort(list: number[], compare: (a: number, b: number) => number): void {
  if (list.length > 8) return void list.sort(compare);
  for (let i = 1; i < list.length; i++) {
    const item = list[i];
    let j = i - 1;
    while (j >= 0 && compare(list[j], item) > 0) (list[j + 1] = list[j]), j--;
    list[j + 1] = item;
  }
}

/**
 * Places nodes in columns by their distance from a source, sizes them by their flow, and then lets each column
 * settle next to its neighbours so that the bands cross less. Throws on a circular flow.
 */
function layoutSankey(names: string[], flows: Flow[], width: number, height: number, labelHeight: number): { nodes: PlacedNode[]; links: PlacedLink[] } {
  const n = names.length;
  const links: PlacedLink[] = flows.map(f => ({ ...f, value: Number.isFinite(f.value) && f.value > 0 ? f.value : 0, thickness: 0, sourceY: 0, targetY: 0 }));
  const outgoing: number[][] = names.map(() => []);
  const incoming: number[][] = names.map(() => []);
  links.forEach((link, k) => (outgoing[link.source].push(k), incoming[link.target].push(k)));

  // longest distance from a source, in topological order; what is left over lies on a cycle
  const depth = new Int32Array(n);
  const pending = new Int32Array(n);
  const order: number[] = [];
  for (let i = 0; i < n; i++) if ((pending[i] = incoming[i].length) === 0) order.push(i);
  for (let q = 0; q < order.length; q++) {
    const i = order[q];
    for (const k of outgoing[i]) {
      const t = links[k].target;
      if (depth[t] < depth[i] + 1) depth[t] = depth[i] + 1;
      if (--pending[t] === 0) order.push(t);
    }
  }
  if (order.length < n) {
    let stuck = 0;
    while (pending[stuck] === 0) stuck++;
    throw new Error(`A sankey can't flow in a circle, and "${names[stuck]}" is part of one.`);
  }
  // a source that only feeds later columns (a gain added to profit) sits just before them, not at the far left
  for (let i = 0; i < n; i++)
    if (!incoming[i].length && outgoing[i].length) depth[i] = Math.max(0, Math.min(...outgoing[i].map(k => depth[links[k].target])) - 1);
  let layers = 1;
  for (let i = 0; i < n; i++) layers = Math.max(layers, depth[i] + 1);

  // flows are scaled to the largest one, so that sums of huge values stay finite
  const largest = links.reduce((a, l) => Math.max(a, l.value), 0);
  const unit = largest > 0 ? 1 / largest : 0;
  const nodes: PlacedNode[] = [];
  const flow = new Float64Array(n);
  const columns: number[][] = Array.from({ length: layers }, () => []);
  const step = layers > 1 ? (width - NODE_WIDTH) / (layers - 1) : 0;
  for (let i = 0; i < n; i++) {
    // justified: a node without outgoing flows sits in the last column
    const layer = outgoing[i].length > 0 ? depth[i] : layers - 1;
    let [into, out, value, valueOut] = [0, 0, 0, 0];
    for (const k of incoming[i]) (into += links[k].value * unit), (value += links[k].value);
    for (const k of outgoing[i]) (out += links[k].value * unit), (valueOut += links[k].value);
    flow[i] = Math.max(into, out);
    nodes.push({ value: Math.max(value, valueOut), x: layer * step, y: 0, height: 0 });
    columns[layer].push(i);
  }

  const tallest = Math.max(1, ...columns.map(c => c.length));
  const gap = tallest > 1 ? Math.min(NODE_PADDING, height / (tallest - 1)) : NODE_PADDING;
  let scale = Infinity;
  for (const column of columns) {
    let sum = 0;
    for (const i of column) sum += flow[i];
    if (sum > 0) scale = Math.min(scale, (height - (column.length - 1) * gap) / sum);
  }
  if (!Number.isFinite(scale) || scale < 0) scale = 0;

  // A thin node still needs room for its label. Where every column can afford it, each node claims at least
  // a label's height, and the flows are scaled down to make that fit.
  let claim = Math.max(0, labelHeight - gap);
  const fits = (s: number) =>
    columns.every(column => column.reduce((extent, i) => extent + Math.max(flow[i] * s, claim), (column.length - 1) * gap) <= height + 1e-6);
  if (claim > 0 && !fits(scale)) {
    if (fits(0)) {
      let low = 0;
      for (let k = 0; k < 40; k++) {
        const mid = (low + scale) / 2;
        if (fits(mid)) low = mid;
        else scale = mid;
      }
      scale = low;
    } else claim = 0;
  }

  // the room a node keeps clear above and below itself
  const margin = new Float64Array(n);
  for (const link of links) link.thickness = link.value * unit * scale;
  for (const column of columns) {
    let y = 0;
    for (const i of column) {
      nodes[i].height = flow[i] * scale;
      margin[i] = Math.max(0, claim - nodes[i].height) / 2;
      nodes[i].y = y + margin[i];
      y += nodes[i].height + 2 * margin[i] + gap;
    }
    // spare room is shared out between the nodes of a column
    const spare = (height - y + gap) / (column.length + 1);
    column.forEach((i, k) => (nodes[i].y += spare * (k + 1)));
  }

  const center = (i: number) => nodes[i].y + nodes[i].height / 2;
  // Bands leave and enter a node in the order of where they go, so they do not cross at it.
  const sourceOffset = new Float64Array(links.length);
  const targetOffset = new Float64Array(links.length);
  const byTarget = (a: number, b: number) => center(links[a].target) - center(links[b].target) || a - b;
  const bySource = (a: number, b: number) => center(links[a].source) - center(links[b].source) || a - b;
  const byCenter = (a: number, b: number) => center(a) - center(b) || a - b;
  const stackOut = (i: number) => {
    let y = 0;
    sort(outgoing[i], byTarget);
    for (const k of outgoing[i]) (sourceOffset[k] = y + links[k].thickness / 2), (y += links[k].thickness);
  };
  const stackIn = (i: number) => {
    let y = 0;
    sort(incoming[i], bySource);
    for (const k of incoming[i]) (targetOffset[k] = y + links[k].thickness / 2), (y += links[k].thickness);
  };
  const stackAll = () => {
    for (let i = 0; i < n; i++) stackOut(i), stackIn(i);
  };

  // Moves each node of a column towards where its bands would run level, then restores the order and the
  // gaps. `forward` looks at the bands coming in, otherwise at those going out.
  const settle = (column: number[], pull: number, forward: boolean) => {
    for (const i of column) {
      const list = forward ? incoming[i] : outgoing[i];
      if (!list.length) continue;
      forward ? stackIn(i) : stackOut(i);
      let [weighted, weight, plain] = [0, 0, 0];
      for (const k of list) {
        const level = forward ? nodes[links[k].source].y + sourceOffset[k] - targetOffset[k] : nodes[links[k].target].y + targetOffset[k] - sourceOffset[k];
        weighted += level * links[k].thickness;
        weight += links[k].thickness;
        plain += center(forward ? links[k].source : links[k].target) - nodes[i].height / 2;
      }
      const wanted = weight > 0 ? weighted / weight : plain / list.length;
      nodes[i].y += (wanted - nodes[i].y) * pull;
    }
    sort(column, byCenter);
    let y = 0;
    for (const i of column) {
      if (nodes[i].y - margin[i] < y) nodes[i].y = y + margin[i];
      y = nodes[i].y + nodes[i].height + margin[i] + gap;
    }
    y = height;
    for (let k = column.length - 1; k >= 0; k--) {
      const i = column[k];
      if (nodes[i].y + nodes[i].height + margin[i] > y) nodes[i].y = y - nodes[i].height - margin[i];
      y = nodes[i].y - margin[i] - gap;
    }
  };

  stackAll();
  for (let pass = 0; pass < PASSES; pass++) {
    const pull = Math.pow(0.99, pass);
    for (let l = layers - 2; l >= 0; l--) settle(columns[l], pull, false);
    stackAll();
    for (let l = 1; l < layers; l++) settle(columns[l], pull, true);
    stackAll();
  }
  for (let k = 0; k < links.length; k++) {
    links[k].sourceY = nodes[links[k].source].y + sourceOffset[k];
    links[k].targetY = nodes[links[k].target].y + targetOffset[k];
  }
  return { nodes, links };
}

/** Bands from source to target nodes; each node also reports its total flow, for its label and tooltip. */
export function sankeyChart(names: string[], flows: Flow[], format: (v: number) => string) {
  let totals: number[] = [];

  const draw = (area: Area): string => {
    const m = measurer(area.font);
    const chartHeight = Math.max(1, area.h - 2 * PAD - SMALL * 1.5);
    const room = area.w - 2 * PAD;
    // Labels sit beside the bars, on the side that faces the middle of the chart. They can still run past an
    // edge, so as Pele fits a chart to a width: draw, then give up the overflow, a few times.
    const place = (chartWidth: number) => {
      const { nodes, links } = layoutSankey(names, flows, chartWidth, chartHeight, SMALL * 1.15);
      let [minX, maxX] = [0, chartWidth];
      const labels = nodes.map((node, i) => {
        const value = format(node.value);
        const after = node.x < chartWidth / 2;
        const textWidth = m.width(`${names[i]} ${value}`, SMALL);
        const x = after ? node.x + NODE_WIDTH + LABEL_GAP : node.x - LABEL_GAP;
        (minX = Math.min(minX, after ? x : x - textWidth)), (maxX = Math.max(maxX, after ? x + textWidth : x));
        return { x, after, value };
      });
      return { nodes, links, labels, minX, maxX, chartWidth };
    };
    let p = place(room);
    for (let round = 0; round < 3 && p.maxX - p.minX > room + 0.5 && p.chartWidth > 160; round++) p = place(Math.max(160, p.chartWidth - (p.maxX - p.minX - room)));
    totals = p.nodes.map(node => node.value);

    // a node's color is its place in its own column, so each side reads like a legend: the first source and
    // the first target share the first series color, as the same values do in the report's other charts
    const columns = new Map<number, number>();
    const color = p.nodes.map(node => {
      const k = columns.get(node.x) ?? 0;
      columns.set(node.x, k + 1);
      return seriesColor(k);
    });
    let nodesOut = '';
    let labelsOut = '';
    p.nodes.forEach((node, i) => {
      const height = Math.max(node.height, 1);
      nodesOut += `<rect class="c-sankey-node" data-i="${i}" ${pos(node.x, node.y)} width="${NODE_WIDTH}" height="${num(height)}" rx="${num(Math.min(2, height / 2))}" fill="${color[i]}"/>`;
      const { x, after, value } = p.labels[i];
      labelsOut +=
        `<g class="c-label" data-i="${i}">` +
        textAt(x, node.y + node.height / 2, SMALL, `${esc(names[i])} <tspan class="c-sankey-value" fill="var(--_m)">${esc(value)}</tspan>`, ` text-anchor="${after ? 'start' : 'end'}"`) +
        '</g>';
    });
    let linksOut = '';
    p.links.forEach((link, k) => {
      const half = Math.max(link.thickness, 1) / 2;
      const x0 = p.nodes[link.source].x + NODE_WIDTH;
      const x1 = p.nodes[link.target].x;
      const mid = (x0 + x1) / 2;
      const [a, b, c, d] = [link.sourceY - half, link.targetY - half, link.targetY + half, link.sourceY + half];
      linksOut +=
        `<path class="c-sankey-link" data-i="${k}" d="M${pt(x0, a)}C${pt(mid, a)} ${pt(mid, b)} ${pt(x1, b)}` +
        `L${pt(x1, c)}C${pt(mid, c)} ${pt(mid, d)} ${pt(x0, d)}Z" fill="${color[link.source]}"/>`;
    });

    const ox = PAD - p.minX + (room - (p.maxX - p.minX)) / 2;
    const oy = PAD + SMALL * 0.75;
    return svgDocument(
      'sankey',
      area,
      `<g transform="translate(${pt(ox, oy)})">` +
        `<g class="c-sankey-links" fill-opacity="0.4">${linksOut}</g>` +
        `<g class="c-sankey-nodes">${nodesOut}</g>` +
        `<g class="c-labels" font-size="${SMALL}">${labelsOut}</g></g>`
    );
  };

  /** A node's total flow, from the last drawing. */
  return { draw, total: (i: number) => totals[i] ?? 0 };
}
