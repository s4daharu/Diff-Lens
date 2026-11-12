import { useEffect, useRef, useState } from 'react';
import { CloseIcon, DownloadIcon } from './Icons';

interface SessionNameModalProps {
  isOpen: boolean;
  initialName: string;
  onClose: () => void;
  onSave: (name: string) => void;
}

export function SessionNameModal({
  isOpen,
  initialName,
  onClose,
  onSave,
}: SessionNameModalProps) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(initialName);
    const previousFocus = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    inputRef.current?.select();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      } else {
        document
          .querySelector<HTMLButtonElement>('[data-export-toggle="true"]')
          ?.focus();
      }
    };
  }, [initialName, isOpen, onClose]);

  if (!isOpen) return null;

  const trimmed = name.trim();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal-card session-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-name-title"
        aria-describedby="session-name-description"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onSave(trimmed);
        }}
      >
        <header className="modal-header">
          <div className="modal-title">
            <DownloadIcon size={17} />
            <h3 id="session-name-title">Save comparison session</h3>
          </div>
          <button
            type="button"
            className="btn btn--small btn--icon btn--ghost"
            onClick={onClose}
            aria-label="Close save session dialog"
          >
            <CloseIcon size={16} />
          </button>
        </header>
        <div className="modal-body session-modal__body">
          <label className="session-modal__label" htmlFor="session-name-input">
            Session name
          </label>
          <input
            ref={inputRef}
            id="session-name-input"
            className="session-modal__input"
            type="text"
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. API migration review"
            autoComplete="off"
          />
          <p id="session-name-description" className="session-modal__hint">
            Saves both source texts, filenames, comparison options, and view
            preferences to a local .difflens.json file. Nothing is uploaded.
          </p>
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={!trimmed}
          >
            Save session
          </button>
        </footer>
      </form>
    </div>
  );
}
