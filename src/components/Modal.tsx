import { Component, JSX, Show, splitProps } from 'solid-js';
import { Dynamic } from 'solid-js/web';

/**
 * A dialog over the page. A click outside it calls `onClose` (none: it stays until it's done). With a `title`, it opens
 * with a header: the title and the `subtitle`. Other props (more classes, drag and drop, a ref) go on
 * the dialog itself, which is a <form> when it has an `onSubmit`.
 */
export const Modal: Component<{ title?: JSX.Element; subtitle?: JSX.Element; onClose?: () => void } & JSX.HTMLAttributes<HTMLElement>> = (props) => {
  const [own, rest] = splitProps(props, ['title', 'subtitle', 'onClose', 'class', 'children']);
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
      </Dynamic>
    </div>
  );
};
