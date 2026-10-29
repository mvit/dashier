// Drives dist/dashier.html (with the tests/e2e-doc.json report) in headless Chrome/Edge: edit interactions, filters, theming, save -> reload.
// Usage: npm run build && npm run e2e   (set CHROME_PATH to use a specific browser)
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const zlib = require('zlib');
const os = require('os');
const path = require('path');

// The built app with the fixture report in tests/e2e-doc.json (the shipped tutorial can change freely).
const FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dashier-e2e-')), 'fixture.html');
fs.writeFileSync(FILE, fs.readFileSync('dist/dashier.html', 'utf8').replace(
  /(<script type="application\/dashier\+json" id="dashier-doc">)[\s\S]*?(<\/script>)/,
  (_, open, close) => open + fs.readFileSync('tests/e2e-doc.json', 'utf8') + close
));
const URL = 'file:///' + FILE.replace(/\\/g, '/');
const executablePath = require('./tests/browser.cjs');

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!executablePath) throw new Error('No Chrome/Edge found; set CHROME_PATH');
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'dashier-e2e-'));

  // a profile of our own: without one, Edge on Windows can refuse to start ("The browser is already running")
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashier-e2e-profile-'));
  const browser = await puppeteer.launch({ executablePath, headless: true, userDataDir, args: ['--window-size=1600,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // force the download fallback so Save is observable without a file picker
  await page.evaluateOnNewDocument(() => { window.showSaveFilePicker = undefined; delete window.showSaveFilePicker; });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });

  page.on('dialog', (d) => d.accept());
  const tiles = '.d-visual-container';
  const css = (i) => page.$$eval(tiles, (els, i) => `${els[i].style.gridColumn} | ${els[i].style.gridRow}`, i);
  // deselect (the fixed-size sheet may be scrolled, so its corner isn't always on screen)
  const blank = async () => {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Escape');
  };
  const kpi = () => page.$eval('.card-value', (e) => e.textContent);

  // ── view mode ───────────────────────────────────────────────────────────────
  const open = async (hash = '') => {
    await page.goto('about:blank'); // a hash-only change would not reload the app
    await page.goto(URL + hash);
    await page.waitForSelector(tiles);
    await page.waitForSelector('#d-splash', { hidden: true });
  };
  // #preview opens the sheet without any editor chrome
  await open('#preview');
  check('#preview hides all editor chrome', !!(await page.$('.mode-preview')) && !(await page.$('.ed-topbar')) && !(await page.$('.d-visualizations-pane')) && !(await page.$('.d-filters-pane')));
  check('renders 7 visuals', (await page.$$(tiles)).length === 7);
  await page.waitForSelector('.d-chart-svg svg');
  check('the bar and line charts are drawn', (await page.$$('.d-chart-svg svg')).length >= 2);
  check('charts with series show the same legend, none inside the chart', (await page.$$('.d-chart-widget .d-legend')).length === 2 && !(await page.$('.c-legend')));
  await page.waitForFunction(() => document.querySelector('.markdown-content')?.textContent.includes('Revenue:'));
  const note = await page.$eval('.markdown-content', (e) => e.textContent);
  check('a text box fills in live table values', note.includes('$1,816,004') && note.includes('16 region-quarters') && note.includes('Peak users: 22,100'), note);
  const style = (sel, prop) => page.$eval(sel, (e, p) => getComputedStyle(e)[p], prop);
  check('sheet frame has square corners', (await style('.d-canvas-sheet', 'borderTopLeftRadius')) === '0px');
  check('tiles are square by default', (await style(tiles, 'borderTopLeftRadius')) === '0px');
  check('no type badges on charts or cards', !(await page.$('.chart-type-badge, .card-agg-tag')));
  const frames = await page.$$eval(tiles, (ts) => ts.map((t) => getComputedStyle(t).borderTopWidth + ' ' + getComputedStyle(t).outlineStyle));
  check('no visual (chart, card, table, text) has an outer border', frames.every((f) => f === '0px none'), frames.join(' | '));
  const sheetW = await page.$eval('.d-canvas-sheet', (e) => e.getBoundingClientRect().width);
  check('preview sheet keeps its fixed size (no reflow to the window)', sheetW === 1440, `${sheetW}px`);
  // zoom scales the whole sheet; the layout inside stays the same
  const tileW = () => page.$eval('.d-visual-container', (e) => e.offsetWidth);
  const tw0 = await tileW();
  await page.$$eval('.d-zoom .d-status-btn', (bs) => bs.find((b) => b.textContent.trim() === '−').click());
  const zoomed = await page.$eval('.d-canvas-sheet', (e) => e.getBoundingClientRect().width);
  check('zooming out scales the sheet without reflowing it', zoomed < 1440 && (await tileW()) === tw0, `${zoomed}px, tile ${await tileW()} vs ${tw0}`);
  await page.$$eval('.d-zoom .d-status-btn', (bs) => bs.find((b) => b.textContent.includes('Fit page')).click());
  const fitH = await page.$eval('.d-canvas-sheet', (e) => e.getBoundingClientRect().height);
  const viewH = await page.$eval('.d-canvas-scroll-container', (e) => e.clientHeight);
  check('Fit page fits the whole sheet in the view', fitH <= viewH, `${fitH} of ${viewH}`);
  await page.$$eval('.d-zoom .d-status-btn', (bs) => bs.find((b) => b.textContent.includes('%')).click());
  // a trackpad pinch (ctrlKey wheel, Ctrl not held) scales the sheet; real Ctrl + wheel / Ctrl + = belong to the browser
  const pct = () => page.$eval('.d-zoom-pct', (e) => e.textContent.trim());
  const wheel = () => page.$eval('.d-canvas-scroll-container', (el) => {
    const ev = new WheelEvent('wheel', { deltaY: -40, ctrlKey: true, clientX: 300, clientY: 300, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  const pinched = await wheel();
  check('a pinch zooms the sheet', pinched && (await pct()) !== '100%', await pct());
  await page.$$eval('.d-zoom .d-status-btn', (bs) => bs.find((b) => b.textContent.includes('%')).click());
  await page.keyboard.down('Control');
  const ctrlWheel = await wheel();
  const ctrlPlus = await page.evaluate(() => {
    const ev = new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  await page.keyboard.up('Control');
  check('Ctrl + wheel and Ctrl + = are left to the browser\'s page zoom', !ctrlWheel && !ctrlPlus && (await pct()) === '100%', `${ctrlWheel} ${ctrlPlus} ${await pct()}`);
  // ── charts: tooltips and formatted axes ────────────────────────────────────
  const firstBar = await page.$('.d-chart-widget .c-bars rect');
  const fb = await firstBar.boundingBox();
  await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
  await sleep(100);
  const tipText = await page.$eval('.d-tip', (t) => (t.style.display === 'block' ? t.textContent : ''));
  check('hovering a column shows a tooltip with its category and values', tipText.startsWith('North America') && tipText.includes('Q1') && tipText.includes('124,500.5'), tipText);
  await page.mouse.move(2, 300);
  check('…which hides when the pointer leaves', (await page.$eval('.d-tip', (t) => t.style.display)) === 'none');
  const ticks = await page.$$eval('.d-chart-widget .c-axis-labels text[text-anchor="end"]', (ts) => ts.map((t) => t.textContent));
  check('value axes read 50K, not 50000', ticks.includes('50K') && !ticks.some((t) => /^\d{5,}$/.test(t)), ticks.join(' '));

  await page.keyboard.press('Escape');
  check('Esc leaves preview', !!(await page.$('.mode-edit')) && !!(await page.$('.ed-topbar')));

  // the editor is the default; Preview is a button, not a toggle
  await open();
  check('opens in the editor by default', !!(await page.$('.mode-edit')) && !!(await page.$('.d-visualizations-pane')));
  check('no Edit/Done toggle', !(await page.$$eval('.ed-btn', (b) => b.some((x) => /Done|Edit/.test(x.textContent)))));
  await page.$$eval('.ed-btn', (b) => b.find((x) => /Preview/.test(x.textContent)).click());
  await page.waitForSelector('.mode-preview');
  check('Preview button hides the chrome', !(await page.$('.ed-topbar')));
  await page.click('.d-exit-preview');
  await page.waitForSelector('.mode-edit');
  check('exit button returns to the editor', !!(await page.$('.ed-topbar')));

  // ── bottom bars: page tabs scroll, the + stays put; zoom lives in the window-wide status bar ──
  check('zoom controls are in the status bar, not the page tabs', !!(await page.$('.ed-statusbar .d-zoom')) && !(await page.$('.d-bottom-pages-bar .d-zoom')));
  for (let i = 0; i < 14; i++) await page.click('.d-add-page-btn');
  const tabsBox = await page.$eval('.d-page-tabs-list', (e) => ({ sw: e.scrollWidth, cw: e.clientWidth, sl: e.scrollLeft }));
  const addBox = await (await page.$('.d-add-page-btn')).boundingBox();
  const barBox = await (await page.$('.d-bottom-pages-bar')).boundingBox();
  check('many pages scroll the tab list…', tabsBox.sw > tabsBox.cw && tabsBox.sl > 0, JSON.stringify(tabsBox));
  check('…and the add button stays visible', addBox && addBox.x + addBox.width <= barBox.x + barBox.width, JSON.stringify(addBox));
  const activeTab = await (await page.$('.d-bottom-tab.active')).boundingBox();
  check('the new page\'s tab is scrolled into view', activeTab.x >= barBox.x && activeTab.x + activeTab.width <= addBox.x + 1);
  check('the status bar counts pages', (await page.$eval('.ed-statusbar', (e) => e.textContent)).includes('Page 16 of 16'));

  // ── drag, resize, undo ──────────────────────────────────────────────────────
  await open();
  const g0 = await css(0);
  const colW = (await page.$eval('.d-visuals-grid', (g) => g.getBoundingClientRect().width + 14)) / 12;
  const box = await (await page.$$(tiles))[0].boundingBox();
  await page.mouse.move(box.x + 40, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 40 + colW * 1.5, box.y + 60, { steps: 4 });
  await page.mouse.move(box.x + 40 + colW * 3, box.y + 60, { steps: 4 });
  await page.mouse.up();
  const g1 = await css(0);
  check('dragging moves a visual 3 columns', /^4 \/ span 3/.test(g1), g1);

  const h = await (await page.$('.h-se')).boundingBox();
  await page.mouse.move(h.x + 4, h.y + 4);
  await page.mouse.down();
  await page.mouse.move(h.x + 4 + colW, h.y + 4 + 99, { steps: 5 });
  await page.mouse.up();
  const g2 = await css(0);
  check('resize handle grows it to 4×3', /^4 \/ span 4/.test(g2) && /\| 1 \/ span 3$/.test(g2), g2);

  await blank();
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  check('each gesture is one undo step', (await css(0)) === g0, await css(0));

  // ── filters ─────────────────────────────────────────────────────────────────
  // drags a Data pane field onto the i-th element matching `target`
  const dropOn = (table, field, target, i = 0) => page.evaluate((t, f, sel, n) => {
    const node = [...document.querySelectorAll('.d-table-node')].find((x) => x.querySelector('.d-table-name').textContent === t);
    const item = [...node.querySelectorAll('.d-field-item')].find((x) => x.querySelector('.d-field-name').textContent === f);
    const dt = new DataTransfer();
    item.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    const box = document.querySelectorAll(sel)[n];
    box.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    box.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, table, field, target, i);
  const before = await kpi();
  check('filters are added by dragging a field, not from a list', !(await page.$('.d-filters-pane select')));
  await dropOn('regional_metrics', 'region', '.d-filters-pane .d-filter-section:nth-child(1) .d-well-box');
  await page.waitForSelector('.d-filter-values');
  for (const l of await page.$$('.d-filter-values label')) if ((await l.evaluate((e) => e.textContent)) === 'Europe') await l.click();
  const after = await kpi();
  check('page filter changes the KPI', before === '$1,816,004' && after === '$489,101', `${before} → ${after}`);
  check('page filter changes the table', (await page.$$eval('.d-table-widget tbody tr', (rs) => rs.length)) === 4);
  check('tables have no search box or paging', !(await page.$('.d-table-widget input, .d-table-widget select, .table-pagination')));
  const cards = () => page.$$eval('.card-value', (es) => es.map((e) => e.textContent));
  check('a filter follows a relationship into another table', (await cards())[2] === '$600,000', (await cards()).join(' | '));

  // ── top bar is minimal ──────────────────────────────────────────────────────
  const barButtons = await page.$$eval('.ed-topbar button', (bs) => bs.map((b) => b.textContent.trim() || `${b.title} [${b.querySelector('svg') ? 'icon' : ''}]`));
  check('top bar only has the logo (About), undo/redo (drawn icons), Preview and Share', JSON.stringify(barButtons) === JSON.stringify(['About Dashier [icon]', 'Undo (Ctrl+Z) [icon]', 'Redo (Ctrl+Y) [icon]', '▶ Preview', 'Share ▾']), barButtons.join(' | '));
  await page.click('.ed-logo');
  await page.waitForSelector('.d-about');
  const about = await page.$eval('.d-about', (e) => e.textContent);
  check('the logo opens About: who made Dashier and where it lives', about.includes('Made by mvit and Opus 5.5') && about.includes('GitHub'), about);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.d-about', { hidden: true });
  check('…and Esc closes it', true);
  check('the logo is the pie mark', (await page.$$('.ed-logo-mark path')).length === 2);
  const durations = await page.$$eval('.ed-root *', (els) => [...new Set(els.map((e) => getComputedStyle(e).transitionDuration))]);
  check('no transitions anywhere in the app', durations.join() === '0s', durations.join());

  // ── right-click menus ───────────────────────────────────────────────────────
  const menuItems = () => page.$$eval('.d-context-menu button', (bs) => bs.map((b) => (b.disabled ? '(' : '') + b.querySelector('span').textContent + (b.disabled ? ')' : '')));
  const pickItem = (label) => page.$$eval('.d-context-menu button', (bs, l) => bs.find((b) => b.querySelector('span').textContent === l).click(), label);
  const tabCount = () => page.$$eval('.d-bottom-tab', (t) => t.length);
  check('page tabs have no inline buttons', !(await page.$('.d-bottom-tab button')));
  await (await page.$$('.d-bottom-tab'))[1].click({ button: 'right' });
  await page.waitForSelector('.d-context-menu');
  check('right-clicking a page tab offers rename, duplicate, delete and new page', (await menuItems()).join() === 'Rename,Duplicate,Delete,New page', (await menuItems()).join());
  const tabs0 = await tabCount();
  await pickItem('Duplicate');
  check('…Duplicate adds a copy of the page', (await tabCount()) === tabs0 + 1 && (await page.$eval('.d-bottom-tab.active', (t) => t.textContent)).includes('(Copy)'));
  await (await page.$$('.d-bottom-tab.active'))[0].click({ button: 'right' });
  await page.waitForSelector('.d-context-menu');
  await pickItem('Delete');
  check('…and Delete removes it', (await tabCount()) === tabs0);
  await (await page.$$('.d-bottom-tab'))[0].click();
  await (await page.$$(tiles))[0].click({ button: 'right' });
  await page.waitForSelector('.d-context-menu');
  check('right-clicking a visual selects it and offers duplicate and delete', !!(await page.$('.d-selection-frame')) && (await menuItems()).join() === 'Duplicate,Delete', (await menuItems()).join());
  await pickItem('Duplicate');
  check('…Duplicate copies it', (await page.$$(tiles)).length === 8);
  await page.keyboard.press('Delete');
  check('…and the copy can be deleted', (await page.$$(tiles)).length === 7);
  await page.keyboard.press('Escape');
  // Share opens the same menu under the button, with the shortcuts
  await page.click('.ed-topbar .ed-btn-primary');
  await page.waitForSelector('.d-context-menu');
  const share = await page.$$eval('.d-context-menu button', (bs) => bs.map((b) => b.textContent));
  check('Share offers Save, Save a copy, Print, then encryption, then Export and Open JSON', share.join() === 'SaveCtrl+S,Save a copy…,Print…Ctrl+P,Encrypt with password…,Remove encryption,Export JSON,Open JSON…' && (await page.$$('.d-context-menu hr')).length === 2, share.join());
  await page.keyboard.press('Escape');
  check('…and Esc closes it', !(await page.$('.d-context-menu')));

  // ── data: right-click a table → Edit Data… ──────────────────────────────────
  const tables = () => page.$$eval('.d-table-name', (ns) => ns.map((n) => n.textContent));
  const rightClick = async (table, item) => {
    const i = (await tables()).indexOf(table);
    await (await page.$$('.d-table-header'))[i].click({ button: 'right' });
    await page.waitForSelector('.d-context-menu');
    await page.$$eval('.d-context-menu button', (b, re) => b.find((x) => new RegExp(re).test(x.textContent)).click(), item);
  };
  const editData = async (table) => { await rightClick(table, 'Edit data'); await page.waitForSelector('.modal-dialog'); };
  const closeDialog = async () => { await page.keyboard.press('Escape'); await page.waitForSelector('.modal-dialog', { hidden: true }); };
  const tab = (n) => page.click(`.d-dtabs .d-dtab:nth-child(${n})`);
  const field = (cls, value) => page.evaluateHandle((c, v) => [...document.querySelectorAll(c)].find((i) => i.value === v), cls, value);
  const retype = async (handle, text) => { await handle.click({ count: 3 }); await page.keyboard.type(text); await page.keyboard.press('Enter'); };
  // a column of the Edit Data grid: its type and its blank count from the header's profile
  const rowOf = (col) => page.$$eval('.modal-dialog thead th[data-col]', (hs, c) => {
    const h = hs.find((x) => x.querySelector('.d-name-input').value === c);
    return h ? { type: h.querySelector('select').value, blanks: (h.querySelector('.d-col-blank')?.textContent ?? '').replace(' blank', '') } : null;
  }, col);
  const setType = (col, type) => page.$$eval('.modal-dialog thead th[data-col]', (hs, c, t) => {
    const sel = hs.find((h) => h.querySelector('.d-name-input').value === c).querySelector('select');
    sel.value = t;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, col, type);

  // the ⋯ button opens the same menu
  await page.hover('.d-table-header');
  await page.click('.d-table-more');
  check('a table\'s ⋯ button opens its menu', !!(await page.$('.d-context-menu')));
  await page.keyboard.press('Escape');

  await editData('regional_metrics');
  check('Edit Data shows the data with each column\'s type', (await page.$$('.modal-dialog thead th[data-col]')).length === 4 && (await page.$$('.modal-dialog tbody tr')).length === 16 && (await rowOf('revenue')).type === 'float');
  await setType('region', 'float');
  await sleep(250);
  check('changing a type re-reads the data (text as float → blank)', (await rowOf('region')).blanks === '16', (await rowOf('region')).blanks);
  await setType('region', 'string');
  await sleep(250);
  check('changing it back restores the values', (await rowOf('region')).blanks === '');

  // connections = relationships between this table's fields and other tables' fields
  await tab(2);
  const rels = () => page.$$eval('.d-rel:not(.d-rel-draft)', (es) => es.map((e) => ({
    mine: e.querySelector('.d-rel-mine').value,
    table: e.querySelector('.d-rel-table').value,
    field: e.querySelector('.d-rel-field').value,
    meta: e.querySelector('.d-rel-meta').textContent
  })));
  const first = (await rels())[0];
  check('Connections shows field ↔ field links', (await rels()).length === 1 && first.mine === 'region' && first.table === 'region_targets' && first.field === 'area', JSON.stringify(first));
  check('…with the share of matching values', first.meta.includes('100% match'));
  check('there are no join kinds to pick (relationships work as in Power BI)', !(await page.$('.d-rel select.d-join-select')));
  const linkText = () => page.$eval('.d-rel', (e) => `${e.querySelector('.d-rel-card').selectedOptions[0].textContent} · ${e.querySelector('.d-rel-dir').selectedOptions[0].textContent}`);
  check('…but a cardinality (read from the data) and the way filters flow, as in Power BI', (await linkText()) === 'Many to one · region_targets filters regional_metrics', await linkText());
  await page.select('.d-rel .d-rel-dir', 'both');
  check('the cross filter direction can be both ways', (await linkText()).endsWith('Filters both ways'), await linkText());
  await page.select('.d-rel .d-rel-dir', 'single');

  // connections are editable: the far field
  await page.select('.d-rel .d-rel-field', 'target_revenue');
  check('the connected field can be changed (and a type mismatch is flagged)', (await rels())[0].field === 'target_revenue' && (await rels())[0].meta.includes('types differ'), JSON.stringify((await rels())[0]));
  await page.select('.d-rel .d-rel-field', 'area');
  check('…and changed back', (await rels())[0].field === 'area');
  await tab(3);
  check('Used by lists every visual bound to the table, on all pages', (await page.$$('.d-usage')).length === 10);
  await page.click('.d-usage');
  await page.waitForSelector('.modal-dialog', { hidden: true });
  check('clicking a visual jumps to it', !!(await page.$('.d-selection-frame')));
  await page.hover('.d-visual-container.d-selected');
  check('the selection outline stays solid under the pointer', (await style('.d-visual-container.d-selected', 'outlineStyle')) === 'solid');
  await blank();

  // Get Data adds a table
  await page.click('.d-get-data-btn');
  check('Get Data opens on a file drop zone', !!(await page.$('.d-dropzone')));
  await page.click('.d-paste-btn');
  await page.type('.modal-dialog textarea', 'a,b\n1,2\n3,4');
  await page.waitForSelector('.d-getdata .d-grid');
  const previewTypes = await page.$$eval('.d-getdata thead th[data-col] .d-type-chip span', (cs) => cs.map((c) => c.textContent));
  check('pasted data is previewed with its column types', previewTypes.join() === '123,123' && (await page.$$('.d-getdata tbody tr')).length === 2, previewTypes.join());
  await page.click('.d-getdata-name', { count: 3 });
  await page.keyboard.type('extra');
  await page.click('.modal-dialog .btn-primary');
  await page.waitForSelector('.modal-dialog', { hidden: true });
  check('Get Data adds a typed table', (await tables()).includes('extra'), (await tables()).join(','));

  // connect two fields from the dialog, then remove the connection
  await editData('regional_metrics');
  await tab(2);
  await page.click('.d-new-rel');
  await page.select('.d-rel-form .d-rel-mine', 'quarter');
  await page.select('.d-rel-form .d-rel-table', 'extra');
  await page.select('.d-rel-form .d-rel-field', 'a');
  await page.click('.d-rel-form .btn-primary');
  const added = (await rels())[1];
  check('Connect adds a relationship', (await rels()).length === 2 && added.table === 'extra', JSON.stringify(added));
  check('…and flags mismatched types', added.meta.includes('types differ'));
  await (await page.$$('.d-rel-x'))[1].click();
  check('the connection can be removed', (await rels()).length === 1);
  await closeDialog();

  // rename a table
  await editData('extra');
  await retype(await field('.d-title-input', 'extra'), 'scratch');
  await sleep(150);
  check('a table can be renamed', (await tables()).includes('scratch') && !(await tables()).includes('extra'), (await tables()).join(','));
  await closeDialog();

  // replace a table's data: dropped columns are flagged, new ones are fine, the table keeps its name
  const fieldsOfTable = (t) => page.$$eval('.d-table-node', (ns, name) => {
    const n = ns.find((x) => x.querySelector('.d-table-name').textContent === name);
    return [...n.querySelectorAll('.d-field-name')].map((f) => f.textContent);
  }, t);
  await rightClick('scratch', 'Replace data');
  await page.waitForSelector('.d-getdata');
  check('Replace data opens for that table', (await page.$eval('.d-getdata h3', (e) => e.textContent)).includes('scratch') && !(await page.$('.d-getdata-name')));
  await page.click('.d-paste-btn');
  await page.type('.modal-dialog textarea', 'a,c\n5,x\n7,y');
  await page.waitForSelector('.d-schema-note');
  const notes = await page.$$eval('.d-schema-note', (ns) => ns.map((n) => ({ cls: n.className, text: n.textContent })));
  check('missing columns are warned about', notes.some((n) => n.cls.includes('warn') && n.text.includes('missing') && n.text.includes('b')), JSON.stringify(notes));
  check('…new columns are just noted', notes.some((n) => !n.cls.includes('warn') && n.text.includes('new column') && n.text.includes('c')));
  check('…and the button says so', (await page.$eval('.modal-dialog .btn-primary', (b) => b.textContent)) === 'Replace anyway');
  await page.click('.modal-dialog .btn-primary');
  await page.waitForSelector('.modal-dialog', { hidden: true });
  check('replacing swaps the columns and keeps the table', (await fieldsOfTable('scratch')).join() === 'a,c', (await fieldsOfTable('scratch')).join());

  // rename a column: the visual and the relationship that use it follow
  await editData('region_targets');
  await retype(await field('.d-name-input', 'area'), 'zone');
  await sleep(300);
  check('a column can be renamed', !!(await rowOf('zone')) && !(await rowOf('area')));
  await closeDialog();
  check('…and a filter still reaches the table through the renamed field', (await cards())[2] === '$600,000', (await cards()).join(' | '));

  // clicking a field in the Data pane does nothing to the report (fields are only dragged in)
  const tilesBefore = (await page.$$(tiles)).length;
  await page.click('.d-field-item');
  check('clicking a Data pane field does not add a visual', (await page.$$(tiles)).length === tilesBefore);

  // visuals start empty and fields are only ever dragged in: no pickers, no source setting
  const drag = (table, field, well) => page.evaluate((t, f, i, mime) => {
    const node = [...document.querySelectorAll('.d-table-node')].find((n) => n.querySelector('.d-table-name').textContent === t);
    const item = [...node.querySelectorAll('.d-field-item')].find((n) => n.querySelector('.d-field-name').textContent === f);
    const dt = new DataTransfer();
    item.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    const box = document.querySelectorAll('.d-wells-container .d-well-box')[i];
    box.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    box.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return dt.getData(mime);
  }, table, field, well, 'application/x-dashier-field');
  // a well's field: the pill's text plus its tooltip (table.field)
  const slotText = (i) => page.$$eval('.d-wells-container .d-field-well', (ws, n) => { const p = ws[n].querySelector('.d-pill'); return p ? `${p.textContent} ${p.title}` : ''; }, i);
  const slotsEmpty = async () => (await page.$$('.d-wells-container .d-well-empty')).length;
  // opens the menu of the pill matching `pill` and picks `item`
  const pickMenu = async (pill, item) => {
    await page.click(pill);
    await page.waitForSelector('.d-field-menu');
    await page.$$eval('.d-field-menu .d-menu-item', (bs, l) => bs.find((b) => b.textContent.replace('✓', '').trim() === l).click(), item);
    await sleep(80);
  };

  await blank();
  await page.click('.d-vis-icon[title="Add Column chart"]');
  const fresh = await page.$$eval(tiles, (ts) => ({ svg: !!ts.at(-1).querySelector('svg'), text: ts.at(-1).textContent }));
  check('a new chart starts empty (nothing is pre-filled)', !fresh.svg && fresh.text.includes('Drag fields'), fresh.text);
  check('…with empty slots to drop on, no pickers and no Source', (await slotsEmpty()) === 3 && !(await page.$('.d-wells-container select')) && !(await page.$$eval('.d-well-header label', (ls) => ls.some((l) => l.textContent === 'Source'))));
  const payload = await drag('regional_metrics', 'quarter', 0);
  check('dragging a field carries its table and name', payload === JSON.stringify({ table: 'regional_metrics', field: 'quarter' }), payload);
  check('dropping a field into a slot sets it', (await slotText(0)).includes('quarter') && (await slotsEmpty()) === 2, await slotText(0));
  await drag('region_targets', 'target_revenue', 1);
  check('a connected table\'s field is kept as table.field', (await slotText(1)).includes('region_targets') && (await slotText(1)).includes('target_revenue'), await slotText(1));
  await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].at(-1)?.querySelector('.d-chart-svg svg'), {}, tiles);
  check('the chart draws once its fields are placed', true);
  check('a value field is shown summarized ("Sum of …")', (await slotText(1)).startsWith('Sum of target_revenue'), await slotText(1));
  await pickMenu('.d-wells-container .d-field-well:nth-child(2) .d-pill', 'Average');
  check('the field menu changes the summary', (await slotText(1)).startsWith('Average of target_revenue'), await slotText(1));
  await pickMenu('.d-wells-container .d-field-well:nth-child(2) .d-pill', 'Percent of grand total');
  check('…and can show values as a percent of the grand total', (await slotText(1)).startsWith('%GT Average of target_revenue'), await slotText(1));
  await pickMenu('.d-wells-container .d-field-well:nth-child(2) .d-pill', 'Running total');
  check('…or as a running total along the axis', (await slotText(1)).startsWith('Average of target_revenue, running total'), await slotText(1));
  await pickMenu('.d-wells-container .d-field-well:nth-child(2) .d-pill', 'Same period last year');
  check('…and compared with the same period last year', (await slotText(1)).includes(', % vs last year'), await slotText(1));
  await drag('scratch', 'a', 0);
  check('a field of an unconnected table is refused with a hint', !!(await page.$('.d-drop-note')) && (await slotText(0)).includes('quarter'));
  for (let i = 0; i < 2; i++) await page.click('.d-wells-container .d-pill .d-pill-x');
  check('removing the fields empties the slots again', (await slotsEmpty()) === 3);
  await drag('scratch', 'a', 0);
  check('…and then another table can start the visual', (await slotText(0)).includes('scratch') && !(await page.$('.d-drop-note')), await slotText(0));
  await page.keyboard.press('Delete');
  check('the temporary chart is removed', (await page.$$(tiles)).length === 7);

  // scatter: numbers on both axes, one point per row, or per Details value with both axes summarized
  await blank();
  await page.click('.d-vis-icon[title="Add Scatter chart"]');
  const wellNames = await page.$$eval('.d-wells-container .d-well-header label', (ls) => ls.map((l) => l.textContent).join());
  check('a scatter has X-axis, Y-axis, Legend and Details slots', wellNames === 'X-axis,Y-axis,Legend,Details', wellNames);
  await drag('regional_metrics', 'region', 0);
  check('text is refused on a scatter axis, with a hint', (await slotsEmpty()) === 4 && (await page.$eval('.d-drop-note', (e) => e.textContent)).includes('Details'));
  await drag('regional_metrics', 'revenue', 0);
  await drag('regional_metrics', 'active_users', 1);
  const dots = () => page.$$eval(tiles, (ts) => (ts.at(-1).querySelector('.c-points')?.getAttribute('d').match(/h0/g) || []).length);
  await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].at(-1)?.querySelector('.c-points'), {}, tiles);
  check('a scatter draws one point per row (4 after the page\'s Europe filter)', (await dots()) === 4, String(await dots()));
  check('…its axes reading the fields as they are', (await slotText(0)).startsWith('revenue') && (await slotText(1)).startsWith('active_users'), await slotText(0));
  await drag('regional_metrics', 'region', 3);
  await page.waitForFunction((sel) => ([...document.querySelectorAll(sel)].at(-1)?.querySelector('.c-points')?.getAttribute('d').match(/h0/g) || []).length === 1, {}, tiles);
  check('Details gives one point per value, both axes summarized', (await slotText(0)).startsWith('Sum of revenue') && (await slotText(1)).startsWith('Sum of active_users'), await slotText(0));
  const dot = await page.$$eval(tiles, (ts) => {
    ts.at(-1).scrollIntoView({ block: 'center', inline: 'center' });
    const svg = ts.at(-1).querySelector('svg.c-scatter');
    const [, x, y] = /M([\d.]+) ([\d.]+)h0/.exec(svg.querySelector('.c-points').getAttribute('d'));
    const p = new DOMPoint(+x, +y).matrixTransform(svg.getScreenCTM());
    return { x: p.x, y: p.y };
  });
  await page.mouse.move(dot.x, dot.y);
  await page.waitForSelector('.d-tip', { visible: true });
  const scatterTip = await page.$eval('.d-tip', (e) => e.textContent);
  check('hovering a point shows its name and values', scatterTip.includes('Sum of revenue') && scatterTip.includes('Sum of active_users') && scatterTip.startsWith('Europe'), scatterTip);
  await page.mouse.move(5, 5);
  await page.click('.d-vis-icon[title="Change to Column chart"]');
  check('switching to a column chart puts the details on the X-axis', (await slotText(0)).includes('region') && (await slotText(1)).includes('active_users'), await slotText(0));
  await page.keyboard.press('Delete');
  check('the temporary scatter is removed', (await page.$$(tiles)).length === 7);

  // the format pane: a section by its title (opened), a setting's control by its label
  const fsec = (title) =>
    page.$$eval('.d-fsec', (ss, t) => {
      const s = ss.find((x) => x.querySelector('.d-fsec-title').textContent.replace(/[▸▾]/, '').trim() === t);
      if (s && !s.classList.contains('open')) s.querySelector('.d-fsec-title').click();
      return !!s;
    }, title);
  const fcontrol = (title, label, fn, arg) =>
    page.$$eval('.d-fsec', (ss, t, l, f, a) => {
      const s = ss.find((x) => x.querySelector('.d-fsec-title').textContent.replace(/[▸▾]/, '').trim() === t);
      const row = [...s.querySelectorAll('.d-frow')].find((r) => r.querySelector('.d-flabel')?.textContent === l);
      return new Function('row', 'a', `return (${f})(row, a)`)(row, a);
    }, title, label, fn.toString(), arg);
  const foptions = async (title, label) => (await fsec(title), fcontrol(title, label, (row) => [...row.querySelectorAll('option')].map((o) => o.textContent)));
  const fpick = async (title, label, text) => {
    await fsec(title);
    await fcontrol(title, label, (row, t) => {
      const s = row.querySelector('select');
      s.value = [...s.options].find((o) => o.textContent === t).value;
      s.dispatchEvent(new Event('change', { bubbles: true }));
    }, text);
    await sleep(80);
  };
  const fpicked = (title, label) => fcontrol(title, label, (row) => row.querySelector('select').selectedOptions[0]?.textContent);

  // stacking, areas and donuts (the page shows only Europe: one region, four quarters)
  const last = (fn) => page.$$eval(tiles, (ts, f) => new Function('t', `return (${f})(t)`)(ts.at(-1)), fn.toString());
  await blank();
  await page.click('.d-vis-icon[title="Add Column chart"]');
  await drag('regional_metrics', 'quarter', 0);
  await drag('regional_metrics', 'revenue', 1);
  await drag('regional_metrics', 'region', 2);
  await page.click('.d-subtab-btn:nth-child(2)'); // Format
  const stackPicker = await foptions('Bars', 'Stack');
  check('column charts offer side by side, stacked and 100% stacked', stackPicker.join() === 'Side by side,Stacked,100% stacked', stackPicker.join());
  await fpick('Bars', 'Stack', '100% stacked');
  await page.waitForFunction((sel) => [...[...document.querySelectorAll(sel)].at(-1).querySelectorAll('.c-axis-labels text')].some((t) => t.textContent === '100%'), {}, tiles);
  check('100% stacked reads its axis in percent', true);
  await page.click('.d-vis-icon[title="Change to Area chart"]');
  await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].at(-1).querySelector('.c-area'), {}, tiles);
  const areas = await last((t) => t.querySelectorAll('.c-area').length);
  await fsec('Lines');
  const keptStack = await fpicked('Lines', 'Stack');
  check('an area chart fills under its line, and keeps the stacking', areas === 1 && keptStack === '100% stacked', `${areas} areas; stack: ${keptStack}`);
  await page.click('.d-vis-icon[title="Change to Donut chart"]');
  await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].at(-1).querySelector('.c-slice'), {}, tiles);
  check('a donut draws ring slices', (await last((t) => t.querySelectorAll('.c-slice').length)) === 4);
  await page.keyboard.press('Delete');

  // matrix: rows in a hierarchy, columns across, values at every crossing, with totals
  await blank();
  await page.click('.d-vis-icon[title="Add Matrix"]');
  await page.click('.d-subtab-btn:nth-child(1)'); // Build
  const matrixWells = await page.$$eval('.d-wells-container .d-well-header label', (ls) => ls.map((l) => l.textContent).join());
  check('a matrix has Rows, Columns and Values', matrixWells === 'Rows,Columns,Values', matrixWells);
  await drag('regional_metrics', 'quarter', 0);
  await drag('regional_metrics', 'region', 1);
  await drag('regional_metrics', 'revenue', 2);
  await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].at(-1).querySelector('.d-matrix tbody th'), {}, tiles);
  const matrix = () => last((t) => {
    const m = t.querySelector('.d-matrix');
    const cells = (tr) => [...tr.children].map((c) => c.textContent.replace(/[+−]/, '').trim());
    return { head: [...m.querySelectorAll('thead th')].map((th) => th.textContent.trim()), rows: [...m.querySelectorAll('tbody tr:not(.d-spacer)')].map(cells), total: [...m.querySelectorAll('tfoot tr')].map(cells)[0] };
  });
  let mx = await matrix();
  check('a matrix lays out its rows, columns and totals', mx.head.join('|') === 'Quarter|Europe|Total' && mx.rows.length === 4 && mx.rows[0][0] === 'Q1' && mx.total[0] === 'Total', JSON.stringify(mx));
  check('…every cell summed, with a Total column and row', mx.rows[0][1] === mx.rows[0][2] && mx.total[1] === mx.total[2] && mx.total[1] !== '', JSON.stringify(mx.total));
  await drag('regional_metrics', 'region', 0);
  await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].at(-1).querySelectorAll('.d-matrix tbody tr:not(.d-spacer)').length === 8, {}, tiles);
  mx = await matrix();
  check('a second row field nests under the first, each group with its subtotal', mx.rows[1][0] === 'Europe' && mx.rows[0][1] === mx.rows[1][1], JSON.stringify(mx.rows.slice(0, 2)));
  await page.$$eval(tiles, (ts) => ts.at(-1).querySelector('.d-matrix-toggle').click());
  await page.waitForFunction((sel) => [...document.querySelectorAll(sel)].at(-1).querySelectorAll('.d-matrix tbody tr:not(.d-spacer)').length === 7, {}, tiles);
  check('a group collapses with its toggle', true);
  const totals = async () => (await matrix()).rows.filter((r) => /^Q/.test(r[0])).map((r) => Number(r[2].replace(/[^\d.]/g, '')));
  await page.$$eval(tiles, (ts) => [...ts.at(-1).querySelectorAll('.d-matrix thead th')].find((th) => th.textContent.startsWith('Total')).click());
  await sleep(100);
  const asc = await totals();
  check('a header click sorts the groups by it', asc.every((v, i) => i === 0 || asc[i - 1] <= v), asc.join());
  await page.click('.d-vis-icon[title="Change to Table"]');
  const asTable = await page.$$eval('.d-wells-container .d-pill-label', (ps) => ps.map((p) => p.textContent).join());
  check('a matrix switches to a table with its fields', asTable === 'quarter,region,region,Sum of revenue', asTable);
  await page.click('.d-vis-icon[title="Change to Matrix"]');
  check('…and back, its summed column becoming a value', (await page.$$eval('.d-wells-container .d-field-well', (ws) => ws.map((w) => w.querySelectorAll('.d-pill').length).join())) === '3,0,1');
  await page.keyboard.press('Delete');
  check('the temporary visuals are removed', (await page.$$(tiles)).length === 7);

  // a visual on one table can use the connected table's fields
  await blank();
  await page.click('.d-vis-icon[title="Add Card (KPI)"]');
  check('a new card starts empty', (await slotsEmpty()) === 1 && (await page.$$eval(tiles, (ts) => ts.at(-1).textContent)).includes('Drag a field'));
  await drag('regional_metrics', 'revenue', 0);
  await drag('region_targets', 'target_revenue', 0); // replaces the field with the connected table's one
  const lastCard = async () => (await cards()).at(-1);
  check('a visual can use a connected table\'s fields', (await lastCard()) === '2.4M', await lastCard());
  await page.keyboard.press('Delete');
  check('the temporary visual is removed', (await page.$$(tiles)).length === 7);

  // ── text boxes: templates over table data ──────────────────────────────
  await blank();
  await page.click('.d-markdown-widget .markdown-title');
  const boxText = () => page.$eval('.markdown-content', (e) => e.textContent);
  const waitText = (t) => page.waitForFunction((x) => document.querySelector('.markdown-content')?.textContent.includes(x), {}, t);
  await waitText('Revenue:');
  check('text box values follow the filters', (await boxText()).includes('$489,101') && (await boxText()).includes('4 region-quarters'), await boxText());
  const area = '.d-wells-container .d-code';
  const typeInto = async (text) => {
    await page.$eval(area, (t) => (t.focus(), t.select()));
    await page.keyboard.type(text);
  };
  await typeInto('{{#regional_metrics}}x{{/regional_metrics}} {{^nothing}}none{{/nothing}}');
  await waitText('none');
  check('sections repeat over rows and show when empty', (await boxText()) === 'xxxx none', await boxText());
  await typeInto('{{#regional_metrics}} open');
  await page.waitForSelector('.d-template-error');
  check('a template mistake is reported on the box', (await page.$eval('.d-template-error', (e) => e.textContent)).includes('Unclosed section'));
  await typeInto('{{ regional_metrics | nosuchfilter }}');
  await page.waitForFunction(() => document.querySelector('.d-template-error')?.textContent.includes('Unknown filter "nosuchfilter"'));
  check('an unknown filter is reported on the box', true);
  await typeInto('{{ regional_metrics | size }} quarters, best {{#regional_metrics | sort: "revenue" | reverse | first: 1}}{{ quarter | lower }}{{/regional_metrics}}');
  await waitText('quarters, best');
  check('filters shape values and lists (a count, the top row by revenue)', (await boxText()) === '4 quarters, best q4' && !(await page.$('.d-template-error')), await boxText());
  await typeInto('Total: ');
  await drag('regional_metrics', 'revenue', 0);
  await waitText('489.1K');
  check('dropping a field onto a text box inserts a variable bound to its sum', (await page.$eval(area, (t) => t.value)).includes('{{ revenue }}') && (await boxText()).includes('489.1K'), await boxText());
  // slots: the template's own variables become drop targets for fields and tables from the Data pane
  await typeInto('Revenue {{ rev }}, rows {{ everything }}, {{ title }}');
  await page.waitForSelector('.d-slots .d-field-well');
  const slots = () => page.$$eval('.d-slots .d-field-well', (es) => es.map((e) => ({
    name: e.querySelector('.d-well-header code').textContent,
    warn: e.querySelector('.d-well-box').classList.contains('warn'),
    auto: !!e.querySelector('.d-well-auto'),
    val: e.querySelector('.d-pill')?.title ?? ''
  })));
  const found = await slots();
  check('the variables the text expects are listed as field wells', found.map((x) => x.name).join() === 'rev,everything,title', found.map((x) => x.name).join());
  check('…unresolved ones are flagged, known ones are automatic', found[0].warn && found[1].warn && found[2].auto, JSON.stringify(found));
  check('no duplicate field list under the slots', !(await page.$('.d-fieldlist')));
  // drags a field (or, with no field, a whole table) from the Data pane onto slot i
  const dropChip = (table, field, i) => page.evaluate((t, f, i) => {
    const node = [...document.querySelectorAll('.d-table-node')].find((n) => n.querySelector('.d-table-name').textContent === t);
    const src = f ? [...node.querySelectorAll('.d-field-item')].find((n) => n.querySelector('.d-field-name').textContent === f) : node.querySelector('.d-table-header');
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    const target = document.querySelectorAll('.d-slots .d-well-box')[i];
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, table, field, i);
  await dropChip('regional_metrics', 'revenue', 0);
  await dropChip('regional_metrics', null, 1);
  await waitText('rows 4');
  check('dropping a field binds its sum, a table its row count', (await boxText()) === 'Revenue 489.1K, rows 4, Operations & Analytics Hub', await boxText());
  // the summary and format are set from the field's menu, not in the template
  await pickMenu('.d-slots .d-pill', 'Average');
  await pickMenu('.d-slots .d-pill', 'Currency ($)');
  await waitText('$122,275');
  check('the field menu sets the aggregation and format', (await boxText()) === 'Revenue $122,275, rows 4, Operations & Analytics Hub', await boxText());
  const bound = await slots();
  check('bound slots show what they are bound to', bound[0].val === 'regional_metrics.revenue' && bound[1].val.startsWith('regional_metrics'), JSON.stringify(bound.map((x) => x.val)));
  const headerPayload = await page.evaluate(() => {
    const dt = new DataTransfer();
    document.querySelector('.d-table-header').dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    return dt.getData('application/x-dashier-field');
  });
  check('a table can be dragged from the Data pane too', headerPayload === JSON.stringify({ table: 'regional_metrics' }), headerPayload);
  // a text field in a text box: counted to start, and also its minimum, maximum, most common, first or last
  await dropChip('regional_metrics', 'quarter', 0);
  await waitText('Revenue 4,');
  await page.click('.d-slots .d-pill');
  await page.waitForSelector('.d-field-menu');
  const textSummaries = await page.$$eval('.d-field-menu .d-menu-item', (bs) => bs.map((b) => b.textContent.replace('✓', '').trim()));
  await page.keyboard.press('Escape');
  check('a text field offers Minimum, Maximum, Most common, First and Last', ['Count', 'Minimum', 'Maximum', 'Most common', 'First', 'Last'].every((t) => textSummaries.includes(t)) && !textSummaries.includes('Sum'), textSummaries.join());
  await pickMenu('.d-slots .d-pill', 'Maximum');
  await waitText('Revenue Q4,');
  check('…and shows the one picked', (await boxText()).startsWith('Revenue Q4,'), await boxText());
  await page.click('.d-slots .d-pill-x');
  check('a binding can be cleared', (await slots())[0].warn);
  await blank();

  // ── slicers: an on-page pick filters the other visuals ──────────────────────
  await blank();
  await page.click('.d-vis-icon[title="Add Slicer"]');
  await drag('regional_metrics', 'quarter', 0);
  await page.waitForSelector('.d-slicer-list .d-checkbox-label');
  const quarters = await page.$$eval('.d-slicer-list .d-checkbox-label', (ls) => ls.map((l) => l.textContent));
  check('a slicer lists its field\'s values', quarters.length === 4, quarters.join(','));
  const kpi0 = await kpi();
  await page.click('.d-slicer-list .d-checkbox-label input');
  await sleep(100);
  check('picking a slicer value filters the page', (await kpi()) !== kpi0, `${kpi0} → ${await kpi()}`);
  check('…but not the slicer itself', (await page.$$('.d-slicer-list .d-checkbox-label')).length === 4);
  await page.click('.d-slicer-clear');
  await sleep(100);
  check('clearing the slicer restores the page', (await kpi()) === kpi0, await kpi());
  await page.keyboard.press('Delete');
  check('the slicer is removed', !(await page.$('.d-slicer')));

  // right-click → Delete
  await rightClick('scratch', 'Delete');
  await sleep(150);
  check('Delete table removes it', !(await tables()).includes('scratch'));

  // table visual: rename a column header
  await page.click('.d-table-widget .chart-title');
  await pickMenu('.d-wells-container .d-pill', 'Rename for this visual');
  await page.waitForSelector('.d-pill-rename');
  await page.keyboard.type('Zone');
  await page.keyboard.press('Enter');
  const headersText = await page.$$eval('.d-table th', (ths) => ths.map((t) => t.textContent));
  check('a table visual column header can be renamed', headersText.some((t) => t.includes('Zone')), headersText.join(' | '));
  await blank();

  // table: summarizing a column groups the rows by the others
  await blank();
  await page.click('.d-vis-icon[title="Add Table"]');
  await drag('regional_metrics', 'region', 0);
  await drag('regional_metrics', 'revenue', 0);
  const lastTable = () => page.$$eval('.d-table-widget', (ts) => {
    const n = ts.at(-1).querySelectorAll('tbody tr').length;
    return { rows: `${n} ${n === 1 ? 'row' : 'rows'}`, cells: [...ts.at(-1).querySelectorAll('tbody td')].map((td) => td.textContent) };
  });
  check('an unsummarized table shows every row', (await lastTable()).rows === '4 rows', (await lastTable()).rows);
  await pickMenu('.d-wells-container .d-field-well .d-pill:nth-child(2)', 'Sum');
  check('summing a column groups the rows by the others', (await lastTable()).rows === '1 row' && (await lastTable()).cells.join() === 'Europe,489,101.25', JSON.stringify(await lastTable()));
  await pickMenu('.d-wells-container .d-field-well .d-pill:nth-child(2)', 'Percent of grand total');
  check('…and can show it as a percent of the grand total', (await lastTable()).cells[1] === '100.0%', JSON.stringify(await lastTable()));
  // drag the second column's pill above the first: the table's columns follow
  await page.evaluate(() => {
    const [first, second] = document.querySelectorAll('.d-wells-container .d-field-well .d-pill');
    const dt = new DataTransfer();
    second.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    const r = first.getBoundingClientRect();
    const at = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 2 };
    first.dispatchEvent(new DragEvent('dragover', at));
    first.dispatchEvent(new DragEvent('drop', at));
    second.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
  });
  await sleep(100);
  const heads = await page.$$eval('.d-table-widget', (ts) => [...ts.at(-1).querySelectorAll('thead th')].map((th) => th.textContent.trim()));
  const pills = await page.$$eval('.d-wells-container .d-field-well .d-pill .d-pill-label', (ls) => ls.map((l) => l.textContent));
  check('table columns can be reordered by dragging their pills', heads[0].includes('revenue') && heads[1] === 'region' && pills[1] === 'region', `${heads.join()} | ${pills.join()}`);
  await page.keyboard.press('Delete');

  // ── swapping chart types must redraw (regression: the old drawing stayed on screen) ──
  await blank();
  await (await page.$$('.d-chart-widget'))[0].click();
  const drawing = () => page.$$eval('.d-chart-widget', (ws) => ws[0].querySelector('.d-chart-svg')?.innerHTML ?? '');
  const seen = new Set([await drawing()]);
  for (const t of ['Line chart', 'Bar chart', 'Radar chart', 'Treemap', 'Pie chart']) {
    await page.click(`.d-vis-icon[title="Change to ${t}"]`);
    await sleep(200);
    seen.add(await drawing());
  }
  check('every chart type swap redraws', seen.size === 6, `${seen.size} distinct drawings`);
  const pieBefore = await drawing();
  await drag('regional_metrics', 'quarter', 0); // the Europe filter leaves one region, so change the category
  await sleep(200);
  check('changing a field redraws', (await drawing()) !== pieBefore);
  await page.click('.d-subtab-btn:nth-child(2)');
  const sections = await page.$$eval('.d-fsec-title', (ts) => ts.map((t) => t.textContent.replace(/[▸▾]/, '').trim()));
  check('format tab offers Data labels for a pie', sections.includes('Data labels') && !sections.includes('Bars'), sections.join(','));
  await page.waitForSelector('.d-chart-widget .d-legend span');
  check('a pie lists its slices in the standard legend', !(await page.$('.c-legend')) && (await page.$$eval('.d-chart-widget', (ws) => ws[0].querySelectorAll('.d-legend span').length)) > 0);
  await fsec('Legend');
  await fcontrol('Legend', 'Position', (row) => [...row.querySelectorAll('button')].find((b) => b.textContent === 'Right').click());
  check('the legend can sit to the right', !!(await page.$$eval('.d-chart-widget', (ws) => ws[0].querySelector('.d-chart-body.legend-right .d-legend'))));
  await sleep(300);
  const beside = await page.$$eval('.d-chart-widget', (ws) => {
    const plot = ws[0].querySelector('.d-chart-body.legend-right .d-chart-plot');
    return { h: Math.round(plot.getBoundingClientRect().height), svg: !!plot.querySelector('svg') };
  });
  check('…and the chart beside it keeps its full height', beside.svg && beside.h > 100, JSON.stringify(beside));
  // a section's switch turns it off; a changed section shows a dot and resets in one click
  const legendSwitch = () => page.$$eval('.d-fsec', (ss) => ss.find((x) => x.querySelector('.d-fsec-title').textContent.includes('Legend')).querySelector('.d-fsec-head .d-switch').click());
  await legendSwitch();
  await sleep(100);
  check('a section switch turns the legend off', !(await page.$$eval('.d-chart-widget', (ws) => ws[0].querySelector('.d-legend'))));
  const legendChanged = await page.$$eval('.d-fsec', (ss) => !!ss.find((x) => x.querySelector('.d-fsec-title').textContent.includes('Legend')).querySelector('.d-fchanged'));
  await page.$$eval('.d-fsec', (ss) => ss.find((x) => x.querySelector('.d-fsec-title').textContent.includes('Legend')).querySelector('.d-freset').click());
  await sleep(100);
  check('…marks the section changed, and its reset brings the legend back at the bottom', legendChanged && !!(await page.$$eval('.d-chart-widget', (ws) => ws[0].querySelector('.d-chart-body.legend-bottom .d-legend'))));
  // colors: each slice is listed with its palette color, and a picked one recolors it
  await fsec('Colors');
  const swatches = await page.$$eval('.d-fcolors .d-frow', (rs) => rs.length);
  await page.$eval('.d-fcolors input[type="color"]', (i) => {
    i.value = '#ff0000';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(100);
  const override = await page.$$eval('.d-chart-widget', (ws) => ws[0].style.getPropertyValue('--series-1'));
  check('Colors lists every slice and a picked color recolors its slice', swatches > 1 && override === '#ff0000', `${swatches} rows; --series-1: ${override}`);
  // search narrows the pane to matching settings
  await page.type('.d-ftools input[type="search"]', 'units');
  const matching = await page.$$eval('.d-fsec-title', (ts) => ts.map((t) => t.textContent.replace(/[▸▾]/, '').trim()));
  check('searching the format pane shows only matching settings', matching.join() === 'Values', matching.join());
  await page.$eval('.d-ftools input[type="search"]', (i) => {
    i.value = '';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('.d-vis-icon[title="Change to Gauge"]');
  await page.waitForSelector('svg.d-gauge');
  check('gallery switches a chart to a gauge', true);
  await page.click('.d-vis-icon[title="Change to Column chart"]');
  await page.waitForSelector('.d-chart-svg svg');
  check('…and back to a column chart', true);

  // ── add / delete ────────────────────────────────────────────────────────────
  await blank();
  await page.click('.d-vis-icon[title="Add Line chart"]');
  check('gallery adds a visual when nothing is selected', (await page.$$(tiles)).length === 8);
  check('no "Add Visual" button', !(await page.$('.ed-insert-group .ed-menu')) && !(await page.$$eval('.ed-btn', (b) => b.some((x) => /Add Visual/.test(x.textContent)))));
  await page.keyboard.press('Delete');
  check('Delete key removes the selected visual', (await page.$$(tiles)).length === 7);

  // ── dates, combo, table features, on a page of their own ──────────────────
  let daily = 'day,product,units\n';
  for (let i = 0; i < 6000; i++) daily += `${new Date(Date.UTC(2023, 0, 1) + (i % 600) * 864e5).toISOString().slice(0, 10)},${'ABC'[i % 3]},${(i * 7) % 50 + 1}\n`;
  await page.click('.d-get-data-btn');
  await page.click('.d-paste-btn');
  await page.$eval('.modal-dialog textarea', (t, v) => { t.value = v; t.dispatchEvent(new Event('input', { bubbles: true })); }, daily);
  await page.waitForSelector('.d-getdata .d-grid');
  check('date columns are detected as dates', (await page.$eval('.d-getdata thead th[data-col="day"] .d-type-chip span', (e) => e.textContent)) === 'DATE');
  await page.click('.d-getdata-name', { count: 3 });
  await page.keyboard.type('daily');
  await page.click('.modal-dialog .btn-primary');
  await page.waitForSelector('.modal-dialog', { hidden: true });
  await page.click('.d-add-page-btn');
  await sleep(150);

  await page.click('.d-vis-icon[title="Add Line and column chart"]');
  await page.click('.d-subtab-btn:nth-child(1)'); // Build
  await drag('daily', 'day', 0);
  await drag('daily', 'units', 1);
  await drag('daily', 'units', 2);
  const wellText = () => page.$$eval('.d-wells-container .d-field-well', (ws) => ws.map((w) => w.querySelector('.d-pill-label')?.textContent ?? ''));
  check('a date on the axis is grouped by month', (await wellText())[0] === 'day (Month)', (await wellText()).join(' | '));
  await page.waitForFunction(() => [...document.querySelectorAll('.d-chart-widget')].at(-1)?.querySelector('.c-line'));
  const combo = await page.$$eval('.d-chart-widget', (ws) => {
    const w = ws.at(-1);
    return { bars: w.querySelectorAll('.c-bars rect').length, lines: w.querySelectorAll('.c-line').length, first: [...w.querySelectorAll('.c-axis-labels text')].find((t) => /\d{4}/.test(t.textContent))?.textContent };
  });
  check('a line and column chart draws both, one column per month, oldest first', combo.bars === 20 && combo.lines === 1 && combo.first.replace(/\s/g, '') === 'Jan2023', JSON.stringify(combo)); // a narrow slot wraps its label
  await pickMenu('.d-wells-container .d-field-well:nth-child(1) .d-pill', 'Quarter');
  check('…and can be regrouped by quarter', (await page.$$eval('.d-chart-widget', (ws) => ws.at(-1).querySelectorAll('.c-bars rect').length)) === 7);

  // pills drag between wells: the line values move to the column legend's well and back
  const movePill = (from, to) => page.evaluate((f, t) => {
    const wells = document.querySelectorAll('.d-wells-container .d-field-well');
    const pill = wells[f].querySelector('.d-pill');
    const dt = new DataTransfer();
    pill.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    const box = wells[t].querySelector('.d-well-box');
    box.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    box.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    pill.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
  }, from, to);
  await movePill(2, 3);
  check('a pill dragged to another well moves there', (await wellText())[2] === '' && (await wellText())[3] === 'units', (await wellText()).join(' | '));
  await movePill(3, 2);
  check('…and back', (await wellText())[2] === 'Sum of units' && (await wellText())[3] === '', (await wellText()).join(' | '));
  // dropped outside any well a pill is removed; a drag that ends without a drop (Esc) changes nothing
  const dragOut = (from, drop) => page.evaluate((f, d) => {
    const pill = document.querySelectorAll('.d-wells-container .d-field-well')[f].querySelector('.d-pill');
    const dt = new DataTransfer();
    pill.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    const outside = document.querySelector('.d-canvas-scroll-container');
    const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
    outside.dispatchEvent(over);
    if (d) outside.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    pill.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
    return over.defaultPrevented;
  }, from, drop);
  const accepted = await dragOut(2, false);
  check('a pill dragged off and cancelled (Esc) stays', accepted && (await wellText())[2] === 'Sum of units', (await wellText()).join(' | '));
  await dragOut(2, true);
  check('a pill dropped outside the wells is removed', (await wellText())[2] === '', (await wellText()).join(' | '));
  await drag('daily', 'units', 2);

  // Top N
  await page.click('.d-subtab-btn:nth-child(2)');
  await fsec('Order');
  await fcontrol('Order', 'Top N', (row) => {
    const i = row.querySelector('input');
    i.value = '3';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(100);
  check('Top N keeps the largest categories', (await page.$$eval('.d-chart-widget', (ws) => ws.at(-1).querySelectorAll('.c-bars rect').length)) === 3);
  await page.click('.d-subtab-btn:nth-child(1)');
  await blank();

  // a big table: only the rows in view are drawn; totals and data bars
  await page.click('.d-vis-icon[title="Add Table"]');
  await drag('daily', 'product', 0);
  await drag('daily', 'units', 0);
  const big = () => page.$$eval('.d-table-widget', (ts) => {
    const t = ts.at(-1);
    return { drawn: t.querySelectorAll('tbody tr:not(.d-spacer)').length, total: t.querySelector('tfoot')?.textContent ?? '' };
  });
  check('a 6,000-row table draws only the rows in view', (await big()).drawn < 80, JSON.stringify(await big()));
  check('"Don\'t summarize" columns get no total', (await big()).total === '', JSON.stringify(await big()));
  await page.$$eval('.d-table-widget', (ts) => { const c = ts.at(-1).querySelector('.table-container'); c.scrollTop = c.scrollHeight; c.dispatchEvent(new Event('scroll')); });
  await sleep(100);
  const tail = await page.$$eval('.d-table-widget', (ts) => {
    const body = ts.at(-1).querySelector('tbody');
    return { before: body.firstElementChild.classList.contains('d-spacer'), after: body.lastElementChild.classList.contains('d-spacer') };
  });
  check('…and after scrolling to the end, the rows above are skipped and the last ones drawn', (await big()).drawn < 80 && tail.before && !tail.after, JSON.stringify(tail));
  await pickMenu('.d-wells-container .d-field-well .d-pill:nth-child(2)', 'Sum');
  check('summing a column groups the rows and adds a totals row', (await big()).drawn === 3 && (await big()).total.startsWith('Total') && (await big()).total.includes('153,'), JSON.stringify(await big()));
  await pickMenu('.d-wells-container .d-field-well .d-pill:nth-child(2)', 'Data bars');
  check('numeric columns get data bars', (await page.$$eval('.d-table-widget', (ts) => ts.at(-1).querySelector('tbody td.td-right')?.style.background || '')).includes('linear-gradient'));
  await blank();

  // relative date filter on the page
  const unitsTotal = async () => Number((await big()).total.replace(/[^\d]/g, ''));
  const allUnits = await unitsTotal();
  await dropOn('daily', 'day', '.d-filters-pane .d-filter-section:nth-child(1) .d-well-box');
  await page.waitForSelector('.d-filter-mode');
  await page.click('.d-filter-mode [data-mode="last"]');
  await sleep(100);
  // the data ends in 2024, so nothing is in the last 3 months
  const summaryText = await page.$eval('.d-filter-card .filter-type', (e) => e.textContent);
  check('"in the last 3 months" filters out older dates', summaryText === 'Last 3 months' && (await unitsTotal()) < allUnits, `${summaryText} · ${await unitsTotal()} of ${allUnits}`);

  // a date slicer grouped by Date picks a from–to range, which filters the page
  await page.click('.d-filter-mode [data-mode="range"]');
  await sleep(100);
  await page.click('.d-vis-icon[title="Add Slicer"]');
  await page.click('.d-subtab-btn:nth-child(1)'); // Build
  await drag('daily', 'day', 0);
  await pickMenu('.d-wells-container .d-pill', 'Date');
  await page.waitForSelector('.d-slicer input[type="date"]');
  await page.$eval('.d-slicer input[type="date"]', (i) => { i.value = '2024-01-01'; i.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(150);
  const fromDate = await page.$eval('.d-slicer input[type="date"]', (i) => i.value);
  const sliced = await unitsTotal();
  check('a date slicer\'s range filters the page (and keeps its dates)', fromDate === '2024-01-01' && sliced > 0 && sliced < allUnits, `${fromDate} · ${sliced} of ${allUnits}`);
  await page.click('.d-slicer-clear');
  await sleep(100);
  check('…and clearing it shows every date again', (await unitsTotal()) === allUnits, String(await unitsTotal()));
  await page.keyboard.press('Delete');

  // printing: Ctrl+P lays out every page (off screen) and goes straight to the browser's print dialog
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.keyboard.down('Control'); await page.keyboard.press('p'); await page.keyboard.up('Control');
  await page.waitForFunction(() => window.__printed === 1);
  const printed = await page.evaluate(() => ({
    slots: document.querySelectorAll('.d-print-slot').length,
    charts: document.querySelectorAll('.d-print-view .d-chart-svg svg').length,
    left: document.querySelector('.d-print-view').getBoundingClientRect().left,
    chrome: !!document.querySelector('.d-print-view .d-selection-frame, .d-print-view .d-well-empty'),
    rules: document.querySelector('.d-print-view style').textContent
  }));
  check('Ctrl+P goes straight to the print dialog, every page laid out for it', printed.slots === (await page.$$('.d-bottom-tab')).length && /@page p0 \{ size: \d+px \d+px/.test(printed.rules), JSON.stringify(printed).slice(0, 200));
  check('…with its charts drawn, no editor chrome, and nothing on screen', printed.charts > 0 && !printed.chrome && printed.left < -10000, JSON.stringify({ ...printed, rules: undefined }));
  await page.evaluate(() => dispatchEvent(new Event('afterprint')));
  await page.waitForSelector('.d-print-view', { hidden: true });
  check('closing the dialog leaves the editor as it was', !!(await page.$('.ed-topbar')) && !!(await page.$('.mode-edit')));

  // ── quick measures ─────────────────────────────────────────────────────────
  await page.click('.d-add-page-btn');
  await sleep(150);
  const measureMenu = async (table, item, measure) => {
    const target = measure
      ? await page.evaluateHandle((m) => [...document.querySelectorAll('.d-measure-item')].find((x) => x.querySelector('.d-field-name').textContent === m), measure)
      : (await page.$$('.d-table-header'))[(await tables()).indexOf(table)];
    await target.click({ button: 'right' });
    await page.waitForSelector('.d-context-menu');
    await page.$$eval('.d-context-menu button', (b, re) => b.find((x) => new RegExp(re).test(x.textContent)).click(), item);
    await page.waitForSelector('.d-measure-dialog');
  };
  const setSelect = (sel, value) => page.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  const previewText = () => page.$eval('.d-measure-preview', (e) => e.textContent);

  // a field's right-click menu creates a measure from it
  const revenueField = await page.evaluateHandle(() => [...document.querySelectorAll('.d-field-item')].find((x) => x.querySelector('.d-field-name')?.textContent === 'revenue'));
  await revenueField.click({ button: 'right' });
  await page.waitForSelector('.d-context-menu');
  const fieldItems = await page.$$eval('.d-context-menu button', (bs) => bs.map((b) => b.textContent));
  await page.$$eval('.d-context-menu button', (bs) => bs.find((b) => b.textContent.startsWith('Create measure')).click());
  await page.waitForSelector('.d-measure-dialog');
  const fromField = await page.evaluate(() => ({ name: document.querySelector('.d-measure-name').value, fields: [...document.querySelectorAll('.d-measure-dialog select')].map((s) => s.value) }));
  check('a data field\'s right-click menu creates a measure from it', fieldItems.some((t) => t.startsWith('Create measure')) && fromField.name === 'Sum of revenue' && fromField.fields.includes('revenue'), JSON.stringify({ fieldItems, fromField }));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.d-measure-dialog', { hidden: true });
  await measureMenu('regional_metrics', 'Create measure');
  await page.type('.d-measure-name', 'Revenue (Europe)');
  await setSelect('.d-measure-field', 'revenue');
  await setSelect('.d-measure-where', 'regional_metrics\u0000region');
  await page.$$eval('.d-measure-values label', (ls) => ls.find((l) => l.textContent === 'Europe').querySelector('input').click());
  check('a measure previews its value on all rows', (await previewText()).includes('489.1K'), await previewText());
  await page.click('.d-measure-dialog .btn-primary');
  await page.waitForSelector('.d-measure-dialog', { hidden: true });
  const measuresListed = () => page.$$eval('.d-measure-item .d-field-name', (ns) => ns.map((n) => n.textContent));
  check('saved measures are listed under their table', (await measuresListed()).includes('Revenue (Europe)'));

  await measureMenu('regional_metrics', 'Create measure');
  await page.type('.d-measure-name', 'Europe share');
  await page.$$eval('.d-seg button', (bs) => bs[1].click());
  const [opA, , opB] = await page.$$('.d-mcalc select');
  await opA.select('m:regional_metrics\u0000Revenue (Europe)');
  await opB.select('f:revenue');
  // the Format field, by its label
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('.d-measure-dialog .d-mfield')].find((f) => f.querySelector('span')?.textContent === 'Format').querySelector('select');
    s.value = 'percent';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  check('a calculated measure previews too', (await previewText()).includes('26.9%'), await previewText());
  await page.click('.d-measure-dialog .btn-primary');
  await page.waitForSelector('.d-measure-dialog', { hidden: true });

  await page.click('.d-vis-icon[title="Add Card (KPI)"]');
  await page.click('.d-subtab-btn:nth-child(1)');
  await drag('regional_metrics', 'Europe share', 0);
  check('a card shows a measure in its format', (await cards()).at(-1) === '26.9%', (await cards()).at(-1));
  await blank();
  await page.click('.d-vis-icon[title="Add Column chart"]');
  await drag('regional_metrics', 'Revenue (Europe)', 0);
  check('a measure is refused on an axis', (await page.$eval('.d-drop-note', (e) => e.textContent)).includes('measure'));
  await drag('regional_metrics', 'region', 0);
  await drag('regional_metrics', 'Revenue (Europe)', 1);
  await page.waitForFunction(() => [...document.querySelectorAll('.d-chart-widget')].at(-1)?.querySelector('.c-bars'));
  const bars = await page.$$eval('.d-chart-widget', (ws) => [...ws.at(-1).querySelectorAll('.c-bars rect')].map((r) => +r.getAttribute('height') > 0));
  check('a measure is worked out per bar (only Europe has Europe revenue)', bars.filter(Boolean).length === 1, JSON.stringify(bars));
  check('the value well shows the measure by name', (await wellText())[1] === 'Revenue (Europe)', (await wellText()).join(' | '));
  await blank();

  await measureMenu('regional_metrics', 'Edit measure', 'Revenue (Europe)');
  await page.click('.d-measure-name', { count: 3 });
  await page.keyboard.type('EU revenue');
  await page.click('.d-measure-dialog .btn-primary');
  await page.waitForSelector('.d-measure-dialog', { hidden: true });
  check('renaming a measure renames it in the list', (await measuresListed()).includes('EU revenue') && !(await measuresListed()).includes('Revenue (Europe)'));
  await page.waitForFunction(() => [...document.querySelectorAll('.d-chart-widget')].at(-1)?.querySelectorAll('.c-bars rect').length, { timeout: 3000 }).catch(() => {});
  check('…and the measures and visuals that use it keep working', (await cards()).at(-1) === '26.9%' && (await page.$$eval('.d-chart-widget', (ws) => ws.at(-1).querySelectorAll('.c-bars rect').length)) === 4);
  await measureMenu('regional_metrics', 'Edit measure', 'EU revenue');
  await page.click('.d-measure-delete');
  await sleep(100);
  check('a measure another measure uses cannot be deleted', (await page.$eval('.d-measure-dialog .d-form-error', (e) => e.textContent)).includes('Europe share'));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.d-measure-dialog', { hidden: true });
  await page.click('.d-bottom-tab'); // back to the first page for the rest
  await sleep(150);

  // ── report theme is independent of the editor ───────────────────────────────
  await blank();
  const chrome = () => page.$eval('.ed-topbar', (e) => getComputedStyle(e).backgroundColor);
  const sheet = () => page.$eval('.d-canvas-sheet', (e) => getComputedStyle(e).backgroundColor);
  const chrome0 = await chrome(), sheet0 = await sheet();
  check('there are no theme presets, only a reset to the default', !(await page.$$eval('.d-visualizations-pane label', (ls) => ls.some((l) => l.textContent === 'Preset'))) && !!(await page.$('.d-section-title .d-link-btn')));
  await page.select('.d-visualizations-pane .d-format-group select', 'dark');
  await sleep(100);
  check('a dark base restyles the report', (await sheet()) !== sheet0, `${sheet0} → ${await sheet()}`);
  check('…without touching the editor chrome', (await chrome()) === chrome0);
  await page.click('.d-section-title .d-link-btn');
  await sleep(100);
  check('Reset to default brings the default look back', (await sheet()) === sheet0, await sheet());
  await page.$eval('.d-swatch input[type="color"]', (i) => { i.value = '#fbf6f0'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  // page size: a shape keeps the long side, the orientation turns the page
  const canvasSize = () => page.$$eval('.d-visualizations-pane .d-row .d-input', (is) => is.map((i) => i.value).join('x'));
  const [shapeSelect, turnSelect] = await page.$$('.d-visualizations-pane .d-row .d-well-select');
  check('the default page is 16:9, landscape', (await canvasSize()) === '1440x810' && (await shapeSelect.evaluate((s) => s.value)) === '16:9' && (await turnSelect.evaluate((s) => s.value)) === 'landscape', await canvasSize());
  await shapeSelect.select('4:3');
  await sleep(50);
  check('a shape keeps the long side', (await canvasSize()) === '1440x1080', await canvasSize());
  await turnSelect.select('portrait');
  await sleep(50);
  check('…and portrait turns the page', (await canvasSize()) === '1080x1440' && (await shapeSelect.evaluate((s) => s.value)) === '4:3', await canvasSize());
  await turnSelect.select('landscape');
  await shapeSelect.select('16:9');
  await sleep(50);
  check('…and back', (await canvasSize()) === '1440x810', await canvasSize());

  // ── save → reload ───────────────────────────────────────────────────────────
  await page.keyboard.down('Control'); await page.keyboard.press('s'); await page.keyboard.up('Control');
  let saved;
  for (let i = 0; i < 40 && !saved; i++) { await sleep(150); saved = fs.readdirSync(dl).find((f) => f.endsWith('.dashier.html')); }
  check('Ctrl+S downloads a .dashier.html', !!saved, saved);
  if (saved) {
    const html = fs.readFileSync(path.join(dl, saved), 'utf8');
    const json = html.match(/<script type="application\/dashier\+json" id="dashier-doc">([\s\S]*?)<\/script>/)[1];
    check('saved doc has no raw "<"', !json.includes('<'));
    const doc = JSON.parse(json);
    check('saved doc keeps the page filter', doc.pages[0].filters?.[0]?.values?.[0] === 'Europe');
    check('saved doc keeps the measures', (doc.measures || []).map((m) => m.name).join() === 'EU revenue,Europe share' && doc.measures[1].a.measure === 'EU revenue', JSON.stringify(doc.measures));
    check('saved doc keeps the theme', doc.theme?.background === '#fbf6f0' && !('branding' in doc.theme), JSON.stringify(doc.theme));
    check('saved payload is still gzip+base64', doc.sources.regional_metrics.encoding === 'gzip+base64');
    const targets = doc.sources.region_targets;
    const header = zlib.gunzipSync(Buffer.from(targets.payload, 'base64')).toString().split('\n')[0];
    check('saved column rename is in the structure and in the stored data', targets.structure[0].name === 'zone' && header === 'zone,target_revenue', header);
    check('saved relationship follows the rename', doc.relationships?.length === 1 && doc.relationships[0].to.field === 'zone', JSON.stringify(doc.relationships));
    check('saved doc dropped the deleted table', !doc.sources.scratch && !doc.sources.extra);
    const note = doc.pages[0].elements.find((e) => e.type === 'markdown');
    check('saved text box keeps its bindings', note.bindings?.everything?.table === 'regional_metrics' && !note.bindings?.rev, JSON.stringify(note.bindings));
    check('saved table header label', doc.pages[0].elements.find((e) => e.type === 'table').columns[0].label === 'Zone');
    check('saved file carries the app code exactly once', (html.match(/id="dashier-js"/g) || []).length === 1);
    check('saved file has no runtime DOM', html.includes('<div id="app"></div>') && !html.includes('class="d-visual-container'));
    const p2 = await browser.newPage();
    p2.on('pageerror', (e) => errors.push('reload: ' + e.message));
    await p2.goto('file:///' + path.join(dl, saved).replace(/\\/g, '/'));
    await p2.waitForSelector('.card-value');
    check('saved file reopens in the editor', !!(await p2.$('.mode-edit')));
    check('saved file keeps the filter', (await p2.$eval('.card-value', (e) => e.textContent)) === '$489,101');
    check('saved file keeps the relationship working', (await p2.$$eval('.card-value', (es) => es.map((e) => e.textContent)))[2] === '$600,000');
  }

  // ── a star schema: filters on a dimension's attributes reach the fact ─────────
  {
    const csv = (t) => zlib.gzipSync(t).toString('base64');
    const src = (text, structure) => ({ format: 'csv', encoding: 'gzip+base64', structure, payload: csv(text) });
    const card = (id, x, filters) => ({ id, type: 'card', x, y: 0, w: 3, h: 2, sourceId: 'fact_sales', aggregation: { method: 'sum', field: 'revenue' }, format: 'integer', filters });
    const star = {
      format: 'dashier', version: 1, title: 'Star',
      sources: {
        fact_sales: src('store_id,revenue\nS1,10\nS2,20\nS3,40\n', [{ name: 'store_id', type: 'string' }, { name: 'revenue', type: 'float' }]),
        dim_store: src('store_id,region\nS1,North\nS2,North\nS3,South\n', [{ name: 'store_id', type: 'string' }, { name: 'region', type: 'string' }])
      },
      relationships: [{ from: { table: 'fact_sales', field: 'store_id' }, to: { table: 'dim_store', field: 'store_id' }, join: 'left' }],
      pages: [{ id: 'p', title: 'P', elements: [
        card('all', 0), card('north', 3, [{ field: 'region', table: 'dim_store', values: ['North'] }]), card('none', 6, [{ field: 'region', table: 'dim_store', values: ['Nowhere'] }]),
        { id: 'n', type: 'markdown', x: 9, y: 0, w: 3, h: 2, content: 'rows [{{ n }}]', bindings: { n: { table: 'fact_sales', aggregate: 'count' } }, filters: [{ field: 'region', table: 'dim_store', values: ['Nowhere'] }] },
        { id: 's', type: 'slicer', x: 0, y: 2, w: 3, h: 2, sourceId: 'dim_store', field: 'region' },
        { id: 'chart', type: 'chart', chartType: 'bar', x: 3, y: 2, w: 9, h: 4, sourceId: 'fact_sales', mapping: { x: 'dim_store.region', y: 'revenue' } }
      ] }]
    };
    const starFile = path.join(path.dirname(FILE), 'star.html');
    fs.writeFileSync(starFile, fs.readFileSync('dist/dashier.html', 'utf8').replace(
      /(<script type="application\/dashier\+json" id="dashier-doc">)[\s\S]*?(<\/script>)/,
      (_, open, close) => open + JSON.stringify(star).replace(/</g, '\\u003c') + close
    ));
    const page = await browser.newPage(); // its own tab: nothing carried over from the tests above
    await page.setViewport({ width: 1600, height: 1000 });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('file:///' + starFile.replace(/\\/g, '/') + '#preview');
    await page.waitForSelector('.card-value');
    const values = () => page.$$eval('.card-value', (es) => es.map((e) => e.textContent).join());
    check('a visual filter on a dimension\'s attribute filters the fact; matching nothing shows "—"', (await values()) === '70,30,—', await values());
    check('…and a count of no rows is 0', (await page.$eval('.markdown-content', (e) => e.textContent)).includes('rows [0]'));
    const axis = await page.waitForFunction(() => [...document.querySelectorAll('.d-chart-widget text')].some((t) => t.textContent === 'South'), { timeout: 3000 }).catch(() => null);
    check('…an axis shows the dimension\'s attribute', !!axis);
    await page.evaluate(() => [...document.querySelectorAll('.d-slicer label, .d-slicer button')].find((e) => e.textContent.trim() === 'South')?.click());
    await sleep(200);
    check('…and a slicer on the dimension filters the fact', (await values()) === '40,—,—', await values());

    // Power BI semantics: filters follow chains of relationships (and back, on "both"), keys match by value and
    // ignoring case, a repeated dimension key doesn't repeat fact rows, measures work in any connected visual
    const model = {
      format: 'dashier', version: 1, title: 'Model',
      sources: {
        fact_sales: src('store_id,revenue\ns1,10\nS2,20\nS3,40\n', [{ name: 'store_id', type: 'string' }, { name: 'revenue', type: 'float' }]),
        dim_store: src('store_id,store,region_id\nS1,Downtown,1\nS2,Harbor,1\nS3,Mall,2\nS3,Mall (old),2\n', [{ name: 'store_id', type: 'string' }, { name: 'store', type: 'string' }, { name: 'region_id', type: 'int' }]),
        dim_region: src('region_id,region_name,rank\n1.0,North,2\n2.0,South,1\n', [{ name: 'region_id', type: 'string' }, { name: 'region_name', type: 'string', sortBy: 'rank' }, { name: 'rank', type: 'int' }]),
        fact_targets: src('region_id,target\n1,100\n2,200\n', [{ name: 'region_id', type: 'int' }, { name: 'target', type: 'float' }])
      },
      relationships: [
        { from: { table: 'fact_sales', field: 'store_id' }, to: { table: 'dim_store', field: 'store_id' }, crossFilter: 'both' },
        { from: { table: 'dim_store', field: 'region_id' }, to: { table: 'dim_region', field: 'region_id' } },
        { from: { table: 'fact_targets', field: 'region_id' }, to: { table: 'dim_region', field: 'region_id' } }
      ],
      measures: [
        { name: 'Revenue', table: 'fact_sales', aggregate: 'sum', field: 'revenue' },
        { name: 'North revenue', table: 'fact_sales', aggregate: 'sum', field: 'revenue', where: { table: 'dim_region', field: 'region_name', values: ['North'] } },
        { name: 'Target', table: 'fact_targets', aggregate: 'sum', field: 'target' },
        { name: 'Attainment', table: 'fact_sales', op: '/', a: { measure: 'Revenue' }, b: { measure: 'Target', table: 'fact_targets' }, format: 'percent' },
        { name: 'North S1 revenue', table: 'fact_sales', aggregate: 'sum', field: 'revenue', where: [{ table: 'dim_region', field: 'region_name', values: ['North'] }, { field: 'store_id', values: ['s1', 'S3'] }] }
      ],
      pages: [{ id: 'p', title: 'P', elements: [
        { ...card('total', 0), w: 2 },
        { ...card('north2', 2), x: 2, w: 2, filters: [{ field: 'region_name', table: 'dim_region', values: ['North'] }], compare: { filters: [{ field: 'region_name', table: 'dim_region', values: ['South'] }], label: 'vs South' } },
        { ...card('target', 4), x: 4, w: 2, aggregation: { method: 'sum', field: '[Target]' } },
        { ...card('wherenorth', 6), x: 6, w: 2, aggregation: { method: 'sum', field: '[North revenue]' } },
        { id: 'stores', type: 'card', x: 8, y: 0, w: 2, h: 2, sourceId: 'dim_store', aggregation: { method: 'distinct', field: 'store_id' }, format: 'integer', filters: [{ field: 'revenue', table: 'fact_sales', min: 35 }] },
        { id: 'm1', type: 'matrix', x: 0, y: 2, w: 6, h: 3, sourceId: 'fact_sales', rows: [{ field: 'dim_region.region_name' }], values: [{ field: '[Revenue]' }, { field: '[Target]' }, { field: '[Attainment]' }] },
        { id: 'm2', type: 'matrix', x: 6, y: 2, w: 6, h: 3, sourceId: 'dim_region', rows: [{ field: 'region_name' }], values: [{ field: '[Revenue]' }] },
        { ...card('both', 0), y: 5, w: 2, aggregation: { method: 'sum', field: '[North S1 revenue]' } },
        { id: 'hl', type: 'markdown', x: 0, y: 8, w: 6, h: 2, title: 'Highlights', filters: [{ field: 'region_name', table: 'dim_region', values: ['North'] }],
          content: '- **North** {{ rev }}, {{ vs }} vs South ({{ gap }}).', bindings: { rev: { table: 'fact_sales', field: '[Revenue]' },
            vs: { table: 'fact_sales', field: '[Revenue]', compare: { filters: [{ field: 'region_name', table: 'dim_region', values: ['South'] }] } },
            gap: { table: 'fact_sales', field: 'revenue', aggregate: 'sum', format: 'integer', compare: { filters: [{ field: 'region_name', table: 'dim_region', values: ['South'] }], show: 'difference' } } } },
        { id: 'bars', type: 'chart', chartType: 'bar', x: 2, y: 5, w: 10, h: 3, sourceId: 'fact_sales', mapping: { x: 'dim_region.region_name', y: 'revenue' } }
      ] }]
    };
    fs.writeFileSync(starFile, fs.readFileSync('dist/dashier.html', 'utf8').replace(
      /(<script type="application\/dashier\+json" id="dashier-doc">)[\s\S]*?(<\/script>)/,
      (_, open, close) => open + JSON.stringify(model).replace(/</g, '\\u003c') + close
    ));
    await page.goto('about:blank');
    await page.goto('file:///' + starFile.replace(/\\/g, '/') + '#preview');
    await page.waitForSelector('.d-matrix');
    await sleep(300);
    const mrows = (i) => page.$$eval('.d-matrix', (ms, i) => [...ms[i].querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => c.textContent.trim()).join('|')), i);
    check('a repeated dimension key and keys in other spellings ("s1", "1.0") don\'t change the total', (await values()).split(',')[0] === '70', await values());
    check('a filter crosses two relationships (region → store → sales)', (await values()).split(',')[1] === '30', await values());
    check('a measure of another table works in a card, and a where on a dimension\'s attribute', (await values()).split(',').slice(2, 4).join() === '300,30', await values());
    check('crossFilter "both" lets a fact filter its dimension', (await values()).split(',')[4] === '1', await values());
    const m1 = (await mrows(0)).join(' / ');
    check('a matrix row works out another table\'s measure for that row, and ratios across tables', m1.includes('North|30|100|30.0%') && m1.includes('South|40|200|20.0%') && m1.includes('Total|70|300|23.3%'), m1);
    const m2 = (await mrows(1)).join(' / ');
    check('a visual on a dimension shows a fact\'s measure through two relationships', m2.includes('North|30') && m2.includes('South|40'), m2);
    check('a column sorted by another orders matrix rows by it', m2.indexOf('South') < m2.indexOf('North'), m2);
    const cats = await page.$$eval('.d-chart-widget text', (ts) => ts.map((t) => t.textContent).filter((t) => t === 'North' || t === 'South').join());
    check('…and chart categories', cats === 'South,North', cats);
    check('a measure with two conditions keeps rows meeting both', (await values()).split(',')[5] === '10', await values());
    const cmp = await page.$eval('.card-compare', (e) => `${e.textContent}|${e.className}`);
    check('a card compares with its value under other filters', cmp === '-25.0% vs South|card-compare down', cmp);
    await page.waitForFunction(() => [...document.querySelectorAll('.markdown-content')].some((m) => m.textContent.includes('North')), { timeout: 3000 }).catch(() => {});
    const hl = await page.$$eval('.markdown-content', (ms) => ms.map((m) => m.textContent.trim()).find((t) => t.includes('North')));
    check('a text binding compares too (highlights: "vs" another period or segment)', hl === 'North 30, -25.0% vs South (-10).', hl);

    // a card compares with the previous period of whatever date filter reaches it: here a slicer on the page
    const sliced = {
      format: 'dashier', version: 1, title: 'Sliced',
      sources: { fact: src('date,revenue\n2025-02-01,10\n2025-05-01,30\n2025-08-01,45\n', [{ name: 'date', type: 'datetime' }, { name: 'revenue', type: 'float' }]) },
      pages: [{ id: 'p', title: 'P', elements: [
        { id: 'k', type: 'card', x: 0, y: 0, w: 3, h: 2, sourceId: 'fact', aggregation: { method: 'sum', field: 'revenue' }, format: 'integer', compare: { shift: 'period' } },
        { id: 'k2', type: 'card', x: 3, y: 0, w: 3, h: 2, sourceId: 'fact', aggregation: { method: 'sum', field: 'revenue' }, format: 'integer', compare: { shift: 'year' } },
        { id: 'q', type: 'slicer', x: 6, y: 0, w: 6, h: 2, sourceId: 'fact', field: 'date', datePart: 'quarter', style: 'tiles' }
      ] }]
    };
    fs.writeFileSync(starFile, fs.readFileSync('dist/dashier.html', 'utf8').replace(
      /(<script type="application\/dashier\+json" id="dashier-doc">)[\s\S]*?(<\/script>)/,
      (_, open, close) => open + JSON.stringify(sliced) + close
    ));
    await page.goto('about:blank');
    await page.goto('file:///' + starFile.replace(/\\/g, '/') + '#preview');
    await page.waitForSelector('.card-value');
    const compares = () => page.$$eval('.d-card-widget', (cs) => cs.map((c) => c.querySelector('.card-compare')?.textContent ?? '-').join(' | '));
    check('a card with nothing to compare with shows no comparison', (await compares()) === '- | -', await compares());
    await page.evaluate(() => [...document.querySelectorAll('.d-slicer button, .d-slicer label')].find((b) => b.textContent.trim() === '2025 Q3').click());
    await sleep(200);
    check('a slicer pick makes cards compare with the previous period (none a year back)', (await compares()) === '+50.0% vs 2025 Q2 | -', await compares());
    await page.close();
  }

  // ── encryption ──────────────────────────────────────────────────────────────
  {
    const page = await browser.newPage(); // its own tab, saving into its own folder
    page.on('pageerror', (e) => errors.push('encryption: ' + e.message));
    await page.evaluateOnNewDocument(() => { delete window.showSaveFilePicker; });
    // downloads land where the saving tab's own session says
    const saveDir = async (p) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashier-e2e-'));
      await (await p.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
      return dir;
    };
    const download = async (dir) => {
      for (let i = 0; i < 80; i++) {
        await sleep(150);
        const f = fs.readdirSync(dir).find((n) => n.endsWith('.dashier.html'));
        if (f) return path.join(dir, f);
      }
    };
    const docOf = (file) => JSON.parse(fs.readFileSync(file, 'utf8').match(/id="dashier-doc">([\s\S]*?)<\/script>/)[1]);
    const cards = (p) => p.$$eval('.card-value', (es) => es.map((e) => e.textContent).join(' | '));
    const share = async (p, item) => {
      await p.click('.ed-btn-primary');
      await p.waitForSelector('.d-context-menu');
      await p.$$eval('.d-context-menu button', (b, re) => b.find((x) => new RegExp(re).test(x.textContent)).click(), item);
    };
    const submit = async (p, ...passwords) => {
      const inputs = await p.$$('.d-password input');
      for (const [i, pw] of passwords.entries()) {
        await inputs[i].evaluate((e) => (e.value = ''));
        await inputs[i].type(pw);
      }
      await p.click('.d-password .btn-primary');
    };

    await page.goto(URL);
    await page.waitForSelector('.card-value');
    check('an unencrypted file opens with no password prompt', !(await page.$('.d-password')));
    const plain = await cards(page);
    await share(page, 'Encrypt with password');
    await page.waitForSelector('.d-password');
    check('the encrypt dialog warns that a lost password loses the data', (await page.$eval('.d-password', (e) => e.textContent)).includes('If you lose the password, the data cannot be recovered.'));
    await submit(page, 's3cret!', 'typo');
    await page.waitForSelector('.d-form-error');
    check('encrypting asks for the password twice', (await page.$eval('.d-form-error', (e) => e.textContent)) === "The passwords don't match");
    let dir = await saveDir(page);
    await submit(page, 's3cret!', 's3cret!');
    const sealed = await download(dir);
    check('Encrypt with password… saves the file', !!sealed);
    const doc = sealed && docOf(sealed);
    const e = doc?.encryption || {};
    const original = JSON.parse(fs.readFileSync('tests/e2e-doc.json', 'utf8')).sources;
    check('the saved file holds the data only as ciphertext, with no password or key', !!doc && Object.values(doc.sources).every((s) => s.payload === '') &&
      e.version === 1 && e.kdf === 'PBKDF2-SHA256' && e.iterations === 600000 && atob(e.salt).length === 16 && atob(e.iv).length === 12 && e.ciphertext?.length > 100 &&
      Object.keys(e).sort().join() === 'ciphertext,iterations,iv,kdf,salt,version' && !Object.values(original).some((s) => fs.readFileSync(sealed, 'utf8').includes(s.payload.slice(0, 40))), JSON.stringify({ ...e, ciphertext: e.ciphertext?.length }));
    await page.close();

    if (sealed) {
      const p3 = await browser.newPage();
      p3.on('pageerror', (e) => errors.push('encrypted: ' + e.message));
      await p3.evaluateOnNewDocument(() => { delete window.showSaveFilePicker; });
      await p3.goto('file:///' + sealed.replace(/\\/g, '/'));
      await p3.waitForSelector('.d-password');
      check('an encrypted file asks for its password before rendering anything', !(await p3.$('.d-visual-container')) && !(await p3.$eval('.d-password', (e) => e.textContent)).includes('If you lose'));
      await submit(p3, 'wrong');
      await p3.waitForSelector('.d-form-error');
      check('a wrong password shows "Wrong password", renders nothing and lets you retry', (await p3.$eval('.d-form-error', (e) => e.textContent)) === 'Wrong password' && !(await p3.$('.d-visual-container')));
      await submit(p3, 's3cret!');
      await p3.waitForSelector('.card-value');
      check('the right password opens the report with all its data', (await cards(p3)) === plain, await cards(p3));
      dir = await saveDir(p3);
      await share(p3, 'Remove encryption');
      const opened = await download(dir);
      const back = opened && docOf(opened);
      check('Remove encryption saves the data readable again', !!back && !back.encryption && Object.entries(back.sources).every(([id, s]) => s.payload.length > 20 && zlib.gunzipSync(Buffer.from(s.payload, 'base64')).length > 0), opened);
      await p3.close();

      // a changed ciphertext never opens, not even with the right password
      const tampered = sealed.replace(/\.dashier\.html$/, '.tampered.html');
      fs.writeFileSync(tampered, fs.readFileSync(sealed, 'utf8').replace(/("ciphertext": ")(.)/, (_, k, c) => k + (c === 'A' ? 'B' : 'A')));
      const p4 = await browser.newPage();
      p4.on('pageerror', (e) => errors.push('tampered: ' + e.message));
      await p4.goto('file:///' + tampered.replace(/\\/g, '/'));
      await p4.waitForSelector('.d-password');
      await submit(p4, 's3cret!');
      await p4.waitForSelector('.d-form-error');
      check('a tampered file is refused even with the right password', !(await p4.$('.d-visual-container')));
      await p4.close();
    }
  }

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  fs.rmSync(dl, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
