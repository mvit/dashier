/** Small line icons for the editor's buttons, drawn in the text color. */
const icon = (d: string) => () => (
  <svg class="d-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** A curved arrow back: Lucide's undo-2 (ISC, © 2026 Lucide Icons and Contributors), redrawn as one path. */
export const UndoIcon = icon('M9 15L4 10l5-5M4 10h10.5a5.5 5.5 0 0 1 0 11H11');
/** A curved arrow forward: Lucide's redo-2 (ISC, © 2026 Lucide Icons and Contributors), redrawn as one path. */
export const RedoIcon = icon('M15 15l5-5-5-5M20 10H9.5a5.5 5.5 0 0 0 0 11H13');
/** A funnel, crossed out: clears a filter's or slicer's pick. */
export const ClearFilterIcon = icon('M3 4h15l-6 7v6l-3 2v-8L3 4zM16 15l5 5M21 15l-5 5');

/** Dashier's mark: a pie with its first quarter pulled out. */
export const Logo = (props: { size: number }) => (
  <svg class="ed-logo-mark" width={props.size} height={props.size} viewBox="0 0 24 24" role="img" aria-label="dashier">
    <path d="M10.5 13.5V4.5a9 9 0 1 0 9 9z" fill="#5b8def" />
    <path d="M13 11V2a9 9 0 0 1 9 9z" fill="#f7a600" />
  </svg>
);
