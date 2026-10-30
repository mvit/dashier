import { Component, For } from 'solid-js';
import { store } from '../runtime/store';
import { resolveCanvas, resolveTheme } from '../types/model';
import { F, Section, SettingsPane, px, sec } from './FormatPane';
import { Select } from './ui';

const COLORS = [
  ['background', 'Page'],
  ['surface', 'Tiles'],
  ['text', 'Text'],
  ['muted', 'Muted'],
  ['border', 'Lines'],
  ['accent', 'Accent'],
  ['positive', 'Good news'],
  ['negative', 'Bad news']
] as const;

/** Page shapes, long side by short side; paper as at 96 px per inch. */
const RATIOS: [string, number, number][] = [
  ['16:9', 16, 9],
  ['16:10', 16, 10],
  ['4:3', 4, 3],
  ['1:1', 1, 1],
  ['Letter', 11, 8.5],
  ['A4', 297, 210]
];

const FONTS = ['system-ui, sans-serif', 'Georgia, "Times New Roman", serif', '"Trebuchet MS", Verdana, sans-serif', 'ui-monospace, Menlo, Consolas, monospace'];

/**
 * The report's settings, in the Format pane's cards: its colors (each "Auto", its base's, until set), series colors,
 * font and corners (doc.theme), and its page size (doc.canvas). They affect only the report canvas.
 */
export const ThemeEditor: Component = () => {
  // the base the colors come from: its light or dark palette
  const base = () => resolveTheme({ mode: store.doc.theme?.mode });
  const size = () => store.canvasSize();
  const portrait = () => size().height > size().width;
  const long = () => Math.max(size().width, size().height);
  // the shape the page has (within a pixel or so), whatever its size
  const ratio = () => RATIOS.find(([, a, b]) => Math.abs(long() / Math.min(size().width, size().height) - a / b) < 0.01)?.[0] ?? '';
  /** A page of `name`'s shape, keeping the long side and the orientation. */
  const shape = (name: string) => {
    const [, a, b] = RATIOS.find(r => r[0] === name)!;
    const short = Math.round((long() * b) / a);
    store.setCanvas(portrait() ? { width: short, height: long() } : { width: long(), height: short });
  };

  // a setting is a key of the theme ("palette.2": one series color) or the page size ("canvas"); what the base
  // (or the default page) has reads as unset, so a card is "changed" only when something differs from it
  const get = (path: string): any => {
    const [k, i] = path.split('.');
    if (k === 'canvas') return size().width === 1440 && size().height === 810 ? undefined : size();
    const v = (store.doc.theme as any)?.[k];
    return i ? v?.[+i] : k === 'mode' && v === 'light' ? undefined : v;
  };
  const put = (path: string, v: any) => {
    const [k, i] = path.split('.');
    if (k === 'canvas') return store.setCanvas(resolveCanvas(v));
    if (!i) return store.setTheme({ [k]: v === '' || v === (k === 'radius' ? 0 : (base() as any)[k]) ? undefined : v });
    const palette = [...(store.doc.theme?.palette ?? base().palette)];
    palette[+i] = v ?? base().palette[+i];
    store.setTheme({ palette: palette.join() === base().palette.join() ? undefined : palette });
  };

  const pageSize = () => (
    <>
      <div class="d-row">
        <Select title="Shape" value={ratio()} options={[['', 'Custom'], ...RATIOS.map(([n]): [string, string] => [n, n])]} set={(v) => v && shape(v)} />
        <Select title="Orientation" value={portrait() ? 'portrait' : 'landscape'} options={[['landscape', 'Landscape'], ['portrait', 'Portrait']]} set={() => store.setCanvas({ width: size().height, height: size().width })} />
      </div>
      <div class="d-row">
        <For each={['width', 'height'] as const}>
          {(key) => (
            <input
              type="number" class="d-input" min="320" max="7680" step="10" title={`${key[0].toUpperCase() + key.slice(1)} (px)`} value={size()[key]}
              onChange={(e) => {
                // a number is kept within 320–7680 px; anything else puts the size back
                const v = Number(e.currentTarget.value);
                if (e.currentTarget.value && Number.isFinite(v)) store.setCanvas({ ...size(), [key]: Math.max(320, v) });
                e.currentTarget.value = String(size()[key]);
              }}
            />
          )}
        </For>
      </div>
    </>
  );

  const sections = (): Section[] => [
    sec('theme-colors', 'Colors', [
      F.select('Base', 'mode', [[undefined, 'Light'], ['dark', 'Dark'], ['auto', "Viewer's system"]]),
      ...COLORS.map(([key, label]) => F.color(label, key, () => base()[key]))
    ]),
    // unset, a series has the color it's drawn in (a shorter palette repeats)
    sec('theme-series', 'Series colors', base().palette.map((_, i) => F.color(`Series ${i + 1}`, `palette.${i}`, () => store.reportTheme().palette[i % store.reportTheme().palette.length]))),
    sec('theme-font', 'Font and corners', [F.text('Font', 'font', 'System default', false, FONTS), F.range('Corners', 'radius', 0, 24, 1, 0, px)]),
    sec('theme-page', 'Page size', [{ kind: 'custom', label: 'Page size', keys: ['canvas'], render: pageSize }])
  ];

  return (
    <SettingsPane
      sections={sections()}
      get={get}
      put={put}
      search="Search report settings"
      tools={
        <button class="d-fbtn" title="Back to the default colors, font, corners and page size" onClick={() => (store.setTheme({}, true), store.setCanvas(resolveCanvas()))}>
          Reset
        </button>
      }
    />
  );
};
