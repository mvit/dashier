import { defineConfig, Plugin } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';
import path from 'node:path';
import { gzipAsync } from '@gfx/zopfli';
import pack85 from './pack85.cjs';
import zipDir from './zip.mjs';
import shortenClasses from './classes.mjs';

// Runs the packed app code. Indirect eval keeps it out of the DOM, so the page HTML that
// "Save" rewrites never contains a second copy of the code.
const LOADER =
  `(async()=>{const b=(${pack85.DECODE})(document.getElementById("dashier-js").textContent.replace(/\\s/g,""));` +
  '(0,eval)(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text())})()' +
  '.catch(e=>{document.getElementById("d-splash").textContent="Dashier needs a current browser: "+e})';

/**
 * Post-processes the single-file build: the inlined (already minified) app script and stylesheet become
 * base85(gzip(css + js)) in a data block (pack85.cjs), started by LOADER. The stylesheet is installed as an adopted
 * sheet, which keeps it out of the DOM. Output: dist/dashier.html, copied to site/ with the skill zipped beside it.
 */
function packScript(): Plugin {
  return {
    name: 'dashier-pack',
    apply: 'build',
    enforce: 'post',
    async closeBundle() {
      const dist = path.resolve(__dirname, 'dist');
      const input = path.join(dist, 'index.html');
      if (!fs.existsSync(input)) return;
      let html = fs.readFileSync(input, 'utf-8');

      const scripts = [...html.matchAll(/<script type="module"[^>]*>([\s\S]*?)<\/script>/g)];
      if (scripts.length !== 1) throw new Error(`[dashier] expected one inlined module script, found ${scripts.length}`);
      const js = scripts[0][1];
      if (/\bimport\.meta\b|^\s*(import|export)\b/m.test(js)) throw new Error('[dashier] bundle must be a plain script (iife)');
      const styles = [...html.matchAll(/<style rel="stylesheet"[^>]*>([\s\S]*?)<\/style>/g)];
      if (styles.length !== 1) throw new Error(`[dashier] expected one inlined stylesheet, found ${styles.length}`);
      // the editor's own class names, shortened in the stylesheet and the code (classes.mjs); the map is for the tests
      const short = shortenClasses(styles[0][1], js, __dirname);
      const css = short.css;
      fs.writeFileSync(path.join(dist, 'dashier.classes.json'), JSON.stringify(short.map, null, 1));

      const code = `{const s=new CSSStyleSheet;s.replaceSync(${JSON.stringify(css)});document.adoptedStyleSheets=[s]}\n${short.js}`;
      // zopfli: still plain gzip for DecompressionStream, about 4% smaller than zlib -9; costs build time only
      const packed = pack85.encode(Buffer.from(await gzipAsync(code, { numiterations: 15 })));
      html = html.replace(scripts[0][0], () => '').replace(styles[0][0], () => '');
      html = html.replace('</body>', () => `<script id="dashier-js" type="text/plain">${packed}</script>\n<script>${LOADER}</script>\n</body>`);

      fs.writeFileSync(path.join(dist, 'dashier.html'), html);
      fs.rmSync(input);
      // the site (published as is): the editor, and the skill as a zip
      const site = path.resolve(__dirname, 'site');
      fs.copyFileSync(path.join(dist, 'dashier.html'), path.join(site, 'dashier.html'));
      fs.writeFileSync(path.join(site, 'dashier-report-skill.zip'), zipDir(path.resolve(__dirname, 'skill/dashier-report'), 'dashier-report'));
      const kb = (n: number) => (n / 1024).toFixed(1) + ' KB';
      console.log(`[dashier] js+css ${kb(code.length)} -> gzip+base85 ${kb(packed.length)}; dist/dashier.html ${kb(Buffer.byteLength(html))}`);
    }
  };
}

export default defineConfig({
  plugins: [solidPlugin(), viteSingleFile(), packScript()],
  build: {
    target: 'esnext',
    // one inlined script: there are no chunks to preload
    modulePreload: { polyfill: false },
    minify: 'terser',
    // no pure_getters: in Solid a property read is how a computation subscribes (props, store fields), so one whose
    // value is unused, as in createMemo(() => (props.rows, new Map())), must stay
    terserOptions: { compress: { passes: 2, unsafe_arrows: true }, mangle: { toplevel: true }, format: { comments: false }, ecma: 2020 },
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } }
  }
});
