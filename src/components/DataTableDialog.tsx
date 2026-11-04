import { Component, Match, Switch } from 'solid-js';
import { ChartElement, DashElement, MatrixElement, TableElement } from '../types/model';
import { chartMatrix } from '../runtime/matrix';
import { downloadCSV } from '../runtime/save';
import { MatrixWidget, matrixCSV } from './widgets/MatrixWidget';
import { TableWidget, tableCSV } from './widgets/TableWidget';
import { Modal } from './Modal';

/** Visuals whose numbers show as a table (and export as CSV). */
export const tabular = (e: DashElement) => e.type === 'chart' || e.type === 'table' || e.type === 'matrix';

/**
 * A visual's numbers as a table, under its own filters, for a screen reader to read and anyone to export: a chart's
 * as the matrix its mapping makes (categories down, series across), a table or matrix as itself, at full size.
 */
export const DataTableDialog: Component<{ element: DashElement; onClose: () => void }> = (props) => {
  const name = () => props.element.title || 'Data';
  // its title is the dialog's
  const matrix = () => ({ ...(props.element.type === 'chart' ? chartMatrix(props.element as ChartElement) : (props.element as MatrixElement)), title: undefined }) as MatrixElement;
  const table = () => ({ ...props.element, title: undefined }) as TableElement;
  const rows = () => (props.element.type === 'table' ? tableCSV(table()) : matrixCSV(matrix()));
  return (
    <Modal
      class="d-data-table"
      title={name()}
      subtitle={props.element.type === 'chart' ? "The chart's numbers as a table" : 'Every row, to read or export'}
      onClose={props.onClose}
      ok="Done"
      onOk={props.onClose}
      foot={<button class="btn-secondary" onClick={() => downloadCSV(name(), rows())}>Export as CSV</button>}
    >
      <div class="modal-body d-data-table-body">
        <Switch fallback={<MatrixWidget element={matrix()} />}>
          <Match when={props.element.type === 'table'}>
            <TableWidget element={table()} />
          </Match>
        </Switch>
      </div>
    </Modal>
  );
};
