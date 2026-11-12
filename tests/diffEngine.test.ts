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
} from '../src/lib/diffEngine';
import type { DiffOptions } from '../src/lib/types';
import { applyPatch } from 'diff';
import { buildVirtualOffsets, findVirtualIndex, getVirtualRange } from '../src/lib/virtualRows';

const base: DiffOptions = {
  ignoreCase: false,
  ignoreWhitespace: false,
  ignoreLineEndings: false,
  context: 'all',
  granularity: 'chars',
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
