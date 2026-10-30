import { Component, For, Index, Show, createMemo, createSignal } from 'solid-js';
import { store } from '../runtime/store';
import { Modal } from './Modal';
import { FORMAT_CHOICES, UNIT_CHOICES } from './FieldWell';
import { Check, Select } from './ui';
import { formatValue, summaryLabel, SUMMARY_NAMES, withUnits } from '../runtime/charts';
import { OPS, compileMeasure, measureError, measureFormat, wheres } from '../runtime/measures';
import { AggregationMethod, DashMeasure, MeasureOp, MeasureOperand, Units, ValueFormat, isNumericType } from '../types/model';

const SUMMARIES: AggregationMethod[] = ['sum', 'avg', 'min', 'max', 'count', 'distinct', 'median'];


/** Operands in a <select>: "m:<table>\0<measure>", "f:<field>" (its sum), or "n" (a number). */
const encode = (table: string, o?: MeasureOperand) => (!o ? '' : o.measure != null ? `m:${o.table ?? table}\u0000${o.measure}` : o.field != null ? `f:${o.field}` : 'n');

/**
 * New / edit a quick measure: summarize a field (optionally only some rows), or calculate with two values.
 * The preview works it out over all of the table's rows.
 */
export const MeasureDialog: Component<{ table: string; name?: string; field?: string; onClose: () => void }> = (props) => {
  const existing = props.name != null ? store.measuresOf(props.table).find(m => m.name === props.name) : undefined;
  // from a field (its right-click menu): its sum, or for text its distinct count, named to match
  const start: AggregationMethod = props.field && !store.isNumericRef(props.table, props.field) ? 'distinct' : 'sum';
  const [name, setName] = createSignal(existing?.name ?? (props.field ? summaryLabel(props.field, start) : ''));
  const [mode, setMode] = createSignal<'summarize' | 'calculate'>(existing?.op ? 'calculate' : 'summarize');
  const [aggregate, setAggregate] = createSignal<AggregationMethod>(existing?.aggregate ?? start);
  const [field, setField] = createSignal(existing?.field ?? props.field ?? '');
  // conditions, all of which must hold: each a column of this table or of a connected one (a dimension's attribute,
  // say) and the values to keep; an empty one stands for "all rows"
  const [conds, setConds] = createSignal(wheres(existing).map(w => ({ ...w, table: w.table ?? props.table })));
  if (!conds().length) setConds([{ table: props.table, field: '', values: [] }]);
  const setCond = (i: number, c: Partial<{ table: string; field: string; values: string[] }>) => setConds(cs => cs.map((x, j) => (j === i ? { ...x, ...c } : x)));
  const [op, setOp] = createSignal<MeasureOp>(existing?.op ?? '/');
  const [a, setA] = createSignal<MeasureOperand | undefined>(existing?.a);
  const [b, setB] = createSignal<MeasureOperand | undefined>(existing?.b);
  const [format, setFormat] = createSignal<ValueFormat | ''>(existing?.format ?? '');
  const [units, setUnits] = createSignal<Units | ''>(existing?.units ?? '');
  const [error, setError] = createSignal('');

  const fields = () => store.fieldsOf(props.table);
  const numericFields = () => fields().filter(c => isNumericType(c.type));
  const others = () => store.measuresOf(props.table).filter(m => m.name !== props.name);
  const connected = () => store.connectedTables(props.table);


  /** The conditions as stored: one object, or a list when there are several. */
  const where = () => {
    const ws = conds().filter(c => c.field && c.values.length).map(({ table, ...w }) => (table === props.table ? w : { ...w, table }));
    return ws.length ? { where: ws.length > 1 ? ws : ws[0] } : {};
  };

  /** The measure as currently filled in. */
  const draft = (): DashMeasure => {
    const base = { name: name().trim(), table: props.table, ...(format() ? { format: format() as ValueFormat } : {}), ...(units() ? { units: units() as Units } : {}) };
    return mode() === 'calculate'
      ? { ...base, op: op(), a: a(), b: b() }
      : { ...base, aggregate: aggregate(), ...(field() ? { field: field() } : {}), ...where() };
  };

  const problem = () => measureError(store.doc.measures || [], draft(), t => store.fieldsOf(t).map(c => c.name), props.name);
  const preview = createMemo(() => {
    if (problem()) return null;
    const d = draft();
    const all = [...(store.doc.measures || []).filter(m => !(m.table === props.table && m.name === props.name)), d];
    const v = compileMeasure(all, props.table, d.name, store.measureEnv)?.(store.tableFrame(props.table));
    return v == null ? '—' : formatValue(v, withUnits(measureFormat(d), d.units));
  });

  const done = (err: string | null) => (err ? setError(err) : props.onClose());
  const remove = () => confirm(`Delete measure "${props.name}"? Visuals that use it lose it.`) && done(store.deleteMeasure(props.table, props.name!));
  const fieldOptions = (list: () => { name: string }[]) => <For each={list()}>{(c) => <option value={c.name}>{c.name}</option>}</For>;

  const operandPicker = (value: () => MeasureOperand | undefined, set: (o: MeasureOperand | undefined) => void) => (
    <div class="d-operand">
      <select
        class="d-well-select"
        value={encode(props.table, value())}
        onChange={(e) => {
          const v = e.currentTarget.value;
          const [t, m] = v.slice(2).split('\u0000');
          set(v.startsWith('m:') ? { measure: m, ...(t !== props.table ? { table: t } : {}) } : v.startsWith('f:') ? { field: v.slice(2) } : v === 'n' ? { value: value()?.value ?? 1 } : undefined);
        }}
      >
        <option value="">Choose…</option>
        <Show when={others().length}>
          <optgroup label="Measures">
            <For each={others()}>{(m) => <option value={`m:${props.table}\u0000${m.name}`}>{m.name}</option>}</For>
          </optgroup>
        </Show>
        {/* measures of connected tables are worked out for the same cell (actual ÷ target, say) */}
        <For each={connected().filter(t => store.measuresOf(t).length)}>
          {(t) => (
            <optgroup label={`Measures of ${t}`}>
              <For each={store.measuresOf(t)}>{(m) => <option value={`m:${t}\u0000${m.name}`}>{m.name}</option>}</For>
            </optgroup>
          )}
        </For>
        <optgroup label="Sum of a field">
          <For each={numericFields()}>{(c) => <option value={`f:${c.name}`}>Sum of {c.name}</option>}</For>
        </optgroup>
        <optgroup label="Number">
          <option value="n">A number…</option>
        </optgroup>
      </select>
      <Show when={encode(props.table, value()) === 'n'}>
        <input type="number" class="d-input d-operand-number" value={value()?.value ?? ''} onInput={(e) => set({ value: Number(e.currentTarget.value) })} />
      </Show>
    </div>
  );

  return (
    <Modal class="d-measure-dialog" title={existing ? 'Edit measure' : 'New measure'} subtitle={`On ${props.table}`} onClose={props.onClose}>
      <div class="modal-body d-measure-body">
        <label class="d-mfield">
          Name
          <input class="d-input d-measure-name" value={name()} placeholder="e.g. Revenue per user" spellcheck={false} onInput={(e) => setName(e.currentTarget.value)} />
        </label>

        <div class="d-seg">
          <For each={[['summarize', 'Summarize a field'], ['calculate', 'Calculate']] as const}>
            {([m, label]) => <button class={mode() === m ? 'on' : ''} onClick={() => setMode(m)}>{label}</button>}
          </For>
        </div>

        <Show when={mode() === 'summarize'}>
          <div class="d-mrow">
            <Select class="d-well-select d-measure-agg" value={aggregate()} options={SUMMARIES.map(m => [m, m === 'count' ? 'Count of rows' : SUMMARY_NAMES[m]])} set={setAggregate} />
            <Show when={aggregate() !== 'count'}>
              of
              <select class="d-well-select d-measure-field" value={field()} onChange={(e) => setField(e.currentTarget.value)}>
                <option value="">Choose a field…</option>
                {fieldOptions(() => (aggregate() === 'distinct' ? fields() : numericFields()))}
              </select>
            </Show>
          </div>
          <Index each={conds()}>
            {(c, i) => (
              <>
                <div class="d-mrow">
                  {i ? 'and where' : 'Only rows where'}
                  <select
                    class="d-well-select d-measure-where"
                    onChange={(e) => {
                      const [t, f] = e.currentTarget.value.split('\u0000');
                      // emptied: a later condition goes, the first means all rows again
                      f || !i ? setCond(i, { table: f ? t : props.table, field: f ?? '', values: [] }) : setConds(cs => cs.filter((_, j) => j !== i));
                    }}
                  >
                    <option value="">{i ? '(remove)' : '(all rows)'}</option>
                    <For each={[props.table, ...connected()]}>
                      {(t) => (
                        <optgroup label={t === props.table ? props.table : `${t} (connected)`}>
                          <For each={store.fieldsOf(t)}>{(col) => <option value={`${t}\u0000${col.name}`} selected={c().table === t && c().field === col.name}>{col.name}</option>}</For>
                        </optgroup>
                      )}
                    </For>
                  </select>
                  <Show when={c().field}>is one of</Show>
                </div>
                <Show when={c().field}>
                  <div class="d-measure-values">
                    <For each={store.distinct(c().table, c().field).slice(0, 500)}>
                      {(v) => (
                        <Check checked={c().values.includes(v)} set={() => setCond(i, { values: c().values.includes(v) ? c().values.filter(x => x !== v) : [...c().values, v] })}>
                          {v}
                        </Check>
                      )}
                    </For>
                  </div>
                </Show>
              </>
            )}
          </Index>
          <Show when={conds().at(-1)?.field}>
            <button class="d-link-btn d-measure-and" onClick={() => setConds([...conds(), { table: props.table, field: '', values: [] }])}>+ and where…</button>
          </Show>
        </Show>

        <Show when={mode() === 'calculate'}>
          <div class="d-mrow d-mcalc">
            {operandPicker(a, setA)}
            <select class="d-well-select d-measure-op" value={op()} onChange={(e) => setOp(e.currentTarget.value as MeasureOp)}>
              <For each={OPS}>{([v, symbol, words]) => <option value={v} title={words}>{symbol}</option>}</For>
            </select>
            {operandPicker(b, setB)}
          </div>
        </Show>

        <label class="d-mfield">
          Format
          <Select value={format() || undefined} options={FORMAT_CHOICES} set={(v) => setFormat(v ?? '')} />
        </label>
        <label class="d-mfield">
          Display units
          <Select value={units() || undefined} options={UNIT_CHOICES} set={(v) => setUnits(v ?? '')} />
        </label>

        <div class={`d-measure-preview ${problem() ? 'muted' : ''}`}>
          {problem() && name().trim() ? problem() : preview() != null ? <>On all rows of {props.table}: <b>{preview()}</b></> : 'Fill in the measure to see its value.'}
        </div>
        <Show when={error()}>
          <div class="d-form-error">{error()}</div>
        </Show>
      </div>

      <div class="modal-footer">
        <Show when={existing}>
          <button class="btn-secondary d-measure-delete" onClick={remove}>Delete</button>
        </Show>
        <button class="btn-secondary" onClick={props.onClose}>Cancel</button>
        <button class="btn-primary" disabled={!!problem()} onClick={() => done(store.saveMeasure(draft(), props.name))}>Save</button>
      </div>
    </Modal>
  );
};
