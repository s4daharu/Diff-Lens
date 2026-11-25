import { useEffect, useRef, useState } from 'react';
import type { SavedComparison } from '../lib/savedComparisons';
import { CloseIcon } from './Icons';

interface Props {
  entries: SavedComparison[];
  loadError: string | null;
  activeId: string | null;
  canSave: boolean;
  initialName: string;
  onClose: () => void;
  onCreate: (name: string, autosave: boolean) => Promise<void>;
  onOpen: (entry: SavedComparison) => Promise<void>;
  onRename: (entry: SavedComparison, name: string) => Promise<void>;
  onDelete: (entry: SavedComparison) => Promise<void>;
  onSave: (entry: SavedComparison) => Promise<void>;
  onAutosave: (entry: SavedComparison, enabled: boolean) => Promise<void>;
}

export function SavedComparisonsDialog({
  entries, loadError, activeId, canSave, initialName, onClose,
  onCreate, onOpen, onRename, onDelete, onSave, onAutosave,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [name, setName] = useState(initialName);
  const [autosave, setAutosave] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pendingAutosave, setPendingAutosave] = useState<{ id: string; enabled: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    titleRef.current?.focus();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not access saved comparisons.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className="modal-card saved-dialog"
      aria-labelledby="saved-comparisons-title" onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}>
      <header className="modal-header">
        <h3 id="saved-comparisons-title" tabIndex={-1} ref={titleRef}>Saved comparisons</h3>
        <button type="button" className="btn btn--small btn--icon btn--ghost"
          onClick={onClose} disabled={busy} aria-label="Close saved comparisons">
          <CloseIcon size={16} />
        </button>
      </header>
      <div className="modal-body saved-dialog__body">
        <p className="session-modal__hint">
          Comparisons are stored in this browser, not uploaded. Export a session file to keep a backup.
        </p>
        {error && <p role="alert" className="notice">{error}</p>}
        {loadError && <p role="alert" className="notice">{loadError}</p>}
        {canSave && (
          <form className="saved-form" onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            void run(async () => {
              await onCreate(name, autosave);
              setAutosave(false);
            });
          }}>
            <label>
              New comparison name
              <input className="session-modal__input" value={name} maxLength={120}
                onChange={(event) => setName(event.target.value)} required />
            </label>
            <label className="saved-checkbox">
              <input type="checkbox" checked={autosave}
                onChange={(event) => setAutosave(event.target.checked)} />
              Automatically save edits
            </label>
            <button type="submit" className="btn btn--primary" disabled={busy || !name.trim()}>
              Save as new comparison
            </button>
          </form>
        )}
        {entries.length === 0 && <p className="session-modal__hint">No comparisons saved yet.</p>}
        <ul className="saved-list">
          {entries.map((entry) => {
            const autosaveEnabled = pendingAutosave?.id === entry.id ? pendingAutosave.enabled : entry.autosave;
            return (
            <li key={entry.id} className="saved-entry">
              <div className="saved-entry__heading">
                <strong>{entry.name}</strong>
                <time dateTime={entry.savedAt}>{new Date(entry.savedAt).toLocaleString()}</time>
                {activeId === entry.id && <span>Current</span>}
                {autosaveEnabled && <span>Autosave on</span>}
              </div>
              {editing?.id === entry.id ? (
                <form className="saved-row-actions" onSubmit={(event) => {
                  event.preventDefault();
                  const next = editing.name.trim();
                  if (next) void run(async () => {
                    await onRename(entry, next);
                    setEditing(null);
                  });
                }}>
                  <input className="session-modal__input" aria-label="Rename comparison"
                    value={editing.name} maxLength={120} autoFocus
                    onChange={(event) => setEditing({ id: entry.id, name: event.target.value })} />
                  <button className="btn btn--small" disabled={busy || !editing.name.trim()}>Save name</button>
                  <button type="button" className="btn btn--small" disabled={busy}
                    onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : confirmDelete === entry.id ? (
                <div className="saved-row-actions">
                  <span>Delete from this browser?</span>
                  <button type="button" className="btn btn--small" disabled={busy}
                    onClick={() => { void run(() => onDelete(entry)); }}>Confirm delete</button>
                  <button type="button" className="btn btn--small" disabled={busy}
                    onClick={() => setConfirmDelete(null)}>Cancel</button>
                </div>
              ) : (
                <div className="saved-row-actions">
                  <button type="button" className="btn btn--small" disabled={busy}
                    aria-label={`Open ${entry.name}`} onClick={() => { void run(() => onOpen(entry)); }}>
                    Open
                  </button>
                  {activeId === entry.id && canSave && (
                    <button type="button" className="btn btn--small" disabled={busy}
                      onClick={() => { void run(() => onSave(entry)); }}>Save changes</button>
                  )}
                  <button type="button" className="btn btn--small" disabled={busy}
                    onClick={() => setEditing({ id: entry.id, name: entry.name })}>Rename</button>
                  <button type="button" className="btn btn--small" disabled={busy}
                    onClick={() => setConfirmDelete(entry.id)}>Delete</button>
                  <label className="saved-checkbox">
                    <input type="checkbox" checked={autosaveEnabled} disabled={busy}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setPendingAutosave({ id: entry.id, enabled });
                        void run(async () => {
                          try {
                            await onAutosave(entry, enabled);
                          } finally {
                            setPendingAutosave(null);
                          }
                        });
                      }} />
                    Autosave edits
                  </label>
                </div>
              )}
            </li>
            );
          })}
        </ul>
      </div>
    </dialog>
  );
}
