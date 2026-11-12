export type ComparisonType = 'text' | 'image';
export type Granularity = 'chars' | 'words' | 'smart';
export type ViewMode = 'side-by-side' | 'inline';
export type ContextSetting = number | 'all';
export type IgnoreRuleKind = 'literal' | 'regex';
export type MoveRole = 'from' | 'to';

export interface IgnoreRule {
  kind: IgnoreRuleKind;
  pattern: string;
  enabled: boolean;
}

export interface DiffOptions {
  ignoreCase: boolean;
  ignoreWhitespace: boolean;
  ignoreLineEndings: boolean;
  context: ContextSetting;
  granularity: Granularity;
  ignoreRules: IgnoreRule[];
}

export type RowKind = 'equal' | 'added' | 'deleted' | 'modified' | 'gap';

export interface Span {
  text: string;
  added?: boolean;
  removed?: boolean;
}

export interface DiffRow {
  kind: RowKind;
  oldLine: string | null;
  newLine: string | null;
  oldNum: number | null;
  newNum: number | null;
  oldSpans?: Span[];
  newSpans?: Span[];
  skipped?: number;
  gapStartRow?: number;
  gapEndRow?: number;
  moveId?: number;
  moveRole?: MoveRole;
  moveSimilarity?: number;
  moveExact?: boolean;
}

export interface DiffStats {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  oldLines: number;
  newLines: number;
}

export interface DiffResult {
  rows: DiffRow[];
  stats: DiffStats | null;
  aborted: boolean;
  timeMs: number;
}

export interface SamplePreset {
  id: string;
  label: string;
  category: string;
  oldName: string;
  newName: string;
  oldText: string;
  newText: string;
}

export type TextTransform =
  | 'format-json'
  | 'sort-lines'
  | 'sort-lines-desc'
  | 'trim-whitespace'
  | 'remove-blank-lines'
  | 'lowercase'
  | 'uppercase';

export const DEFAULT_OPTIONS: DiffOptions = {
  ignoreCase: false,
  ignoreWhitespace: false,
  ignoreLineEndings: false,
  context: 'all',
  granularity: 'chars',
  ignoreRules: [],
};
