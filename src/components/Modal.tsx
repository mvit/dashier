import { Component, JSX, Show, splitProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';

/**
 * A dialog over the page. A click outside it calls `onClose` (none: it stays until it's done). With a `title`, it opens
 * with a header: the title, the `subtitle` and a × that closes. Other props (more classes, drag and drop, a ref) go on
 * the dialog itself, which is a <form> when it has an `onSubmit`.
 */
export const Modal: Component<{ title?: JSX.Element; subtitle?: JSX.Element; onClose?: () => void } & JSX.HTMLAttributes<HTMLElement>> = (props) => {
  const [own, rest] = splitProps(props, ['title', 'subtitle', 'onClose', 'class', 'children']);
  return (
    <div class="modal-backdrop" onClick={() => own.onClose?.()}>
      <Dynamic component={rest.onSubmit ? 'form' : 'div'} {...(rest as any)} class={`modal-dialog ${own.class}`} onClick={(e: Event) => e.stopPropagation()}>
        <Show when={own.title}>
          <div class="modal-header">
            <div>
              <h3>{own.title}</h3>
              <p class="modal-subtitle">{own.subtitle}</p>
            </div>
            <button class="btn-close-modal" title="Close (Esc)" onClick={() => own.onClose?.()}>×</button>
          </div>
        </Show>
        {own.children}
      </Dynamic>
    </div>
  );
};
