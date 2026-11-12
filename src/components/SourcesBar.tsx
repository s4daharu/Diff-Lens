import { CheckIcon, PencilIcon, SwapIcon } from './Icons';
import { countLines } from '../lib/diffEngine';

interface SourcesBarProps {
  oldText: string;
  newText: string;
  oldName: string | null;
  newName: string | null;
  identical: boolean;
  editorOpen: boolean;
  onEdit: () => void;
  onSwap: () => void;
}

export function SourcesBar({
  oldText,
  newText,
  oldName,
  newName,
  identical,
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
          <span className="source-chip__name">{oldName ?? 'Pasted text'}</span>
          <span className="source-chip__meta">
            {oldLines.toLocaleString()} {oldLines === 1 ? 'line' : 'lines'}
          </span>
        </span>

        {identical ? (
          <span className="sources-bar__same" title="The two texts are identical">
            <CheckIcon size={14} /> Identical
          </span>
        ) : (
          <span className="sources-bar__arrow" aria-hidden="true">
            →
          </span>
        )}

        <span className="source-chip source-chip--new" title="Changed text source">
          <span className="source-chip__dot" />
          <span className="source-chip__name">{newName ?? 'Pasted text'}</span>
          <span className="source-chip__meta">
            {newLines.toLocaleString()} {newLines === 1 ? 'line' : 'lines'}
          </span>
        </span>
      </div>

      <div className="sources-bar__actions">
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
          aria-haspopup="dialog"
          aria-expanded={editorOpen}
          aria-controls="source-editor-dialog"
        >
          <PencilIcon size={14} />
          <span className="btn__label">Edit sources</span>
        </button>
      </div>
    </div>
  );
}
