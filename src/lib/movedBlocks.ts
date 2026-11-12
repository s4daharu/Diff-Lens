import type { DiffRow, MoveRole } from './types';

const MIN_MOVE_CHARS = 24;
const MIN_MOVE_LINES = 2;
const MAX_FINGERPRINT_CHARS = 6000;
const MAX_GRAMS = 1200;
const MAX_LINES_FOR_SCORE = 200;
const CANDIDATES_PER_BUCKET = 12;
export const MAX_MOVE_COMPARISONS = 5000;
const MIN_FUZZY_SIMILARITY = 0.72;
const MIN_AMBIGUITY_MARGIN = 0.055;

interface MoveCandidate {
  id: number;
  start: number;
  end: number;
  role: MoveRole;
  normalizedLines: string[];
  normalizedText: string;
  signature: string;
  lineCount: number;
  charCount: number;
  bucket: number;
}

export interface MovePair {
  id: number;
  fromStart: number;
  fromEnd: number;
  toStart: number;
  toEnd: number;
  similarity: number;
  exact: boolean;
}

export interface MovedBlockDetection {
  rows: DiffRow[];
  pairs: MovePair[];
  comparisons: number;
}

function normalizeLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ').toLowerCase();
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function candidateLine(row: DiffRow, role: MoveRole): string {
  return role === 'from' ? row.oldLine ?? '' : row.newLine ?? '';
}

function collectCandidates(rows: DiffRow[]): {
  removed: MoveCandidate[];
  added: MoveCandidate[];
} {
  const removed: MoveCandidate[] = [];
  const added: MoveCandidate[] = [];
  let id = 0;

  for (let index = 0; index < rows.length; ) {
    const kind = rows[index]?.kind;
    if (kind !== 'deleted' && kind !== 'added') {
      index++;
      continue;
    }

    const start = index;
    while (index < rows.length && rows[index]?.kind === kind) index++;
    const end = index - 1;
    const role: MoveRole = kind === 'deleted' ? 'from' : 'to';
    const lines = rows.slice(start, index).map((row) => candidateLine(row, role));
    const normalizedLines = lines.map(normalizeLine);
    const normalizedText = normalizedLines.join('\n');
    const meaningfulChars = normalizedText.replace(/\s/g, '').length;

    if (lines.length < MIN_MOVE_LINES && meaningfulChars < MIN_MOVE_CHARS) {
      continue;
    }

    const candidate: MoveCandidate = {
      id: id++,
      start,
      end,
      role,
      normalizedLines,
      normalizedText,
      signature: `${lines.length}:${hashString(normalizedText)}`,
      lineCount: lines.length,
      charCount: normalizedText.length,
      bucket: Math.floor(Math.log2(Math.max(1, lines.length))),
    };
    (role === 'from' ? removed : added).push(candidate);
  }

  return { removed, added };
}

function sampledLines(lines: string[]): string[] {
  if (lines.length <= MAX_LINES_FOR_SCORE) return lines;
  const half = MAX_LINES_FOR_SCORE / 2;
  return [...lines.slice(0, half), ...lines.slice(-half)];
}

function lineDice(left: string[], right: string[]): number {
  const a = sampledLines(left);
  const b = sampledLines(right);
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const line of a) counts.set(line, (counts.get(line) ?? 0) + 1);
  let common = 0;
  for (const line of b) {
    const count = counts.get(line) ?? 0;
    if (count > 0) {
      common++;
      counts.set(line, count - 1);
    }
  }
  return (2 * common) / (a.length + b.length);
}

function gramSet(value: string): Set<string> {
  const text = value.slice(0, MAX_FINGERPRINT_CHARS);
  if (text.length <= 3) return new Set(text ? [text] : []);
  const available = text.length - 2;
  const stride = Math.max(1, Math.ceil(available / MAX_GRAMS));
  const grams = new Set<string>();
  for (let i = 0; i <= text.length - 3; i += stride) {
    grams.add(text.slice(i, i + 3));
  }
  return grams;
}

function gramDice(left: string, right: string): number {
  const a = gramSet(left);
  const b = gramSet(right);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const gram of small) if (large.has(gram)) common++;
  return (2 * common) / (a.size + b.size);
}

function candidateSimilarity(
  removed: MoveCandidate,
  added: MoveCandidate,
): number {
  const maxChars = Math.max(removed.charCount, added.charCount, 1);
  const lengthRatio = Math.min(removed.charCount, added.charCount) / maxChars;
  if (lengthRatio < 0.55) return 0;

  const lineScore = lineDice(removed.normalizedLines, added.normalizedLines);
  const gramScore = gramDice(removed.normalizedText, added.normalizedText);
  if (lineScore < 0.35 && gramScore < 0.55) return 0;

  return (
    (0.42 * lineScore + 0.58 * gramScore) *
    (0.8 + 0.2 * lengthRatio)
  );
}

function nearestByCharCount(
  sorted: MoveCandidate[],
  charCount: number,
  limit: number,
): MoveCandidate[] {
  if (sorted.length <= limit) return sorted;

  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sorted[mid].charCount < charCount) low = mid + 1;
    else high = mid;
  }

  let left = low - 1;
  let right = low;
  const result: MoveCandidate[] = [];
  while (result.length < limit && (left >= 0 || right < sorted.length)) {
    const leftDistance =
      left >= 0 ? Math.abs(sorted[left].charCount - charCount) : Infinity;
    const rightDistance =
      right < sorted.length
        ? Math.abs(sorted[right].charCount - charCount)
        : Infinity;
    if (leftDistance <= rightDistance) result.push(sorted[left--]);
    else result.push(sorted[right++]);
  }
  return result;
}

interface BestMatch {
  peerId: number;
  score: number;
  secondScore: number;
}

function recordBest(
  map: Map<number, BestMatch>,
  ownerId: number,
  peerId: number,
  score: number,
): void {
  const current = map.get(ownerId);
  if (!current) {
    map.set(ownerId, { peerId, score, secondScore: -Infinity });
    return;
  }
  if (score > current.score) {
    current.secondScore = current.score;
    current.score = score;
    current.peerId = peerId;
  } else if (score > current.secondScore) {
    current.secondScore = score;
  }
}

function hasEnoughMargin(match: BestMatch): boolean {
  return (
    match.secondScore === -Infinity ||
    match.score - match.secondScore >= MIN_AMBIGUITY_MARGIN
  );
}

export function detectMovedBlocks(rows: DiffRow[]): MovedBlockDetection {
  const { removed, added } = collectCandidates(rows);
  if (removed.length === 0 || added.length === 0) {
    return { rows, pairs: [], comparisons: 0 };
  }

  const pairedRemoved = new Set<number>();
  const pairedAdded = new Set<number>();
  const provisional: Array<{
    from: MoveCandidate;
    to: MoveCandidate;
    similarity: number;
    exact: boolean;
  }> = [];

  const removedBySignature = new Map<string, MoveCandidate[]>();
  const addedBySignature = new Map<string, MoveCandidate[]>();
  for (const candidate of removed) {
    const list = removedBySignature.get(candidate.signature) ?? [];
    list.push(candidate);
    removedBySignature.set(candidate.signature, list);
  }
  for (const candidate of added) {
    const list = addedBySignature.get(candidate.signature) ?? [];
    list.push(candidate);
    addedBySignature.set(candidate.signature, list);
  }

  for (const [signature, fromList] of removedBySignature) {
    const toList = addedBySignature.get(signature);
    if (
      fromList.length === 1 &&
      toList?.length === 1 &&
      fromList[0].normalizedText === toList[0].normalizedText
    ) {
      provisional.push({
        from: fromList[0],
        to: toList[0],
        similarity: 1,
        exact: true,
      });
      pairedRemoved.add(fromList[0].id);
      pairedAdded.add(toList[0].id);
    }
  }

  const buckets = new Map<number, MoveCandidate[]>();
  for (const candidate of added) {
    if (pairedAdded.has(candidate.id)) continue;
    const list = buckets.get(candidate.bucket) ?? [];
    list.push(candidate);
    buckets.set(candidate.bucket, list);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => a.charCount - b.charCount);
  }

  const removedById = new Map(
    removed.map((candidate) => [candidate.id, candidate]),
  );
  const addedById = new Map(added.map((candidate) => [candidate.id, candidate]));
  const bestForRemoved = new Map<number, BestMatch>();
  const bestForAdded = new Map<number, BestMatch>();
  let comparisons = 0;

  outer: for (const from of removed) {
    if (pairedRemoved.has(from.id)) continue;
    const candidates = new Map<number, MoveCandidate>();
    for (let bucket = from.bucket - 1; bucket <= from.bucket + 1; bucket++) {
      const list = buckets.get(bucket);
      if (!list) continue;
      for (const candidate of nearestByCharCount(
        list,
        from.charCount,
        CANDIDATES_PER_BUCKET,
      )) {
        candidates.set(candidate.id, candidate);
      }
    }

    for (const to of candidates.values()) {
      if (comparisons >= MAX_MOVE_COMPARISONS) break outer;
      comparisons++;
      const score = candidateSimilarity(from, to);
      if (score < MIN_FUZZY_SIMILARITY) continue;
      recordBest(bestForRemoved, from.id, to.id, score);
      recordBest(bestForAdded, to.id, from.id, score);
    }
  }

  for (const [fromId, fromMatch] of bestForRemoved) {
    if (
      pairedRemoved.has(fromId) ||
      fromMatch.score < MIN_FUZZY_SIMILARITY ||
      !hasEnoughMargin(fromMatch)
    ) {
      continue;
    }
    const toMatch = bestForAdded.get(fromMatch.peerId);
    if (
      !toMatch ||
      toMatch.peerId !== fromId ||
      !hasEnoughMargin(toMatch) ||
      pairedAdded.has(fromMatch.peerId)
    ) {
      continue;
    }
    const from = removedById.get(fromId);
    const to = addedById.get(fromMatch.peerId);
    if (!from || !to) continue;
    provisional.push({
      from,
      to,
      similarity: Math.min(fromMatch.score, toMatch.score),
      exact: false,
    });
    pairedRemoved.add(from.id);
    pairedAdded.add(to.id);
  }

  provisional.sort(
    (a, b) =>
      Math.min(a.from.start, a.to.start) - Math.min(b.from.start, b.to.start),
  );

  const annotated = rows.map((row) => ({ ...row }));
  const pairs: MovePair[] = provisional.map((pair, index) => {
    const id = index + 1;
    const similarity = Number(pair.similarity.toFixed(3));
    for (let rowIndex = pair.from.start; rowIndex <= pair.from.end; rowIndex++) {
      annotated[rowIndex] = {
        ...annotated[rowIndex],
        moveId: id,
        moveRole: 'from',
        moveSimilarity: similarity,
        moveExact: pair.exact,
      };
    }
    for (let rowIndex = pair.to.start; rowIndex <= pair.to.end; rowIndex++) {
      annotated[rowIndex] = {
        ...annotated[rowIndex],
        moveId: id,
        moveRole: 'to',
        moveSimilarity: similarity,
        moveExact: pair.exact,
      };
    }
    return {
      id,
      fromStart: pair.from.start,
      fromEnd: pair.from.end,
      toStart: pair.to.start,
      toEnd: pair.to.end,
      similarity,
      exact: pair.exact,
    };
  });

  return { rows: annotated, pairs, comparisons };
}
