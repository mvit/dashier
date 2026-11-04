import { For, JSX, Show, createSignal } from 'solid-js';
import { ClearButton } from './icons';

/**
 * The editor's shared controls, styled by the chrome's tokens (theme.css): what a pane, a dialog or a slicer
 * uses to pick, search and group, so that every place looks and sizes alike.
 */

/**
 * A collapsible card: its head (a caret, the `title`, then `actions` on the right) opens and closes it; its body shows
 * while it's open and has something in it (`empty`: nothing). `head` adds to the head (dragging a table, its menu).
 */
export const Card = (p: {
  open: boolean;
  flip: () => void;
  title: JSX.Element;
  actions?: JSX.Element;
  class?: string;
  body?: string;
  empty?: boolean;
  head?: JSX.HTMLAttributes<HTMLDivElement>;
  children?: JSX.Element;
}) => (
  <section class={`d-card ${p.open ? 'open' : ''} ${p.class ?? ''}`}>
    <div
      class="d-card-head"
      role="button"
      tabIndex={0}
      aria-expanded={p.open}
      {...p.head}
      onClick={p.flip}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), p.flip())}
    >
      <span class="d-caret" aria-hidden="true" />
      <span class="d-card-title">{p.title}</span>
      {/* the actions' clicks are theirs: they don't open or close the card */}
      <span class="d-card-actions" onClick={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()}>
        {p.actions}
      </span>
    </div>
    <Show when={p.open && !p.empty}>
      <div class={`d-card-body ${p.body ?? ''}`}>{p.children}</div>
    </Show>
  </section>
);

/**
 * A filter's or slicer's card: its field (`sub`: the table, small), what it keeps (`summary`: empty when it keeps
 * everything), and while it keeps less, a button to `clear` it ([its tooltip, what it does]). More `actions` follow.
 */
export const PickCard = (p: {
  class?: string;
  open: boolean;
  flip: () => void;
  name: JSX.Element;
  sub?: string;
  summary: string;
  clear: [string, () => void];
  actions?: JSX.Element;
  children: JSX.Element;
}) => (
  <Card
    class={`d-filter-card ${p.summary ? 'active' : ''} ${p.class ?? ''}`}
    open={p.open}
    flip={p.flip}
    title={
      <>
        <span class="filter-name">
          {p.name}
          <Show when={p.sub}>
            <small>{p.sub}</small>
          </Show>
        </span>
        <span class="filter-type">{p.summary}</span>
      </>
    }
    actions={
      <>
        <Show when={p.summary}>
          <ClearButton class="d-filter-x" title={p.clear[0]} onClick={p.clear[1]} />
        </Show>
        {p.actions}
      </>
    }
  >
    {p.children}
  </Card>
);

/** A <select> of `[value, label]` choices, `value`'s selected; an option's value is its own as text (unset: ''). */
export const Select = (p: { class?: string; title?: string; value: unknown; options: [unknown, string][]; set: (v: any) => void }) => {
  const text = (v: unknown) => String(v ?? '');
  return (
    <select class={p.class ?? 'd-well-select'} title={p.title} onChange={(e) => p.set(p.options.find(o => text(o[0]) === e.currentTarget.value)?.[0])}>
      <For each={p.options}>{(o) => <option value={text(o[0])} selected={p.value === o[0]}>{o[1]}</option>}</For>
    </select>
  );
};

/** A segmented control: picks one of `options`, each [value, label, its tooltip]. */
export const Seg = <T,>(p: { value: T; options: readonly (readonly [T, JSX.Element, string?])[]; set: (v: T) => void; class?: string }) => (
  <div class={`d-seg ${p.class ?? ''}`} role="group">
    <For each={p.options}>
      {([v, label, tip]) => (
        <button type="button" title={tip} class={p.value === v ? 'on' : ''} aria-pressed={p.value === v} onClick={() => p.set(v)}>
          {label}
        </button>
      )}
    </For>
  </div>
);

/** A checkbox (or radio) and its label. */
export const Check = (p: { checked: boolean; set: () => void; radio?: boolean; children: JSX.Element }) => (
  <label class="d-checkbox-label">
    {/* a click the state doesn't follow (the option already on) mustn't leave the box showing otherwise */}
    <input type={p.radio ? 'radio' : 'checkbox'} checked={p.checked} onClick={(e) => (p.set(), (e.currentTarget.checked = p.checked))} />
    {p.children}
  </label>
);

/**
 * The checklist a filter, a slicer and a measure's condition pick values from: `on` says which are picked, `flip` picks or
 * drops one. A search box shows once there are more than `search` values; the first `limit` matches are listed (500).
 * `children` come first (a filter's Select All).
 */
export const CheckList = (p: {
  class: string;
  values: string[];
  label?: (v: string) => string;
  on: (v: string) => boolean;
  flip: (v: string) => void;
  radio?: boolean;
  search?: number;
  limit?: number;
  children?: JSX.Element;
}) => {
  const [q, setQ] = createSignal('');
  const label = (v: string) => p.label?.(v) ?? v;
  const shown = () => (q() ? p.values.filter((v) => label(v).toLowerCase().includes(q().toLowerCase())) : p.values).slice(0, p.limit ?? 500);
  return (
    <>
      <Show when={p.values.length > (p.search ?? Infinity)}>
        <Search class="d-input d-slicer-search" value={q()} set={setQ} />
      </Show>
      <div class={p.class}>
        {p.children}
        <For each={shown()}>
          {(v) => (
            <Check radio={p.radio} checked={p.on(v)} set={() => p.flip(v)}>
              {label(v)}
            </Check>
          )}
        </For>
      </div>
    </>
  );
};

/** A name edited in place: selected to start, saved on Enter or when it loses focus; Esc calls `done()` with nothing. */
export const Rename = (p: { class: string; value: string; done: (v?: string) => void }) => (
  <input
    type="text"
    class={p.class}
    value={p.value}
    ref={(el) => setTimeout(() => el.select())}
    onBlur={(e) => p.done(e.currentTarget.value)}
    onKeyDown={(e) => (e.key === 'Enter' ? p.done(e.currentTarget.value) : e.key === 'Escape' && p.done())}
  />
);

/** Enter in a text field is done with it: saved as it loses focus. */
export const blurOnEnter = (e: KeyboardEvent & { currentTarget: HTMLElement }) => e.key === 'Enter' && e.currentTarget.blur();

/** A form's error, when there is one. */
export const Err = (p: { text?: string | false | null; class?: string }) => (
  <Show when={p.text}>
    <div class={`d-form-error ${p.class ?? ''}`} role="alert">{p.text}</div>
  </Show>
);

/** A search box. */
export const Search = (p: { value: string; set: (v: string) => void; class?: string; placeholder?: string }) => (
  <input type="search" aria-label={p.placeholder ?? 'Search'} class={p.class} placeholder={p.placeholder ?? 'Search'} value={p.value} onInput={(e) => p.set(e.currentTarget.value)} />
);

/**
 * A From–To pair of date or number inputs, labelled (two lines where one is too narrow for both). `set` gets an
 * input's text as it's typed, or with `change`, once it's done.
 */
export const RangeInputs = (p: { type: 'date' | 'number'; value: (to: number) => unknown; placeholder?: (to: number) => string; set: (to: number, v: string) => void; change?: boolean }) => (
  <div class="d-filter-range">
    <For each={['From', 'To']}>
      {(label, i) => (
        <label>
          {label}
          <input
            type={p.type}
            class="d-input"
            placeholder={p.placeholder?.(i()) ?? ''}
            value={String(p.value(i()) ?? '')}
            onInput={(e) => !p.change && p.set(i(), e.currentTarget.value)}
            onChange={(e) => p.change && p.set(i(), e.currentTarget.value)}
          />
        </label>
      )}
    </For>
  </div>
);

