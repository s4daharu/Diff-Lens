import { CheckIcon, PencilIcon, SwapIcon } from './Icons';
import { countLines } from '../lib/diffEngine';

interface SourcesBarProps {
  oldText: string;
  newText: string;
  oldName: string | null;
  newName: string | null;
  equalityLabel: string | null;
  saveStatus: 'unsaved' | 'saving' | 'saved' | 'checking';
  onSave: () => void;
  sessionName: string | null;
  editorOpen: boolean;
  onEdit: () => void;
  onSwap: () => void;
}

export function SourcesBar({
  oldText,
  newText,
  oldName,
  newName,
  equalityLabel,
  saveStatus,
  onSave,
  sessionName,
  editorOpen,
  onEdit,
  onSwap,
}: SourcesBarProps) {
  const oldLines = countLines(oldText);
  const newLines = countLines(newText);

  return (
    <div className="sources-bar">
      <div className="sources-bar__files">
        <span className="source-chip source-chip--old" title="Original text source">
          <span className="source-chip__dot" />
          <span className="source-chip__name">{oldName ?? 'Original'}</span>
          <span className="source-chip__meta">
            {oldLines.toLocaleString()} {oldLines === 1 ? 'line' : 'lines'}
          </span>
        </span>

        <span className="sources-bar__arrow" aria-hidden="true">→</span>

        <span className="source-chip source-chip--new" title="Changed text source">
          <span className="source-chip__dot" />
          <span className="source-chip__name">{newName ?? 'Changed'}</span>
          <span className="source-chip__meta">
            {newLines.toLocaleString()} {newLines === 1 ? 'line' : 'lines'}
          </span>
        </span>
      </div>

      <div className="sources-bar__actions">
        <div className="sources-save">
          <span className="sources-session-name" title={sessionName ?? undefined}>
            <strong>{sessionName ?? 'Untitled comparison'}</strong>
          </span>
          <span className="sources-save__status" data-save-status={saveStatus} role="status">
            {saveStatus === 'saved' ? 'Saved locally' : saveStatus === 'saving' ? 'Saving…'
              : saveStatus === 'checking' ? 'Checking save…' : 'Unsaved'}
          </span>
          <button type="button" className="btn btn--small" disabled={saveStatus !== 'unsaved'}
            aria-label="Save comparison locally" onClick={onSave}>Save</button>
        </div>
        <button
          type="button"
          className="btn btn--small btn--icon btn--ghost"
          onClick={onSwap}
          title="Swap original and changed text"
          aria-label="Swap texts"
        >
          <SwapIcon size={15} />
        </button>
        <button
          type="button"
          className="btn btn--small"
          onClick={onEdit}
          title="Edit original and changed text (Ctrl+E)"
          aria-expanded={editorOpen}
          aria-controls={editorOpen ? 'source-editor' : undefined}
          data-edit-sources
        >
          <PencilIcon size={14} />
          <span>Edit sources</span>
        </button>
      </div>
      {equalityLabel && <span className="sources-bar__same" role="status">
        <CheckIcon size={14} /> {equalityLabel}
      </span>}
    </div>
  );
}
