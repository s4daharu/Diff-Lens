/// <reference lib="webworker" />
import {
  computeDiff,
  buildUnifiedPatch,
  hasNoNewlineAtEof,
} from './lib/diffEngine';
import { DEFAULT_OPTIONS, type DiffOptions, type DiffResult } from './lib/types';

interface DiffRequest {
  id: number;
  oldText: string;
  newText: string;
  options: DiffOptions;
  oldName?: string;
  newName?: string;
}

interface DiffResponse {
  id: number;
  ok: boolean;
  result?: DiffResult;
  patch?: string;
  error?: string;
}

self.onmessage = (e: MessageEvent<DiffRequest>) => {
  const { id, oldText, newText, options, oldName, newName } = e.data;
  try {
    const result = computeDiff(oldText, newText, options);
    if (result.aborted) {
      self.postMessage({ id, ok: true, result } satisfies DiffResponse);
      return;
    }
    const filtersActive =
      options.ignoreCase ||
      options.ignoreWhitespace ||
      options.ignoreLineEndings ||
      options.ignoreRules.some((rule) => rule.enabled);
    const rawResult = filtersActive
      ? computeDiff(oldText, newText, {
          ...DEFAULT_OPTIONS,
          context: options.context,
          granularity: options.granularity,
        })
      : result;
    const patch = rawResult.aborted
      ? undefined
      : buildUnifiedPatch(
          rawResult.rows,
          options.context,
          oldName,
          newName,
          {
            oldNoNewlineAtEof: hasNoNewlineAtEof(oldText),
            newNoNewlineAtEof: hasNoNewlineAtEof(newText),
          },
        );
    self.postMessage({ id, ok: true, result, patch } satisfies DiffResponse);
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies DiffResponse);
  }
};
