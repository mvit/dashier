import { Component, JSX, Show, onCleanup, splitProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';

/**
 * A dialog over the page. A click outside it, or Esc, calls `onClose` (none: it stays until it's done). With a `title`, it opens
 * with a header: the title and the `subtitle`. With `ok`, it ends with a footer: `foot`, then Cancel (unless `onOk` only
 * closes it, as Done does), then the `ok` button (`okOff`: disabled; no `onOk`: it submits the form). Other props (more
 * classes, drag and drop, a ref) go on the dialog itself, which is a <form> when it has an `onSubmit`.
 */
export const Modal: Component<
  { title?: JSX.Element; subtitle?: JSX.Element; onClose?: () => void; ok?: JSX.Element; onOk?: () => void; okOff?: boolean; foot?: JSX.Element } & JSX.HTMLAttributes<HTMLElement>
> = (props) => {
  const [own, rest] = splitProps(props, ['title', 'subtitle', 'onClose', 'class', 'children', 'ok', 'onOk', 'okOff', 'foot']);
  // Esc closes it, before anything behind it hears the key (as a menu's does), wherever it was opened from
  if (own.onClose) {
    const off = new AbortController();
    addEventListener('keydown', (e) => e.key === 'Escape' && (e.stopPropagation(), own.onClose!()), { capture: true, signal: off.signal });
    onCleanup(() => off.abort());
  }
  return (
    <div class="modal-backdrop" onClick={() => own.onClose?.()}>
      <Dynamic component={rest.onSubmit ? 'form' : 'div'} aria-label={typeof own.title === 'string' ? own.title : undefined} {...(rest as any)} role="dialog" aria-modal="true" class={`modal-dialog ${own.class ?? ''}`} onClick={(e: Event) => e.stopPropagation()}>
        <Show when={own.title}>
          <div class="modal-header">
            <div>
              <h3>{own.title}</h3>
              <Show when={own.subtitle}>
                <p class="modal-subtitle">{own.subtitle}</p>
              </Show>
            </div>
          </div>
        </Show>
        {own.children}
        <Show when={own.ok}>
          <div class="modal-footer">
            {own.foot}
            <Show when={own.onClose && own.onOk !== own.onClose}>
              <button type="button" class="btn-secondary" onClick={() => own.onClose!()}>Cancel</button>
            </Show>
            <button class="btn-primary" disabled={own.okOff} onClick={() => own.onOk?.()}>{own.ok}</button>
          </div>
        </Show>
      </Dynamic>
    </div>
  );
};
