// A .zip of a folder (its files deflated), for the skill download on the site: the build needs no zip tool.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/** A file's modification time as zip headers store it: DOS date and time (2-second steps). */
const dos = (d) => [((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(), (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)];

/** Little-endian fields: [value, bytes] pairs. */
const fields = (...parts) => Buffer.concat(parts.map(([v, n]) => { const b = Buffer.alloc(n); b[`writeUInt${n * 8}LE`](v); return b; }));

/**
 * `dir` zipped as `root/…`: every file and folder in it but dotfiles and __pycache__, names in UTF-8, Unix modes
 * (scripts executable).
 */
export default function zipDir(dir, root) {
  const entries = [];
  const walk = (abs, name) => {
    const st = fs.statSync(abs);
    if (!st.isDirectory()) return entries.push({ name, st, data: fs.readFileSync(abs), mode: /\.(py|sh)$/.test(name) ? 0o100755 : 0o100644 });
    entries.push({ name: name + '/', st, data: Buffer.alloc(0), mode: 0o40755 });
    for (const n of fs.readdirSync(abs).sort()) if (!n.startsWith('.') && n !== '__pycache__') walk(path.join(abs, n), `${name}/${n}`);
  };
  walk(dir, root);

  const local = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name), file = !e.name.endsWith('/');
    const body = file ? zlib.deflateRawSync(e.data, { level: 9 }) : e.data;
    const [date, time] = dos(e.st.mtime);
    // version needed 2.0, UTF-8 names, deflated (or stored, for a folder), time, date, CRC-32, sizes, name length
    const common = [[20, 2], [0x0800, 2], [file ? 8 : 0, 2], [time, 2], [date, 2], [zlib.crc32(e.data), 4], [body.length, 4], [e.data.length, 4], [name.length, 2]];
    local.push(fields([0x04034b50, 4], ...common, [0, 2]), name, body);
    // made by Unix 2.0; no extra field, comment, disk or internal attributes; the mode in the external attributes
    central.push(fields([0x02014b50, 4], [0x0314, 2], ...common, [0, 2], [0, 2], [0, 2], [0, 2], [((e.mode << 16) | (file ? 0 : 0x10)) >>> 0, 4], [offset, 4]), name);
    offset += 30 + name.length + body.length;
  }
  const dirSize = central.reduce((n, b) => n + b.length, 0);
  return Buffer.concat([...local, ...central, fields([0x06054b50, 4], [0, 2], [0, 2], [entries.length, 2], [entries.length, 2], [dirSize, 4], [offset, 4], [0, 2])]);
}
