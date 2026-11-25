import type { ChangeSection } from '../lib/changeSections';
import type { MergeDirection } from '../lib/mergeSections';

function rangeLabel(entry: ChangeSection, side: 'old' | 'new'): string {
  const start = side === 'old' ? entry.oldStartLine : entry.newStartLine;
  const end = side === 'old' ? entry.oldEndLine : entry.newEndLine;
  if (start === end) return start === 0 ? 'before line 1' : `after line ${start}`;
  return end === start + 1 ? `line ${start + 1}` : `lines ${start + 1} through ${end}`;
}

export function MergeButtons({
  entry,
  onMerge,
  compact = false,
  disabled = false,
}: {
  entry: ChangeSection;
  onMerge: (rowIndex: number, direction: MergeDirection) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const oldRange = rangeLabel(entry, 'old');
  const newRange = rangeLabel(entry, 'new');
  const moved = entry.moveId == null ? '' : ' moved pair';
  return (
    <div
      className={`merge-actions${compact ? ' merge-actions--compact' : ''}`}
      role="group"
      aria-label="Merge this change section"
    >
      <button
        type="button"
        className="merge-action-btn"
        disabled={disabled}
        onClick={() => onMerge(entry.rowIndex, 'changed-to-original')}
        title="Apply Changed → Original"
        aria-label={`Apply Changed ${newRange} to Original ${oldRange}${moved}`}
      >
        <span aria-hidden="true">←</span>
        {!compact && <span>Changed → Original</span>}
      </button>
      <button
        type="button"
        className="merge-action-btn"
        disabled={disabled}
        onClick={() => onMerge(entry.rowIndex, 'original-to-changed')}
        title="Apply Original → Changed"
        aria-label={`Apply Original ${oldRange} to Changed ${newRange}${moved}`}
      >
        {!compact && <span>Original → Changed</span>}
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}
