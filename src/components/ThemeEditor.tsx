import { Component, For } from 'solid-js';
import { store } from '../runtime/store';
import { DashTheme } from '../types/model';

const COLORS = [
  ['background', 'Page'],
  ['surface', 'Tiles'],
  ['text', 'Text'],
  ['muted', 'Muted'],
  ['border', 'Lines'],
  ['accent', 'Accent']
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

/** Report colors, fonts and corners. Stored in doc.theme; affects only the report canvas. */
export const ThemeEditor: Component = () => {
  const theme = () => store.reportTheme();
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

  const setPaletteColor = (i: number, color: string) => {
    const palette = [...theme().palette];
    palette[i] = color;
    store.setTheme({ palette });
  };

  return (
    <div class="d-format-container">
      <div class="d-section-title d-row">
        Report theme
        <button class="d-link-btn" title="Back to the default colors, font and corners" onClick={() => store.setTheme({}, true)}>
          Reset to default
        </button>
      </div>
      <div class="d-format-group">
        <label>Base</label>
        <select class="d-well-select" value={theme().mode} onChange={(e) => store.setTheme({ mode: e.currentTarget.value as DashTheme['mode'] })}>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="auto">Follow viewer's system</option>
        </select>
      </div>

      <div class="d-swatches">
        <For each={COLORS}>
          {([key, name]) => (
            <label class="d-swatch">
              <input type="color" value={theme()[key]} onInput={(e) => store.setTheme({ [key]: e.currentTarget.value })} />
              {name}
            </label>
          )}
        </For>
      </div>

      <div class="d-format-group">
        <label>Series colors</label>
        <div class="d-palette">
          <For each={[0, 1, 2, 3, 4, 5, 6, 7]}>
            {(i) => <input type="color" value={theme().palette[i % theme().palette.length]} onInput={(e) => setPaletteColor(i, e.currentTarget.value)} />}
          </For>
        </div>
      </div>

      <div class="d-format-group">
        <label>Font</label>
        <input
          type="text"
          class="d-input"
          list="d-fonts"
          value={store.doc.theme?.font ?? ''}
          placeholder="System default"
          onInput={(e) => store.setTheme({ font: e.currentTarget.value || undefined })}
        />
        <datalist id="d-fonts">
          <For each={FONTS}>{(f) => <option value={f} />}</For>
        </datalist>
      </div>

      <div class="d-format-group">
        <label>Corner radius · {theme().radius}px</label>
        <input type="range" min="0" max="24" value={theme().radius} onInput={(e) => store.setTheme({ radius: Number(e.currentTarget.value) })} />
      </div>

      <div class="d-section-title">Page size</div>
      <div class="d-format-group">
        <div class="d-row">
          <select class="d-well-select" title="Shape" onChange={(e) => e.currentTarget.value && shape(e.currentTarget.value)}>
            <option value="" selected={!ratio()}>Custom</option>
            <For each={RATIOS}>{([name]) => <option value={name} selected={ratio() === name}>{name}</option>}</For>
          </select>
          <select class="d-well-select" title="Orientation" onChange={() => store.setCanvas({ width: size().height, height: size().width })}>
            <option value="landscape" selected={!portrait()}>Landscape</option>
            <option value="portrait" selected={portrait()}>Portrait</option>
          </select>
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
      </div>
    </div>
  );
};
