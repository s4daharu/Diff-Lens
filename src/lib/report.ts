import type { DiffOptions, DiffRow } from './types';

export function describeReportOptions(options: DiffOptions): string[] {
  const labels: string[] = [
    `Precision: ${
      options.granularity === 'smart'
        ? 'Smart'
        : options.granularity === 'words'
          ? 'Words'
          : 'Characters'
    }`,
    options.context === 'all'
      ? 'Context: all unchanged lines'
      : options.context === 0
        ? 'Context: unchanged lines hidden'
        : `Context: ${options.context} unchanged line${
            options.context === 1 ? '' : 's'
          } around changes`,
  ];

  if (options.ignoreCase) labels.push('Ignore case');
  if (options.ignoreWhitespace) labels.push('Ignore whitespace');
  if (options.ignoreLineEndings) labels.push('Ignore line-ending style');

  for (const rule of options.ignoreRules) {
    if (!rule.enabled) continue;
    labels.push(
      rule.kind === 'regex'
        ? `Ignore regex: /${rule.pattern}/`
        : `Ignore literal: “${rule.pattern}”`,
    );
  }

  return labels;
}

export function summarizeHiddenContext(rows: DiffRow[]): {
  gapCount: number;
  hiddenLines: number;
} {
  let gapCount = 0;
  let hiddenLines = 0;
  for (const row of rows) {
    if (row.kind !== 'gap') continue;
    gapCount++;
    hiddenLines += row.skipped ?? 0;
  }
  return { gapCount, hiddenLines };
}
