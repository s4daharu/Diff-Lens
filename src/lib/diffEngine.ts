import { Diff, diffChars, diffWordsWithSpace, type Change } from 'diff';
import type {
  DiffOptions,
  DiffResult,
  DiffRow,
  DiffStats,
  Span,
  TextTransform,
} from './types';

const MAX_CHAR_DIFF_LENGTH = 4000;
const MAX_WORD_DIFF_LENGTH = 20000;
const NO_NEWLINE_MARKER = '\\ No newline at end of file';

export interface PatchEofOptions {
  oldNoNewlineAtEof?: boolean;
  newNoNewlineAtEof?: boolean;
}

export function hasNoNewlineAtEof(text: string): boolean {
  return text.length > 0 && !/[\r\n]$/.test(text);
}

export function splitLines(value: string): string[] {
  const parts = value.split(/\r\n|\r|\n/);
  if (parts.length > 0 && parts[parts.length - 1] === '') {
    parts.pop();
  }
  return parts;
}

export function countLines(value: string): number {
  if (value === '') return 0;
  let n = 1;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 10 || c === 13) {
      if (c === 13 && value.charCodeAt(i + 1) === 10) i++;
      n++;
    }
  }
  return value.endsWith('\n') || value.endsWith('\r') ? n - 1 : n;
}

interface LineDiffOptions {
  stripTrailingCr?: boolean;
  newlineIsToken?: boolean;
  ignoreWhitespace?: boolean;
  ignoreNewlineAtEof?: boolean;
  timeout?: number;
}

/**
 * Line diff that additionally honours `ignoreCase`, which jsdiff only
 * supports on its base `Diff.equals` (used by diffChars/diffWords) but does
 * not expose through the typed options of `diffLines`.
 */
class CaseAwareLineDiff extends Diff<string, string> {
  private readonly ignoreCase: boolean;

  constructor(ignoreCase: boolean) {
    super();
    this.ignoreCase = ignoreCase;
  }

  tokenize(value: string, options: LineDiffOptions): string[] {
    let normalized = value;
    if (options.stripTrailingCr) {
      normalized = normalized.replace(/\r\n?/g, '\n');
    }
    const ret: string[] = [];
    const linesAndNewlines = normalized.split(/(\r\n|\n|\r)/);
    if (!linesAndNewlines[linesAndNewlines.length - 1]) {
      linesAndNewlines.pop();
    }
    for (let i = 0; i < linesAndNewlines.length; i++) {
      const line = linesAndNewlines[i];
      if (i % 2 && !options.newlineIsToken) {
        ret[ret.length - 1] += line;
      } else {
        ret.push(line);
      }
    }
    return ret;
  }

  equals(left: string, right: string, options: LineDiffOptions): boolean {
    if (options.ignoreWhitespace) {
      if (!options.newlineIsToken || !left.includes('\n')) {
        left = left.trim();
      }
      if (!options.newlineIsToken || !right.includes('\n')) {
        right = right.trim();
      }
    } else if (options.ignoreNewlineAtEof && !options.newlineIsToken) {
      if (left.endsWith('\n')) left = left.slice(0, -1);
      if (right.endsWith('\n')) right = right.slice(0, -1);
    }
    if (this.ignoreCase) {
      left = left.toLowerCase();
      right = right.toLowerCase();
    }
    return left === right;
  }
}

function intraLineSpans(
  oldLine: string,
  newLine: string,
  options: DiffOptions,
): { oldSpans: Span[]; newSpans: Span[] } {
  const total = oldLine.length + newLine.length;
  const limit =
    options.granularity === 'chars' ? MAX_CHAR_DIFF_LENGTH : MAX_WORD_DIFF_LENGTH;
  if (total > limit) {
    return {
      oldSpans: [{ text: oldLine, removed: true }],
      newSpans: [{ text: newLine, added: true }],
    };
  }
  const parts =
    options.granularity === 'chars'
      ? diffChars(oldLine, newLine, { ignoreCase: options.ignoreCase })
      : diffWordsWithSpace(oldLine, newLine, { ignoreCase: options.ignoreCase });

  const oldSpans: Span[] = [];
  const newSpans: Span[] = [];
  for (const part of parts) {
    if (part.added) {
      newSpans.push({ text: part.value, added: true });
    } else if (part.removed) {
      oldSpans.push({ text: part.value, removed: true });
    } else {
      oldSpans.push({ text: part.value });
      newSpans.push({ text: part.value });
    }
  }
  return { oldSpans, newSpans };
}

function buildRows(parts: Change[], options: DiffOptions): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNum = 0;
  let newNum = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part.removed) {
      const removedLines = splitLines(part.value);
      let addedLines: string[] = [];
      if (i + 1 < parts.length && parts[i + 1].added) {
        addedLines = splitLines(parts[i + 1].value);
        i++;
      }
      const count = Math.max(removedLines.length, addedLines.length);
      for (let k = 0; k < count; k++) {
        const oldLine = k < removedLines.length ? removedLines[k] : null;
        const newLine = k < addedLines.length ? addedLines[k] : null;
        if (oldLine !== null && newLine !== null) {
          const { oldSpans, newSpans } = intraLineSpans(oldLine, newLine, options);
          rows.push({
            kind: 'modified',
            oldLine,
            newLine,
            oldNum: ++oldNum,
            newNum: ++newNum,
            oldSpans,
            newSpans,
          });
        } else if (oldLine !== null) {
          rows.push({
            kind: 'deleted',
            oldLine,
            newLine: null,
            oldNum: ++oldNum,
            newNum: null,
          });
        } else if (newLine !== null) {
          rows.push({
            kind: 'added',
            oldLine: null,
            newLine,
            oldNum: null,
            newNum: ++newNum,
          });
        }
      }
      continue;
    }

    const lines = splitLines(part.value);
    if (part.added) {
      for (const line of lines) {
        rows.push({
          kind: 'added',
          oldLine: null,
          newLine: line,
          oldNum: null,
          newNum: ++newNum,
        });
      }
    } else {
      for (const line of lines) {
        rows.push({
          kind: 'equal',
          oldLine: line,
          newLine: line,
          oldNum: ++oldNum,
          newNum: ++newNum,
        });
      }
    }
  }

  return rows;
}

export function countWords(value: string): number {
  if (!value.trim()) return 0;
  const matches = value.match(/\S+/g);
  return matches ? matches.length : 0;
}

export function formatJson(value: string): { success: boolean; result: string; error?: string } {
  try {
    const parsed = JSON.parse(value);
    return { success: true, result: JSON.stringify(parsed, null, 2) };
  } catch (err) {
    return {
      success: false,
      result: value,
      error: err instanceof Error ? err.message : 'Invalid JSON format',
    };
  }
}

export function applyTextTransform(
  text: string,
  transform: TextTransform,
): { success: boolean; result: string; error?: string } {
  switch (transform) {
    case 'format-json':
      return formatJson(text);
    case 'sort-lines': {
      const lines = splitLines(text);
      lines.sort((a, b) => a.localeCompare(b));
      return { success: true, result: lines.join('\n') + (text.endsWith('\n') ? '\n' : '') };
    }
    case 'sort-lines-desc': {
      const lines = splitLines(text);
      lines.sort((a, b) => b.localeCompare(a));
      return { success: true, result: lines.join('\n') + (text.endsWith('\n') ? '\n' : '') };
    }
    case 'trim-whitespace': {
      const lines = splitLines(text).map((l) => l.trim());
      return { success: true, result: lines.join('\n') + (text.endsWith('\n') ? '\n' : '') };
    }
    case 'remove-blank-lines': {
      const lines = splitLines(text).filter((l) => l.trim().length > 0);
      return { success: true, result: lines.join('\n') + (lines.length > 0 && text.endsWith('\n') ? '\n' : '') };
    }
    case 'lowercase':
      return { success: true, result: text.toLowerCase() };
    case 'uppercase':
      return { success: true, result: text.toUpperCase() };
    default:
      return { success: true, result: text };
  }
}

export function applyContext(
  rows: DiffRow[],
  context: number | 'all',
  expandedIndices?: Set<number> | null,
): DiffRow[] {
  if (context === 'all' && (!expandedIndices || expandedIndices.size === 0)) return rows;

  const changedIndices: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind !== 'equal') changedIndices.push(i);
  }
  if (changedIndices.length === 0 && (!expandedIndices || expandedIndices.size === 0)) return rows;

  const keep = new Set<number>();
  if (context === 'all') {
    for (let i = 0; i < rows.length; i++) keep.add(i);
  } else {
    for (const idx of changedIndices) {
      const from = Math.max(0, idx - context);
      const to = Math.min(rows.length - 1, idx + context);
      for (let k = from; k <= to; k++) keep.add(k);
    }
  }

  if (expandedIndices) {
    for (const idx of expandedIndices) {
      if (idx >= 0 && idx < rows.length) keep.add(idx);
    }
  }

  const out: DiffRow[] = [];
  let lastKept = -2;
  for (let k = 0; k < rows.length; k++) {
    if (keep.has(k)) {
      if (lastKept === -2 && k > 0) {
        out.push({
          kind: 'gap', oldLine: null, newLine: null,
          oldNum: null, newNum: null, skipped: k,
          gapStartRow: 0, gapEndRow: k - 1,
        });
      }
      if (lastKept === -2 || lastKept === k - 1) {
        out.push(rows[k]);
      } else {
        const skipped = k - lastKept - 1;
        const gapStartRow = lastKept === -2 ? 0 : lastKept + 1;
        const gapEndRow = k - 1;
        out.push({
          kind: 'gap',
          oldLine: null,
          newLine: null,
          oldNum: null,
          newNum: null,
          skipped,
          gapStartRow,
          gapEndRow,
        });
        out.push(rows[k]);
      }
      lastKept = k;
    }
  }
  if (lastKept >= 0 && lastKept < rows.length - 1) {
    out.push({
      kind: 'gap', oldLine: null, newLine: null,
      oldNum: null, newNum: null,
      skipped: rows.length - lastKept - 1,
      gapStartRow: lastKept + 1, gapEndRow: rows.length - 1,
    });
  }
  return out;
}

export function computeDiff(
  oldText: string,
  newText: string,
  options: DiffOptions,
): DiffResult {
  const start = performance.now();

  const diff = new CaseAwareLineDiff(options.ignoreCase);
  const parts = diff.diff(oldText, newText, {
    ignoreWhitespace: options.ignoreWhitespace,
    stripTrailingCr: options.ignoreLineEndings,
    timeout: 6000,
  });

  const timeMs = performance.now() - start;

  if (!parts) {
    return { rows: [], stats: null, aborted: true, timeMs };
  }

  const rows = buildRows(parts, options);

  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;
  let oldLines = 0;
  let newLines = 0;
  for (const row of rows) {
    switch (row.kind) {
      case 'added':
        added++;
        break;
      case 'deleted':
        removed++;
        break;
      case 'modified':
        changed++;
        break;
      case 'equal':
        unchanged++;
        break;
    }
    if (row.oldNum !== null) oldLines = row.oldNum;
    if (row.newNum !== null) newLines = row.newNum;
  }

  const stats: DiffStats = {
    added,
    removed,
    changed,
    unchanged,
    oldLines,
    newLines,
  };

  return { rows, stats, aborted: false, timeMs };
}

/**
 * Builds a unified-format patch directly from diff rows, so the exported
 * patch always matches exactly what is displayed (including ignore options
 * and context settings).
 */
export function buildUnifiedPatch(
  rows: DiffRow[],
  context: number | 'all',
  oldName = 'original.txt',
  newName = 'changed.txt',
  eof: PatchEofOptions = {},
): string {
  const trimmed = applyContext(rows, context);
  const maxContext = context === 'all' ? Infinity : context;

  let maxOldNum = 0;
  let maxNewNum = 0;
  for (const row of rows) {
    if (row.oldNum !== null && row.oldNum > maxOldNum) maxOldNum = row.oldNum;
    if (row.newNum !== null && row.newNum > maxNewNum) maxNewNum = row.newNum;
  }
  const isLastOldLine = (n: number | null) =>
    eof.oldNoNewlineAtEof === true && n !== null && n === maxOldNum;
  const isLastNewLine = (n: number | null) =>
    eof.newNoNewlineAtEof === true && n !== null && n === maxNewNum;

  const lines: string[] = [`--- ${oldName}`, `+++ ${newName}`];
  let prevOld = 0;
  let prevNew = 0;
  let equalBuffer: DiffRow[] = [];
  let hunk: {
    lines: string[];
    oldStart: number;
    newStart: number;
    oldLen: number;
    newLen: number;
  } | null = null;

  const flushHunk = () => {
    if (hunk === null) return;
    const oldStart = hunk.oldLen === 0 ? Math.max(0, prevOld) : hunk.oldStart;
    const newStart = hunk.newLen === 0 ? Math.max(0, prevNew) : hunk.newStart;
    lines.push(`@@ -${oldStart},${hunk.oldLen} +${newStart},${hunk.newLen} @@`);
    lines.push(...hunk.lines);
    hunk = null;
  };

  for (const row of trimmed) {
    if (row.kind === 'gap') {
      flushHunk();
      prevOld += row.skipped ?? 0;
      prevNew += row.skipped ?? 0;
      equalBuffer = [];
      continue;
    }

    if (row.kind === 'equal') {
      prevOld = row.oldNum ?? prevOld;
      prevNew = row.newNum ?? prevNew;
      if (hunk !== null) {
        hunk.lines.push(` ${row.oldLine ?? ''}`);
        hunk.oldLen++;
        hunk.newLen++;
        if (isLastOldLine(row.oldNum) || isLastNewLine(row.newNum)) {
          hunk.lines.push(NO_NEWLINE_MARKER);
        }
      } else {
        equalBuffer.push(row);
        if (equalBuffer.length > maxContext) equalBuffer.shift();
      }
      continue;
    }

    if (hunk === null) {
      hunk = {
        lines: equalBuffer.map((r) => ` ${r.oldLine ?? ''}`),
        oldStart: equalBuffer[0]?.oldNum ?? prevOld + 1,
        newStart: equalBuffer[0]?.newNum ?? prevNew + 1,
        oldLen: equalBuffer.length,
        newLen: equalBuffer.length,
      };
    }

    if (row.oldLine !== null) {
      hunk.lines.push(`-${row.oldLine}`);
      hunk.oldLen++;
      if (isLastOldLine(row.oldNum)) {
        hunk.lines.push(NO_NEWLINE_MARKER);
      }
    }
    if (row.newLine !== null) {
      hunk.lines.push(`+${row.newLine}`);
      hunk.newLen++;
      if (isLastNewLine(row.newNum)) {
        hunk.lines.push(NO_NEWLINE_MARKER);
      }
    }
  }
  flushHunk();

  return lines.join('\n') + '\n';
}

export function buildMarkdownDiff(
  rows: DiffRow[],
  context: number | 'all',
  oldName = 'original.txt',
  newName = 'changed.txt',
  eof: PatchEofOptions = {},
): string {
  const patch = buildUnifiedPatch(rows, context, oldName, newName, eof);
  return '```diff\n' + patch.trimEnd() + '\n```\n';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function buildHtmlDiffReport({
  rows,
  stats,
  oldName = 'original.txt',
  newName = 'changed.txt',
}: {
  rows: DiffRow[];
  stats: DiffStats | null;
  oldName?: string;
  newName?: string;
}): string {
  const rowsHtml = rows
    .map((row) => {
      if (row.kind === 'gap') {
        return `<tr class="gap"><td colspan="4">… ${row.skipped ?? ''} lines hidden …</td></tr>`;
      }
      const oldNum = row.oldNum ?? '';
      const newNum = row.newNum ?? '';
      const oldContent = row.oldSpans
        ? row.oldSpans
            .map((s) => `<span class="${s.removed ? 'del-hl' : ''}">${escapeHtml(s.text)}</span>`)
            .join('')
        : escapeHtml(row.oldLine ?? '');
      const newContent = row.newSpans
        ? row.newSpans
            .map((s) => `<span class="${s.added ? 'add-hl' : ''}">${escapeHtml(s.text)}</span>`)
            .join('')
        : escapeHtml(row.newLine ?? '');

      return `<tr class="row-${row.kind}">
        <td class="ln">${oldNum}</td>
        <td class="code code-old">${oldContent}</td>
        <td class="ln">${newNum}</td>
        <td class="code code-new">${newContent}</td>
      </tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Diff Report: ${escapeHtml(oldName)} vs ${escapeHtml(newName)}</title>
<style>
  :root {
    --bg: #ffffff;
    --text: #1b2433;
    --border: #e1e6ee;
    --ln-bg: #f8fafc;
    --ln-color: #667085;
    --add-bg: #e7f8ee;
    --add-hl: #c7f2d8;
    --del-bg: #fdecec;
    --del-hl: #f8cbcb;
    --mod-bg: #fdf6d9;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117;
      --text: #e6edf3;
      --border: #2d3542;
      --ln-bg: #161b22;
      --ln-color: #8b98a9;
      --add-bg: #12291c;
      --add-hl: #1d4430;
      --del-bg: #2a1719;
      --del-hl: #4a2528;
      --mod-bg: #2b2410;
    }
  }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    background: var(--bg);
    color: var(--text);
    margin: 0;
    padding: 24px;
  }
  .header {
    border-bottom: 1px solid var(--border);
    padding-bottom: 16px;
    margin-bottom: 20px;
  }
  .title { margin: 0 0 8px; font-size: 20px; }
  .stats { display: flex; gap: 12px; font-size: 14px; margin-top: 8px; }
  .pill { padding: 3px 8px; border-radius: 999px; font-weight: 600; }
  .pill-add { background: var(--add-bg); color: #1d7a45; }
  .pill-del { background: var(--del-bg); color: #c0392b; }
  .pill-mod { background: var(--mod-bg); color: #8a6d1a; }
  .diff-table {
    width: 100%;
    border-collapse: collapse;
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 13px;
    line-height: 1.5;
  }
  .diff-table th {
    background: var(--ln-bg);
    border: 1px solid var(--border);
    padding: 8px 12px;
    text-align: left;
  }
  .diff-table td {
    padding: 2px 10px;
    vertical-align: top;
    white-space: pre-wrap;
    word-break: break-word;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  }
  .ln {
    width: 50px;
    text-align: right;
    background: var(--ln-bg);
    color: var(--ln-color);
    user-select: none;
    border-right: 1px solid var(--border);
  }
  .row-added { background: var(--add-bg); }
  .row-deleted { background: var(--del-bg); }
  .row-modified { background: var(--mod-bg); }
  .gap td {
    background: var(--ln-bg);
    text-align: center;
    color: var(--ln-color);
    padding: 6px;
    font-style: italic;
  }
  .add-hl { background: var(--add-hl); font-weight: bold; border-radius: 2px; }
  .del-hl { background: var(--del-hl); text-decoration: line-through; border-radius: 2px; }
  @media print {
    body { padding: 0; }
  }
</style>
</head>
<body>
  <div class="header">
    <h1 class="title">Diff: ${escapeHtml(oldName)} ➔ ${escapeHtml(newName)}</h1>
    <div class="stats">
      ${stats ? `
        <span class="pill pill-add">+${stats.added} added</span>
        <span class="pill pill-del">-${stats.removed} removed</span>
        <span class="pill pill-mod">~${stats.changed} changed</span>
        <span>${stats.unchanged} unchanged</span>
      ` : ''}
    </div>
  </div>
  <table class="diff-table">
    <thead>
      <tr>
        <th colspan="2">${escapeHtml(oldName)}</th>
        <th colspan="2">${escapeHtml(newName)}</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;
}
