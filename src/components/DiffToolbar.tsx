import { useEffect, useRef, useState } from 'react';
import type { ViewMode } from '../lib/types';
import { MenuCheck, ToolbarMenu } from './ToolbarMenu';
import {
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FileCodeIcon,
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
  ignoreCase: boolean;
  onIgnoreCaseChange: (ignore: boolean) => void;
  ignoreLineEndings: boolean;
  onIgnoreLineEndingsChange: (ignore: boolean) => void;
  activeFilters: string[];
  onOpenAdvancedFilters: () => void;
  hideUnchangedLines: boolean;
  onHideUnchangedLinesChange: (hidden: boolean) => void;
  lineNumbers: boolean;
  onLineNumbersChange: (show: boolean) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  narrow: boolean;
  searchOpen: boolean;
  onToggleSearch: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchCount: number;
  searchOrdinal: number | null;
  onSearchNext: () => void;
  onSearchPrev: () => void;
  changeCount: number;
  changeOrdinal: number | null;
  onNextChange: () => void;
  onPrevChange: () => void;
  onCopyPatch: () => void;
  onDownloadPatch: () => void;
  onCopyMarkdown: () => void;
  onExportHtml: () => void;
  onPrintReport: (mode: ViewMode) => void;
  reportReady: boolean;
  onSaveSession: () => void;
  onCopySource: (side: 'old' | 'new') => void;
  onDownloadSource: (side: 'old' | 'new') => void;
  canUndoMerge: boolean;
  canRedoMerge: boolean;
  onUndoMerge: () => void;
  onRedoMerge: () => void;
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
  ignoreCase,
  onIgnoreCaseChange,
  ignoreLineEndings,
  onIgnoreLineEndingsChange,
  activeFilters,
  onOpenAdvancedFilters,
  hideUnchangedLines,
  onHideUnchangedLinesChange,
  lineNumbers,
  onLineNumbersChange,
  sidebarOpen,
  onToggleSidebar,
  narrow,
  searchOpen,
  onToggleSearch,
  searchQuery,
  onSearchChange,
  searchCount,
  searchOrdinal,
  onSearchNext,
  onSearchPrev,
  changeCount,
  changeOrdinal,
  onNextChange,
  onPrevChange,
  onCopyPatch,
  onDownloadPatch,
  onCopyMarkdown,
  onExportHtml,
  onPrintReport,
  reportReady,
  onSaveSession,
  onCopySource,
  onDownloadSource,
  canUndoMerge,
  canRedoMerge,
  onUndoMerge,
  onRedoMerge,
  patchReady,
  copied,
  copiedMarkdown,
}: DiffToolbarProps) {
  const [openMenu, setOpenMenu] = useState<'view' | 'filter' | 'export' | null>(null);
  const controls = useRef<HTMLDivElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) {
      searchInput.current?.focus({ preventScroll: true });
    }
  }, [searchOpen]);

  const closeSearch = () => {
    onToggleSearch();
    searchButton.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!openMenu) return;
    const onClick = (e: MouseEvent) => {
      const active = controls.current?.querySelector('.toolbar-menu-trigger[aria-expanded=true]')?.parentElement;
      if (!active?.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('pointerdown', onClick);
    return () => {
      document.removeEventListener('pointerdown', onClick);
    };
  }, [openMenu]);

  return (
    <div className="result-controls" ref={controls}>
      <div className="diff-toolbar">
        <div
          className="segmented"
          role="tablist"
          aria-label="View mode"
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault();
            const index = e.key === 'Home' ? 0 : e.key === 'End' ? 1 : viewMode === 'side-by-side' ? 1 : 0;
            onViewModeChange(index === 0 ? 'side-by-side' : 'inline');
            e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[index]?.focus();
          }}
        >
          <button
            type="button"
            role="tab"
            aria-label="Side by side"
            aria-selected={viewMode === 'side-by-side'}
            tabIndex={viewMode === 'side-by-side' ? 0 : -1}
            className={`segmented__btn ${viewMode === 'side-by-side' ? 'segmented__btn--active' : ''}`}
            onClick={() => onViewModeChange('side-by-side')}
          >
            <span className="view-label-full">Side by side</span><span className="view-label-compact" aria-hidden="true">Split</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'inline'}
            tabIndex={viewMode === 'inline' ? 0 : -1}
            className={`segmented__btn ${viewMode === 'inline' ? 'segmented__btn--active' : ''}`}
            onClick={() => onViewModeChange('inline')}
          >
            Unified
          </button>
        </div>

        <div className="diff-toolbar__group diff-change-nav" role="group" aria-label="Change navigation">
          <button type="button" className="btn btn--small btn--icon" disabled={!changeCount}
            onClick={onPrevChange} aria-label="Previous change" title="Previous change (Alt+P)">
            <ChevronUpIcon size={15} />
          </button>
          <span className="diff-nav-count" role="status">
            {changeOrdinal == null
              ? `${changeCount.toLocaleString()} ${changeCount === 1 ? 'change' : 'changes'}`
              : `${(changeOrdinal + 1).toLocaleString()} / ${changeCount.toLocaleString()} changes`}
          </span>
          <button type="button" className="btn btn--small btn--icon" disabled={!changeCount}
            onClick={onNextChange} aria-label="Next change" title="Next change (Alt+N)">
            <ChevronDownIcon size={15} />
          </button>
        </div>

        <div className="diff-toolbar__group">
          <button ref={searchButton} type="button"
            className={`btn btn--small ${searchOpen ? 'btn--primary' : ''}`}
            onClick={onToggleSearch} title="Search within diff (Ctrl+F)" aria-label="Find in diff"
            aria-expanded={searchOpen}>
            <SearchIcon size={14} /><span>Find</span>
          </button>
        </div>

        <div className="diff-toolbar__group diff-toolbar__secondary">
          <ToolbarMenu name="View options" label="View" icon={<SlidersIcon size={14} />}
            open={openMenu === 'view'} onOpenChange={(open) => setOpenMenu(open ? 'view' : null)}>
            {() => <>
              <MenuCheck checked={hideUnchangedLines} onToggle={() => onHideUnchangedLinesChange(!hideUnchangedLines)}>
                Hide unchanged lines
              </MenuCheck>
              <MenuCheck checked={wrap} onToggle={() => onWrapChange(!wrap)}>Wrap long lines</MenuCheck>
              <MenuCheck checked={lineNumbers} onToggle={() => onLineNumbersChange(!lineNumbers)}>Line numbers</MenuCheck>
            </>}
          </ToolbarMenu>

          <ToolbarMenu name="Comparison filters" label="Filters" icon={<SlidersIcon size={14} />}
            open={openMenu === 'filter'} onOpenChange={(open) => setOpenMenu(open ? 'filter' : null)}>
            {(close) => <>
              <MenuCheck checked={hideWhitespaceChanges} onToggle={() => onHideWhitespaceChangesChange(!hideWhitespaceChanges)}>
                Ignore whitespace
              </MenuCheck>
              <MenuCheck checked={ignoreCase} onToggle={() => onIgnoreCaseChange(!ignoreCase)}>Ignore case</MenuCheck>
              <MenuCheck checked={ignoreLineEndings} onToggle={() => onIgnoreLineEndingsChange(!ignoreLineEndings)}>
                Ignore line endings
              </MenuCheck>
              <button type="button" className="dropdown-item" role="menuitem" tabIndex={-1}
                onClick={() => { close(); onOpenAdvancedFilters(); }}>Advanced filters…</button>
            </>}
          </ToolbarMenu>

          <button
            type="button"
            className="btn btn--small btn--toggle"
            aria-pressed={sidebarOpen}
            aria-expanded={sidebarOpen}
            aria-controls={sidebarOpen ? (narrow ? 'text-details-sheet' : 'diff-sidebar') : undefined}
            aria-haspopup={narrow ? 'dialog' : undefined}
            data-details-toggle="true"
            onClick={onToggleSidebar}
            title={sidebarOpen ? 'Hide diff details' : 'Show diff details'}
            aria-label="Diff details"
          >
            <ListIcon size={14} />
            <span>Details</span>
          </button>
        </div>

        <div
          className="diff-toolbar__group merge-history"
          role="group"
          aria-label="Merge history"
        >
          <button
            type="button"
            className="btn btn--small"
            onClick={onUndoMerge}
            disabled={!canUndoMerge}
            title="Undo last merge (Ctrl/⌘+Z)"
            aria-label="Undo merge"
          >
            Undo
          </button>
          <button
            type="button"
            className="btn btn--small"
            onClick={onRedoMerge}
            disabled={!canRedoMerge}
            title="Redo merge (Ctrl/⌘+Shift+Z or Ctrl/⌘+Y)"
            aria-label="Redo merge"
          >
            Redo
          </button>
        </div>

        <div className="diff-toolbar__spacer" />

        <ToolbarMenu name="Export options" label="Export" icon={<FileCodeIcon size={14} />}
          open={openMenu === 'export'} onOpenChange={(open) => setOpenMenu(open ? 'export' : null)} right exportTrigger>
          {(close) => <>
              <div className="dropdown-header" aria-hidden="true">Source text</div>
              {([['old', 'Original'], ['new', 'Changed']] as const).map(([side, label]) => (
                <div key={side} role="presentation">
                  <button type="button" className="dropdown-item" role="menuitem" tabIndex={-1}
                    onClick={() => { close(); onCopySource(side); }}>
                    <CopyIcon size={14} /> Copy {label} text
                  </button>
                  <button type="button" className="dropdown-item" role="menuitem" tabIndex={-1}
                    onClick={() => { close(); onDownloadSource(side); }}>
                    <DownloadIcon size={14} /> Download {label} text
                  </button>
                </div>
              ))}
              <div className="dropdown-header" aria-hidden="true">Comparison</div>
              <button
                type="button"
                className="dropdown-item"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  close();
                  onCopyPatch();
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
                tabIndex={-1}
                onClick={() => {
                  close();
                  onDownloadPatch();
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
                tabIndex={-1}
                onClick={() => {
                  close();
                  onCopyMarkdown();
                }}
                disabled={!patchReady}
              >
                <CopyIcon size={14} />
                <span>{copiedMarkdown ? 'Copied Markdown!' : 'Copy as Markdown'}</span>
              </button>
              <button
                type="button"
                className="dropdown-item"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  close();
                  onExportHtml();
                }}
                disabled={!reportReady}
              >
                <DownloadIcon size={14} />
                <span>Download HTML Report</span>
              </button>
              <button
                type="button"
                className="dropdown-item"
                role="menuitem"
                tabIndex={-1}
                disabled={!reportReady}
                onClick={() => {
                  close();
                  onPrintReport('side-by-side');
                }}
              >
                <DownloadIcon size={14} />
                <span>Print / Save PDF — Side by side</span>
              </button>
              <button
                type="button"
                className="dropdown-item"
                role="menuitem"
                tabIndex={-1}
                disabled={!reportReady}
                onClick={() => {
                  close();
                  onPrintReport('inline');
                }}
              >
                <DownloadIcon size={14} />
                <span>Print / Save PDF — Inline</span>
              </button>
              <button
                type="button"
                className="dropdown-item"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  close();
                  onSaveSession();
                }}
              >
                <DownloadIcon size={14} />
                <span>Export comparison session</span>
              </button>
          </>}
        </ToolbarMenu>
      </div>

      {activeFilters.length > 0 && (
        <div className="active-text-filters" role="group" aria-label="Active comparison filters">
          <span>Ignoring:</span>{activeFilters.map((filter) => <span key={filter} className="filter-badge">{filter}</span>)}
        </div>
      )}
      {searchOpen && (
        <div className="diff-search-bar" role="search" aria-label="Find in diff"
          onKeyDown={(event) => {
            if (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f')) {
              event.preventDefault();
              closeSearch();
            }
          }}>
          <SearchIcon size={15} className="diff-search-icon" />
          <input
            type="text"
            ref={searchInput}
            className="diff-search-input"
            placeholder="Find text…"
            maxLength={1024}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
              event.preventDefault();
              if (event.shiftKey) onSearchPrev();
              else onSearchNext();
            }}
            aria-label="Search within diff"
          />
          {searchQuery && (
            <button
              type="button"
              className="diff-search-clear"
              onClick={() => {
                onSearchChange('');
                searchInput.current?.focus();
              }}
              aria-label="Clear search"
            >
              <CloseIcon size={13} />
            </button>
          )}
          <span className="diff-nav-count" role="status">
            {searchQuery.trim() && (searchOrdinal == null
              ? `${searchCount.toLocaleString()} ${searchCount === 1 ? 'match' : 'matches'}`
              : `${(searchOrdinal + 1).toLocaleString()} / ${searchCount.toLocaleString()}`)}
          </span>
          <button type="button" className="btn btn--small btn--icon" disabled={!searchCount}
            onClick={onSearchPrev} aria-label="Previous match" title="Previous match (Shift+Enter)">
            <ChevronUpIcon size={14} />
          </button>
          <button type="button" className="btn btn--small btn--icon" disabled={!searchCount}
            onClick={onSearchNext} aria-label="Next match" title="Next match (Enter)">
            <ChevronDownIcon size={14} />
          </button>
          <button
            type="button"
            className="btn btn--small btn--ghost btn--icon"
            aria-label="Close search"
            onClick={closeSearch}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
