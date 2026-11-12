import type { ChangeSection } from './changeSections';

export type MergeDirection =
  | 'changed-to-original'
  | 'original-to-changed';

export interface MergeTexts {
  oldText: string;
  newText: string;
}

interface LineRecord {
  content: string;
  eol: string;
}

interface LineEdit {
  sourceStart: number;
  sourceEnd: number;
  targetStart: number;
  targetEnd: number;
}

function parseLines(text: string): LineRecord[] {
  if (text === '') return [];
  const records: LineRecord[] = [];
  let start = 0;
  let index = 0;

  while (index < text.length) {
    if (text[index] !== '\n' && text[index] !== '\r') {
      index++;
      continue;
    }

    const content = text.slice(start, index);
    let eol = text[index];
    if (text[index] === '\r' && text[index + 1] === '\n') {
      eol = '\r\n';
      index++;
    }
    records.push({ content, eol });
    index++;
    start = index;
  }

  if (start < text.length) records.push({ content: text.slice(start), eol: '' });
  return records;
}

function serializeLines(records: LineRecord[]): string {
  return records.map((line) => line.content + line.eol).join('');
}

function cloneLines(
  records: LineRecord[],
  start: number,
  end: number,
): LineRecord[] {
  return records.slice(start, end).map((line) => ({ ...line }));
}

function applyLineEdits(
  sourceText: string,
  targetText: string,
  edits: LineEdit[],
): string {
  const source = parseLines(sourceText);
  const target = parseLines(targetText);
  const ordered = [...edits].sort(
    (a, b) => b.sourceStart - a.sourceStart || b.sourceEnd - a.sourceEnd,
  );

  let previousStart = Infinity;
  for (const edit of ordered) {
    if (
      edit.sourceStart < 0 ||
      edit.sourceEnd < edit.sourceStart ||
      edit.sourceEnd > source.length ||
      edit.targetStart < 0 ||
      edit.targetEnd < edit.targetStart ||
      edit.targetEnd > target.length
    ) {
      throw new Error('Cannot merge section: source line range is invalid.');
    }
    if (edit.sourceEnd > previousStart) {
      throw new Error('Cannot merge section: source line ranges overlap.');
    }

    const replacement = cloneLines(target, edit.targetStart, edit.targetEnd);
    source.splice(
      edit.sourceStart,
      edit.sourceEnd - edit.sourceStart,
      ...replacement,
    );

    if (edit.sourceStart > 0 && edit.targetStart > 0) {
      const previousTarget = target[edit.targetStart - 1];
      const previousSource = source[edit.sourceStart - 1];
      if (previousSource && previousTarget) {
        previousSource.eol = previousTarget.eol;
      }
    }

    previousStart = edit.sourceStart;
  }

  return serializeLines(source);
}

export function mergeChangeSections(
  oldText: string,
  newText: string,
  sections: ChangeSection[],
  direction: MergeDirection,
): MergeTexts {
  if (sections.length === 0) return { oldText, newText };

  if (direction === 'changed-to-original') {
    const edits = sections.map((section) => ({
      sourceStart: section.oldStartLine,
      sourceEnd: section.oldEndLine,
      targetStart: section.newStartLine,
      targetEnd: section.newEndLine,
    }));
    return {
      oldText: applyLineEdits(oldText, newText, edits),
      newText,
    };
  }

  const edits = sections.map((section) => ({
    sourceStart: section.newStartLine,
    sourceEnd: section.newEndLine,
    targetStart: section.oldStartLine,
    targetEnd: section.oldEndLine,
  }));
  return {
    oldText,
    newText: applyLineEdits(newText, oldText, edits),
  };
}
