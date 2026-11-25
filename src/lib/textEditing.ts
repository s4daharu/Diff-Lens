const ENDING = /\r\n|\r|\n/g;

export function normalizeEditorText(text: string): string {
  return text.replace(/\r\n|\r/g, '\n');
}

/** Textareas expose LF only. Reuse the original separators where the edit keeps them. */
export function applyEditorText(previous: string, edited: string): string {
  if (!previous.includes('\r')) return edited;

  const normalized = normalizeEditorText(previous);
  if (edited === normalized) return previous;
  let start = 0;
  while (start < normalized.length && start < edited.length && normalized[start] === edited[start]) start++;
  let oldEnd = normalized.length;
  let newEnd = edited.length;
  while (oldEnd > start && newEnd > start && normalized[oldEnd - 1] === edited[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const before: string[] = [];
  const replaced: string[] = [];
  const after: string[] = [];
  const counts = new Map<string, number>();
  let extra = 0;
  for (const match of previous.matchAll(ENDING)) {
    const ending = match[0];
    const position = match.index - extra;
    extra += ending.length - 1;
    counts.set(ending, (counts.get(ending) ?? 0) + 1);
    (position < start ? before : position < oldEnd ? replaced : after).push(ending);
  }
  let dominant = '\n';
  let max = 0;
  for (const [ending, count] of counts) {
    if (count > max) {
      max = count;
      dominant = ending;
    }
  }
  const nearest = replaced[0] ?? before.at(-1) ?? after[0] ?? dominant;
  let beforeIndex = 0;
  let replacedIndex = 0;
  let afterIndex = 0;
  let lastPosition = -2;
  let lastEnding = '';
  return edited.replace(/\n/g, (_match, position: number) => {
    let ending = position < start ? before[beforeIndex++]
      : position < newEnd ? replaced[replacedIndex++] ?? nearest
        : after[afterIndex++];
    // If an edit puts CR and LF next to one another, keep two physical breaks.
    if (position === lastPosition + 1 && lastEnding === '\r' && ending === '\n') ending = '\r\n';
    lastPosition = position;
    lastEnding = ending;
    return ending;
  });
}
