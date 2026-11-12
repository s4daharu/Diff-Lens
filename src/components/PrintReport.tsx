import type {
  DiffOptions,
  DiffRow,
  DiffStats,
  Span,
  ViewMode,
} from '../lib/types';
import {
  describeReportOptions,
  summarizeHiddenContext,
} from '../lib/report';

interface PrintReportProps {
  rows: DiffRow[];
  stats: DiffStats | null;
  viewMode: ViewMode;
  sessionName: string | null;
  oldName: string;
  newName: string;
  generatedAt: string;
  options: DiffOptions;
  expandedContextCount: number;
}

function renderSpans(
  spans: Span[] | undefined,
  fallback: string | null,
  side: 'old' | 'new',
) {
  if (!spans) return fallback ?? '';
  return spans.map((span, index) => {
    const highlighted =
      side === 'old' ? span.removed === true : span.added === true;
    return highlighted ? (
      <mark
        className={side === 'old' ? 'print-hl print-hl--del' : 'print-hl print-hl--add'}
        key={index}
      >
        {span.text}
      </mark>
    ) : (
      <span key={index}>{span.text}</span>
    );
  });
}

function movedLabel(row: DiffRow): string | null {
  if (row.moveRole === 'from') return 'Moved from';
  if (row.moveRole === 'to') return 'Moved to';
  return null;
}

function rowClass(row: DiffRow): string {
  return [
    'print-report__row',
    `print-report__row--${row.kind}`,
    row.moveRole ? `print-report__row--moved-${row.moveRole}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function SideBySideRows({ rows }: { rows: DiffRow[] }) {
  return (
    <>
      {rows.map((row, index) => {
        if (row.kind === 'gap') {
          return (
            <tr
              className="print-report__gap"
              data-source-row-index={index}
              key={`gap-${index}`}
            >
              <td colSpan={4}>
                {row.skipped ?? 0} unchanged line
                {(row.skipped ?? 0) === 1 ? '' : 's'} hidden
              </td>
            </tr>
          );
        }
        const move = movedLabel(row);
        return (
          <tr
            className={rowClass(row)}
            data-source-row-index={index}
            data-move-role={row.moveRole}
            key={index}
          >
            <td className="print-report__ln">{row.oldNum ?? ''}</td>
            <td className="print-report__code">
              {move && <span className="print-report__move">{move}</span>}
              {renderSpans(row.oldSpans, row.oldLine, 'old')}
            </td>
            <td className="print-report__ln">{row.newNum ?? ''}</td>
            <td className="print-report__code">
              {move && <span className="print-report__move">{move}</span>}
              {renderSpans(row.newSpans, row.newLine, 'new')}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function InlineCell({
  sign,
  number,
  children,
  className,
  sourceIndex,
}: {
  sign: string;
  number: number | null;
  children: React.ReactNode;
  className: string;
  sourceIndex: number;
}) {
  return (
    <tr
      className={`print-report__row ${className}`}
      data-source-row-index={sourceIndex}
    >
      <td className="print-report__sign">{sign}</td>
      <td className="print-report__ln">{number ?? ''}</td>
      <td className="print-report__code">{children}</td>
    </tr>
  );
}

function InlineRows({ rows }: { rows: DiffRow[] }) {
  return (
    <>
      {rows.map((row, index) => {
        if (row.kind === 'gap') {
          return (
            <tr
              className="print-report__gap"
              data-source-row-index={index}
              key={`gap-${index}`}
            >
              <td colSpan={3}>
                {row.skipped ?? 0} unchanged line
                {(row.skipped ?? 0) === 1 ? '' : 's'} hidden
              </td>
            </tr>
          );
        }

        const move = movedLabel(row);
        const moveBadge = move ? (
          <span className="print-report__move">{move}</span>
        ) : null;

        if (row.kind === 'modified') {
          return (
            <tbody className="print-report__inline-pair" key={index}>
              <InlineCell
                sign="-"
                number={row.oldNum}
                className="print-report__row--deleted"
                sourceIndex={index}
              >
                {moveBadge}
                {renderSpans(row.oldSpans, row.oldLine, 'old')}
              </InlineCell>
              <InlineCell
                sign="+"
                number={row.newNum}
                className="print-report__row--added"
                sourceIndex={index}
              >
                {moveBadge}
                {renderSpans(row.newSpans, row.newLine, 'new')}
              </InlineCell>
            </tbody>
          );
        }

        const added = row.kind === 'added';
        return (
          <InlineCell
            key={index}
            sign={added ? '+' : row.kind === 'deleted' ? '-' : ' '}
            number={added ? row.newNum : row.oldNum}
            className={rowClass(row)}
            sourceIndex={index}
          >
            {moveBadge}
            {renderSpans(
              added ? row.newSpans : row.oldSpans,
              added ? row.newLine : row.oldLine,
              added ? 'new' : 'old',
            )}
          </InlineCell>
        );
      })}
    </>
  );
}

export function PrintReport({
  rows,
  stats,
  viewMode,
  sessionName,
  oldName,
  newName,
  generatedAt,
  options,
  expandedContextCount,
}: PrintReportProps) {
  const optionLabels = describeReportOptions(options);
  const hidden = summarizeHiddenContext(rows);

  return (
    <article
      className={`print-report print-report--${viewMode}`}
      data-print-layout={viewMode}
      aria-label="Printable comparison report"
    >
      <header className="print-report__header">
        <div>
          <p className="print-report__eyebrow">DiffLens comparison report</p>
          <h1>{sessionName || `${oldName} ↔ ${newName}`}</h1>
          {sessionName && (
            <p className="print-report__files">
              {oldName} ↔ {newName}
            </p>
          )}
        </div>
        <div className="print-report__generated">
          <span>Generated locally</span>
          <time dateTime={generatedAt}>
            {new Date(generatedAt).toLocaleString()}
          </time>
        </div>
      </header>

      <section className="print-report__summary" aria-label="Report summary">
        {stats && (
          <dl className="print-report__stats">
            <div>
              <dt>Added</dt>
              <dd>{stats.added}</dd>
            </div>
            <div>
              <dt>Removed</dt>
              <dd>{stats.removed}</dd>
            </div>
            <div>
              <dt>Changed</dt>
              <dd>{stats.changed}</dd>
            </div>
            <div>
              <dt>Unchanged</dt>
              <dd>{stats.unchanged}</dd>
            </div>
          </dl>
        )}

        <div className="print-report__metadata">
          <strong>Comparison settings</strong>
          <ul>
            {optionLabels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
          {hidden.hiddenLines > 0 && (
            <p className="print-report__disclosure">
              This report hides {hidden.hiddenLines.toLocaleString()} unchanged
              line{hidden.hiddenLines === 1 ? '' : 's'} across {hidden.gapCount}{' '}
              collapsed region{hidden.gapCount === 1 ? '' : 's'}.
              {expandedContextCount > 0 &&
                ` ${expandedContextCount.toLocaleString()} manually expanded context row${
                  expandedContextCount === 1 ? ' is' : 's are'
                } included.`}
            </p>
          )}
          <p className="print-report__privacy">
            Generated entirely in this browser. Source content was not uploaded
            for report generation.
          </p>
        </div>
      </section>

      <table className="print-report__table">
        <thead>
          {viewMode === 'side-by-side' ? (
            <tr>
              <th className="print-report__ln">Line</th>
              <th>{oldName}</th>
              <th className="print-report__ln">Line</th>
              <th>{newName}</th>
            </tr>
          ) : (
            <tr>
              <th className="print-report__sign">±</th>
              <th className="print-report__ln">Line</th>
              <th>{oldName} → {newName}</th>
            </tr>
          )}
        </thead>
        {viewMode === 'side-by-side' ? (
          <tbody>
            <SideBySideRows rows={rows} />
          </tbody>
        ) : (
          <InlineRows rows={rows} />
        )}
      </table>

      <footer className="print-report__footer">
        <span>DiffLens · local comparison report</span>
        <span>
          {viewMode === 'side-by-side' ? 'Side-by-side' : 'Inline'} layout
        </span>
      </footer>
    </article>
  );
}
