import fs from 'node:fs';
import path from 'node:path';
const root = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const files = [
  'app.js',
  'github.js',
  'demo.js',
  'theme-init.js',
  'markdown.js',
  'styles.css',
  'mark.svg',
  '_headers',
  'robots.txt',
  'sitemap.xml',
];
for (const file of files) if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing site asset: ${file}`);
for (const match of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)) {
  if (!fs.existsSync(path.join(root, match[1]))) throw new Error(`Missing referenced site asset: ${match[1]}`);
}
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate site element IDs.');
if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) throw new Error('Inline scripts violate the site CSP.');
for (const anchor of html.matchAll(/href="#([^"]+)"/g))
  if (!ids.includes(anchor[1])) throw new Error(`Broken in-page link #${anchor[1]}`);
console.log(`Verified ${files.length} site assets, unique IDs and anchor targets.`);
