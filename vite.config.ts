import { defineConfig, Plugin } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import pack85 from './pack85.cjs';

// Runs the packed app code. Indirect eval keeps it out of the DOM, so the page HTML that
// "Save" rewrites never contains a second copy of the code.
const LOADER =
  `(async()=>{const b=(${pack85.DECODE})(document.getElementById("dashier-js").textContent.replace(/\\s/g,""));` +
  '(0,eval)(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text())})()' +
  '.catch(e=>{document.getElementById("d-splash").textContent="Dashier needs a current browser: "+e})';

/**
 * Post-processes the single-file build: the inlined (already minified) app script and stylesheet become
 * base85(gzip(css + js)) in a data block (pack85.cjs), started by LOADER. The stylesheet is installed as an adopted
 * sheet, which keeps it out of the DOM. Output: dist/dashier.html.
 */
function packScript(): Plugin {
  return {
    name: 'dashier-pack',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
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
      const css = styles[0][1];

      const code = `{const s=new CSSStyleSheet;s.replaceSync(${JSON.stringify(css)});document.adoptedStyleSheets=[s]}\n${js}`;
      const packed = pack85.encode(zlib.gzipSync(code, { level: 9 }));
      html = html.replace(scripts[0][0], () => '').replace(styles[0][0], () => '');
      html = html.replace('</body>', () => `<script id="dashier-js" type="text/plain">${packed}</script>\n<script>${LOADER}</script>\n</body>`);

      fs.writeFileSync(path.join(dist, 'dashier.html'), html);
      fs.rmSync(input);
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
    terserOptions: { compress: { passes: 2, pure_getters: true, unsafe_arrows: true }, mangle: { toplevel: true }, format: { comments: false } },
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } }
  }
});
