import type { DiffRow } from './types';

export type SearchSide = 'old' | 'new';

export interface SearchRange {
  start: number;
  end: number;
}

export interface DiffSearchMatch extends SearchRange {
  rowIndex: number;
  side: SearchSide;
}

export function createLineSearch(query: string) {
  const literal = query.trim();
  if (!literal) return null;
  const pattern = new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');

  function* ranges(text: string): Generator<SearchRange> {
    for (const match of text.matchAll(pattern)) {
      yield { start: match.index, end: match.index + match[0].length };
    }
  }

  return ranges;
}

export type LineSearch = NonNullable<ReturnType<typeof createLineSearch>>;

export function indexDiffMatches(rows: DiffRow[], search: LineSearch | null) {
  // Store one entry per matching line rather than one object per occurrence.
  const lines: { rowIndex: number; side: SearchSide; first: number }[] = [];
  let count = 0;
  if (search) {
    rows.forEach((row, rowIndex) => {
      const add = (line: string | null, side: SearchSide) => {
        if (line == null) return;
        const first = count;
        for (const _match of search(line)) count++;
        if (count > first) lines.push({ rowIndex, side, first });
      };
      add(row.oldLine, 'old');
      // An unchanged pair of identical lines is one logical match location.
      if (row.kind !== 'equal' || row.oldLine !== row.newLine) add(row.newLine, 'new');
    });
  }

  function at(index: number): DiffSearchMatch | null {
    if (!search || index < 0 || index >= count) return null;
    let low = 0;
    let high = lines.length;
    while (high - low > 1) {
      const middle = (low + high) >>> 1;
      if (lines[middle].first <= index) low = middle;
      else high = middle;
    }
    const { rowIndex, side, first } = lines[low];
    const line = side === 'old' ? rows[rowIndex].oldLine : rows[rowIndex].newLine;
    let occurrence = first;
    for (const range of search(line ?? '')) {
      if (occurrence++ === index) return { ...range, rowIndex, side };
    }
    return null;
  }

  return { count, at };
}
