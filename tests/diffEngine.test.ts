import {
  computeDiff,
  applyContext,
  buildUnifiedPatch,
  buildMarkdownDiff,
  buildHtmlDiffReport,
  countLines,
  countWords,
  formatJson,
  applyTextTransform,
  hasNoNewlineAtEof,
  chooseSmartGranularity,
} from '../src/lib/diffEngine';
import { validateIgnoreRule } from '../src/lib/ignoreRules';
import type { DiffOptions } from '../src/lib/types';
import { applyPatch } from 'diff';
import { buildVirtualOffsets, findVirtualIndex, getVirtualRange } from '../src/lib/virtualRows';
import { buildChangeSections } from '../src/lib/changeSections';
import {
  MAX_MOVE_COMPARISONS,
  detectMovedBlocks,
} from '../src/lib/movedBlocks';
import {
  SESSION_FORMAT,
  createComparisonSession,
  parseComparisonSession,
  serializeComparisonSession,
  sessionFileName,
} from '../src/lib/session';

const base: DiffOptions = {
  ignoreCase: false,
  ignoreWhitespace: false,
  ignoreLineEndings: false,
  context: 'all',
  granularity: 'chars',
  ignoreRules: [],
};

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}`, detail ?? '');
  }
}

console.log('--- basic modification ---');
{
  const oldText = 'a\nb\nc\nd\ne\n';
  const newText = 'a\nB\nc\nd\nf\n';
  const r = computeDiff(oldText, newText, base);
  check('not aborted', !r.aborted);
  check('stats changed=2', r.stats?.changed === 2, r.stats);
  check('stats unchanged=3', r.stats?.unchanged === 3, r.stats);
  check('row count = 5', r.rows.length === 5);
  const modified = r.rows.filter((x) => x.kind === 'modified');
  check('modified rows have spans', modified.every((m) => m.oldSpans && m.newSpans));
  check('modified old/new content', modified[0].oldLine === 'b' && modified[0].newLine === 'B', modified[0]);
  check('old numbers sequential', r.rows.map((x) => x.oldNum).join(',') === '1,2,3,4,5');
  check('new numbers sequential', r.rows.map((x) => x.newNum).join(',') === '1,2,3,4,5');
}

console.log('--- pure addition at end ---');
{
  const r = computeDiff('a\nb\n', 'a\nb\nc\n', base);
  check('stats added=1', r.stats?.added === 1, r.stats);
  const kinds = r.rows.map((x) => x.kind).join(',');
  check('kinds equal,equal,added', kinds === 'equal,equal,added', kinds);
  check('added newNum=3', r.rows[2].newNum === 3 && r.rows[2].oldNum === null);
}

console.log('--- pure deletion ---');
{
  const r = computeDiff('a\nb\nc\n', 'a\nc\n', base);
  check('stats removed=1', r.stats?.removed === 1, r.stats);
  const kinds = r.rows.map((x) => x.kind).join(',');
  check('kinds equal,deleted,equal', kinds === 'equal,deleted,equal', kinds);
  check('deleted oldNum=2', r.rows[1].oldNum === 2 && r.rows[1].newNum === null);
}

console.log('--- ignore case ---');
{
  const r = computeDiff('Hello World\nfoo\n', 'hello WORLD\nfoo\n', {
    ...base,
    ignoreCase: true,
  });
  check('identical under ignoreCase', r.stats?.unchanged === 2 && r.stats?.changed === 0, r.stats);
}

console.log('--- ignore whitespace ---');
{
  const r = computeDiff('foo\n  bar  \nbaz\n', 'foo\nbar\nbaz\n', {
    ...base,
    ignoreWhitespace: true,
  });
  check('identical under ignoreWhitespace', r.stats?.unchanged === 3 && r.stats?.changed === 0, r.stats);
}

console.log('--- ignore line endings (CRLF) ---');
{
  const r = computeDiff('a\r\nb\r\n', 'a\nb\n', { ...base, ignoreLineEndings: true });
  check('identical under ignoreLineEndings', r.stats?.unchanged === 2, r.stats);
  const r2 = computeDiff('a\r\nb\r\n', 'a\nb\n', base);
  check('differs without option', r2.stats?.unchanged !== 2, r2.stats);
}

console.log('--- blank lines preserved ---');
{
  const r = computeDiff('a\n\nb\n', 'a\nb\n', base);
  const kinds = r.rows.map((x) => x.kind).join(',');
  check('blank line shows as deleted', kinds === 'equal,deleted,equal', kinds);
  check('deleted line is empty', r.rows[1].oldLine === '', r.rows[1]);
}

console.log('--- no trailing newline ---');
{
  const r = computeDiff('a\nb', 'a\nb\nc', base);
  check('added=1', r.stats?.added === 1, r.stats);
}

console.log('--- empty vs content ---');
{
  const r = computeDiff('', 'x\ny\n', base);
  check('added=2', r.stats?.added === 2, r.stats);
  check('oldLines=0, newLines=2', r.stats?.oldLines === 0 && r.stats?.newLines === 2, r.stats);
}

console.log('--- custom ignore rules and smart precision ---');
{
  const timestampRule = {
    kind: 'regex' as const,
    pattern: '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z',
    enabled: true,
  };
  const ignored = computeDiff(
    '2026-11-12T10:00:00Z request ready\n',
    '2026-11-12T10:00:09Z request ready\n',
    { ...base, ignoreRules: [timestampRule] },
  );
  check(
    'regex ignore makes volatile timestamp equal',
    ignored.stats?.unchanged === 1 && ignored.stats.changed === 0,
    ignored.stats,
  );
  check(
    'ignored equality preserves original source text',
    ignored.rows[0]?.oldLine === '2026-11-12T10:00:00Z request ready' &&
      ignored.rows[0]?.newLine === '2026-11-12T10:00:09Z request ready',
    ignored.rows[0],
  );

  const mixed = computeDiff(
    '2026-11-12T10:00:00Z status=READY id=abc123\n',
    '2026-11-12T10:00:09Z status=FAILED id=xyz999\n',
    {
      ...base,
      ignoreRules: [
        timestampRule,
        { kind: 'regex', pattern: 'id=[a-z0-9]+', enabled: true },
      ],
    },
  );
  const oldHighlighted = (mixed.rows[0]?.oldSpans ?? [])
    .filter((span) => span.removed)
    .map((span) => span.text)
    .join('');
  const newHighlighted = (mixed.rows[0]?.newSpans ?? [])
    .filter((span) => span.added)
    .map((span) => span.text)
    .join('');
  check(
    'real change still highlighted beside ignored noise',
    oldHighlighted.length > 0 &&
      newHighlighted.length > 0 &&
      !oldHighlighted.includes('10:00:00') &&
      !newHighlighted.includes('10:00:09') &&
      !oldHighlighted.includes('abc123') &&
      !newHighlighted.includes('xyz999'),
    { oldHighlighted, newHighlighted, row: mixed.rows[0] },
  );
  check(
    'masked spans reconstruct original lines',
    (mixed.rows[0]?.oldSpans ?? []).map((span) => span.text).join('') ===
        mixed.rows[0]?.oldLine &&
      (mixed.rows[0]?.newSpans ?? []).map((span) => span.text).join('') ===
        mixed.rows[0]?.newLine,
    mixed.rows[0],
  );

  const literalIgnored = computeDiff(
    'request DEBUG payload\n',
    'request payload\n',
    {
      ...base,
      ignoreRules: [
        { kind: 'literal', pattern: 'DEBUG ', enabled: true },
      ],
    },
  );
  check(
    'literal ignore masks fixed noise',
    literalIgnored.stats?.unchanged === 1,
    literalIgnored.stats,
  );

  const uuidIgnored = computeDiff(
    'build=10429 id=550e8400-e29b-41d4-a716-446655440000\n',
    'build=10439 id=7d444840-9dc0-11d1-b245-5ffdce74fad2\n',
    {
      ...base,
      ignoreRules: [
        { kind: 'regex', pattern: 'build=\\d+', enabled: true },
        {
          kind: 'regex',
          pattern:
            '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
          enabled: true,
        },
      ],
    },
  );
  check(
    'regex rules ignore UUID and build-number noise',
    uuidIgnored.stats?.unchanged === 1,
    uuidIgnored.stats,
  );

  check(
    'invalid regex is rejected',
    validateIgnoreRule({
      kind: 'regex',
      pattern: '(',
      enabled: true,
    })?.startsWith('Invalid regex:') === true,
  );
  check(
    'nested quantified regex is rejected',
    validateIgnoreRule({
      kind: 'regex',
      pattern: '(a+)+$',
      enabled: true,
    })?.includes('Nested quantified') === true,
  );

  check(
    'smart precision chooses words for prose',
    chooseSmartGranularity(
      'The quick brown fox jumps over the lazy dog in the garden.',
      'The quick brown fox walks over the lazy dog in the garden.',
    ) === 'words',
  );
  check(
    'smart precision chooses chars for identifiers',
    chooseSmartGranularity('release_build_10429', 'release_build_10439') ===
      'chars',
  );
}

console.log('--- context trimming ---');
{
  const r = computeDiff('1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n', '1\n2\nX\n4\n5\n6\nY\n8\n9\n10\n', base);
  const trimmed = applyContext(r.rows, 1);
  const kinds = trimmed.map((x) => x.kind).join(',');
  check('gap present', trimmed.some((x) => x.kind === 'gap'), kinds);
  const gap = trimmed.find((x) => x.kind === 'gap');
  check('gap skipped=1', gap?.skipped === 1, gap);
  check('kept rows = 9 (6 + three gaps)', trimmed.length === 9, trimmed.length);
}

console.log('--- unified patch ---');
{
  const oldText = 'alpha\nbeta\ngamma\ndelta\n';
  const newText = 'alpha\nBETA\ngamma\nepsilon\n';
  const r = computeDiff(oldText, newText, base);
  const patch = buildUnifiedPatch(r.rows, 'all');
  console.log(patch);
  check('patch has headers', patch.startsWith('--- original.txt\n+++ changed.txt\n'), patch);
  check('patch has hunk', patch.includes('@@ -1,4 +1,4 @@'), patch);
  check('patch has -beta', patch.includes('-beta'), patch);
  check('patch has +BETA', patch.includes('+BETA'), patch);
  check('patch has +epsilon', patch.includes('+epsilon'), patch);
}

console.log('--- patch with context=1 ---');
{
  const oldText = '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n';
  const newText = '1\n2\nX\n4\n5\n6\nY\n8\n9\n10\n';
  const r = computeDiff(oldText, newText, base);
  const patch = buildUnifiedPatch(r.rows, 1);
  console.log(patch);
  check('two hunks', (patch.match(/@@/g) ?? []).length === 4, patch);
  check('first hunk -2,3 +2,3', patch.includes('@@ -2,3 +2,3 @@'), patch);
  check('second hunk -6,3 +6,3', patch.includes('@@ -6,3 +6,3 @@'), patch);
}

console.log('--- countLines & countWords ---');
{
  check('countLines empty', countLines('') === 0);
  check('countLines a\\n', countLines('a\n') === 1);
  check('countLines a\\n\\n', countLines('a\n\n') === 2);
  check('countLines no trailing', countLines('a\nb') === 2);
  check('countLines crlf', countLines('a\r\nb\r\n') === 2);
  check('countWords empty', countWords('') === 0);
  check('countWords text', countWords('hello world foo bar') === 4);
  check('countWords with whitespace', countWords('   multi \n line \t string   ') === 3);
}

console.log('--- formatJson and applyTextTransform ---');
{
  const jsonRaw = '{"b":2,"a":1}';
  const jsonFmt = formatJson(jsonRaw);
  check('formatJson success', jsonFmt.success && jsonFmt.result.includes('\n  "b": 2'));
  const jsonInvalid = formatJson('{not json}');
  check('formatJson error', !jsonInvalid.success && jsonInvalid.error !== undefined);

  const sortRes = applyTextTransform('cherry\napple\nbanana\n', 'sort-lines');
  check('sort-lines', sortRes.result === 'apple\nbanana\ncherry\n');

  const sortDescRes = applyTextTransform('apple\ncherry\nbanana\n', 'sort-lines-desc');
  check('sort-lines-desc', sortDescRes.result === 'cherry\nbanana\napple\n');

  const trimRes = applyTextTransform('  foo  \n  bar   \n', 'trim-whitespace');
  check('trim-whitespace', trimRes.result === 'foo\nbar\n');

  const blankRes = applyTextTransform('foo\n\n   \nbar\n', 'remove-blank-lines');
  check('remove-blank-lines', blankRes.result === 'foo\nbar\n');
}

console.log('--- buildMarkdownDiff and buildHtmlDiffReport ---');
{
  const r = computeDiff('hello\nworld\n', 'hello\nWORLD\n', base);
  const md = buildMarkdownDiff(r.rows, 'all', 'a.txt', 'b.txt');
  check('markdown diff starts with ```diff', md.startsWith('```diff\n'));
  check('markdown diff ends with ```\\n', md.endsWith('```\n'));
  check('markdown diff has +WORLD', md.includes('+WORLD'));

  const html = buildHtmlDiffReport({
    rows: r.rows,
    stats: r.stats,
    oldName: 'a.txt',
    newName: 'b.txt',
  });
  check('html report has doctype', html.includes('<!DOCTYPE html>'));
  check('html report has diff table', html.includes('class="diff-table"'));
  const filteredHtml = buildHtmlDiffReport({
    rows: r.rows,
    stats: r.stats,
    oldName: 'a.txt',
    newName: 'b.txt',
    options: {
      ...base,
      granularity: 'smart',
      ignoreRules: [
        { kind: 'literal', pattern: 'request-id=', enabled: true },
      ],
    },
  });
  check(
    'html report discloses comparison filters',
    filteredHtml.includes('1 custom ignore rule') &&
      filteredHtml.includes('smart intra-line precision'),
  );
}

console.log('--- no newline at EOF markers ---');
{
  const MARKER = '\\ No newline at end of file';

  check('hasNoNewlineAtEof', hasNoNewlineAtEof('a') && !hasNoNewlineAtEof('a\n') && !hasNoNewlineAtEof('a\r\n') && !hasNoNewlineAtEof(''));

  const r = computeDiff('a', 'b', base);
  const p = buildUnifiedPatch(r.rows, 'all', 'f.txt', 'g.txt', {
    oldNoNewlineAtEof: true,
    newNoNewlineAtEof: true,
  });
  check(
    'markers after both - and + lines',
    p === `--- f.txt\n+++ g.txt\n@@ -1,1 +1,1 @@\n-a\n${MARKER}\n+b\n${MARKER}\n`,
    p,
  );
  check('round-trip both no-newline', applyPatch('a', p) === 'b', applyPatch('a', p));

  const r2 = computeDiff('x\na', 'y\nb\n', base);
  const p2 = buildUnifiedPatch(r2.rows, 'all', 'f.txt', 'g.txt', { oldNoNewlineAtEof: true });
  check(
    'marker only on old side',
    p2.includes(`-a\n${MARKER}\n`) && !p2.includes(`+b\n${MARKER}`),
    p2,
  );
  check('round-trip old-only no-newline', applyPatch('x\na', p2) === 'y\nb\n');

  const r3 = computeDiff('a\n', 'b\n', base);
  const p3 = buildUnifiedPatch(r3.rows, 'all', 'f.txt', 'g.txt');
  check('no markers when both sides end with newline', !p3.includes(MARKER), p3);

  const r4 = computeDiff('q\nz\nlast', 'w\nz\nlast', base);
  const p4 = buildUnifiedPatch(r4.rows, 'all', 'f', 'g', {
    oldNoNewlineAtEof: true,
    newNoNewlineAtEof: true,
  });
  check('marker after shared trailing context line', p4.endsWith(` z\n last\n${MARKER}\n`), p4);
  check('round-trip context no-newline', applyPatch('q\nz\nlast', p4) === 'w\nz\nlast');

  const r5 = computeDiff('1\n2\n3\n4\n5\nno-nl-end', '1\nX\n3\n4\n5\nno-nl-end', base);
  const p5 = buildUnifiedPatch(r5.rows, 1, 'f', 'g', {
    oldNoNewlineAtEof: true,
    newNoNewlineAtEof: true,
  });
  check('no marker when last line trimmed out by context', !p5.includes(MARKER), p5);

  const r6 = computeDiff('a', 'b', base);
  const md = buildMarkdownDiff(r6.rows, 'all', 'a.txt', 'b.txt', {
    oldNoNewlineAtEof: true,
    newNoNewlineAtEof: true,
  });
  check('markdown diff includes markers', md.includes(MARKER), md);

  const r7 = computeDiff('keep\nold-end', 'keep\nnew-end', base);
  const p7 = buildUnifiedPatch(r7.rows, 'all', 'f', 'g', { newNoNewlineAtEof: true });
  check(
    'marker only on new side',
    p7.includes(`-old-end\n+new-end\n${MARKER}\n`) && !p7.includes(`-old-end\n${MARKER}`),
    p7,
  );
}

console.log('--- applyContext with expanded gap indices ---');
{
  const r = computeDiff('1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n', '1\n2\nX\n4\n5\n6\nY\n8\n9\n10\n', base);
  const initialTrimmed = applyContext(r.rows, 1);
  check('initial has gap', initialTrimmed.some((x) => x.kind === 'gap'));
  const gap = initialTrimmed.find((x) => x.kind === 'gap' && x.gapStartRow === 4);
  check('gap has gapStartRow & gapEndRow', gap?.gapStartRow === 4 && gap?.gapEndRow === 4);

  // Expand row 4 (the skipped line)
  const expanded = applyContext(r.rows, 1, new Set([4]));
  check('expanded middle gap is gone', !expanded.some((x) => x.kind === 'gap' && x.gapStartRow === 4));
  check('expanded keeps edge gaps', expanded.filter((x) => x.kind === 'gap').length === 2);
  check('expanded length = 9', expanded.length === 9);
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURES'}`);
console.log('--- CR-only and mixed line endings ---');
{
  const oldText = 'alpha\rbeta\rgamma\r';
  const newText = 'alpha\rBETA\rgamma\r';
  const r = computeDiff(oldText, newText, base);
  check('CR-only produces three numbered rows', r.rows.length === 3 && r.stats?.oldLines === 3 && r.stats?.newLines === 3, r.rows);
  check('CR-only isolates the modified line', r.stats?.changed === 1 && r.rows[1]?.oldLine === 'beta' && r.rows[1]?.newLine === 'BETA', r.rows);
  const normalized = computeDiff('one\rtwo\rthree\r', 'one\ntwo\nthree\n', { ...base, ignoreLineEndings: true });
  check('ignore line endings normalizes bare CR', normalized.stats?.unchanged === 3 && normalized.stats?.changed === 0, normalized.stats);
  const mixed = computeDiff('a\r\nb\rc\n', 'a\nb\nc\n', { ...base, ignoreLineEndings: true });
  check('ignore line endings normalizes mixed endings', mixed.stats?.unchanged === 3, mixed.stats);
}

console.log('--- context gaps at file boundaries ---');
{
  const oldText = 'top\nsecond\nmiddle\nfourth\nbottom\n';
  const newText = 'top\nsecond\nCHANGED\nfourth\nbottom\n';
  const r = computeDiff(oldText, newText, base);
  const trimmed = applyContext(r.rows, 0);
  check('leading gap visible', trimmed[0]?.kind === 'gap' && trimmed[0].skipped === 2 && trimmed[0].gapStartRow === 0 && trimmed[0].gapEndRow === 1, trimmed);
  check('trailing gap visible', trimmed[2]?.kind === 'gap' && trimmed[2].skipped === 2 && trimmed[2].gapStartRow === 3 && trimmed[2].gapEndRow === 4, trimmed);
  check('context-zero patch still applies', applyPatch(oldText, buildUnifiedPatch(r.rows, 0)) === newText);
  const expanded = applyContext(r.rows, 0, new Set([0, 1, 3, 4]));
  check('all boundary gaps can expand', expanded.length === 5 && expanded.every((row) => row.kind !== 'gap'), expanded);
}

console.log('--- change sections ---');
{
  const r = computeDiff(
    'a\nb\nc\nd\ne\nf\n',
    'a\nB\nC\nd\ne\nF\n',
    base,
  );
  const sections = buildChangeSections(r.rows);
  check('contiguous edits form two sections', sections.length === 2, sections);
  check(
    'first section spans two changed rows',
    sections[0]?.count === 2 &&
      sections[0]?.rowIndex === 1 &&
      sections[0]?.endRowIndex === 2,
    sections[0],
  );
  check(
    'second section starts after unchanged lines',
    sections[1]?.rowIndex === 5 && sections[1]?.count === 1,
    sections[1],
  );
}

console.log('--- moved-block detection ---');
{
  const exactOld = 'start\nalpha moved line\nbeta moved line\nend\n';
  const exactNew = 'start\nend\nalpha moved line\nbeta moved line\n';
  const exactDiff = computeDiff(exactOld, exactNew, base);
  const exact = detectMovedBlocks(exactDiff.rows);
  check('exact move produces one pair', exact.pairs.length === 1, exact.pairs);
  check(
    'exact move annotates from and to rows',
    exact.rows.some((row) => row.moveRole === 'from') &&
      exact.rows.some((row) => row.moveRole === 'to') &&
      exact.pairs[0]?.exact === true,
    exact.rows,
  );
  const exactSections = buildChangeSections(exact.rows);
  const movedSections = exactSections.filter((section) => section.moveId != null);
  check(
    'moved sections link to their peer',
    movedSections.length === 2 &&
      movedSections.every((section) => section.movePeerRowIndex != null),
    movedSections,
  );
  const exactPatch = buildUnifiedPatch(exact.rows, 'all');
  check(
    'move metadata does not change patch semantics',
    applyPatch(exactOld, exactPatch) === exactNew,
    exactPatch,
  );

  const fuzzyRows = [
    { kind: 'deleted' as const, oldLine: 'Project Atlas status: ready', newLine: null, oldNum: 1, newNum: null },
    { kind: 'deleted' as const, oldLine: 'Owner: Alice', newLine: null, oldNum: 2, newNum: null },
    { kind: 'deleted' as const, oldLine: 'Due: Friday', newLine: null, oldNum: 3, newNum: null },
    { kind: 'equal' as const, oldLine: 'separator', newLine: 'separator', oldNum: 4, newNum: 1 },
    { kind: 'added' as const, oldLine: null, newLine: 'Project Atlas status: ready', oldNum: null, newNum: 2 },
    { kind: 'added' as const, oldLine: null, newLine: 'Owner: Bob', oldNum: null, newNum: 3 },
    { kind: 'added' as const, oldLine: null, newLine: 'Due: Friday', oldNum: null, newNum: 4 },
  ];
  const fuzzy = detectMovedBlocks(fuzzyRows);
  check(
    'lightly edited moved block is paired',
    fuzzy.pairs.length === 1 &&
      fuzzy.pairs[0]?.exact === false &&
      fuzzy.pairs[0]?.similarity >= 0.72,
    fuzzy.pairs,
  );

  const duplicateRows = [
    { kind: 'deleted' as const, oldLine: 'duplicate block first line', newLine: null, oldNum: 1, newNum: null },
    { kind: 'deleted' as const, oldLine: 'duplicate block second line', newLine: null, oldNum: 2, newNum: null },
    { kind: 'equal' as const, oldLine: 'one', newLine: 'one', oldNum: 3, newNum: 1 },
    { kind: 'deleted' as const, oldLine: 'duplicate block first line', newLine: null, oldNum: 4, newNum: null },
    { kind: 'deleted' as const, oldLine: 'duplicate block second line', newLine: null, oldNum: 5, newNum: null },
    { kind: 'equal' as const, oldLine: 'two', newLine: 'two', oldNum: 6, newNum: 2 },
    { kind: 'added' as const, oldLine: null, newLine: 'duplicate block first line', oldNum: null, newNum: 3 },
    { kind: 'added' as const, oldLine: null, newLine: 'duplicate block second line', oldNum: null, newNum: 4 },
    { kind: 'equal' as const, oldLine: 'three', newLine: 'three', oldNum: 7, newNum: 5 },
    { kind: 'added' as const, oldLine: null, newLine: 'duplicate block first line', oldNum: null, newNum: 6 },
    { kind: 'added' as const, oldLine: null, newLine: 'duplicate block second line', oldNum: null, newNum: 7 },
  ];
  const duplicate = detectMovedBlocks(duplicateRows);
  check(
    'ambiguous duplicate blocks are not guessed',
    duplicate.pairs.length === 0 &&
      duplicate.rows.every((row) => row.moveId == null),
    duplicate.pairs,
  );

  const manyRows = [];
  let oldNum = 0;
  let newNum = 0;
  for (let i = 0; i < 450; i++) {
    manyRows.push(
      { kind: 'deleted' as const, oldLine: `removed section ${i} alpha unique payload`, newLine: null, oldNum: ++oldNum, newNum: null },
      { kind: 'deleted' as const, oldLine: `removed section ${i} beta unique payload`, newLine: null, oldNum: ++oldNum, newNum: null },
      { kind: 'equal' as const, oldLine: `separator old ${i}`, newLine: `separator new ${i}`, oldNum: ++oldNum, newNum: ++newNum },
    );
  }
  for (let i = 0; i < 450; i++) {
    manyRows.push(
      { kind: 'added' as const, oldLine: null, newLine: `different section ${i} gamma payload`, oldNum: null, newNum: ++newNum },
      { kind: 'added' as const, oldLine: null, newLine: `different section ${i} delta payload`, oldNum: null, newNum: ++newNum },
      { kind: 'equal' as const, oldLine: `tail old ${i}`, newLine: `tail new ${i}`, oldNum: ++oldNum, newNum: ++newNum },
    );
  }
  const bounded = detectMovedBlocks(manyRows);
  check(
    'fuzzy move comparisons stay bounded on large candidate sets',
    bounded.comparisons <= MAX_MOVE_COMPARISONS,
    bounded.comparisons,
  );
}

console.log('--- comparison sessions ---');
{
  const session = createComparisonSession({
    name: ' API Migration Review ',
    oldText: '',
    newText: 'changed\n',
    oldName: 'empty.txt',
    newName: 'changed.txt',
    oldReady: true,
    newReady: true,
    options: {
      ...base,
      context: 3,
      ignoreLineEndings: true,
      granularity: 'smart',
      ignoreRules: [
        { kind: 'literal', pattern: 'request-id=', enabled: true },
      ],
    },
    viewMode: 'inline',
    wrap: true,
    lineNumbers: false,
    syntaxEnabled: false,
  });
  const parsed = parseComparisonSession(serializeComparisonSession(session));
  check('session format is versioned', parsed.format === SESSION_FORMAT && parsed.version === 1);
  check('session name is normalized', parsed.name === 'API Migration Review', parsed.name);
  check('session preserves empty ready source', parsed.sources.original.ready && parsed.sources.original.text === '', parsed.sources.original);
  check('session preserves source filenames', parsed.sources.original.name === 'empty.txt' && parsed.sources.changed.name === 'changed.txt', parsed.sources);
  check(
    'session restores diff options and custom rules',
    parsed.preferences.options.context === 3 &&
      parsed.preferences.options.ignoreLineEndings &&
      parsed.preferences.options.granularity === 'smart' &&
      parsed.preferences.options.ignoreRules[0]?.pattern === 'request-id=',
    parsed.preferences.options,
  );
  check('session restores view preferences', parsed.preferences.viewMode === 'inline' && parsed.preferences.wrap && !parsed.preferences.lineNumbers && !parsed.preferences.syntaxEnabled, parsed.preferences);
  check('session filename is safe', sessionFileName(parsed.name) === 'api-migration-review.difflens.json', sessionFileName(parsed.name));

  let badVersion = false;
  try {
    parseComparisonSession(JSON.stringify({ ...session, version: 99 }));
  } catch (error) {
    badVersion =
      error instanceof Error && error.message.includes('unsupported version');
  }
  check('unsupported session versions are rejected', badVersion);

  let malformed = false;
  try {
    parseComparisonSession('{not json');
  } catch (error) {
    malformed =
      error instanceof Error && error.message.includes('not valid JSON');
  }
  check('malformed session files are rejected', malformed);
}

console.log('--- virtual row layout ---');
{
  const measured = new Map<number, number>([[1, 40]]);
  const offsets = buildVirtualOffsets(4, measured, () => 20);
  check(
    'virtual offsets include measured row heights',
    offsets.join(',') === '0,20,60,80,100',
    offsets,
  );
  check('virtual index lookup finds measured row', findVirtualIndex(offsets, 45) === 1);
  const range = getVirtualRange(offsets, 45, 20, 0);
  check(
    'virtual range includes viewport rows',
    range.start === 1 &&
      range.end === 3 &&
      range.topPadding === 20 &&
      range.bottomPadding === 20 &&
      range.totalHeight === 100,
    range,
  );
  const overscanned = getVirtualRange(offsets, 45, 20, 20);
  check(
    'virtual range overscans both directions',
    overscanned.start === 1 && overscanned.end === 4,
    overscanned,
  );
}

console.log('--- patch round-trip ---');
{
  const cases = [
    ['alpha\nbeta\ngamma\ndelta\n', 'alpha\nBETA\ngamma\nepsilon\n', 'all'],
    ['1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n', '1\n2\nX\n4\n5\n6\nY\n8\n9\n10\n', 1],
    ['only line\n', 'completely different\nsecond\nthird\n', 'all'],
    ['a\nb\nc\n', '', 2],
    ['', 'x\ny\nz\n', 3],
    ['no newline at end', 'no newline at end changed', 0],
  ];
  for (const [old, next, ctx] of cases) {
    const r = computeDiff(old, next, base);
    const patch = buildUnifiedPatch(r.rows, ctx as never);
    const applied = applyPatch(old, patch);
    check(`round-trip ${JSON.stringify(ctx)}`, applied === next, { patch, applied, expected: next });
  }
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURES'}`);
process.exit(failures === 0 ? 0 : 1);
