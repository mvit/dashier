import { ResolvedTheme } from '../types/model';

/**
 * CSS custom properties for the report canvas. They redefine the editor's own variable names
 * (--surface, --ink, …) inside the report subtree, so widgets pick up the report theme while
 * the editor chrome keeps the user's UI theme. Charts read them too, plus --gridline and --series-1…8.
 */
export function reportStyle(t: ResolvedTheme): Record<string, string> {
  const mix = (pct: number) => `color-mix(in srgb, ${t.text} ${pct}%, ${t.surface})`;
  const vars: Record<string, string> = {
    '--r-bg': t.background,
    '--r-radius': `${t.radius}px`,
    '--surface': t.surface,
    '--field': t.surface,
    '--ink': t.text,
    '--ink-2': t.text,
    '--muted': t.muted,
    '--line': t.border,
    '--chrome-2': mix(6),
    '--accent': t.accent,
    '--gridline': mix(12),
    'font-family': t.font
  };
  for (let i = 0; i < 8; i++) vars[`--series-${i + 1}`] = t.palette[i % t.palette.length];
  return vars;
}
