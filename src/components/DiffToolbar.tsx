import { useEffect, useRef, useState } from 'react';
import type { ViewMode } from '../lib/types';
import {
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  CheckIcon,
  FileCodeIcon,
  HashIcon,
  ListIcon,
  SearchIcon,
  SlidersIcon,
} from './Icons';

interface DiffToolbarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  wrap: boolean;
  onWrapChange: (wrap: boolean) => void;
  hideWhitespaceChanges: boolean;
  onHideWhitespaceChangesChange: (hidden: boolean) => void;
  hideUnchangedLines: boolean;
  onHideUnchangedLinesChange: (hidden: boolean) => void;
  lineNumbers: boolean;
  onLineNumbersChange: (show: boolean) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onCopyPatch: () => void;
  onDownloadPatch: () => void;
  onCopyMarkdown: () => void;
  onExportHtml: () => void;
  patchReady: boolean;
  copied: boolean;
  copiedMarkdown: boolean;
}

export function DiffToolbar({
  viewMode,
  onViewModeChange,
  wrap,
  onWrapChange,
  hideWhitespaceChanges,
  onHideWhitespaceChangesChange,
  hideUnchangedLines,
  onHideUnchangedLinesChange,
  lineNumbers,
  onLineNumbersChange,
  sidebarOpen,
  onToggleSidebar,
  searchOpen,
  onToggleSearch,
  searchQuery,
  onSearchChange,
  onCopyPatch,
  onDownloadPatch,
  onCopyMarkdown,
  onExportHtml,
  patchReady,
  copied,
  copiedMarkdown,
}: DiffToolbarProps) {
  const [openMenu, setOpenMenu] = useState<'view' | 'export' | null>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onClick = (e: MouseEvent) => {
      const activeRef = openMenu === 'view' ? viewMenuRef : exportMenuRef;
      if (activeRef.current && !activeRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  return (
    <>
      <div className="diff-toolbar">
        <div
          className="segmented"
          role="tablist"
          aria-label="View mode"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            onViewModeChange(
              viewMode === 'side-by-side' ? 'inline' : 'side-by-side',
            );
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'side-by-side'}
            className={`segmented__btn ${viewMode === 'side-by-side' ? 'segmented__btn--active' : ''}`}
            onClick={() => onViewModeChange('side-by-side')}
          >
            Side by side
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'inline'}
            className={`segmented__btn ${viewMode === 'inline' ? 'segmented__btn--active' : ''}`}
            onClick={() => onViewModeChange('inline')}
          >
            Inline
          </button>
        </div>

        <div className="dropdown-wrapper" ref={viewMenuRef}>
          <button
            type="button"
            className="btn btn--small"
            onClick={() =>
              setOpenMenu((menu) => (menu === 'view' ? null : 'view'))
            }
            title="Control how differences are displayed"
            aria-label="View options"
            aria-expanded={openMenu === 'view'}
            aria-haspopup="menu"
          >
            <SlidersIcon size={14} />
            <span className="btn__label">View</span>
          </button>

          {openMenu === 'view' && (
            <div
              className="dropdown-menu dropdown-menu--view"
              role="menu"
              aria-label="View options"
            >
              <button
                type="button"
                className="dropdown-item dropdown-item--checkable"
                role="menuitemcheckbox"
                aria-checked={hideWhitespaceChanges}
                onClick={() =>
                  onHideWhitespaceChangesChange(!hideWhitespaceChanges)
                }
                title="Ignore whitespace-only differences when comparing lines"
              >
                <span className="dropdown-item__check" aria-hidden="true">
                  {hideWhitespaceChanges && <CheckIcon size={13} />}
                </span>
                <span>Hide whitespace changes</span>
              </button>
              <button
                type="button"
                className="dropdown-item dropdown-item--checkable"
                role="menuitemcheckbox"
                aria-checked={hideUnchangedLines}
                onClick={() =>
                  onHideUnchangedLinesChange(!hideUnchangedLines)
                }
                title="Show only changed lines, with expandable hidden regions"
              >
                <span className="dropdown-item__check" aria-hidden="true">
                  {hideUnchangedLines && <CheckIcon size={13} />}
                </span>
                <span>Hide unchanged lines</span>
              </button>
              <button
                type="button"
                className="dropdown-item dropdown-item--checkable"
                role="menuitemcheckbox"
                aria-checked={!wrap}
                onClick={() => onWrapChange(!wrap)}
                title="Keep long lines on one row and scroll horizontally"
              >
                <span className="dropdown-item__check" aria-hidden="true">
                  {!wrap && <CheckIcon size={13} />}
                </span>
                <span>Disable line wrap</span>
              </button>
            </div>
          )}
        </div>

        <div className="diff-toolbar__group">
          <button
            type="button"
            className="btn btn--small btn--toggle"
            aria-pressed={sidebarOpen}
            aria-expanded={sidebarOpen}
            aria-controls="diff-sidebar"
            data-details-toggle="true"
            onClick={onToggleSidebar}
            title={sidebarOpen ? 'Hide diff details' : 'Show diff details'}
            aria-label="Diff details"
          >
            <ListIcon size={14} />
            <span className="btn__label">Details</span>
          </button>
          <button
            type="button"
            className="btn btn--small btn--toggle"
            aria-pressed={lineNumbers}
            onClick={() => onLineNumbersChange(!lineNumbers)}
            title="Show or hide line numbers"
            aria-label="Line numbers"
          >
            <HashIcon size={14} />
            <span className="btn__label">Numbers</span>
          </button>
          <button
            type="button"
            className={`btn btn--small ${searchOpen ? 'btn--primary' : ''}`}
            onClick={onToggleSearch}
            title="Search within diff (Ctrl+F)"
            aria-label="Find in diff"
          >
            <SearchIcon size={14} />
            <span className="btn__label">Find</span>
          </button>
        </div>

        <div className="diff-toolbar__spacer" />

        <div className="dropdown-wrapper" ref={exportMenuRef}>
          <button
            type="button"
            className="btn btn--small"
            onClick={() => setOpenMenu((menu) => (menu === 'export' ? null : 'export'))}
            title="Export the diff (patch, Markdown, HTML report)"
            aria-label="Export options"
            aria-expanded={openMenu === 'export'}
            aria-haspopup="menu"
          >
            <FileCodeIcon size={14} />
            <span className="btn__label">Export</span>
          </button>

          {openMenu === 'export' && (
            <div
              className="dropdown-menu dropdown-menu--right"
              role="menu"
              aria-label="Export options"
            >
              <button
                type="button"
                className="dropdown-item"
                role="menuitem"
                onClick={() => {
                  onCopyPatch();
                  setOpenMenu(null);
                }}
                disabled={!patchReady}
              >
                <CopyIcon size={14} />
                <span>{copied ? 'Copied!' : 'Copy patch'}</span>
              </button>
              <button
                type="button"
                className="dropdown-item"
                role="menuitem"
                onClick={() => {
                  onDownloadPatch();
                  setOpenMenu(null);
                }}
                disabled={!patchReady}
              >
                <DownloadIcon size={14} />
                <span>Download .patch</span>
              </button>
              <button
                type="button"
                className="dropdown-item"
                role="menuitem"
                onClick={() => {
                  onCopyMarkdown();
                  setOpenMenu(null);
                }}
              >
                <CopyIcon size={14} />
                <span>{copiedMarkdown ? 'Copied Markdown!' : 'Copy as Markdown'}</span>
              </button>
              <button
                type="button"
                className="dropdown-item"
                role="menuitem"
                onClick={() => {
                  onExportHtml();
                  setOpenMenu(null);
                }}
              >
                <DownloadIcon size={14} />
                <span>Download HTML Report</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {searchOpen && (
        <div className="diff-search-bar" role="search">
          <SearchIcon size={15} className="diff-search-icon" />
          <input
            type="text"
            className="diff-search-input"
            placeholder="Search text within differences..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search within diff"
            autoFocus
          />
          {searchQuery && (
            <button
              type="button"
              className="diff-search-clear"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
            >
              <CloseIcon size={13} />
            </button>
          )}
          <button
            type="button"
            className="btn btn--small btn--ghost"
            onClick={onToggleSearch}
          >
            Close
          </button>
        </div>
      )}
    </>
  );
}
