import fs from 'node:fs/promises';
import path from 'node:path';
import type { PackContext } from 'app-builder-lib/out/configuration';
import { prepareWindowsRuntime, runtimePin } from './prepare-windows-runtime';

/** Packaging must never silently consume stale/missing compiler output. */
export default async function beforePack(context: PackContext): Promise<void> {
  for (const file of [
    'main.js',
    'preload.js',
    ...['app', 'debug', 'editor', 'install'].map((name) => `renderer-dist/${name}.html`),
  ]) {
    await fs.access(path.join(context.packager.info.appDir, 'src', file));
  }
  if (context.electronPlatformName === 'win32') {
    await prepareWindowsRuntime();
    await fs.writeFile(
      path.join(context.packager.info.appDir, 'build', 'vendor', 'windows-runtime.nsh'),
      `!define MV_VC_VERSION "${runtimePin.version}"\n!define MV_VC_SHA256 "${runtimePin.sha256}"\n`,
    );
  }
}
