import { Component, For, Show, createSignal, onCleanup } from 'solid-js';

/** Shortcuts as the viewer's keyboard writes them: ⌘S on a Mac, iPhone or iPad, Ctrl+S elsewhere. */
export const MAC = /Mac|iP(hone|ad|od)/.test(navigator.userAgent);
export const MOD = MAC ? '⌘' : 'Ctrl+';

/** Where menus may go: between the top bar and the page tabs, or the window's edges where those aren't shown. */
export const menuArea = () => {
  const bar = (selector: string) => {
    const r = document.querySelector(selector)?.getBoundingClientRect();
    return r?.height ? r : null;
  };
  return { top: (bar('.ed-topbar')?.bottom ?? 0) + 8, bottom: (bar('.d-bottom-pages-bar')?.top ?? innerHeight) - 8 };
};

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

/** `above` and `right`: where it ends when it doesn't fit below or after its button; `anchor`: that button, which closes it again. */
type Place = { x: number; y: number; above?: number; right?: number; anchor?: Element };
const [menu, setMenu] = createSignal<(Place & { items: MenuEntry[]; placed?: boolean }) | null>(null);

/** Opens the app's one context menu at the pointer (or at `at`, e.g. under a ⋯ button). */
export function openMenu(e: MouseEvent, items: MenuEntry[], at?: Place) {
  e.preventDefault();
  e.stopPropagation();
  setMenu({ ...at, x: at?.x ?? e.clientX, y: at?.y ?? e.clientY, items });
}

/** Opens the menu under the element that was clicked (a ⋯ button), or over it if there's no room; a second click closes it. */
export const openMenuBelow = (e: MouseEvent, items: MenuEntry[]) => {
  const anchor = e.currentTarget as HTMLElement, r = anchor.getBoundingClientRect();
  if (menu()?.anchor === anchor) {
    e.stopPropagation();
    setMenu(null);
  } else openMenu(e, items, { x: r.left, y: r.bottom + 4, above: r.top - 4, right: r.right, anchor });
};

/**
 * Closes an open menu on a pointer down or scroll outside the `inside` elements, Escape (which goes no further) or a
 * resize, until the owner is disposed. Returns the listeners' signal, for more of them.
 */
export function dismiss(inside: Node[], close: () => void): AbortSignal {
  const ac = new AbortController();
  const o = { capture: true, signal: ac.signal };
  const outside = (e: Event) => !inside.some(n => n.contains(e.target as Node)) && close();
  addEventListener('pointerdown', outside, o);
  addEventListener('keydown', (e) => e.key === 'Escape' && (e.stopPropagation(), close()), o);
  addEventListener('scroll', outside, o);
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
    addEventListener('blur', close, { signal: dismiss([node, menu()?.anchor].filter((n) => !!n), close) });
    queueMicrotask(() => {
      const m = menu();
      if (!m || m.placed) return;
      const { width, height } = node.getBoundingClientRect();
      const area = menuArea();
      setMenu({ ...m, x: Math.max(4, m.x + width > innerWidth - 4 ? (m.right ?? innerWidth - 4) - width : m.x), y: m.y + height > area.bottom ? Math.max(area.top, (m.above ?? area.bottom) - height) : m.anchor ? m.y : Math.max(area.top, m.y), placed: true });
    });
  };

  return (
    <Show when={menu()}>
      {(m) => (
        <div
          class="d-context-menu"
          ref={place}
          style={{ left: `${m().x}px`, top: `${m().y}px`, 'max-height': `${menuArea().bottom - menuArea().top}px`, visibility: m().placed ? 'visible' : 'hidden' }}
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
