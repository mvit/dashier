import { Component, For, Show, createSignal, onCleanup } from 'solid-js';

/** Shortcuts as the viewer's keyboard writes them: ⌘S on a Mac, iPhone or iPad, Ctrl+S elsewhere. */
export const MAC = /Mac|iP(hone|ad|od)/.test(navigator.userAgent);
export const MOD = MAC ? '⌘' : 'Ctrl+';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Shortcut shown on the right. */
  kbd?: string;
  /** What the item does, on hover. */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
}
/** A line between groups of items. */
export type MenuEntry = MenuItem | '-';

const [menu, setMenu] = createSignal<{ x: number; y: number; items: MenuEntry[]; placed?: boolean } | null>(null);

/** Opens the app's one context menu at the pointer (or at `at`, e.g. under a ⋯ button). */
export function openMenu(e: MouseEvent, items: MenuEntry[], at?: { x: number; y: number }) {
  e.preventDefault();
  e.stopPropagation();
  setMenu({ x: at?.x ?? e.clientX, y: at?.y ?? e.clientY, items });
}

/** Opens the menu under the element that was clicked (a ⋯ button). */
export const openMenuBelow = (e: MouseEvent, items: MenuEntry[]) => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  openMenu(e, items, { x: r.left, y: r.bottom + 2 });
};

/**
 * Closes an open menu on a pointer down outside the `inside` elements, Escape (which goes no further), a scroll or a
 * resize, until the owner is disposed. Returns the listeners' signal, for more of them.
 */
export function dismiss(inside: Node[], close: () => void): AbortSignal {
  const ac = new AbortController();
  const o = { capture: true, signal: ac.signal };
  addEventListener('pointerdown', (e) => !inside.some(n => n.contains(e.target as Node)) && close(), o);
  addEventListener('keydown', (e) => e.key === 'Escape' && (e.stopPropagation(), close()), o);
  addEventListener('scroll', close, o);
  addEventListener('resize', close, o);
  onCleanup(() => ac.abort());
  return ac.signal;
}

/** Renders the open menu; closes on a click elsewhere, Escape, scroll, resize, leaving the window or another right-click. */
export const ContextMenuHost: Component = () => {
  // measured once it's laid out, then moved inside the window (hidden until then)
  const place = (node: HTMLDivElement) => {
    const close = () => setMenu(null);
    // a blur caught on the way down would be any field's: only the window's own counts
    addEventListener('blur', close, { signal: dismiss([node], close) });
    queueMicrotask(() => {
      const m = menu();
      if (!m || m.placed) return;
      const { width, height } = node.getBoundingClientRect();
      setMenu({ ...m, x: Math.max(4, Math.min(m.x, innerWidth - width - 4)), y: Math.max(4, Math.min(m.y, innerHeight - height - 4)), placed: true });
    });
  };

  return (
    <Show when={menu()}>
      {(m) => (
        <div
          class="d-context-menu"
          ref={place}
          style={{ left: `${m().x}px`, top: `${m().y}px`, visibility: m().placed ? 'visible' : 'hidden' }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <For each={m().items}>
            {(item) =>
              item === '-' ? (
                <hr />
              ) : (
                <button class={item.danger ? 'danger' : ''} title={item.hint} disabled={item.disabled} onClick={() => (setMenu(null), item.onSelect())}>
                  <span>{item.label}</span>
                  {item.kbd && <kbd>{item.kbd}</kbd>}
                </button>
              )
            }
          </For>
        </div>
      )}
    </Show>
  );
};
