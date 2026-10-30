import { For, JSX, Show } from 'solid-js';

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
      <span class="d-caret">{p.open ? '▾' : '▸'}</span>
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

/** A <select> of `[value, label]` choices, `value`'s selected; an option's value is its own as text (unset: ''). */
export const Select = (p: { class?: string; title?: string; value: unknown; options: [unknown, string][]; set: (v: any) => void }) => {
  const text = (v: unknown) => String(v ?? '');
  return (
    <select class={p.class ?? 'd-well-select'} title={p.title} onChange={(e) => p.set(p.options.find(o => text(o[0]) === e.currentTarget.value)?.[0])}>
      <For each={p.options}>{(o) => <option value={text(o[0])} selected={p.value === o[0]}>{o[1]}</option>}</For>
    </select>
  );
};

/** A checkbox (or radio) and its label. */
export const Check = (p: { checked: boolean; set: () => void; radio?: boolean; children: JSX.Element }) => (
  <label class="d-checkbox-label">
    <input type={p.radio ? 'radio' : 'checkbox'} checked={p.checked} onClick={p.set} />
    {p.children}
  </label>
);

/** A search box. */
export const Search = (p: { value: string; set: (v: string) => void; class?: string; placeholder?: string }) => (
  <input type="search" class={p.class} placeholder={p.placeholder ?? 'Search'} value={p.value} onInput={(e) => p.set(e.currentTarget.value)} />
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

