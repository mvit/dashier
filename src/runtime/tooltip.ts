import type { Tip } from './charts';
import { esc } from './markdown';

let el: HTMLDivElement | null = null;

/**
 * One tooltip for every chart, on <body> so the zoomed sheet doesn't scale it. `from` is the chart element:
 * the tooltip takes its report colors.
 */
export function showTip(tip: Tip, x: number, y: number, from: Element) {
  el ||= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'd-tip' }));
  const css = getComputedStyle(from);
  // the report's colors, and its series colors for the swatches (the tooltip sits outside the report)
  for (const v of ['--surface', '--ink', '--muted', '--line', ...[1, 2, 3, 4, 5, 6, 7, 8].map(i => `--series-${i}`)]) el.style.setProperty(v, css.getPropertyValue(v));
  el.style.fontFamily = css.fontFamily;
  el.innerHTML =
    `<div class="d-tip-title">${esc(tip.title)}</div>` +
    tip.rows
      .map(r => `<div class="d-tip-row${r.active ? ' active' : ''}">${r.color ? `<i style="background:${r.color}"></i>` : ''}<span>${esc(r.label)}</span><b>${esc(r.value)}</b></div>`)
      .join('');
  el.style.display = 'block';
  const { width, height } = el.getBoundingClientRect();
  el.style.left = `${x + 14 + width > innerWidth ? x - width - 14 : x + 14}px`;
  el.style.top = `${y + 14 + height > innerHeight ? Math.max(4, y - height - 10) : y + 14}px`;
}

/** Touches on the screen now: with two or more (a pinch) there's no tooltip. */
const touches = new Set<number>();
/** A tap anywhere hides the tooltip, and so does a scroll after one; a tap on a chart then shows its own (ChartHost). */
let touched = false;
addEventListener('pointerdown', e => ((touched = e.pointerType == 'touch') && touches.add(e.pointerId), hideTip()), true);
for (const t of ['pointerup', 'pointercancel']) addEventListener(t, e => touches.delete((e as PointerEvent).pointerId), true);
addEventListener('scroll', () => touched && hideTip(), true);
export const pinching = () => touches.size > 1;

export function hideTip() {
  if (el) el.style.display = 'none';
}
