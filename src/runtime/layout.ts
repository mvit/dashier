/** Visuals on a page's grid: where they sit, and making room when one moves onto others. */

/** A visual's place on the page's 12-column grid, in cells. */
export type Place = { id: string; x: number; y: number; w: number; h: number };

const overlaps = (a: Place, b: Place) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Room for `moved` among the page's other visuals (`others`, where they were): any it now covers moves down to just
 * below it, and any that one then covers, in turn, as grid layouts push. The new y of each visual that had to move.
 */
export function pushDown(others: Place[], moved: Place): Map<string, number> {
  const at = others.filter((p) => p.id !== moved.id).map((p) => ({ ...p }));
  const out = new Map<string, number>(), queue: Place[] = [moved];
  // each push moves a visual further down, so this ends
  for (let a; (a = queue.shift()); )
    for (const b of at)
      if (b !== a && overlaps(a, b)) {
        b.y = a.y + a.h;
        out.set(b.id, b.y);
        queue.push(b);
      }
  return out;
}
