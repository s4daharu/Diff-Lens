import { memo, useCallback, useMemo, useRef, useState, useEffect, type RefObject } from 'react';
import type { ThemedToken } from 'shiki';
import type { DiffRow, Span, ViewMode } from '../lib/types';
import { buildVirtualOffsets, getVirtualRange } from '../lib/virtualRows';
import {
  CopyIcon,
  CheckIcon,
  ExpandAllIcon,
  ExpandDownIcon,
  ExpandUpIcon,
} from './Icons';

interface DiffViewProps {
  rows: DiffRow[];
  viewMode: ViewMode;
  wrap: boolean;
  lineNumbers: boolean;
  searchQuery?: string;
  activeChangeRowIndex?: number | null;
  activeChangeEndRowIndex?: number | null;
  onExpandGap?: (startRow: number, endRow: number, count: number) => void;
  onCopyNotice?: (msg: string) => void;
  getTokens?: ((line: string) => ThemedToken[] | null) | null;
}


const VIRTUALIZE_THRESHOLD = 800;
const VIRTUAL_OVERSCAN_PX = 700;
const BASE_ROW_HEIGHT = 21;
const GAP_ROW_HEIGHT = 34;

function estimateDiffRowHeight(
  row: DiffRow,
  wrap: boolean,
  charsPerLine: number,
): number {
  if (row.kind === 'gap') return GAP_ROW_HEIGHT;
  if (!wrap) return BASE_ROW_HEIGHT;

  const longest = Math.max(row.oldLine?.length ?? 0, row.newLine?.length ?? 0);
  const visualLines = Math.max(
    1,
    Math.min(24, Math.ceil((longest + 8) / Math.max(20, charsPerLine))),
  );
  return visualLines * BASE_ROW_HEIGHT;
}

function useVirtualWindow<T>(
  items: T[],
  scrollRef: RefObject<HTMLDivElement | null>,
  estimateHeight: (item: T) => number,
) {
  const virtualized = items.length > VIRTUALIZE_THRESHOLD;
  const measurementsRef = useRef(new Map<number, number>());
  const previousItemsRef = useRef(items);
  const widthRef = useRef(0);
  const refreshFrameRef = useRef<number | null>(null);
  const [measureVersion, setMeasureVersion] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });

  if (previousItemsRef.current !== items) {
    previousItemsRef.current = items;
    measurementsRef.current.clear();
  }

  const offsets = useMemo(
    () =>
      buildVirtualOffsets(
        items.length,
        measurementsRef.current,
        (index) => estimateHeight(items[index]),
      ),
    [items, estimateHeight, measureVersion],
  );

  const scheduleMeasurementRefresh = useCallback(() => {
    if (refreshFrameRef.current != null) return;
    refreshFrameRef.current = window.requestAnimationFrame(() => {
      refreshFrameRef.current = null;
      setMeasureVersion((version) => version + 1);
    });
  }, []);

  useEffect(
    () => () => {
      if (refreshFrameRef.current != null) {
        window.cancelAnimationFrame(refreshFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    let frame = 0;
    const updateViewport = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const width = scroller.clientWidth;
        if (
          widthRef.current !== 0 &&
          widthRef.current !== width &&
          measurementsRef.current.size > 0
        ) {
          measurementsRef.current.clear();
          setMeasureVersion((version) => version + 1);
        }
        widthRef.current = width;
        setViewport({
          top: scroller.scrollTop,
          height: scroller.clientHeight,
        });
      });
    };

    updateViewport();
    scroller.addEventListener('scroll', updateViewport, { passive: true });
    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(scroller);

    return () => {
      window.cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', updateViewport);
      resizeObserver.disconnect();
    };
  }, [scrollRef, items.length]);

  const range = useMemo(() => {
    if (!virtualized) {
      return {
        start: 0,
        end: items.length,
        topPadding: 0,
        bottomPadding: 0,
        totalHeight: offsets[offsets.length - 1] ?? 0,
      };
    }
    return getVirtualRange(
      offsets,
      viewport.top,
      Math.max(viewport.height, 600),
      VIRTUAL_OVERSCAN_PX,
    );
  }, [items.length, offsets, viewport, virtualized]);

  const measureRow = useCallback(
    (index: number, node: HTMLDivElement | null) => {
      if (!virtualized || !node) return;
      const height = node.getBoundingClientRect().height;
      if (!Number.isFinite(height) || height <= 0) return;

      const previous = measurementsRef.current.get(index);
      if (previous == null || Math.abs(previous - height) > 0.5) {
        measurementsRef.current.set(index, height);
        scheduleMeasurementRefresh();
      }
    },
    [scheduleMeasurementRefresh, virtualized],
  );

  const scrollToIndex = useCallback(
    (index: number, behavior: ScrollBehavior = 'smooth') => {
      const scroller = scrollRef.current;
      const count = items.length;
      if (!scroller || count === 0) return;

      const safeIndex = Math.max(0, Math.min(count - 1, index));
      const top = offsets[safeIndex] ?? 0;
      const bottom = offsets[safeIndex + 1] ?? top + BASE_ROW_HEIGHT;
      const rowHeight = Math.max(1, bottom - top);
      const centered = top - Math.max(0, (scroller.clientHeight - rowHeight) / 2);
      const maxTop = Math.max(
        0,
        (offsets[offsets.length - 1] ?? 0) - scroller.clientHeight,
      );
      const targetTop = Math.max(0, Math.min(centered, maxTop));
      const effectiveBehavior = virtualized ? 'auto' : behavior;
      scroller.scrollTo({
        top: targetTop,
        behavior: effectiveBehavior,
      });
      if (virtualized) {
        setViewport({
          top: targetTop,
          height: scroller.clientHeight,
        });
      }
    },
    [items.length, offsets, scrollRef, virtualized],
  );

  return {
    virtualized,
    ...range,
    measureRow,
    scrollToIndex,
  };
}

function highlightMatches(text: string, query?: string) {
  if (!query || !query.trim() || !text) return text;
  const q = query.trim();
  const lowerText = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  if (!lowerText.includes(lowerQ)) return text;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let idx = lowerText.indexOf(lowerQ);

  while (idx !== -1) {
    if (idx > lastIndex) {
      parts.push(text.slice(lastIndex, idx));
    }
    parts.push(
      <mark key={`${idx}-${parts.length}`} className="search-match">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    lastIndex = idx + q.length;
    idx = lowerText.indexOf(lowerQ, lastIndex);
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}

function SpanText({
  spans,
  searchQuery,
}: {
  spans?: Span[];
  searchQuery?: string;
}) {
  if (!spans) return null;
  return (
    <>
      {spans.map((span, i) => (
        <span
          key={i}
          className={
            span.added ? 'hl hl--add' : span.removed ? 'hl hl--del' : undefined
          }
        >
          {highlightMatches(span.text, searchQuery)}
        </span>
      ))}
    </>
  );
}

function SyntaxText({
  tokens,
  line,
  searchQuery,
}: {
  tokens: ThemedToken[] | null;
  line: string;
  searchQuery?: string;
}) {
  if (!tokens || tokens.length === 0) {
    return <>{highlightMatches(line, searchQuery)}</>;
  }
  return (
    <>
      {tokens.map((token, i) =>
        token.content ? (
          <span key={i} style={{ color: token.color }}>
            {highlightMatches(token.content, searchQuery)}
          </span>
        ) : null,
      )}
    </>
  );
}

const RowSide = memo(function RowSide({
  row,
  side,
  lineNumbers,
  searchQuery,
  onCopy,
  getTokens,
}: {
  row: DiffRow;
  side: 'old' | 'new';
  lineNumbers: boolean;
  searchQuery?: string;
  onCopy?: (text: string) => void;
  getTokens?: ((line: string) => ThemedToken[] | null) | null;
}) {
  const isOld = side === 'old';
  const line = isOld ? row.oldLine : row.newLine;
  const num = isOld ? row.oldNum : row.newNum;
  const spans = isOld ? row.oldSpans : row.newSpans;
  const [copied, setCopied] = useState(false);

  if (line === null) {
    return (
      <>
        {lineNumbers && <span className="ln" />}
        <span className="cell cell--empty" />
      </>
    );
  }

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard
      ?.writeText(line)
      .then(() => {
        setCopied(true);
        onCopy?.('Copied line to clipboard');
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => onCopy?.('Clipboard permission denied'));
  };

  return (
    <>
      {lineNumbers && <span className="ln">{num}</span>}
      <span className="cell group-cell">
        <span className="cell__text">
          {spans ? (
            <SpanText spans={spans} searchQuery={searchQuery} />
          ) : getTokens ? (
            <SyntaxText
              tokens={getTokens(line)}
              line={line}
              searchQuery={searchQuery}
            />
          ) : null}
          {!spans && !getTokens && highlightMatches(line, searchQuery)}
        </span>
        <button
          type="button"
          className={`cell-copy-btn ${copied ? 'cell-copy-btn--copied' : ''}`}
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy this line'}
          aria-label="Copy line"
        >
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
        </button>
      </span>
    </>
  );
});

function GapRow({
  row,
  onExpandGap,
  rowRef,
  id,
}: {
  row: DiffRow;
  onExpandGap?: (start: number, end: number, count: number) => void;
  rowRef?: (node: HTMLDivElement | null) => void;
  id?: string;
}) {
  const hasRange = row.gapStartRow != null && row.gapEndRow != null;
  const skipped =
    row.skipped ??
    (hasRange ? row.gapEndRow! - row.gapStartRow! + 1 : undefined);

  return (
    <div ref={rowRef} id={id} className="diff-row diff-row--gap" role="row">
      <div className="gap-content">
        {hasRange && onExpandGap && (
          <button
            type="button"
            className="gap-btn"
            title="Expand 10 lines above"
            onClick={() =>
              onExpandGap(
                row.gapStartRow!,
                Math.min(row.gapEndRow!, row.gapStartRow! + 9),
                10,
              )
            }
          >
            <ExpandUpIcon size={13} />
            <span>+10 above</span>
          </button>
        )}
        <span className="gap-label">
          <span className="gap-dots">…</span>
          {skipped != null ? ` ${skipped} lines hidden ` : ' lines hidden '}
          <span className="gap-dots">…</span>
        </span>
        {hasRange && onExpandGap && (
          <>
            <button
              type="button"
              className="gap-btn gap-btn--all"
              title={`Expand all ${skipped ?? ''} hidden lines`}
              onClick={() =>
                onExpandGap(
                  row.gapStartRow!,
                  row.gapEndRow!,
                  skipped ?? row.gapEndRow! - row.gapStartRow! + 1,
                )
              }
            >
              <ExpandAllIcon size={13} />
              <span>Expand all</span>
            </button>
            <button
              type="button"
              className="gap-btn"
              title="Expand 10 lines below"
              onClick={() =>
                onExpandGap(
                  Math.max(row.gapStartRow!, row.gapEndRow! - 9),
                  row.gapEndRow!,
                  10,
                )
              }
            >
              <ExpandDownIcon size={13} />
              <span>+10 below</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function MinimapGutter({
  rows,
  onJumpToRow,
}: {
  rows: DiffRow[];
  onJumpToRow: (rowIndex: number) => void;
}) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const [markers, setMarkers] = useState<
    { index: number; percent: number; kind: string }[]
  >([]);

  useEffect(() => {
    const gutter = gutterRef.current;
    if (!gutter) return;
    const scroller = gutter.parentElement;
    const content = scroller?.querySelector<HTMLElement>('.diff-rows-container') ?? null;

    const compute = () => {
      const total = rows.length;
      const viewH = gutter.clientHeight;
      const contentH = content?.scrollHeight ?? 0;
      if (total === 0 || viewH === 0 || contentH === 0) {
        setMarkers([]);
        return;
      }
      // Fraction of the gutter that actually contains rendered content
      const scale = Math.min(1, contentH / viewH);
      // bucket markers to avoid overlapping clutter on huge files
      const buckets = new Map<number, { index: number; kind: string }>();
      rows.forEach((row, i) => {
        if (row.kind !== 'equal' && row.kind !== 'gap') {
          const bucket = Math.floor((i / Math.max(1, total)) * 200);
          if (!buckets.has(bucket)) {
            buckets.set(bucket, { index: i, kind: row.kind as string });
          }
        }
      });
      const list: { index: number; percent: number; kind: string }[] = [];
      for (const [bucket, v] of buckets) {
        list.push({
          index: v.index,
          percent: (bucket / 200) * scale * 100,
          kind: v.kind,
        });
      }
      setMarkers(list);
    };

    compute();
    const ro = new ResizeObserver(compute);
    if (content) ro.observe(content);
    return () => ro.disconnect();
  }, [rows]);

  const hasChanges = useMemo(
    () => rows.some((r) => r.kind !== 'equal' && r.kind !== 'gap'),
    [rows],
  );

  if (!hasChanges) return null;

  const handleGutterClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const pct = y / rect.height;
    const contentH =
      e.currentTarget.parentElement?.querySelector<HTMLElement>(
        '.diff-rows-container',
      )?.scrollHeight ?? 0;
    const scale = contentH > 0 ? Math.min(1, contentH / rect.height) : 1;
    const targetIndex = Math.max(
      0,
      Math.min(rows.length - 1, Math.floor((pct / scale) * rows.length)),
    );
    // find nearest diff marker
    let nearest = markers[0]?.index ?? 0;
    let best = Infinity;
    for (const m of markers) {
      const d = Math.abs(m.index - targetIndex);
      if (d < best) {
        best = d;
        nearest = m.index;
      }
    }
    onJumpToRow(nearest);
  };

  return (
    <div
      ref={gutterRef}
      className="diff-minimap"
      aria-hidden="true"
      title="Difference minimap — click to jump to nearest change"
      onClick={handleGutterClick}
    >
      {markers.map((m) => (
        <div
          key={m.index}
          className={`minimap-marker minimap-marker--${m.kind}`}
          style={{ top: `${m.percent}%` }}
        />
      ))}
    </div>
  );
}

function SideBySide({
  rows,
  wrap,
  lineNumbers,
  searchQuery,
  activeChangeRowIndex,
  activeChangeEndRowIndex,
  onExpandGap,
  onCopyNotice,
  getTokens,
}: DiffViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const estimateHeight = useCallback(
    (row: DiffRow) => estimateDiffRowHeight(row, wrap, 90),
    [wrap],
  );
  const virtual = useVirtualWindow(rows, scrollRef, estimateHeight);

  const jumpToRow = useCallback(
    (rowIndex: number) => virtual.scrollToIndex(rowIndex),
    [virtual.scrollToIndex],
  );

  useEffect(() => {
    if (activeChangeRowIndex != null) jumpToRow(activeChangeRowIndex);
  }, [activeChangeRowIndex, jumpToRow]);

  const renderedRows = rows.slice(virtual.start, virtual.end);

  return (
    <div
      className={`diff-view diff-view--side${lineNumbers ? '' : ' no-line-nums'}`}
      data-virtualized={virtual.virtualized ? 'true' : 'false'}
      data-total-rows={rows.length}
    >
      <div className="diff-col-head">
        {lineNumbers && <span className="ln ln--head" />}
        <span className="col-title col-title--old">Original</span>
        {lineNumbers && <span className="ln ln--head" />}
        <span className="col-title col-title--new">Changed</span>
      </div>
      <div
        ref={scrollRef}
        className={`diff-scroll ${wrap ? 'diff-scroll--wrap' : ''}`}
      >
        <div
          className="diff-rows-container"
          data-virtualized={virtual.virtualized ? 'true' : 'false'}
        >
          {virtual.topPadding > 0 && (
            <div
              className="virtual-spacer"
              style={{ height: virtual.topPadding }}
              aria-hidden="true"
            />
          )}
          {renderedRows.map((row, localIndex) => {
            const i = virtual.start + localIndex;
            return row.kind === 'gap' ? (
              <GapRow
                key={i}
                id={`diff-row-side-${i}`}
                row={row}
                onExpandGap={onExpandGap}
                rowRef={(node) => virtual.measureRow(i, node)}
              />
            ) : (
              <div
                ref={(node) => virtual.measureRow(i, node)}
                id={`diff-row-side-${i}`}
                key={i}
                className={`diff-row diff-row--${row.kind} ${
                  activeChangeRowIndex != null &&
                  i >= activeChangeRowIndex &&
                  i <= (activeChangeEndRowIndex ?? activeChangeRowIndex)
                    ? 'diff-row--active'
                    : ''
                }`}
              >
                <RowSide
                  row={row}
                  side="old"
                  lineNumbers={lineNumbers}
                  searchQuery={searchQuery}
                  onCopy={onCopyNotice}
                  getTokens={getTokens}
                />
                <RowSide
                  row={row}
                  side="new"
                  lineNumbers={lineNumbers}
                  searchQuery={searchQuery}
                  onCopy={onCopyNotice}
                  getTokens={getTokens}
                />
              </div>
            );
          })}
          {virtual.bottomPadding > 0 && (
            <div
              className="virtual-spacer"
              style={{ height: virtual.bottomPadding }}
              aria-hidden="true"
            />
          )}
        </div>
        <MinimapGutter rows={rows} onJumpToRow={jumpToRow} />
      </div>
    </div>
  );
}

interface InlineRenderRow {
  row: DiffRow;
  sign: string;
  subIndex: number;
  parentRowIndex: number;
}

function InlineView({
  rows,
  wrap,
  lineNumbers,
  searchQuery,
  activeChangeRowIndex,
  activeChangeEndRowIndex,
  onExpandGap,
  onCopyNotice,
  getTokens,
}: DiffViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const expandedRows = useMemo<InlineRenderRow[]>(() => {
    const res: InlineRenderRow[] = [];
    rows.forEach((row, parentIndex) => {
      if (row.kind === 'modified') {
        res.push({
          row,
          sign: '-',
          subIndex: 0,
          parentRowIndex: parentIndex,
        });
        res.push({
          row,
          sign: '+',
          subIndex: 1,
          parentRowIndex: parentIndex,
        });
      } else {
        res.push({
          row,
          sign:
            row.kind === 'added'
              ? '+'
              : row.kind === 'deleted'
                ? '-'
                : '',
          subIndex: 0,
          parentRowIndex: parentIndex,
        });
      }
    });
    return res;
  }, [rows]);

  const estimateHeight = useCallback(
    (item: InlineRenderRow) => estimateDiffRowHeight(item.row, wrap, 140),
    [wrap],
  );
  const virtual = useVirtualWindow(expandedRows, scrollRef, estimateHeight);

  const firstInlineIndexByParent = useMemo(() => {
    const indexMap = new Map<number, number>();
    expandedRows.forEach((item, index) => {
      if (!indexMap.has(item.parentRowIndex)) {
        indexMap.set(item.parentRowIndex, index);
      }
    });
    return indexMap;
  }, [expandedRows]);

  const jumpToRow = useCallback(
    (rowIndex: number) => {
      const itemIndex = firstInlineIndexByParent.get(rowIndex);
      if (itemIndex != null) virtual.scrollToIndex(itemIndex);
    },
    [firstInlineIndexByParent, virtual.scrollToIndex],
  );

  useEffect(() => {
    if (activeChangeRowIndex != null) jumpToRow(activeChangeRowIndex);
  }, [activeChangeRowIndex, jumpToRow]);

  const handleCopyLine = (text: string, idx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopiedIdx(idx);
        onCopyNotice?.('Copied line to clipboard');
        setTimeout(() => setCopiedIdx(null), 1500);
      })
      .catch(() => onCopyNotice?.('Clipboard permission denied'));
  };

  const renderedRows = expandedRows.slice(virtual.start, virtual.end);

  return (
    <div
      className={`diff-view diff-view--inline${lineNumbers ? '' : ' no-line-nums'}`}
      data-virtualized={virtual.virtualized ? 'true' : 'false'}
      data-total-rows={expandedRows.length}
    >
      <div className="diff-col-head diff-col-head--inline">
        {lineNumbers && <span className="ln ln--head" title="Original line #" />}
        {lineNumbers && <span className="ln ln--head" title="Changed line #" />}
        <span className="sign sign--head" />
        <span className="col-title col-title--unified">Unified diff</span>
      </div>
      <div
        ref={scrollRef}
        className={`diff-scroll ${wrap ? 'diff-scroll--wrap' : ''}`}
      >
        <div
          className="diff-rows-container"
          data-virtualized={virtual.virtualized ? 'true' : 'false'}
        >
          {virtual.topPadding > 0 && (
            <div
              className="virtual-spacer"
              style={{ height: virtual.topPadding }}
              aria-hidden="true"
            />
          )}
          {renderedRows.map(({ row, sign, parentRowIndex, subIndex }, localIndex) => {
            const i = virtual.start + localIndex;
            if (row.kind === 'gap') {
              return (
                <GapRow
                  key={i}
                  id={`diff-row-inline-p${parentRowIndex}-${subIndex}`}
                  row={row}
                  onExpandGap={onExpandGap}
                  rowRef={(node) => virtual.measureRow(i, node)}
                />
              );
            }

            const oldNum = sign === '+' ? null : row.oldNum;
            const newNum = sign === '-' ? null : row.newNum;
            const line = sign === '+' ? row.newLine : row.oldLine;
            const spans = sign === '+' ? row.newSpans : row.oldSpans;
            const kind =
              row.kind === 'modified'
                ? sign === '+'
                  ? 'added'
                  : 'deleted'
                : row.kind;
            const isCopied = copiedIdx === i;

            return (
              <div
                ref={(node) => virtual.measureRow(i, node)}
                id={`diff-row-inline-p${parentRowIndex}-${subIndex}`}
                key={i}
                className={`diff-row diff-row--${kind} ${
                  activeChangeRowIndex != null &&
                  parentRowIndex >= activeChangeRowIndex &&
                  parentRowIndex <=
                    (activeChangeEndRowIndex ?? activeChangeRowIndex)
                    ? 'diff-row--active'
                    : ''
                }`}
              >
                {lineNumbers && (
                  <span className="ln ln--old">{oldNum ?? ''}</span>
                )}
                {lineNumbers && (
                  <span className="ln ln--new">{newNum ?? ''}</span>
                )}
                <span
                  className={`sign ${
                    sign === '+'
                      ? 'sign--added'
                      : sign === '-'
                        ? 'sign--deleted'
                        : 'sign--equal'
                  }`}
                >
                  {sign}
                </span>
                <span className="cell group-cell">
                  <span className="cell__text">
                    {spans && sign !== '' ? (
                      <SpanText spans={spans} searchQuery={searchQuery} />
                    ) : getTokens && line != null ? (
                      <SyntaxText
                        tokens={getTokens(line)}
                        line={line}
                        searchQuery={searchQuery}
                      />
                    ) : (
                      highlightMatches(line ?? '', searchQuery)
                    )}
                  </span>
                  {line != null && (
                    <button
                      type="button"
                      className={`cell-copy-btn ${
                        isCopied ? 'cell-copy-btn--copied' : ''
                      }`}
                      onClick={(e) => handleCopyLine(line, i, e)}
                      title={isCopied ? 'Copied!' : 'Copy this line'}
                      aria-label="Copy line"
                    >
                      {isCopied ? (
                        <CheckIcon size={12} />
                      ) : (
                        <CopyIcon size={12} />
                      )}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
          {virtual.bottomPadding > 0 && (
            <div
              className="virtual-spacer"
              style={{ height: virtual.bottomPadding }}
              aria-hidden="true"
            />
          )}
        </div>
        <MinimapGutter rows={rows} onJumpToRow={jumpToRow} />
      </div>
    </div>
  );
}

export function DiffView(props: DiffViewProps) {
  return props.viewMode === 'side-by-side' ? (
    <SideBySide {...props} />
  ) : (
    <InlineView {...props} />
  );
}
