import { useState } from 'react';
import { CloseIcon, DownloadIcon } from './Icons';
import { TextDialog } from './TextDialog';

interface SessionNameModalProps {
  isOpen: boolean;
  initialName: string;
  onClose: () => void;
  onSave: (name: string) => void;
}

export function SessionNameModal({ isOpen, initialName, onClose, onSave }: SessionNameModalProps) {
  return isOpen ? <SessionNameForm initialName={initialName} onClose={onClose} onSave={onSave} /> : null;
}

function SessionNameForm({ initialName, onClose, onSave }: Omit<SessionNameModalProps, 'isOpen'>) {
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();

  return (
    <TextDialog labelId="session-name-title" descriptionId="session-name-description"
      className="text-confirm modal-card session-modal" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed) onSave(trimmed);
        }}
      >
        <header className="modal-header">
          <div className="modal-title">
            <DownloadIcon size={17} />
            <h3 id="session-name-title">Export comparison session</h3>
          </div>
          <button
            type="button"
            className="btn btn--small btn--icon btn--ghost"
            onClick={onClose}
            aria-label="Close session dialog"
          >
            <CloseIcon size={16} />
          </button>
        </header>
        <div className="modal-body session-modal__body">
          <label className="session-modal__label" htmlFor="session-name-input">
            Session name
          </label>
          <input
            data-dialog-focus
            onFocus={(event) => event.currentTarget.select()}
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
            Downloads both sources and your comparison settings as a portable
            .difflens.json file. This does not add it to Saved comparisons.
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
            Download session
          </button>
        </footer>
      </form>
    </TextDialog>
  );
}
