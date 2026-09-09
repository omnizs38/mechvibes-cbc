/** Fail CI if a renderer entry point, asset, or shared preload is missing. */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const renderer = path.join(root, 'src', 'renderer-dist');
const failures: string[] = [];
for (const name of ['app', 'install', 'editor']) {
  const htmlPath = path.join(renderer, `${name}.html`);
  if (!fs.existsSync(htmlPath)) {
    failures.push(`Missing ${name}.html`);
    continue;
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)];
  if (scripts.length === 0) failures.push(`${name}: no bundled script`);
  const references = [...scripts, ...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/gi)];
  for (const [, reference] of references) {
    if (/^(?:data:|https?:)/i.test(reference)) {
      failures.push(`${name}: unexpected remote/inline asset ${reference}`);
      continue;
    }
    const target = path.resolve(renderer, reference);
    if (!target.startsWith(renderer + path.sep) || !fs.existsSync(target))
      failures.push(`${name}: missing or unsafe asset ${reference}`);
  }
  if (!/script-src 'self' file:;/.test(html)) failures.push(`${name}: unexpected script policy`);
  if (!/object-src 'none';/.test(html) || !/frame-src 'none';/.test(html))
    failures.push(`${name}: missing content restrictions`);
}
if (!fs.existsSync(path.join(root, 'src/preload.js'))) failures.push('Missing compiled preload.js');
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log('Verified all three renderer entry points, asset references, CSP and preload.');
