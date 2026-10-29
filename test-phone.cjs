// The phone layout, in headless Chrome/Edge via Playwright: the sample report (with the app from dist/) at 390×844
// and 360×800, every page checked and screenshotted to test-results/phone/.
// Usage: npm run build && npm run phone   (set CHROME_PATH to use a specific browser)
const { chromium } = require('playwright-core');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const SAMPLE = 'site/examples/brightside.dashier.html';
const FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dashier-phone-')), 'brightside.dashier.html');
execFileSync(process.execPath, ['upgrade.mjs', SAMPLE, FILE]); // the sample's document, this build's app
const doc = JSON.parse(fs.readFileSync(FILE, 'utf8').match(/id="dashier-doc">([\s\S]*?)<\/script>/)[1]);
const OUT = 'test-results/phone';
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}: ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) failures++;
};

(async () => {
  const browser = await chromium.launch({ executablePath: require('./tests/browser.cjs') });
  for (const [width, height] of [[390, 844], [360, 800]]) {
    const at = `${width}×${height}`;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pathToFileURL(FILE).href);
    await page.waitForSelector('.d-visual-container');
    check(`${at}: the editor's chrome and layout controls are hidden`, await page.evaluate(() =>
      ['.ed-topbar', '.d-right-panes-strip', '.ed-statusbar', '.d-add-page-btn', '.d-exit-preview'].every((s) => !document.querySelector(s) || getComputedStyle(document.querySelector(s)).display === 'none')));

    const tab = await page.locator('.d-bottom-tab').first().boundingBox();
    check(`${at}: page tabs are thumb-sized (44px+), swiped rather than arrowed`, tab.height >= 44 && !(await page.locator('.d-tabs-arrow').first().isVisible().catch(() => false)), `${tab.height}px`);

    for (const p of doc.pages) {
      await page.locator('.d-bottom-tab', { hasText: p.title }).first().click();
      await page.waitForTimeout(400); // charts draw at their tile's size
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
      await page.screenshot({ path: `${OUT}/${width}x${height}-${p.id}.png`, fullPage: true });
    }

    // filtering: the slicers are in a drawer, opened from a button at the top
    await page.locator('.d-bottom-tab').first().click();
    const button = page.locator('.d-drawer-btn');
    const box = await button.boundingBox();
    check(`${at}: a Filters button at the top of the page`, !!box && box.y < 20 && (await button.evaluate((b) => getComputedStyle(b).position)) === 'fixed');
    const values = () => page.$$eval('.card-value', (es) => es.map((e) => e.textContent).join(' | '));
    const before = await values();
    await button.tap();
    await page.waitForSelector('.d-drawer .d-slicer');
    await page.screenshot({ path: `${OUT}/${width}x${height}-filters.png` });
    await page.locator('.d-drawer .d-slicer-tile').first().tap();
    await page.locator('.d-drawer .btn-primary').tap();
    await page.waitForTimeout(300);
    check(`${at}: a slicer picked in the drawer filters the page`, !(await page.$('.d-drawer')) && (await values()) !== before, `${before} → ${await values()}`);
    await page.evaluate(() => scrollTo(0, 400));
    check(`${at}: the Filters button stays at the top while scrolling`, ((await button.boundingBox())?.y ?? 99) < 20);
    check(`${at}: no page errors`, !errors.length, errors.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : `\nAll checks passed. Screenshots in ${OUT}/`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
