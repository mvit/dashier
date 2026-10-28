import { Component } from 'solid-js';
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

/** A visual's content, by type (the canvas and the print view put it in their own tile). */
export const Widget: Component<{ element: DashElement }> = (props) => <Dynamic component={WIDGETS[props.element.type]} element={props.element} />;
