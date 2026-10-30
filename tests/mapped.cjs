// Runs a browser test against the built file, its class names translated as the build shortened them (the editor's
// own classes; the map is dist/dashier.classes.json, from classes.mjs). Usage: node tests/mapped.cjs tests/e2e.cjs
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

(async () => {
  const { namesRe } = await import('../classes.mjs');
  const [test, ...args] = process.argv.slice(2);
  const map = JSON.parse(fs.readFileSync('dist/dashier.classes.json', 'utf8'));
  // next to the test, so its own requires resolve as they do
  const run = path.join(path.dirname(test), `.mapped-${path.basename(test)}`);
  fs.writeFileSync(run, fs.readFileSync(test, 'utf8').replace(namesRe(Object.keys(map)), (n) => map[n]));
  try {
    process.exitCode = spawnSync(process.execPath, [run, ...args], { stdio: 'inherit' }).status ?? 1;
  } finally {
    fs.rmSync(run, { force: true });
  }
})();
