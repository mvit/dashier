import { Component, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { ChartSpec } from '../../runtime/charts';
import { hideTip, pinching, showTip } from '../../runtime/tooltip';
import { observeSize } from '../../runtime/view';

/** Draws a chart's SVG at exactly the space the parent gives it, in the report's font, with its tooltips. */
export const ChartHost: Component<{ draw?: ChartSpec['draw']; tip?: ChartSpec['tip'] }> = (props) => {
  let host!: HTMLDivElement;
  const [area, setArea] = createSignal({ w: 0, h: 0, font: '' });

  onMount(() => {
    observeSize(host, ([{ contentRect: r }]) => {
      const w = Math.round(r.width), h = Math.round(r.height);
      // the report font, so labels are measured as they will show
      const font = getComputedStyle(host).fontFamily;
      setArea(a => (Math.abs(a.w - w) < 2 && Math.abs(a.h - h) < 2 && a.font === font ? a : { w, h, font }));
    });
  });

  const out = createMemo((): { svg?: string; error?: string } | null => {
    const a = area();
    if (!props.draw || a.w < 40 || a.h < 40) return null;
    try {
      return { svg: props.draw(a) };
    } catch (err: any) {
      return { error: String(err?.message || err) };
    }
  });

  // Tooltips: the spec maps the pointer (in the SVG's own coordinates, whatever the zoom) to values.
  // A mouse or pen hovers; a finger taps (a drag pans the page, two fingers pinch: no tooltip then).
  const onMove = (e: PointerEvent) => {
    const svg = host.querySelector('svg');
    if (pinching()) return hideTip();
    const m = svg?.getScreenCTM();
    if (!svg || !m || !props.tip) return hideTip();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const tip = props.tip(e.target as Element, svg, { x: p.x, y: p.y });
    tip ? showTip(tip, e.clientX, e.clientY, host) : hideTip();
  };
  onCleanup(hideTip);

  return (
    <div class="d-chart-plot" ref={host} onPointerDown={onMove} onPointerMove={(e) => e.pointerType != 'touch' && onMove(e)} onPointerLeave={(e) => e.pointerType != 'touch' && hideTip()}>
      <Show when={out()?.svg} fallback={<div class={`d-chart-empty ${out()?.error ? 'd-error' : ''}`}>{out()?.error}</div>}>
        <div class="d-chart-svg" innerHTML={out()!.svg} />
      </Show>
    </div>
  );
};
