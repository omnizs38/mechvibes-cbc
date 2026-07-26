import { useCallback, useMemo, useRef, useState } from 'react';
import { openExternal } from '../shared/electron';
import { Keyboard } from './Keyboard';
import { ManualList } from './ManualList';
import {
  createPack,
  emptyDefines,
  fromV4Config,
  fs,
  toV4Config,
  type AuthoringMode,
  type EditMode,
  type PackData,
  type SoundDefinition,
} from './packData';

const HOW_TO_URL = 'https://mechvibes.com/say-hi-to-mechvibes-editor/';

export function EditorApp() {
  const [pack, setPack] = useState<PackData>(createPack);
  const [editMode, setEditMode] = useState<EditMode>('visual');
  const [selectedKeycode, setSelectedKeycode] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const exportable = useMemo(() => toV4Config(pack), [pack]);
  const resultJson = useMemo(() => JSON.stringify(exportable, null, 2), [exportable]);

  const saveDefinition = useCallback((keycode: string, value: SoundDefinition) => {
    setPack((previous) => ({
      ...previous,
      defines: { ...previous.defines, [keycode]: value },
    }));
    setSelectedKeycode(null);
  }, []);

  const changeMode = useCallback((mode: AuthoringMode) => {
    // Switching the authoring style invalidates every existing mapping.
    setPack((previous) => ({
      ...previous,
      mode,
      defines: emptyDefines(),
    }));
    setSelectedKeycode(null);
  }, []);

  const newPack = useCallback(() => {
    setPack(createPack());
    setSelectedKeycode(null);
    setNotice('Started a new soundpack.');
  }, []);

  const importPack = useCallback((file: File) => {
    try {
      const filePath = (file as File & { path?: string }).path;
      const raw = filePath ? fs.readFileSync(filePath, 'utf8') : null;
      if (raw === null) {
        throw new Error('Cannot read the selected file.');
      }
      setPack(fromV4Config(JSON.parse(raw)));
      setSelectedKeycode(null);
      setNotice(`Imported ${file.name}.`);
    } catch (error) {
      setNotice(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  const exportPack = useCallback(() => {
    const blob = new Blob([JSON.stringify(exportable, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'config.json';
    link.click();
    URL.revokeObjectURL(link.href);
    setNotice('Exported config.json.');
  }, [exportable]);

  return (
    <div className="editor">
      <header className="editor-header">
        <div className="editor-heading">
          <span className="editor-title">Soundpack editor</span>
          <span className="editor-subtitle">
            Create, edit and share your soundpack.{' '}
            <a
              href={HOW_TO_URL}
              onClick={(event) => {
                event.preventDefault();
                openExternal(HOW_TO_URL);
              }}
            >
              How to?
            </a>
          </span>
        </div>
        <div className="btn-row">
          <button type="button" className="btn" onClick={newPack}>
            New
          </button>
          <button type="button" className="btn" onClick={() => importInputRef.current?.click()}>
            Import
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) importPack(file);
              event.target.value = '';
            }}
          />
          <button type="button" className="btn btn-primary" onClick={exportPack}>
            Export
          </button>
        </div>
      </header>

      {notice ? <div className="banner">{notice}</div> : null}

      <section className="card">
        <div className="editor-grid">
          <div className="field">
            <div className="field-label">
              <label htmlFor="pack-name">Pack name</label>
            </div>
            <input
              id="pack-name"
              className="input"
              type="text"
              placeholder="Pack name…"
              value={pack.name}
              onChange={(event) =>
                setPack((previous) => ({ ...previous, name: event.target.value }))
              }
              onBlur={(event) => {
                if (!event.target.value) setPack((previous) => ({ ...previous, name: 'Untitled' }));
              }}
            />
          </div>

          <div className="field">
            <div className="field-label">
              <label htmlFor="edit-mode">Edit mode</label>
            </div>
            <select
              id="edit-mode"
              className="input"
              value={editMode}
              onChange={(event) => setEditMode(event.target.value as EditMode)}
            >
              <option value="visual">Visual (select on keyboard)</option>
              <option value="manual">Manual (edit on key list)</option>
            </select>
          </div>

          <div className="field">
            <div className="field-label">
              <label htmlFor="authoring-mode">Key define mode</label>
            </div>
            <select
              id="authoring-mode"
              className="input"
              value={pack.mode}
              onChange={(event) => changeMode(event.target.value as AuthoringMode)}
            >
              <option value="sprite">Single file (start and length)</option>
              <option value="files">Multiple files (one file per key)</option>
            </select>
          </div>

          {pack.mode === 'sprite' ? (
            <div className="field">
              <div className="field-label">
                <label htmlFor="single-sound-file">Sound file</label>
              </div>
              <input
                id="single-sound-file"
                className="input"
                type="text"
                placeholder="Sound file name…"
                value={pack.sound}
                onChange={(event) =>
                  setPack((previous) => ({ ...previous, sound: event.target.value }))
                }
                onBlur={(event) => {
                  if (!event.target.value) {
                    setPack((previous) => ({ ...previous, sound: 'sound.ogg' }));
                  }
                }}
              />
            </div>
          ) : null}
        </div>
      </section>

      {editMode === 'visual' ? (
        <Keyboard
          pack={pack}
          selectedKeycode={selectedKeycode}
          onSelect={setSelectedKeycode}
          onSave={saveDefinition}
        />
      ) : (
        <ManualList pack={pack} onSave={saveDefinition} />
      )}

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">config.json preview</h2>
        </div>
        <pre className="result-json">{resultJson}</pre>
      </section>
    </div>
  );
}
