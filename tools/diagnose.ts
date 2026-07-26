#!/usr/bin/env node
/**
 * Mechvibes renderer diagnostics - TypeScript 7
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
 *   npx ts-node tools/diagnose.ts                 # working tree + auto-detected install
 *   npx ts-node tools/diagnose.ts "C:\\Program Files\\Mechvibes"
 *
 * The report is printed and written to mechvibes-diagnostics.txt.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface AsarArchive {
  kind: 'asar';
  root: string;
  header: Record<string, unknown>;
  baseOffset: number;
}

interface FileStats {
  size: number;
  mtime?: Date;
}

interface Source {
  kind: 'directory' | 'asar';
  root: string;
  read: (relativePath: string) => Buffer | null;
  stat: (relativePath: string) => FileStats | null;
  list: (relativePath: string) => string[];
}

interface AsarNode {
  files?: Record<string, AsarNode>;
  offset?: number | string;
  size?: number | string;
  unpacked?: boolean;
}

interface HtmlReference {
  kind: 'script' | 'link';
  href: string;
  tag: string;
}

const WINDOWS: string[] = ['app', 'install', 'debug', 'editor'];
const repoRoot: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const report: string[] = [];
let failures: number = 0;
let warnings: number = 0;

const line = (text: string = ''): void => report.push(text);
const section = (title: string): void => {
  line('');
  line('='.repeat(72));
  line(title);
  line('='.repeat(72));
};
const info = (text: string): void => line('    ' + text);
const ok = (text: string): void => line('  [ ok ] ' + text);
const warn = (text: string): void => {
  warnings += 1;
  line('  [warn] ' + text);
};
const bad = (text: string): void => {
  failures += 1;
  line('  [FAIL] ' + text);
};

const exists = (target: string): fs.Stats | null => {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
};

const human = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

/* ------------------------------------------------------------------ asar -- */

/** Minimal asar reader: header pickle, then raw reads at baseOffset + offset. */
function openAsar(asarPath: string): AsarArchive {
  const fd: number = fs.openSync(asarPath, 'r');
  try {
    const head: Buffer = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerSize: number = head.readUInt32LE(4);
    const jsonLength: number = head.readUInt32LE(12);
    const jsonBuffer: Buffer = Buffer.alloc(jsonLength);
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

function asarNode(archive: AsarArchive, relativePath: string): AsarNode | null {
  const parts: string[] = relativePath.split(/[\\/]+/).filter(Boolean);
  let node: any = archive.header;
  for (const part of parts) {
    if (!node || !node.files || !node.files[part]) return null;
    node = node.files[part];
  }
  return node;
}

function asarRead(archive: AsarArchive, relativePath: string): Buffer | null {
  const node: AsarNode | null = asarNode(archive, relativePath);
  if (!node || node.files) return null;
  if (node.unpacked) {
    const unpacked: string = path.join(archive.root + '.unpacked', relativePath);
    return exists(unpacked) ? fs.readFileSync(unpacked) : null;
  }
  const fd: number = fs.openSync(archive.root, 'r');
  try {
    const buffer: Buffer = Buffer.alloc(Number(node.size));
    fs.readSync(fd, buffer, 0, buffer.length, archive.baseOffset + Number(node.offset));
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}

/* ---------------------------------------------------- filesystem/asar API -- */

/** Both sources expose the same three calls, so the checks stay identical. */
function fsSource(root: string): Source {
  return {
    kind: 'directory',
    root,
    read: (relativePath: string): Buffer | null => {
      const target: string = path.join(root, relativePath);
      return exists(target) ? fs.readFileSync(target) : null;
    },
    stat: (relativePath: string): FileStats | null => {
      const stats: fs.Stats | null = exists(path.join(root, relativePath));
      return stats ? { size: stats.size, mtime: stats.mtime } : null;
    },
    list: (relativePath: string): string[] => {
      try {
        return fs.readdirSync(path.join(root, relativePath));
      } catch {
        return [];
      }
    },
  };
}

function asarSource(asarPath: string): Source {
  const archive: AsarArchive = openAsar(asarPath);
  return {
    kind: 'asar',
    root: asarPath,
    read: (relativePath: string): Buffer | null => asarRead(archive, relativePath),
    stat: (relativePath: string): FileStats | null => {
      const node: AsarNode | null = asarNode(archive, relativePath);
      return node && !node.files ? { size: Number(node.size) } : null;
    },
    list: (relativePath: string): string[] => {
      const node: AsarNode | null = asarNode(archive, relativePath);
      return node && node.files ? Object.keys(node.files) : [];
    },
  };
}

/* ---------------------------------------------------------------- checks -- */

function inspectHtml(source: Source, windowName: string): void {
  const relativePath: string = 'src/renderer-dist/' + windowName + '.html';
  const buffer: Buffer | null = source.read(relativePath);
  if (!buffer) {
    bad(relativePath + ' is missing — the renderer bundle was never built or was excluded from the package');
    return;
  }
  const html: string = buffer.toString('utf8');
  ok(relativePath + ' (' + human(buffer.length) + ')');

  const cspMatch: RegExpMatchArray | null = html.match(/<meta[^>]*Content-Security-Policy[\s\S]*?content="([^"]*)"/i);
  if (!cspMatch) {
    info('no Content-Security-Policy meta tag');
  } else {
    const csp: string = cspMatch[1].replace(/\s+/g, ' ').trim();
    info('CSP: ' + csp);
    const scriptSrc: RegExpMatchArray | null = csp.match(/script-src([^;]*)/i);
    const directive: string | null = scriptSrc ? scriptSrc[1] : null;
    if (directive && !/\bfile:/.test(directive)) {
      bad(
        windowName +
          ".html: script-src does not allow the file: scheme. The page is loaded from disk, so its origin is opaque, 'self' matches nothing and Chromium refuses the bundle — this is what makes the window blank.",
      );
    } else if (directive) {
      ok(windowName + '.html: script-src allows file:');
    }
  }

  const references: HtmlReference[] = [];
  const scriptPattern: RegExp = /<script[^>]*\ssrc="([^"]+)"[^>]*>/gi;
  const linkPattern: RegExp = /<link[^>]*\shref="([^"]+)"[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptPattern.exec(html))) references.push({ kind: 'script', href: match[1], tag: match[0] });
  while ((match = linkPattern.exec(html))) references.push({ kind: 'link', href: match[1], tag: match[0] });

  for (const reference of references) {
    if (/^(https?:|data:|blob:)/i.test(reference.href)) {
      info('remote reference, not checked: ' + reference.href);
      continue;
    }
    const resolved: string = path
      .join('src/renderer-dist', path.dirname(windowName + '.html'), reference.href)
      .replace(/\\/g, '/');
    const stats: FileStats | null = source.stat(resolved);
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

function inspectMain(source: Source): void {
  const buffer: Buffer | null = source.read('src/main.js');
  if (!buffer) {
    bad('src/main.js is missing — the main process was not compiled (npm run build:main)');
    return;
  }
  ok('src/main.js (' + human(buffer.length) + ')');
  const code: string = buffer.toString('utf8');

  const loads: string[] = [...code.matchAll(/loadFile\(\s*['"]([^'"]+)['"]/g)].map((entry): string => entry[1]);
  if (loads.length === 0) {
    warn('no loadFile() call found in the compiled main process');
  }
  for (const target of loads) {
    const normalized: string = target.replace(/^\.\//, '');
    const stats: FileStats | null = source.stat(normalized);
    if (stats) {
      ok('loadFile(' + target + ') resolves (' + human(stats.size) + ')');
    } else {
      bad('loadFile(' + target + ') points at a file that is not in this build');
    }
  }

  const webSecurity: string[] = [...code.matchAll(/webSecurity\s*:\s*(\w+)/g)].map((entry): string => entry[1]);
  const nodeIntegration: string[] = [...code.matchAll(/nodeIntegration\s*:\s*(\w+)/g)].map((entry): string => entry[1]);
  info('BrowserWindow flags: webSecurity=[' + webSecurity.join(', ') + '] nodeIntegration=[' + nodeIntegration.join(', ') + ']');

  // tsc emits `new electron_1.BrowserWindow(...)`, so the namespace has to be optional.
  const windowCount: number = (code.match(/new\s+(?:[A-Za-z_$][\w$]*\.)*BrowserWindow\(/g) || []).length;
  const relaxed: number = webSecurity.filter((value): boolean => value === 'false').length;
  info('BrowserWindow instances: ' + windowCount + ' (web security disabled in ' + relaxed + ')');
  if (windowCount > relaxed) {
    warn(
      'not every window sets webSecurity: false. ES module bundles served over file:// are blocked by CORS in windows that keep web security enabled, so those windows stay blank even with a correct CSP.',
    );
  }
}

function inspectSource(title: string, source: Source): void {
  section(title + '  [' + source.kind + ']');
  info(source.root);
  const packageBuffer: Buffer | null = source.read('package.json');
  if (packageBuffer) {
    try {
      const manifest: any = JSON.parse(packageBuffer.toString('utf8'));
      info('version ' + manifest.version + ', main = ' + manifest.main);
    } catch {
      warn('package.json could not be parsed');
    }
  }
  const bundled: string[] = source.list('src/renderer-dist');
  info('src/renderer-dist entries: ' + (bundled.length ? bundled.join(', ') : '(none)'));
  const assets: string[] = source.list('src/renderer-dist/assets');
  info('src/renderer-dist/assets entries: ' + assets.length);
  if (source.kind === 'asar' && source.list('src/renderer').length > 0) {
    warn('src/renderer (uncompiled TSX sources) is packaged; build.files should exclude it');
  }
  inspectMain(source);
  for (const windowName of WINDOWS) inspectHtml(source, windowName);
}

/* ------------------------------------------------------------- discovery -- */

function findInstallations(explicit: string | undefined): string[] {
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  const home: string = os.homedir();
  candidates.push(
    path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'Mechvibes'),
    path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'mechvibes'),
    'C:\\Program Files\\Mechvibes',
    'C:\\Program Files (x86)\\Mechvibes',
    path.join(repoRoot, 'dist', 'win-unpacked'),
    '/Applications/Mechvibes.app/Contents',
    '/opt/Mechvibes',
  );

  const found: string[] = [];
  const seen: Set<string> = new Set();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const asar: string | undefined = candidate.endsWith('.asar')
      ? candidate
      : [
          path.join(candidate, 'resources', 'app.asar'),
          path.join(candidate, 'Resources', 'app.asar'),
          path.join(candidate, 'app.asar'),
        ].find((option): boolean => exists(option) !== null);
    if (!asar) continue;
    // Windows paths are case-insensitive, so the same install must not be reported twice.
    const key: string = process.platform === 'win32' ? asar.toLowerCase() : asar;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(asar);
  }
  return found;
}

function tailLogs(): void {
  section('RUNTIME LOG');
  const roots: string[] = [
    path.join(process.env.APPDATA || '', 'mechvibes'),
    path.join(process.env.APPDATA || '', 'Mechvibes'),
    path.join(os.homedir(), 'Library', 'Logs', 'Mechvibes'),
    path.join(os.homedir(), '.config', 'mechvibes'),
  ];
  const logs: string[] = [];
  const seen: Set<string> = new Set();
  for (const root of roots) {
    for (const candidate of [root, path.join(root, 'logs')]) {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(candidate);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.endsWith('.log')) continue;
        const target: string = path.join(candidate, entry);
        const key: string = process.platform === 'win32' ? target.toLowerCase() : target;
        if (seen.has(key)) continue;
        seen.add(key);
        logs.push(target);
      }
    }
  }
  if (logs.length === 0) {
    warn('no log file found — the app may never have started, or it stores logs elsewhere');
    return;
  }
  for (const log of logs) {
    const stats: fs.Stats | null = exists(log);
    if (!stats) continue;
    info(log + '  (' + human(stats.size) + ', modified ' + stats.mtime?.toISOString() + ')');
    const lines: string[] = fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean);
    line('    --- last 40 lines ---');
    for (const entry of lines.slice(-40)) line('    | ' + entry);
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

const installations: string[] = findInstallations(process.argv[2]);
if (installations.length === 0) {
  section('INSTALLED BUILD');
  warn('no app.asar found. Pass the installation directory explicitly: npx ts-node tools/diagnose.ts "C:\\Program Files\\Mechvibes"');
} else {
  for (const asar of installations) {
    try {
      inspectSource('INSTALLED BUILD', asarSource(asar));
    } catch (error) {
      section('INSTALLED BUILD');
      bad('could not read ' + asar + ': ' + (error instanceof Error ? error.message : String(error)));
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

const output: string = report.join('\n') + '\n';
const outputPath: string = path.join(process.cwd(), 'mechvibes-diagnostics.txt');
fs.writeFileSync(outputPath, output, 'utf8');
process.stdout.write(output);
process.stdout.write('\nReport written to ' + outputPath + '\n');
process.exit(failures > 0 ? 1 : 0);
