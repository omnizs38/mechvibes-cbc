import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getGlobal, ipcRenderer, nodePath, nodeRequire, onIpc, requireFromSrc } from '../shared/electron';

const fs = nodeRequire('fs-extra');
const { listReferencedSoundFiles, validateSoundpackConfig } = requireFromSrc(
  'libs/soundpacks/validation',
);
const {
  MAX_FILE_BYTES,
  commitDirectoryReplacement,
  enforceDownloadSize,
  parseContentLength,
  readResponseBuffer,
  validateInstallationManifest,
} = requireFromSrc('utils/installer');

const BASE_URL = 'https://www.mechvibes.com/sound-packs';
const CUSTOM_PACKS_DIR = getGlobal<string>('custom_dir');
const REQUEST_TIMEOUT_MS = 20000;
const MANIFEST_MAX_BYTES = 1024 * 1024;
const PACK_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

const ERROR_TRANSLATION: Record<number, string> = {
  400: 'INVREQ',
  401: 'UNAUTH',
  402: 'PAYMENT',
  403: 'FORBID',
  404: 'NOTFOUND',
  405: 'BADMETH',
  418: 'TEAPOT',
  429: 'TOOFAST',
  451: 'DMCA',
  500: 'SERVERR',
  502: 'SERVBAD',
  503: 'SERVUNAV',
  504: 'SERVSLOW',
  521: 'SERVOFF',
  522: 'SERVSLOW',
  523: 'SERVOFF',
  524: 'SERVSLOW',
  525: 'SERVSSL',
  526: 'SERVSSL',
};

type InstallationManifest = {
  name: string;
  folder: string;
  files: string[];
};

type Phase = 'loading' | 'confirm' | 'installing' | 'done' | 'error';

function statusCode(response: Response): string {
  return ERROR_TRANSLATION[response.status] || `HTTP ${response.status}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function fetchWithTimeout<T>(url: string, consume: (response: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    return await consume(response);
  } finally {
    clearTimeout(timer);
  }
}

async function downloadFile(url: string, destination: string, currentTotal: number): Promise<number> {
  return fetchWithTimeout(url, async (response) => {
    if (!response.ok) {
      throw new Error(`Download failed (${statusCode(response)}).`);
    }

    const advertisedSize = parseContentLength(response);
    if (advertisedSize !== null) {
      enforceDownloadSize({ fileBytes: advertisedSize, totalBytes: currentTotal + advertisedSize });
    }
    const buffer = await readResponseBuffer(response, MAX_FILE_BYTES);
    enforceDownloadSize({ fileBytes: buffer.length, totalBytes: currentTotal + buffer.length });
    fs.ensureDirSync(nodePath.dirname(destination));
    fs.writeFileSync(destination, buffer, { flag: 'wx' });
    return buffer.length as number;
  });
}

function validateDownloadedPack(directory: string): void {
  const configPath = nodePath.join(directory, 'config.json');
  if (!fs.existsSync(configPath) || fs.statSync(configPath).size > MANIFEST_MAX_BYTES) {
    throw new Error('Downloaded soundpack has an invalid config.json.');
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  validateSoundpackConfig(config);
  for (const reference of listReferencedSoundFiles(config) as string[]) {
    const filePath = nodePath.join(directory, ...reference.split('/'));
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Downloaded soundpack is missing ${reference}.`);
    }
  }
}

function commitInstallation(tempDirectory: string, folder: string): void {
  const installDirectory = nodePath.join(CUSTOM_PACKS_DIR, folder);
  commitDirectoryReplacement(fs, {
    tempDirectory,
    installDirectory,
    backupDirectory: `${installDirectory}.backup-${Date.now()}`,
  });
}

export function InstallApp() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [manifest, setManifest] = useState<InstallationManifest | null>(null);
  const [statusText, setStatusText] = useState('Fetching soundpack details\u2026');
  const [error, setError] = useState('');
  const [percent, setPercent] = useState(0);
  const packUrlRef = useRef<string | null>(null);

  // The installer window resizes itself to fit its content.
  useLayoutEffect(() => {
    const timer = setTimeout(() => {
      const height = document.scrollingElement?.scrollHeight ?? 0;
      ipcRenderer.send('resize-installer', height);
    }, 5);
    return () => clearTimeout(timer);
  }, [phase, manifest, statusText, error, percent]);

  useEffect(
    () =>
      onIpc<[string]>('install-pack', (packId) => {
        void (async () => {
          try {
            if (typeof packId !== 'string' || !PACK_ID_PATTERN.test(packId)) {
              throw new Error('Invalid soundpack identifier.');
            }
            const packUrl = `${BASE_URL}/${encodeURIComponent(packId)}/dist`;
            packUrlRef.current = packUrl;

            const manifestBuffer = await fetchWithTimeout(`${packUrl}/install.json`, async (response) => {
              if (!response.ok) {
                throw new Error(`Manifest request failed (${statusCode(response)}).`);
              }
              return readResponseBuffer(response, MANIFEST_MAX_BYTES);
            });

            const parsed = validateInstallationManifest(
              JSON.parse(manifestBuffer.toString('utf8')),
            ) as InstallationManifest;
            setManifest(parsed);
            setPhase('confirm');
          } catch (caught) {
            setManifest(null);
            setError(message(caught));
            setPhase('error');
          }
        })();
      }),
    [],
  );

  const install = useCallback(async () => {
    const packUrl = packUrlRef.current;
    if (!manifest || !packUrl) return;

    setPhase('installing');
    setError('');
    setPercent(0);

    const tempDirectory = nodePath.join(
      CUSTOM_PACKS_DIR,
      `.install-${manifest.folder}-${Date.now()}`,
    );
    let totalBytes = 0;

    try {
      fs.ensureDirSync(tempDirectory);
      for (let index = 0; index < manifest.files.length; index += 1) {
        const file = manifest.files[index] as string;
        setStatusText(`Downloading ${file}\u2026`);
        const destination = nodePath.join(tempDirectory, ...file.split('/'));
        const fileUrl = `${packUrl}/${file.split('/').map(encodeURIComponent).join('/')}`;
        totalBytes += await downloadFile(fileUrl, destination, totalBytes);
        setPercent(((index + 1) / manifest.files.length) * 100);
      }

      setStatusText('Validating soundpack\u2026');
      validateDownloadedPack(tempDirectory);
      commitInstallation(tempDirectory, manifest.folder);
      setStatusText('Installed.');
      setPhase('done');
      ipcRenderer.send('installed', manifest.folder);
    } catch (caught) {
      fs.removeSync(tempDirectory);
      setError(message(caught));
      setPhase('confirm');
    }
  }, [manifest]);

  return (
    <div className="installer">
      <header className="installer-head">
        <span className="installer-kicker">Mechvibes</span>
        <h1 className="installer-title">
          {phase === 'error' ? 'Installation failed' : 'Install soundpack'}
        </h1>
      </header>

      {manifest ? (
        <div className="card">
          <span className="card-title">Soundpack</span>
          <p className="installer-pack-name">{manifest.name}</p>
          <span className="hint">
            {manifest.files.length} file{manifest.files.length === 1 ? '' : 's'} will be downloaded
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="banner" data-state="error" role="alert">
          Error: {error}
        </div>
      ) : null}

      {phase === 'loading' ? <p className="hint">{statusText}</p> : null}

      {phase === 'confirm' && manifest ? (
        <>
          <p className="installer-question">Do you want to install this soundpack?</p>
          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={() => void install()}>
              Install
            </button>
            <button type="button" className="btn" onClick={() => window.close()}>
              Cancel
            </button>
          </div>
        </>
      ) : null}

      {phase === 'installing' || phase === 'done' ? (
        <div className="stack-2">
          <p className="hint">{statusText}</p>
          <div
            className="progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
          >
            <div className="progress-bar" style={{ width: `${percent}%` }} />
          </div>
        </div>
      ) : null}

      {phase === 'done' ? (
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => window.close()}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
