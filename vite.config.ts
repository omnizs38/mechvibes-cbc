import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const projectRoot = process.cwd();
const rendererRoot = path.resolve(projectRoot, 'src/renderer');

/**
 * Renderer build.
 *
 * Every Electron window is a separate HTML entry point. The bundles run with
 * `nodeIntegration: true`, so Node/Electron modules are pulled in at runtime
 * through `window.require` (see src/renderer/shared/electron.ts) instead of
 * being bundled by Rollup.
 */
export default defineConfig({
  root: rendererRoot,
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(projectRoot, 'src/renderer-dist'),
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: false,
    rollupOptions: {
      input: {
        app: path.resolve(rendererRoot, 'app.html'),
        editor: path.resolve(rendererRoot, 'editor.html'),
        debug: path.resolve(rendererRoot, 'debug.html'),
        install: path.resolve(rendererRoot, 'install.html'),
      },
    },
  },
});
