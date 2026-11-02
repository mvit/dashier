// The phone layout, in headless Chrome/Edge: the sample report (with the app from dist/) at 390×844, 360×800 and on
// its side at 844×390, every page checked and screenshotted to test-results/phone/.
// Usage: npm run build && npm run phone   (set CHROME_PATH to use a specific browser)
const launch = require('./browser.cjs');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const SAMPLE = 'site/examples/brightside.dashier.html';
const FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dashier-phone-')), 'brightside.dashier.html');
execFileSync(process.execPath, ['upgrade.mjs', SAMPLE, FILE]); // the sample's document, this build's app
const doc = JSON.parse(fs.readFileSync(FILE, 'utf8').match(/id="dashier-doc">([\s\S]*?)<\/script>/)[1]);
// and a short page with no slicers: its tabs still sit at the bottom of the screen, and there's nothing to filter
doc.pages.push({ id: 'note', title: 'Note', elements: [{ id: 'note_text', type: 'markdown', x: 0, y: 0, w: 12, h: 2, content: 'A short page.' }] });
fs.writeFileSync(FILE, fs.readFileSync(FILE, 'utf8').replace(/(id="dashier-doc">)[\s\S]*?(<\/script>)/, (_, a, b) => a + JSON.stringify(doc).replace(/</g, '\\u003c') + b));
const OUT = 'test-results/phone';
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await launch();
  for (const [width, height] of [[390, 844], [360, 800], [844, 390]]) {
    const at = `${width}×${height}`;
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pathToFileURL(FILE).href);
    await page.waitForSelector('.d-visual-container');
    check(`${at}: the editor's chrome and layout controls are hidden`, await page.evaluate(() =>
      ['.ed-topbar', '.d-right-panes-strip', '.ed-statusbar', '.d-add-page-btn', '.d-exit-preview'].every((s) => !document.querySelector(s) || getComputedStyle(document.querySelector(s)).display === 'none')));

    const tab = await (await page.$('.d-bottom-tab')).boundingBox();
    const arrows = await page.$('.d-tabs-arrow');
    check(`${at}: page tabs are thumb-sized (44px+), swiped rather than arrowed`, tab.height >= 44 && !(arrows && (await arrows.isVisible())), `${tab.height}px`);

    for (const p of doc.pages) {
      await page.$$eval('.d-bottom-tab', (els, title) => els.find((e) => e.textContent.trim() === title).click(), p.title);
      await sleep(400); // charts draw at their tile's size
      // every tile as laid out, in the order a reader meets them
      const tiles = await page.$$eval('.d-visual-container', (els) => els.map((e) => ({ id: e.dataset.id, type: e.dataset.type, ...e.getBoundingClientRect().toJSON(), shown: getComputedStyle(e).display !== 'none' })));
      const shown = tiles.filter((t) => t.shown).sort((a, b) => a.top - b.top || a.left - b.left);
      const read = (es) => [...es].sort((a, b) => a.y - b.y || a.x - b.x).map((e) => e.id);
      const cards = p.elements.filter((e) => e.type === 'card');
      const rest = p.elements.filter((e) => e.type !== 'card' && e.type !== 'slicer');
      const grid = await page.$eval('.d-visuals-grid', (g) => g.getBoundingClientRect().width);
      const name = `${at} ${p.title}`;
      check(`${name}: no sideways scrolling`, await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth));
      check(`${name}: KPI cards first, then every other visual in reading order; slicers not in the page`,
        shown.map((t) => t.id).join() === [...read(cards), ...read(rest)].join(), shown.map((t) => t.id).join());
      const cardTiles = shown.filter((t) => t.type === 'card');
      check(`${name}: cards two to a row`, cardTiles.every((t, i) => Math.abs(t.width - (grid - 10) / 2) < 2 && (i % 2 ? Math.abs(t.top - cardTiles[i - 1].top) < 1 && t.left > cardTiles[i - 1].left : true)));
      check(`${name}: other visuals at full width, each tall enough to read`,
        shown.filter((t) => t.type !== 'card').every((t) => Math.abs(t.width - grid) < 2 && (t.type === 'markdown' ? t.height > 30 : t.height >= 280)));
      const bar = await page.$eval('.d-bottom-pages-bar', (b) => [Math.round(b.getBoundingClientRect().bottom), innerHeight]);
      check(`${name}: the page tabs sit at the bottom of the screen`, Math.abs(bar[0] - bar[1]) <= 1, bar.join(' vs '));
      const slicers = p.elements.some((e) => e.type === 'slicer');
      check(`${name}: the Filters button ${slicers ? 'opens the page\'s slicers' : 'is disabled: no slicers here'}`, (await page.$eval('.d-drawer-btn', (b) => b.disabled)) === !slicers);
      await page.screenshot({ path: `${OUT}/${width}x${height}-${p.id}.png`, fullPage: true });
    }

    // filtering: the slicers are in a drawer, opened from a button at the top
    await page.$eval('.d-bottom-tab', (t) => t.click());
    const button = await page.waitForSelector('.d-drawer-btn');
    const box = await button.boundingBox();
    check(`${at}: a Filters button at the top of the page`, !!box && box.y < 20 && (await button.evaluate((b) => getComputedStyle(b).position)) === 'fixed');
    const values = () => page.$$eval('.card-value', (es) => es.map((e) => e.textContent).join(' | '));
    const before = await values();
    await button.tap();
    await page.waitForSelector('.d-drawer .d-slicer');
    await page.screenshot({ path: `${OUT}/${width}x${height}-filters.png` });
    const drawerBox = await page.$eval('.d-drawer', (d) => { const r = d.getBoundingClientRect(); return r.top <= 0 && r.left <= 0 && r.width >= innerWidth && r.height >= innerHeight; });
    check(`${at}: the drawer fills the screen`, drawerBox);
    check(`${at}: the drawer's slicers are cards, closed by the Filters button (no Done)`, !!(await page.$('.d-drawer .d-filter-card')) && !(await page.$('.d-drawer .btn-primary')));
    const head = await page.$('.d-drawer .d-card-head');
    await head.tap();
    await sleep(150);
    check(`${at}: a lone slicer starts open and still collapses`, !(await page.$('.d-drawer .d-slicer')));
    await head.tap();
    await page.waitForSelector('.d-drawer .d-slicer');
    check(`${at}: a drawer card's header never just says All`, (await page.$eval('.d-drawer .filter-type', (e) => e.textContent)) !== 'All');
    await (await page.$('.d-drawer .d-slicer-tile')).tap();
    await sleep(100);
    const picked = await page.$eval('.d-drawer .filter-type', (e) => e.textContent);
    await button.tap();
    await sleep(300);
    check(`${at}: a slicer picked in the drawer filters the page, and its card says what's picked`, !(await page.$('.d-drawer')) && (await values()) !== before && picked.startsWith('is '), `${picked} · ${before} → ${await values()}`);
    await page.evaluate(() => scrollTo(0, 400));
    check(`${at}: the Filters button stays at the top while scrolling`, ((await button.boundingBox())?.y ?? 99) < 20);

    // tooltips by touch: a tap shows one (and it stays after the finger lifts), two fingers or a tap elsewhere hide it
    await page.evaluate(() => scrollTo(0, 0));
    const tip = () => page.evaluate(() => getComputedStyle(document.querySelector('.d-tip') ?? document.body).display === 'block');
    const plot = await page.$('.d-visual-container[data-type="chart"] .d-chart-plot');
    await plot.scrollIntoView();
    const pb = await plot.boundingBox();
    const [cx, cy] = [pb.x + pb.width / 2, pb.y + pb.height / 2];
    await page.touchscreen.tap(cx, cy);
    await sleep(300);
    check(`${at}: a tap on a chart shows its tooltip, which stays once the finger lifts`, await tip());
    const cdp = await page.createCDPSession();
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    await touch('touchStart', [{ x: cx, y: cy, id: 1 }]);
    await touch('touchStart', [{ x: cx, y: cy, id: 1 }, { x: cx + 40, y: cy + 10, id: 2 }]);
    await touch('touchMove', [{ x: cx - 10, y: cy, id: 1 }, { x: cx + 60, y: cy + 10, id: 2 }]);
    check(`${at}: no tooltip while two fingers are down (a pinch)`, !(await tip()));
    await touch('touchEnd', []);
    await page.touchscreen.tap(cx, cy);
    await sleep(200);
    // the same as a phone sends it (pointer events by touch, then a leave once the finger lifts), deterministically
    const seq = await page.evaluate(([x, y]) => {
      const host = document.querySelector('.d-visual-container[data-type="chart"] .d-chart-plot');
      const at = document.elementFromPoint(x, y);
      const ev = (type, id, dx = 0, el = at) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x + dx, clientY: y, bubbles: !type.endsWith('leave') }));
      const shown = () => getComputedStyle(document.querySelector('.d-tip') ?? document.body).display === 'block';
      ev('pointerdown', 11); ev('pointerup', 11); ev('pointerout', 11); ev('pointerleave', 11, 0, host);
      const lifted = shown();
      ev('pointerdown', 12); ev('pointerdown', 13, 30); ev('pointermove', 12, -20); ev('pointermove', 13, 50);
      const pinch = shown();
      ev('pointerup', 12); ev('pointerup', 13);
      return { lifted, pinch };
    }, [cx, cy]);
    check(`${at}: touch pointer events: a tap's tooltip outlives the lift, and a pinch shows none`, seq.lifted && !seq.pinch, JSON.stringify(seq));
    const outside = await (await page.$('.d-bottom-pages-bar')).boundingBox();
    await page.touchscreen.tap(outside.x + outside.width - 4, outside.y + 4);
    check(`${at}: a tap outside the chart hides the tooltip`, !(await tip()));
    check(`${at}: no page errors`, !errors.length, errors.join(' | '));
    await page.close();
  }

  // on a tablet the editor stays: two fingers on the view pinch it, wherever they land, and never drag a visual
  {
    const page = await browser.newPage();
    page.on('dialog', (d) => d.accept()); // reopening after an edit asks first
    await page.setViewport({ width: 1180, height: 820, isMobile: true, hasTouch: true });
    const cdp = await page.createCDPSession();
    const touch = async (type, points) => {
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
      await sleep(50);
    };
    const state = (name) => page.$eval(`[title^="${name}"]`, (b) => !b.disabled);
    const zoom = () => page.$eval('.d-canvas-sheet', (e) => +e.style.transform.match(/[\d.]+/)[0]);
    const placed = () => page.$$eval('.d-visual-container', (els) => els.map((e) => e.style.cssText).join());
    const sheet = () => page.$eval('.d-canvas-sheet', (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top }; });
    const open = async () => {
      await page.goto(pathToFileURL(FILE).href);
      await page.waitForSelector('.d-visual-container[data-type="chart"]');
      await sleep(500);
      // both fingers on the first card: at this width the panes cover the ones beside it
      const box = await (await page.$('.d-visual-container[data-type="card"]')).boundingBox();
      const at = (f) => ({ x: box.x + box.width * f, y: box.y + box.height / 2 });
      return { a: at(0.25), b: at(0.75), start: await placed(), scale: await zoom() };
    };

    let { a, b, start, scale } = await open();
    check('tablet: the editor is open', !!(await page.$('.ed-topbar')));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const before = await sheet();
    await touch('touchStart', [{ ...a, id: 1 }]);
    await touch('touchStart', [{ ...a, id: 1 }, { ...b, id: 2 }]);
    await touch('touchMove', [{ x: a.x - 30, y: a.y, id: 1 }, { x: b.x + 30, y: b.y, id: 2 }]);
    await touch('touchMove', [{ x: a.x - 60, y: a.y, id: 1 }, { x: b.x + 60, y: b.y, id: 2 }]);
    const wider = await zoom();
    const expected = scale * ((b.x - a.x + 120) / (b.x - a.x));
    check('tablet: a pinch on visuals zooms by how far the fingers spread', Math.abs(wider - expected) < 0.02, `${scale} -> ${wider}, expected ${expected.toFixed(3)}`);
    const after = await sheet();
    const drift = Math.hypot((mid.x - before.x) / scale - (mid.x - after.x) / wider, (mid.y - before.y) / scale - (mid.y - after.y) / wider);
    check('tablet: …around the point between the fingers', drift < 3, `${drift.toFixed(1)}px off`);
    check('tablet: …and moves no visual', (await placed()) === start);
    // Safari sends a gesture event for the same pinch
    await page.$eval('.d-canvas-scroll-container', (e) => e.dispatchEvent(Object.assign(new Event('gesturechange', { cancelable: true }), { scale: 3, clientX: 100, clientY: 100 })));
    check('tablet: …and is not zoomed again by the gesture event Safari sends for it', Math.abs((await zoom()) - wider) < 0.001, `${await zoom()}`);
    await touch('touchEnd', []);
    check('tablet: …leaving nothing to undo', !(await state('Undo')));
    const trackpad = await zoom();
    await page.$eval('.d-canvas-scroll-container', (e) => {
      e.dispatchEvent(Object.assign(new Event('gesturestart', { cancelable: true }), { clientX: 100, clientY: 100 }));
      e.dispatchEvent(Object.assign(new Event('gesturechange', { cancelable: true }), { scale: 1.5, clientX: 100, clientY: 100 }));
    });
    check('tablet: a trackpad pinch in Safari (gesture events, no fingers down) still zooms', Math.abs((await zoom()) - trackpad * 1.5) < 0.01, `${await zoom()}`);

    ({ a, b, start, scale } = await open());
    const area = await (await page.$('.d-canvas-scroll-container')).boundingBox();
    const [left, right] = [{ x: area.x + 6, y: area.y + 6 }, { x: area.x + 6, y: area.y + 56 }];
    await touch('touchStart', [{ ...left, id: 1 }, { ...right, id: 2 }]);
    await touch('touchMove', [{ x: left.x, y: left.y - 2, id: 1 }, { x: right.x, y: right.y + 30, id: 2 }]);
    await touch('touchMove', [{ x: left.x, y: left.y - 4, id: 1 }, { x: right.x, y: right.y + 60, id: 2 }]);
    check('tablet: a pinch on the background zooms too', (await zoom()) > scale, `${scale} -> ${await zoom()}`);
    await touch('touchEnd', []);

    // the first finger can travel before the second lands
    ({ a, b, start, scale } = await open());
    await touch('touchStart', [{ ...a, id: 1 }]);
    await touch('touchMove', [{ x: a.x, y: a.y + 200, id: 1 }]);
    const moved = (await placed()) !== start;
    await touch('touchStart', [{ x: a.x, y: a.y + 200, id: 1 }, { ...b, id: 2 }]);
    await touch('touchMove', [{ x: a.x, y: a.y + 300, id: 1 }, { ...b, id: 2 }]);
    await touch('touchEnd', [{ ...b, id: 2 }]);
    await touch('touchMove', [{ x: b.x, y: b.y + 200, id: 2 }]);
    check('tablet: a second finger puts a visual back where the drag began', moved && (await placed()) === start, `moved ${moved}`);
    await touch('touchEnd', []);
    check('tablet: …leaving nothing to undo or redo', !(await state('Undo')) && !(await state('Redo')));

    await touch('touchStart', [{ ...a, id: 1 }]);
    await touch('touchMove', [{ x: a.x, y: a.y + 200, id: 1 }]);
    await touch('touchEnd', []);
    check('tablet: one finger still drags a visual, as one undo step', (await placed()) !== start && (await state('Undo')));

    // a field carried from the Data pane to a well: a held finger picks it up, a swipe doesn't
    await open();
    const chart = await page.$('.d-visual-container[data-type="chart"]');
    const spot = await chart.boundingBox();
    await page.touchscreen.tap(spot.x + 30, spot.y + 14);
    await sleep(300);
    const field = await page.evaluateHandle(() => {
      const el = [...document.querySelectorAll('.d-field-item')].find((e) => e.textContent.trim().endsWith('subcategory'));
      el.scrollIntoView({ block: 'center' });
      return el;
    });
    await sleep(200);
    const fb = await field.boundingBox();
    const from = { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 };
    const legend = async () => page.$$eval('.d-field-well', (els) => els.find((e) => /legend/i.test(e.textContent)).querySelector('.d-well-box').textContent);
    const well = await page.evaluateHandle(() => [...document.querySelectorAll('.d-field-well')].find((e) => /legend/i.test(e.textContent)).querySelector('.d-well-box'));
    const wb = await well.boundingBox();
    const to = { x: wb.x + wb.width / 2, y: wb.y + wb.height / 2 };
    const ghost = () => page.$('.d-drag-ghost');

    await touch('touchStart', [{ ...from, id: 1 }]);
    await touch('touchMove', [{ x: from.x, y: from.y - 40, id: 1 }]);
    await sleep(400);
    check('tablet: a quick swipe on a field picks nothing up', !(await ghost()));
    await touch('touchEnd', []);

    await touch('touchStart', [{ ...from, id: 1 }]);
    await sleep(400);
    check('tablet: holding a field picks it up', !!(await ghost()));
    await touch('touchMove', [{ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, id: 1 }]);
    await touch('touchMove', [{ ...to, id: 1 }]);
    await sleep(50);
    check('tablet: …the well under the finger lights up', await well.evaluate((e) => e.matches('.over')));
    await touch('touchEnd', []);
    await sleep(200);
    check('tablet: …and letting go drops it there', (await legend()).includes('subcategory'), await legend());
    check('tablet: …and puts it down', !(await ghost()));

    await touch('touchStart', [{ ...from, id: 1 }]);
    await sleep(400);
    await touch('touchMove', [{ x: 300, y: 300, id: 1 }]);
    await touch('touchEnd', []);
    await sleep(200);
    check('tablet: a field dropped outside any well does nothing', !(await ghost()) && (await legend()).includes('subcategory'));

    // the filter it makes: Select All is the first option, and stays true to the filter
    const pad = await (await page.$('.d-filters-pane .d-filter-section:nth-child(2) .d-well-box')).boundingBox();
    await touch('touchStart', [{ ...from, id: 1 }]);
    await sleep(400);
    await touch('touchMove', [{ x: pad.x + pad.width / 2, y: pad.y + pad.height / 2, id: 1 }]);
    await touch('touchEnd', []);
    await page.waitForSelector('.d-filter-card .d-filter-values');
    const options = () => page.$$eval('.d-filter-card .d-filter-values label', (ls) => ls.map((l) => ({ text: l.textContent.trim(), on: l.querySelector('input').checked })));
    const headed = () => page.$eval('.d-filter-card .filter-type', (e) => e.textContent);
    const option = (n) => page.$$eval('.d-filter-card .d-filter-values input', (els, i) => els[i].click(), n);
    check('tablet: a filter lists Select All first, on, with no All in its header', (await options())[0].text === 'Select All' && (await options())[0].on && !(await headed()), `"${await headed()}"`);
    await option(0);
    await sleep(100);
    check('tablet: …a click on it while it\'s on leaves it on', (await options())[0].on);
    await option(1);
    await sleep(100);
    check('tablet: …picking a value turns it off', !(await options())[0].on && !!(await headed()), await headed());
    await option(0);
    await sleep(100);
    check('tablet: …and it lets the pick go', (await options())[0].on && !(await options())[1].on && !(await headed()));
    await page.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : `\nAll checks passed. Screenshots in ${OUT}/`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
