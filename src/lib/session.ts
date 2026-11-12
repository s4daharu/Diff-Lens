import {
  DEFAULT_OPTIONS,
  type DiffOptions,
  type ViewMode,
} from './types';

export const SESSION_FORMAT = 'difflens-session';
export const SESSION_VERSION = 1;
export const MAX_SESSION_FILE_BYTES = 32 * 1024 * 1024;

export interface SessionSource {
  text: string;
  name: string | null;
  ready: boolean;
}

export interface ComparisonSession {
  format: typeof SESSION_FORMAT;
  version: typeof SESSION_VERSION;
  name: string;
  savedAt: string;
  sources: {
    original: SessionSource;
    changed: SessionSource;
  };
  preferences: {
    options: DiffOptions;
    viewMode: ViewMode;
    wrap: boolean;
    lineNumbers: boolean;
    syntaxEnabled: boolean;
  };
}

export interface CreateComparisonSessionInput {
  name: string;
  oldText: string;
  newText: string;
  oldName: string | null;
  newName: string | null;
  oldReady: boolean;
  newReady: boolean;
  options: DiffOptions;
  viewMode: ViewMode;
  wrap: boolean;
  lineNumbers: boolean;
  syntaxEnabled: boolean;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid session: ${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function optionalName(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new Error(`Invalid session: ${label} must be text or null.`);
  }
  return value.slice(0, 512);
}

function source(value: unknown, label: string): SessionSource {
  const raw = record(value, label);
  if (typeof raw.text !== 'string' || typeof raw.ready !== 'boolean') {
    throw new Error(`Invalid session: ${label} is incomplete.`);
  }
  return {
    text: raw.text,
    name: optionalName(raw.name, `${label}.name`),
    ready: raw.ready,
  };
}

function options(value: unknown): DiffOptions {
  const raw = record(value, 'preferences.options');
  const context = raw.context;
  const validContext =
    context === 'all' ||
    (typeof context === 'number' &&
      Number.isFinite(context) &&
      context >= 0 &&
      Number.isInteger(context));

  if (
    typeof raw.ignoreCase !== 'boolean' ||
    typeof raw.ignoreWhitespace !== 'boolean' ||
    typeof raw.ignoreLineEndings !== 'boolean' ||
    !validContext ||
    (raw.granularity !== 'chars' && raw.granularity !== 'words')
  ) {
    throw new Error('Invalid session: diff options are not supported.');
  }

  return {
    ignoreCase: raw.ignoreCase,
    ignoreWhitespace: raw.ignoreWhitespace,
    ignoreLineEndings: raw.ignoreLineEndings,
    context: context as DiffOptions['context'],
    granularity: raw.granularity,
  };
}

export function normalizeSessionName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!name) throw new Error('Session name is required.');
  return name;
}

export function sessionFileName(name: string): string {
  const normalized = normalizeSessionName(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const slug = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `${slug || 'comparison'}.difflens.json`;
}

export function createComparisonSession(
  input: CreateComparisonSessionInput,
): ComparisonSession {
  return {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    name: normalizeSessionName(input.name),
    savedAt: new Date().toISOString(),
    sources: {
      original: {
        text: input.oldText,
        name: input.oldName,
        ready: input.oldReady,
      },
      changed: {
        text: input.newText,
        name: input.newName,
        ready: input.newReady,
      },
    },
    preferences: {
      options: { ...input.options },
      viewMode: input.viewMode,
      wrap: input.wrap,
      lineNumbers: input.lineNumbers,
      syntaxEnabled: input.syntaxEnabled,
    },
  };
}

export function serializeComparisonSession(session: ComparisonSession): string {
  return `${JSON.stringify(session, null, 2)}\n`;
}

export function parseComparisonSession(serialized: string): ComparisonSession {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Could not open session: the file is not valid JSON.');
  }

  const root = record(parsed, 'root');
  if (root.format !== SESSION_FORMAT) {
    throw new Error('Could not open session: this is not a DiffLens session.');
  }
  if (root.version !== SESSION_VERSION) {
    throw new Error(
      `Could not open session: unsupported version ${String(root.version)}.`,
    );
  }
  if (typeof root.name !== 'string') {
    throw new Error('Invalid session: name is missing.');
  }
  if (
    typeof root.savedAt !== 'string' ||
    !Number.isFinite(Date.parse(root.savedAt))
  ) {
    throw new Error('Invalid session: savedAt is missing or invalid.');
  }

  const sources = record(root.sources, 'sources');
  const preferences = record(root.preferences, 'preferences');
  if (
    preferences.viewMode !== 'side-by-side' &&
    preferences.viewMode !== 'inline'
  ) {
    throw new Error('Invalid session: view mode is not supported.');
  }
  if (
    typeof preferences.wrap !== 'boolean' ||
    typeof preferences.lineNumbers !== 'boolean' ||
    typeof preferences.syntaxEnabled !== 'boolean'
  ) {
    throw new Error('Invalid session: view preferences are incomplete.');
  }

  return {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    name: normalizeSessionName(root.name),
    savedAt: root.savedAt,
    sources: {
      original: source(sources.original, 'sources.original'),
      changed: source(sources.changed, 'sources.changed'),
    },
    preferences: {
      options: options(preferences.options ?? DEFAULT_OPTIONS),
      viewMode: preferences.viewMode,
      wrap: preferences.wrap,
      lineNumbers: preferences.lineNumbers,
      syntaxEnabled: preferences.syntaxEnabled,
    },
  };
}
