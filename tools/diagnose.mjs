#!/usr/bin/env node
/**
 * Mechvibes renderer diagnostics.
 *
 * Answers one question: why is a window blank?
 *
 * The script inspects an installed build (or the working tree), reads the
 * asar archive without any external dependency, and checks the whole chain
 * that has to hold for a window to paint:
 *
 *   1. the compiled main process exists                (npm run build:main)
 *   2. src/renderer-dist/<window>.html exists           (npm run build:renderer)
 *   3. the HTML is inside the packaged archive          (build.files)
 *   4. every script/style it references exists too      (asset integrity)
 *   5. the Content-Security-Policy allows file: scripts (the classic blank window)
 *   6. the BrowserWindow flags allow ES modules on file://
 *
 * Usage:
 *   node tools/diagnose.mjs                 # working tree + auto-detected install
 *   node tools/diagnose.mjs "C:\\Program Files\\Mechvibes"
 *
 * The report is printed and written to mechvibes-diagnostics.txt.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WINDOWS = ['app', 'install', 'debug', 'editor'];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const report = [];
let failures = 0;
let warnings = 0;

const line = (text = '') => report.push(text);
const section = (title) => {
  line('');
  line('='.repeat(72));
  line(title);
  line('='.repeat(72));
};
const info = (text) => line('    ' + text);
const ok = (text) => line('  [ ok ] ' + text);
const warn = (text) => {
  warnings += 1;
  line('  [warn] ' + text);
};
const bad = (text) => {
  failures += 1;
  line('  [FAIL] ' + text);
};

const exists = (target) => {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
};

const human = (bytes) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

/* ------------------------------------------------------------------ asar -- */

/** Minimal asar reader: header pickle, then raw reads at baseOffset + offset. */
function openAsar(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerSize = head.readUInt32LE(4);
    const jsonLength = head.readUInt32LE(12);
    const jsonBuffer = Buffer.alloc(jsonLength);
    fs.readSync(fd, jsonBuffer, 0, jsonLength, 16);
    return {
      kind: 'asar',
      root: asarPath,
      header: JSON.parse(jsonBuffer.toString('utf8')),
      baseOffset: 8 + headerSize,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function asarNode(archive, relativePath) {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  let node = archive.header;
  for (const part of parts) {
    if (!node || !node.files || !node.files[part]) return null;
    node = node.files[part];
  }
  return node;
}

function asarRead(archive, relativePath) {
  const node = asarNode(archive, relativePath);
  if (!node || node.files) return null;
  if (node.unpacked) {
    const unpacked = path.join(archive.root + '.unpacked', relativePath);
    return exists(unpacked) ? fs.readFileSync(unpacked) : null;
  }
  const fd = fs.openSync(archive.root, 'r');
  try {
    const buffer = Buffer.alloc(Number(node.size));
    fs.readSync(fd, buffer, 0, buffer.length, archive.baseOffset + Number(node.offset));
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}

/* ---------------------------------------------------- filesystem/asar API -- */

/** Both sources expose the same three calls, so the checks stay identical. */
function fsSource(root) {
  return {
    kind: 'directory',
    root,
    read: (relativePath) => {
      const target = path.join(root, relativePath);
      return exists(target) ? fs.readFileSync(target) : null;
    },
    stat: (relativePath) => {
      const stats = exists(path.join(root, relativePath));
      return stats ? { size: stats.size } : null;
    },
    list: (relativePath) => {
      try {
        return fs.readdirSync(path.join(root, relativePath));
      } catch {
        return [];
      }
    },
  };
}

function asarSource(asarPath) {
  const archive = openAsar(asarPath);
  return {
    kind: 'asar',
    root: asarPath,
    read: (relativePath) => asarRead(archive, relativePath),
    stat: (relativePath) => {
      const node = asarNode(archive, relativePath);
      return node && !node.files ? { size: Number(node.size) } : null;
    },
    list: (relativePath) => {
      const node = asarNode(archive, relativePath);
      return node && node.files ? Object.keys(node.files) : [];
    },
  };
}

/* ---------------------------------------------------------------- checks -- */

function inspectHtml(source, windowName) {
  const relativePath = 'src/renderer-dist/' + windowName + '.html';
  const buffer = source.read(relativePath);
  if (!buffer) {
    bad(relativePath + ' is missing — the renderer bundle was never built or was excluded from the package');
    return;
  }
  const html = buffer.toString('utf8');
  ok(relativePath + ' (' + human(buffer.length) + ')');

  const cspMatch = html.match(/<meta[^>]*Content-Security-Policy[\s\S]*?content="([^"]*)"/i);
  if (!cspMatch) {
    info('no Content-Security-Policy meta tag');
  } else {
    const csp = cspMatch[1].replace(/\s+/g, ' ').trim();
    info('CSP: ' + csp);
    const scriptSrc = csp.match(/script-src([^;]*)/i);
    const directive = scriptSrc ? scriptSrc[1] : null;
    if (directive && !/\bfile:/.test(directive)) {
      bad(
        windowName +
          ".html: script-src does not allow the file: scheme. The page is loaded from disk, so its origin is opaque, 'self' matches nothing and Chromium refuses the bundle — this is what makes the window blank.",
      );
    } else if (directive) {
      ok(windowName + '.html: script-src allows file:');
    }
  }

  const references = [];
  const scriptPattern = /<script[^>]*\ssrc="([^"]+)"[^>]*>/gi;
  const linkPattern = /<link[^>]*\shref="([^"]+)"[^>]*>/gi;
  let match;
  while ((match = scriptPattern.exec(html))) references.push({ kind: 'script', href: match[1], tag: match[0] });
  while ((match = linkPattern.exec(html))) references.push({ kind: 'link', href: match[1], tag: match[0] });

  for (const reference of references) {
    if (/^(https?:|data:|blob:)/i.test(reference.href)) {
      info('remote reference, not checked: ' + reference.href);
      continue;
    }
    const resolved = path
      .join('src/renderer-dist', path.dirname(windowName + '.html'), reference.href)
      .replace(/\\/g, '/');
    const stats = source.stat(resolved);
    if (stats) {
      ok('  ' + reference.kind + ' ' + reference.href + ' (' + human(stats.size) + ')');
    } else {
      bad('  ' + reference.kind + ' ' + reference.href + ' is referenced but missing at ' + resolved);
    }
    if (reference.kind === 'script' && / crossorigin/i.test(reference.tag)) {
      warn('  ' + reference.href + ' is tagged crossorigin; under file:// this only works while webSecurity is disabled');
    }
  }
}

function inspectMain(source) {
  const buffer = source.read('src/main.js');
  if (!buffer) {
    bad('src/main.js is missing — the main process was not compiled (npm run build:main)');
    return;
  }
  ok('src/main.js (' + human(buffer.length) + ')');
  const code = buffer.toString('utf8');

  const loads = [...code.matchAll(/loadFile\(\s*['"]([^'"]+)['"]/g)].map((entry) => entry[1]);
  if (loads.length === 0) {
    warn('no loadFile() call found in the compiled main process');
  }
  for (const target of loads) {
    const normalized = target.replace(/^\.\//, '');
    const stats = source.stat(normalized);
    if (stats) {
      ok('loadFile(' + target + ') resolves (' + human(stats.size) + ')');
    } else {
      bad('loadFile(' + target + ') points at a file that is not in this build');
    }
  }

  const webSecurity = [...code.matchAll(/webSecurity\s*:\s*(\w+)/g)].map((entry) => entry[1]);
  const nodeIntegration = [...code.matchAll(/nodeIntegration\s*:\s*(\w+)/g)].map((entry) => entry[1]);
  info('BrowserWindow flags: webSecurity=[' + webSecurity.join(', ') + '] nodeIntegration=[' + nodeIntegration.join(', ') + ']');
  const windowCount = (code.match(/new BrowserWindow\(/g) || []).length;
  info('BrowserWindow instances: ' + windowCount);
  if (windowCount > webSecurity.filter((value) => value === 'false').length) {
    warn(
      'not every window sets webSecurity: false. ES module bundles served over file:// are blocked by CORS in windows that keep web security enabled.',
    );
  }
}

function inspectSource(title, source) {
  section(title + '  [' + source.kind + ']');
  info(source.root);
  const packageBuffer = source.read('package.json');
  if (packageBuffer) {
    try {
      const manifest = JSON.parse(packageBuffer.toString('utf8'));
      info('version ' + manifest.version + ', main = ' + manifest.main);
    } catch {
      warn('package.json could not be parsed');
    }
  }
  const bundled = source.list('src/renderer-dist');
  info('src/renderer-dist entries: ' + (bundled.length ? bundled.join(', ') : '(none)'));
  const assets = source.list('src/renderer-dist/assets');
  info('src/renderer-dist/assets entries: ' + assets.length);
  if (source.list('src/renderer').length > 0) {
    warn('src/renderer (uncompiled TSX sources) is present in this build; build.files should exclude it');
  }
  inspectMain(source);
  for (const windowName of WINDOWS) inspectHtml(source, windowName);
}

/* ------------------------------------------------------------- discovery -- */

function findInstallations(explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  const home = os.homedir();
  candidates.push(
    path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'Mechvibes'),
    path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'mechvibes'),
    'C:\\Program Files\\Mechvibes',
    'C:\\Program Files (x86)\\Mechvibes',
    path.join(repoRoot, 'dist', 'win-unpacked'),
    '/Applications/Mechvibes.app/Contents',
    '/opt/Mechvibes',
  );

  const found = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const asar = candidate.endsWith('.asar')
      ? candidate
      : [
          path.join(candidate, 'resources', 'app.asar'),
          path.join(candidate, 'Resources', 'app.asar'),
          path.join(candidate, 'app.asar'),
        ].find((option) => exists(option));
    if (asar && !found.includes(asar)) found.push(asar);
  }
  return found;
}

function tailLogs() {
  section('RUNTIME LOG');
  const roots = [
    path.join(process.env.APPDATA || '', 'mechvibes'),
    path.join(process.env.APPDATA || '', 'Mechvibes'),
    path.join(os.homedir(), 'Library', 'Logs', 'Mechvibes'),
    path.join(os.homedir(), '.config', 'mechvibes'),
  ];
  const logs = [];
  for (const root of roots) {
    for (const candidate of [root, path.join(root, 'logs')]) {
      let entries = [];
      try {
        entries = fs.readdirSync(candidate);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.endsWith('.log')) logs.push(path.join(candidate, entry));
      }
    }
  }
  if (logs.length === 0) {
    warn('no log file found — the app may never have started, or it stores logs elsewhere');
    return;
  }
  for (const log of logs) {
    const stats = exists(log);
    info(log + '  (' + human(stats.size) + ', modified ' + stats.mtime.toISOString() + ')');
    const lines = fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean);
    line('    --- last 60 lines ---');
    for (const entry of lines.slice(-60)) line('    | ' + entry);
    line('    --- end ---');
  }
}

/* ------------------------------------------------------------------ main -- */

section('MECHVIBES RENDER DIAGNOSTICS');
info(new Date().toISOString());
info('node ' + process.version + ' on ' + process.platform + ' ' + process.arch + ' (' + os.release() + ')');
info('repository root: ' + repoRoot);

if (exists(path.join(repoRoot, 'package.json'))) {
  inspectSource('WORKING TREE', fsSource(repoRoot));
} else {
  warn('working tree not found next to the script');
}

const installations = findInstallations(process.argv[2]);
if (installations.length === 0) {
  section('INSTALLED BUILD');
  warn('no app.asar found. Pass the installation directory explicitly: node tools/diagnose.mjs "C:\\Program Files\\Mechvibes"');
} else {
  for (const asar of installations) {
    try {
      inspectSource('INSTALLED BUILD', asarSource(asar));
    } catch (error) {
      section('INSTALLED BUILD');
      bad('could not read ' + asar + ': ' + error.message);
    }
  }
}

tailLogs();

section('RESULT');
info(failures + ' failure(s), ' + warnings + ' warning(s)');
if (failures === 0) {
  info('The asset chain is intact. If a window is still blank, capture the renderer console:');
  info('  1. focus the blank window and press Ctrl+Shift+I');
  info('  2. copy everything in the Console tab, red entries first');
}

const output = report.join('\n') + '\n';
const outputPath = path.join(process.cwd(), 'mechvibes-diagnostics.txt');
fs.writeFileSync(outputPath, output, 'utf8');
process.stdout.write(output);
process.stdout.write('\nReport written to ' + outputPath + '\n');
process.exit(failures > 0 ? 1 : 0);
