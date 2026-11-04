import { Component, Show } from 'solid-js';
import { store } from '../runtime/store';
import { reportStyle } from '../runtime/theme';
import { Dynamic } from 'solid-js/web';
import { DashElement } from '../types/model';
import { CardWidget } from './widgets/CardWidget';
import { ChartWidget } from './widgets/ChartWidget';
import { MarkdownWidget } from './widgets/MarkdownWidget';
import { SlicerWidget } from './widgets/SlicerWidget';
import { TableWidget } from './widgets/TableWidget';
import { MatrixWidget } from './widgets/MatrixWidget';

const WIDGETS: Record<DashElement['type'], Component<{ element: any }>> = {
  card: CardWidget,
  chart: ChartWidget,
  table: TableWidget,
  matrix: MatrixWidget,
  markdown: MarkdownWidget,
  slicer: SlicerWidget
};

/** A page sheet's style: the report's theme, at the canvas's width and (at least) height. */
export const sheetStyle = () => ({ ...reportStyle(store.reportTheme()), width: `${store.canvasSize().width}px`, 'min-height': `${store.canvasSize().height}px` });
/** A visual's place in the page grid. */
export const cell = (e: DashElement) => ({ 'grid-column': `${e.x + 1} / span ${e.w}`, 'grid-row': `${e.y + 1} / span ${e.h}` });

/**
 * A visual's content, by type (the canvas and the print view put it in their own tile). A visual grouping by a table
 * its own isn't connected to can't be worked out: it says so, with the way to connect them while editing.
 */
export const Widget: Component<{ element: DashElement }> = (props) => (
  <Show when={store.unconnected(props.element)[0]} fallback={<Dynamic component={WIDGETS[props.element.type]} element={props.element} />}>
    {(t) => (
      <div class="d-chart-empty d-unconnected">
        {props.element.sourceId} and {t()} aren't connected
        <Show when={store.editing()}>
          <button class="d-link-btn" onClick={(e) => (e.stopPropagation(), store.setConnecting(props.element.sourceId!))}>Connect them…</button>
        </Show>
      </div>
    )}
  </Show>
);
