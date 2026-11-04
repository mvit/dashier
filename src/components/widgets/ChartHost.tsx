import { Component, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { ChartSpec } from '../../runtime/charts';
import { hideTip, pinching, showTip } from '../../runtime/tooltip';
import { observeSize } from '../../runtime/view';

/** Draws a chart's SVG at exactly the space the parent gives it, in the report's font, with its tooltips. */
export const ChartHost: Component<{ draw?: ChartSpec['draw']; tip?: ChartSpec['tip']; minWidth?: number; picked?: string; onPick?: (target: Element, pt: { x: number; y: number }) => void }> = (props) => {
  let host!: HTMLDivElement;
  const [area, setArea] = createSignal({ w: 0, h: 0, font: '' });

  onMount(() => {
    const measure = () => {
      const w = host.clientWidth, h = host.clientHeight;
      // the report font, so labels are measured as they will show
      const font = getComputedStyle(host).fontFamily;
      setArea(a => (Math.abs(a.w - w) < 2 && Math.abs(a.h - h) < 2 && a.font === font ? a : { w, h, font }));
    };
    measure();
    observeSize(host, measure);
  });

  const width = () => Math.max(area().w, props.minWidth || 0);

  const out = createMemo((): { svg?: string; error?: string } | null => {
    const a = area();
    if (!props.draw || a.w < 40 || a.h < 40) return null;
    try {
      return { svg: props.draw({ ...a, w: width() }) };
    } catch (err: any) {
      return { error: String(err?.message || err) };
    }
  });

  // the picked mark stands out from the others, in every redraw
  createEffect(() => {
    out();
    const svg = host.querySelector('svg');
    svg?.classList.toggle('c-picked', !!props.picked);
    svg?.querySelector('.c-on')?.classList.remove('c-on');
    if (props.picked) svg?.querySelector(props.picked)?.classList.add('c-on');
  });

  // a press that moved was a drag (the visual, in the editor), not a click on a mark
  let down = { x: 0, y: 0 };
  const onPress = (e: PointerEvent) => ((down = { x: e.clientX, y: e.clientY }), onMove(e));
  const onClick = (e: MouseEvent) => {
    const m = host.querySelector('svg')?.getScreenCTM();
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && m) props.onPick?.(e.target as Element, new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()));
  };

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
    <div class={`d-chart-plot ${props.onPick ? 'pickable' : ''}`} onClick={onClick} style={{ overflow: props.minWidth ? 'auto' : undefined }} tabIndex={props.minWidth ? 0 : undefined} title={props.minWidth && width() > area().w ? 'Scroll horizontally to see all categories' : undefined} ref={host} onPointerDown={onPress} onPointerMove={(e) => e.pointerType != 'touch' && onMove(e)} onPointerLeave={(e) => e.pointerType != 'touch' && hideTip()}>
      <Show when={out()?.svg} fallback={<div class={`d-chart-empty ${out()?.error ? 'd-error' : ''}`}>{out()?.error}</div>}>
        <div class="d-chart-svg" style={{ width: `${width()}px` }} innerHTML={out()!.svg} />
      </Show>
    </div>
  );
};
