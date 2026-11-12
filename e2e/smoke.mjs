import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4173;
const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? '  ok   ' : '  FAIL '}${name}${detail ? ' — ' + detail : ''}`);
};

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: false,
});

const waitForServer = async (retries = 40) => {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview server did not start');
};

try {
  await waitForServer();
} catch (err) {
  preview.kill();
  throw err;
}

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });

const ensureSidebarOpen = async () => {
  const button = page.getByRole('button', { name: 'Diff details' });
  if ((await button.getAttribute('aria-expanded')) !== 'true') {
    await button.click();
    await page.waitForSelector('.diff-sidebar');
  }
};

const openSidebarOptions = async () => {
  await ensureSidebarOpen();
  const details = page.locator('.sidebar-options');
  if ((await details.getAttribute('open')) === null) {
    await details.locator('summary').click();
  }
};

const openViewOptions = async () => {
  const button = page.getByRole('button', { name: 'View options' });
  if ((await button.getAttribute('aria-expanded')) !== 'true') {
    await button.click();
  }
  return page.getByRole('menu', { name: 'View options' });
};

check('no console/page errors on load', errors.length === 0, errors.join(' | '));

const emptyVisible = await page.locator('.empty').isVisible();
check('empty state visible initially', emptyVisible);

// Landing mode shows the input panels directly
const landingPanels = await page.locator('.input-panel--left textarea').count();
check('landing mode shows input panels', landingPanels === 1);

// Loading only one source must keep the user in the source-entry workspace.
const leftChooserPromise = page.waitForEvent('filechooser');
await page.locator('.input-panel--left').getByRole('button', { name: 'Open file' }).click();
const leftChooser = await leftChooserPromise;
await leftChooser.setFiles({
  name: 'only-left.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('left source\n'),
});
await page.waitForTimeout(300);
check('one uploaded source stays on landing', await page.locator('.main--landing').isVisible());
check('one uploaded source does not open viewer', (await page.locator('.diff-view').count()) === 0);

const rightChooserPromise = page.waitForEvent('filechooser');
await page.locator('.input-panel--right').getByRole('button', { name: 'Open file' }).click();
const rightChooser = await rightChooserPromise;
await rightChooser.setFiles({
  name: 'right.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('right source\n'),
});
await page.waitForSelector('.diff-view--side', { timeout: 5000 });
check('viewer opens after both sources are ready', true);
await page.getByRole('button', { name: 'New diff' }).click();
await page.waitForSelector('.main--landing');

await page.getByRole('button', { name: 'Try with sample text' }).click();
await page.waitForSelector('.diff-view--side', { timeout: 5000 });

// Workspace mode: sources bar + toolbar + diff canvas. Details stay hidden
// until explicitly requested so the diff gets the full desktop width.
check('sources bar visible', await page.locator('.sources-bar').isVisible());
check('sidebar hidden by default', (await page.locator('.diff-sidebar').count()) === 0);
check(
  'details toggle starts collapsed',
  (await page.getByRole('button', { name: 'Diff details' }).getAttribute('aria-expanded')) === 'false',
);
check('toolbar visible', await page.locator('.diff-toolbar').isVisible());
await ensureSidebarOpen();
check('sidebar opens on demand', await page.locator('.diff-sidebar').isVisible());
await page.getByRole('button', { name: 'Close diff details' }).click();
await page.waitForTimeout(100);
check('sidebar close hides details', (await page.locator('.diff-sidebar').count()) === 0);
check(
  'closing details restores toggle focus',
  await page.getByRole('button', { name: 'Diff details' }).evaluate(
    (button) => document.activeElement === button,
  ),
);
await ensureSidebarOpen();

const viewMenu = await openViewOptions();
check(
  'view menu exposes requested controls',
  (await viewMenu.getByRole('menuitemcheckbox').count()) === 3,
);
check(
  'line wrap is disabled by default',
  (await viewMenu
    .getByRole('menuitemcheckbox', { name: 'Disable line wrap' })
    .getAttribute('aria-checked')) === 'true',
);
await viewMenu
  .getByRole('menuitemcheckbox', { name: 'Hide whitespace changes' })
  .click();
check(
  'whitespace changes can be hidden',
  (await viewMenu
    .getByRole('menuitemcheckbox', { name: 'Hide whitespace changes' })
    .getAttribute('aria-checked')) === 'true',
);
await viewMenu
  .getByRole('menuitemcheckbox', { name: 'Hide whitespace changes' })
  .click();

const rows = await page
  .locator('.diff-row--modified, .diff-row--added, .diff-row--deleted')
  .count();
check('diff rows render', rows > 5, `rows=${rows}`);

const pillText = await page.locator('.pill').allTextContents();
check('stats pills show', pillText.length === 4, pillText.join(', '));

const hlCount = await page.locator('.hl--add, .hl--del').count();
check('intra-line highlights render', hlCount > 0, `hl=${hlCount}`);

// change outline list in the sidebar
const changeItems = await page.locator('.change-item').count();
check('change section outline renders', changeItems > 0, `sections=${changeItems}`);
await page.locator('.change-item').first().click();
await page.waitForTimeout(300);
const activeRow = await page.locator('.diff-row--active').count();
check('section click highlights its changed rows', activeRow >= 1);
await page.waitForTimeout(100);
check(
  'section navigation focuses the announced diff row',
  await page.locator('.diff-row--active').first().evaluate(
    (row) => document.activeElement === row && !!row.getAttribute('aria-label'),
  ),
);

const minimap = page.getByRole('slider', { name: 'Difference minimap' });
check('minimap is keyboard accessible', await minimap.isVisible());
await minimap.focus();
await page.keyboard.press('End');
await page.waitForTimeout(150);
check(
  'minimap End jumps to the last mapped change',
  (await minimap.getAttribute('aria-valuenow')) ===
    (await minimap.getAttribute('aria-valuemax')),
);
await page.keyboard.press('Home');
check('minimap Home returns to first mapped change', (await minimap.getAttribute('aria-valuenow')) === '1');

// toggle inline view
await page.getByRole('tab', { name: 'Inline' }).click();
await page.waitForSelector('.diff-view--inline');
const signCount = await page.locator('.sign--added, .sign--deleted').count();
check('inline view shows signs', signCount > 0, `signs=${signCount}`);

// hide unchanged lines from the View menu, then restore the previous context
const contextMenu = await openViewOptions();
await contextMenu
  .getByRole('menuitemcheckbox', { name: 'Hide unchanged lines' })
  .click();
await page.waitForTimeout(600);
const gapCount = await page.locator('.diff-row--gap').count();
check('hide unchanged lines produces gaps', gapCount >= 2, `gaps=${gapCount}`);
await contextMenu
  .getByRole('menuitemcheckbox', { name: 'Hide unchanged lines' })
  .click();
await page.waitForTimeout(600);

// ignore case option
await openSidebarOptions();

// open the source editor drawer to edit texts
const editSources = () => page.getByRole('button', { name: 'Edit sources' }).click();
const closeEditor = () =>
  page.getByRole('button', { name: 'Done', exact: true }).click();

const editTrigger = page.getByRole('button', { name: 'Edit sources' });
await editTrigger.focus();
await editSources();
await page.waitForSelector('.source-editor');
const ta = page.locator('.source-editor .input-panel--left textarea');
const ta2 = page.locator('.source-editor .input-panel--right textarea');
check(
  'source editor initially focuses original text',
  await ta.evaluate((textarea) => document.activeElement === textarea),
);
await page.keyboard.press('Shift+Tab');
check(
  'source editor keeps keyboard focus inside the dialog',
  await page.locator('.source-editor').evaluate(
    (dialog) => dialog.contains(document.activeElement),
  ),
);
await ta.focus();
await ta.fill('HELLO WORLD\nsecond line\nthird line\n');
await ta2.fill('hello world\nsecond line\nthird line\n');
await closeEditor();
await page.waitForTimeout(800);
check(
  'source editor restores focus to its opener',
  await editTrigger.evaluate((button) => document.activeElement === button),
);
let msgCount = await page.locator('.sidebar-identical-msg').count();
check('case-differing texts show as different (no identical banner)', msgCount === 0, `count=${msgCount}`);

// export menu: copy patch enabled, download works
await page.getByRole('button', { name: 'Export options' }).click();
await page.waitForSelector('.dropdown-menu');
const copyItem = page.getByRole('menuitem', { name: 'Copy patch' });
check('copy patch enabled', await copyItem.isEnabled());
const downloadPromise = page.waitForEvent('download');
await page.getByRole('menuitem', { name: 'Download .patch' }).click();
const download = await downloadPromise;
check('download works', download.suggestedFilename() === 'diff.patch', download.suggestedFilename());

await openSidebarOptions();
await page.getByLabel('Ignore case').check();
await page.waitForTimeout(800);
const msg = await page.locator('.sidebar-identical-msg').textContent();
check('ignore case → identical', !!msg && msg.includes('No differences'), msg);

// swap from the sources bar
await page.getByLabel('Swap texts').click();
await editSources();
const leftVal = await ta.inputValue();
check('swap works', leftVal === 'hello world\nsecond line\nthird line\n', leftVal);

// identical texts state (editor is already open)
await ta.fill('same\n');
await ta2.fill('same\n');
await closeEditor();
await page.waitForTimeout(800);
const identical = await page.locator('.sidebar-identical-msg').count();
check('identical banner', identical === 1);

// file upload via file chooser inside the editor drawer
await editSources();
await ta.fill('file one\n');
await ta2.fill('');
const chooserPromise = page.waitForEvent('filechooser');
await page.locator('.source-editor .input-panel--right').getByRole('button', { name: 'Open file' }).click();
const chooser = await chooserPromise;
await chooser.setFiles({
  name: 'test.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('file one\nsecond\n'),
});
await page.waitForTimeout(800);
const rightVal = await ta2.inputValue();
check('file upload reads text', rightVal === 'file one\nsecond\n', rightVal);
await closeEditor();

// theme toggle
const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
await page.getByTitle(/light|dark mode/).click();
const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
check('theme toggles', themeBefore !== themeAfter, `${themeBefore} → ${themeAfter}`);

// large-file smoke test: 2000 lines with edits.
// Values are set via evaluate: Playwright's CDP fill is slow for large
// strings in this headless environment, independent of the app under test.
let big = '';
for (let i = 0; i < 2000; i++) big += `line number ${i} with some content\n`;
const setValue = (locator, text) =>
  locator.evaluate((el, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    ).set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
await editSources();
const t0 = Date.now();
await setValue(ta, big);
await setValue(ta2, big.replace('line number 1000', 'line number CHANGED'));
await closeEditor();
// view is currently Inline: a modified row renders as a '-'/'+' row pair
await page.waitForSelector('.diff-row--added', { timeout: 10000 });
const perf = Date.now() - t0;
check('2000-line diff renders', true, `${perf}ms`);

// back to side-by-side: use the change outline to jump to a modification
// that starts outside the mounted virtual window.
await page.getByRole('tab', { name: 'Side by side' }).click();
check(
  '2000-line diff is virtualized',
  (await page.locator('.diff-view--side').getAttribute('data-virtualized')) === 'true',
);
await ensureSidebarOpen();
await page.locator('.change-item').first().click();
await page.waitForSelector('.diff-row--modified.diff-row--active', { timeout: 5000 });
check(
  'off-screen change navigation mounts the target row',
  (await page.locator('.diff-row--modified.diff-row--active').count()) === 1,
);

// wrap toggle: long line must wrap instead of horizontally scrolling
const longLine = 'y'.repeat(2000);
await editSources();
await setValue(ta, 'a\n' + longLine + '\nb\n');
await setValue(ta2, 'a\n' + longLine + '\nc\n');
await closeEditor();
await page.waitForTimeout(900);
const overflowBefore = await page.evaluate(() => {
  const s = document.querySelector('.diff-scroll');
  return s.scrollWidth - s.clientWidth;
});
check('no wrap: horizontal overflow present', overflowBefore > 200, `overflow=${overflowBefore}px`);
{
  const menu = await openViewOptions();
  await menu
    .getByRole('menuitemcheckbox', { name: 'Disable line wrap' })
    .click();
}
await page.waitForTimeout(900);
const overflowAfter = await page.evaluate(() => {
  const s = document.querySelector('.diff-scroll');
  return s.scrollWidth - s.clientWidth;
});
check('wrap on: no horizontal overflow', overflowAfter < 100, `overflow=${overflowAfter}px`);
{
  const menu = await openViewOptions();
  await menu
    .getByRole('menuitemcheckbox', { name: 'Disable line wrap' })
    .click();
}

// new diff: clears panels but keeps theme preference
const themeBeforeNew = await page.evaluate(() => document.documentElement.dataset.theme);
await page.getByRole('button', { name: 'New diff' }).click();
await page.waitForTimeout(400);
const cleared =
  (await page.locator('.input-panel--left textarea').inputValue()) === '' &&
  (await page.locator('.input-panel--right textarea').inputValue()) === '';
const themeAfterNew = await page.evaluate(() => document.documentElement.dataset.theme);
check('new diff clears panels', cleared);
check('new diff keeps theme', themeBeforeNew === themeAfterNew, `${themeBeforeNew} → ${themeAfterNew}`);

// keyboard shortcuts: ctrl/cmd+2 inline, ctrl/cmd+1 side-by-side
await page.getByRole('button', { name: 'Try with sample text' }).click();
await page.waitForSelector('.diff-view--side', { timeout: 5000 });
await page.keyboard.press('Control+2');
await page.waitForSelector('.diff-view--inline');
check('ctrl+2 switches to inline view', true);
await page.keyboard.press('Control+1');
await page.waitForSelector('.diff-view--side');
check('ctrl+1 switches to side-by-side view', true);

// ctrl+e opens the source editor
await page.keyboard.press('Control+e');
await page.waitForSelector('.source-editor');
check('ctrl+e opens source editor', true);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('escape closes source editor', !(await page.locator('.source-editor').isVisible()));

// arrow keys navigate the view-mode tablist
await page.locator('.segmented__btn').first().focus();
await page.keyboard.press('ArrowRight');
await page.waitForSelector('.diff-view--inline');
check('arrow right switches view', true);
await page.locator('.segmented__btn').last().focus();
await page.keyboard.press('ArrowLeft');
await page.waitForSelector('.diff-view--side');

// ctrl+s downloads the patch
const dlPromise = page.waitForEvent('download');
await page.keyboard.press('Control+s');
const dl = await dlPromise;
check('ctrl+s downloads patch', dl.suggestedFilename() === 'diff.patch', dl.suggestedFilename());

// drop anywhere: files dropped on the page land in the nearer panel
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.items.add(new File(['dropped left\ncontent\n'], 'dropped.txt', { type: 'text/plain' }));
  document.dispatchEvent(
    new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 100 }),
  );
});
await page.waitForTimeout(400);
await editSources();
const droppedVal = await ta.inputValue();
check('drop anywhere fills left panel', droppedVal === 'dropped left\ncontent\n', droppedVal);

// very large diffs are windowed instead of truncated or fully mounted
let huge = '';
for (let i = 0; i < 25000; i++) huge += `row ${i}\n`;
await setValue(ta, huge);
await setValue(ta2, huge);
await closeEditor();
await page.waitForSelector('.diff-view[data-virtualized="true"]', { timeout: 20000 });
const rendered = await page.locator('.diff-row--equal').count();
check(
  'large diff mounts only a small window',
  rendered > 0 && rendered < 500,
  `mounted rows=${rendered}`,
);
const virtualMetrics = await page.locator('.diff-scroll').evaluate((el) => ({
  scrollHeight: el.scrollHeight,
  clientHeight: el.clientHeight,
}));
check(
  'virtualized diff preserves the full scroll range',
  virtualMetrics.scrollHeight > virtualMetrics.clientHeight * 20,
  JSON.stringify(virtualMetrics),
);
await page.locator('.diff-scroll').evaluate((el) => {
  el.scrollTop = el.scrollHeight;
  el.dispatchEvent(new Event('scroll'));
});
await page.waitForTimeout(500);
const tailText = await page.locator('.diff-row--equal .cell__text').last().textContent();
check(
  'virtualized diff can reach the final row',
  !!tailText && tailText.includes('row 24999'),
  tailText,
);
check(
  'render-all escape hatch is no longer needed',
  (await page.getByRole('button', { name: 'Render all' }).count()) === 0,
);

// uploaded file name appears in the patch header
await editSources();
const chooser2Promise = page.waitForEvent('filechooser');
await page.locator('.source-editor .input-panel--left').getByRole('button', { name: 'Open file' }).click();
const chooser2 = await chooser2Promise;
await chooser2.setFiles({
  name: 'orig.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('a\nb\n'),
});
await page.waitForTimeout(800);
await closeEditor();
const dl2Promise = page.waitForEvent('download');
await page.getByRole('button', { name: 'Export options' }).click();
await page.getByRole('menuitem', { name: 'Download .patch' }).click();
const dl2 = await dl2Promise;
const dl2Path = await dl2.path();
const patchText = readFileSync(dl2Path, 'utf8');
check('patch header uses uploaded name', patchText.includes('--- orig.txt'), patchText.split('\n')[0]);

// interactive gap expansion
await page.getByRole('button', { name: 'New diff' }).click();
await page.getByRole('button', { name: 'Try with sample text' }).click();
await page.waitForSelector('.diff-view--side', { timeout: 5000 });
await openSidebarOptions();
await page.getByLabel('Context lines').selectOption('0');
await page.waitForTimeout(600);
const gapBtnsBefore = await page.locator('.gap-btn').count();
check('gap buttons present with context 0', gapBtnsBefore > 0, `gapBtns=${gapBtnsBefore}`);
const initialRowsCount = await page.locator('.diff-row').count();
await page.locator('.gap-btn--all').first().evaluate((el) => el.click());
await page.waitForTimeout(600);
const afterExpandRowsCount = await page.locator('.diff-row').count();
const gapBtnsAfter = await page.locator('.gap-btn').count();
check(
  'expanding gap reveals content and removes its placeholder',
  gapBtnsAfter < gapBtnsBefore && afterExpandRowsCount >= initialRowsCount,
  `rows ${initialRowsCount} → ${afterExpandRowsCount}; gap buttons ${gapBtnsBefore} → ${gapBtnsAfter}`,
);

// diff navigation
await page.getByLabel('Context lines').selectOption('all');
await page.waitForTimeout(600);
const navLabel = await page.locator('.diff-nav-label').textContent();
check('diff nav displays section count', !!navLabel && navLabel.includes('section'), navLabel);
await page.getByTitle('Next change section (Alt+N or Alt+Down)').click();
await page.waitForTimeout(300);
const navLabelAfter = await page.locator('.diff-nav-label').textContent();
check('nav next updates section index', !!navLabelAfter && navLabelAfter.includes('1 of'), navLabelAfter);
const activeRowNav = await page.locator('.diff-row--active').count();
check('active change section highlighted', activeRowNav >= 1);
const activeItem = await page.locator('.change-item--active').count();
check('active section outline item highlighted', activeItem === 1);

// diff search
await page.getByRole('button', { name: 'Find' }).click();
await page.waitForSelector('.diff-search-input');
await page.locator('.diff-search-input').fill('greet');
await page.waitForTimeout(300);
const matchesCount = await page.locator('.search-match').count();
check('search matches highlighted', matchesCount > 0, `matches=${matchesCount}`);
await page.locator('.diff-search-clear').click();
await page.getByRole('button', { name: 'Close' }).click();

// preset samples dropdown
await page.getByRole('button', { name: 'Samples' }).click();
await page.waitForSelector('.dropdown-menu');
await page.getByRole('button', { name: /API Config/ }).click();
await page.waitForTimeout(600);
await editSources();
const jsonVal = await ta.inputValue();
check('preset loaded JSON text', jsonVal.includes('CloudMetrics'), jsonVal.slice(0, 40));

// text tools transform
const testJson = '{"z": 100, "a": 200}';
await ta.fill(testJson);
await page.locator('.source-editor .input-panel--left').getByTitle(/Text tools/).click();
await page.waitForSelector('.dropdown-item >> text=Format / Prettify JSON');
await page.getByRole('button', { name: 'Format / Prettify JSON' }).click();
await page.waitForTimeout(300);
const formattedVal = await ta.inputValue();
check('text tool formatted JSON', formattedVal.includes('\n  "z": 100'), formattedVal);
await closeEditor();

// keyboard shortcuts modal
await page.getByTitle(/Keyboard shortcuts/).click();
await page.waitForSelector('.modal-card');
const modalVisible = await page.locator('.modal-card').isVisible();
check('shortcuts modal opens', modalVisible);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const modalClosed = !(await page.locator('.modal-card').isVisible());
check('shortcuts modal closes on Escape', modalClosed);

check('no errors accumulated', errors.length === 0, errors.join(' | '));

await browser.close();
preview.kill();

const fails = results.filter((r) => !r.ok).length;
console.log(`\n${fails === 0 ? 'ALL BROWSER TESTS PASSED' : fails + ' BROWSER FAILURES'}`);
process.exit(fails === 0 ? 0 : 1);
