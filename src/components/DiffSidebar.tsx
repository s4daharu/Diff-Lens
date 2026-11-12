import { useEffect, useRef } from 'react';
import type { DiffOptions, DiffStats, RowKind } from '../lib/types';
import { Checkbox, Select } from './OptionControls';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  SlidersIcon,
} from './Icons';

export type ChangeKind = Exclude<RowKind, 'equal' | 'gap'>;

export interface ChangeEntry {
  rowIndex: number;
  kind: ChangeKind;
  oldNum: number | null;
  newNum: number | null;
}

interface DiffSidebarProps {
  stats: DiffStats | null;
  identical: boolean;
  timeMs?: number;
  totalChanges: number;
  currentChangeIndex: number | null;
  onNextChange: () => void;
  onPrevChange: () => void;
  changes: ChangeEntry[];
  hiddenChanges: number;
  activeChangeRowIndex: number | null;
  onSelectChange: (rowIndex: number) => void;
  options: DiffOptions;
  onOptionsChange: (next: DiffOptions) => void;
  syntaxEnabled: boolean;
  onSyntaxChange: (enabled: boolean) => void;
}

const KIND_LABELS: Record<ChangeKind, string> = {
  added: 'Added',
  deleted: 'Removed',
  modified: 'Modified',
};

function formatLocation(entry: ChangeEntry): string {
  const fmt = (n: number | null) => (n == null ? '?' : `L${n}`);
  if (entry.kind === 'modified') return `${fmt(entry.oldNum)} → ${fmt(entry.newNum)}`;
  if (entry.kind === 'deleted') return fmt(entry.oldNum);
  return fmt(entry.newNum);
}

export function DiffSidebar({
  stats,
  identical,
  timeMs,
  totalChanges,
  currentChangeIndex,
  onNextChange,
  onPrevChange,
  changes,
  hiddenChanges,
  activeChangeRowIndex,
  onSelectChange,
  options,
  onOptionsChange,
  syntaxEnabled,
  onSyntaxChange,
}: DiffSidebarProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeChangeRowIndex == null || !listRef.current) return;
    const el = listRef.current.querySelector('.change-item--active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeChangeRowIndex]);

  const totalDiffLines = stats
    ? stats.added + stats.removed + stats.changed
    : 0;
  const pct = (n: number) =>
    totalDiffLines > 0 ? (n / totalDiffLines) * 100 : 0;

  return (
    <aside className="diff-sidebar" aria-label="Diff summary and options">
      {identical && stats && (
        <div className="sidebar-section">
          <div className="sidebar-identical">
            <CheckIcon size={16} />
            <p>
              <span className="sidebar-identical-msg">
                No differences found — the texts are identical.
              </span>
              <span className="sidebar-identical__meta">
                {stats.oldLines} lines · {stats.unchanged} unchanged
                {timeMs != null && ` · ${Math.round(timeMs)} ms`}
              </span>
            </p>
          </div>
        </div>
      )}

      {!identical && stats && (
        <>
          <div className="sidebar-section">
            <h3 className="sidebar-heading">Overview</h3>
            <div className="sidebar-stats">
              <span
                className="pill pill--added"
                title="Lines present only in the changed text"
              >
                <span className="pill__side">
                  <span className="pill__dot" /> Added
                </span>
                <span className="pill__count">{stats.added}</span>
              </span>
              <span
                className="pill pill--removed"
                title="Lines present only in the original text"
              >
                <span className="pill__side">
                  <span className="pill__dot" /> Removed
                </span>
                <span className="pill__count">{stats.removed}</span>
              </span>
              <span
                className="pill pill--changed"
                title="Lines modified in place"
              >
                <span className="pill__side">
                  <span className="pill__dot" /> Changed
                </span>
                <span className="pill__count">{stats.changed}</span>
              </span>
              <span
                className="pill pill--unchanged"
                title="Lines that are the same in both texts"
              >
                <span className="pill__side">
                  <span className="pill__dot" /> Unchanged
                </span>
                <span className="pill__count">{stats.unchanged}</span>
              </span>
            </div>

            {totalDiffLines > 0 && (
              <div
                className="diff-meter diff-meter--block"
                title={`Differences: ${stats.added} added, ${stats.removed} removed, ${stats.changed} changed`}
                aria-hidden="true"
              >
                {stats.added > 0 && (
                  <div
                    className="diff-meter__segment diff-meter__segment--add"
                    style={{ width: `${pct(stats.added)}%` }}
                  />
                )}
                {stats.removed > 0 && (
                  <div
                    className="diff-meter__segment diff-meter__segment--del"
                    style={{ width: `${pct(stats.removed)}%` }}
                  />
                )}
                {stats.changed > 0 && (
                  <div
                    className="diff-meter__segment diff-meter__segment--mod"
                    style={{ width: `${pct(stats.changed)}%` }}
                  />
                )}
              </div>
            )}

            <span className="sidebar-sizes">
              {stats.oldLines} → {stats.newLines} lines
              {timeMs != null && ` · computed in ${Math.round(timeMs)} ms`}
            </span>
          </div>

          {totalChanges > 0 && (
            <div className="sidebar-section">
              <h3 className="sidebar-heading">Navigation</h3>
              <div
                className="diff-nav-group"
                role="group"
                aria-label="Change navigation"
              >
                <span className="diff-nav-label">
                  {currentChangeIndex != null
                    ? `${currentChangeIndex + 1} of ${totalChanges}`
                    : `${totalChanges} ${totalChanges === 1 ? 'change' : 'changes'}`}
                </span>
                <button
                  type="button"
                  className="btn btn--small btn--icon"
                  onClick={onPrevChange}
                  title="Previous difference (Alt+P or Alt+Up)"
                  aria-label="Previous difference"
                >
                  <ChevronUpIcon size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn--small btn--icon"
                  onClick={onNextChange}
                  title="Next difference (Alt+N or Alt+Down)"
                  aria-label="Next difference"
                >
                  <ChevronDownIcon size={14} />
                </button>
              </div>

              {changes.length > 0 && (
                <div className="changes-list" ref={listRef}>
                  {changes.map((entry, i) => (
                    <button
                      key={entry.rowIndex}
                      type="button"
                      data-row-index={entry.rowIndex}
                      className={`change-item change-item--${entry.kind}${
                        activeChangeRowIndex === entry.rowIndex
                          ? ' change-item--active'
                          : ''
                      }`}
                      onClick={() => onSelectChange(entry.rowIndex)}
                      title={`Jump to ${KIND_LABELS[entry.kind].toLowerCase()} line`}
                    >
                      <span className="change-item__idx">#{i + 1}</span>
                      <span className="change-item__loc">
                        {formatLocation(entry)}
                      </span>
                      <span className="change-item__kind">
                        {KIND_LABELS[entry.kind]}
                      </span>
                    </button>
                  ))}
                  {hiddenChanges > 0 && (
                    <span className="changes-more">
                      +{hiddenChanges.toLocaleString()} more not listed
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {!stats && (
        <div className="sidebar-section">
          <span className="sidebar-sizes">Computing differences…</span>
        </div>
      )}

      <details className="sidebar-options">
        <summary>
          <SlidersIcon size={14} />
          Diff options
        </summary>
        <div className="sidebar-options__body">
          <Checkbox
            label="Ignore case"
            checked={options.ignoreCase}
            onChange={(ignoreCase) =>
              onOptionsChange({ ...options, ignoreCase })
            }
          />
          <Checkbox
            label="Hide whitespace changes"
            checked={options.ignoreWhitespace}
            onChange={(ignoreWhitespace) =>
              onOptionsChange({ ...options, ignoreWhitespace })
            }
          />
          <Checkbox
            label="Ignore line-ending style"
            checked={options.ignoreLineEndings}
            onChange={(ignoreLineEndings) =>
              onOptionsChange({ ...options, ignoreLineEndings })
            }
          />
          <Select
            ariaLabel="Context lines"
            value={String(options.context)}
            onChange={(value) =>
              onOptionsChange({
                ...options,
                context: value === 'all' ? 'all' : Number(value),
              })
            }
            options={[
              { value: 'all', label: 'Show all unchanged lines' },
              { value: '0', label: 'Hide unchanged lines' },
              { value: '3', label: 'Show 3 context lines' },
              { value: '5', label: 'Show 5 context lines' },
              { value: '10', label: 'Show 10 context lines' },
            ]}
          />
          <Select
            ariaLabel="Granularity"
            value={options.granularity}
            onChange={(value) =>
              onOptionsChange({
                ...options,
                granularity:
                  value === 'words' ? ('words' as const) : ('chars' as const),
              })
            }
            options={[
              { value: 'chars', label: 'Char level' },
              { value: 'words', label: 'Word level' },
            ]}
          />
          <Checkbox
            label="Syntax highlighting"
            checked={syntaxEnabled}
            onChange={onSyntaxChange}
          />
        </div>
      </details>
    </aside>
  );
}
