import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from './components/Header';
import { InputPanel } from './components/InputPanel';
import { SourcesBar } from './components/SourcesBar';
import { DiffToolbar } from './components/DiffToolbar';
import { DiffSidebar } from './components/DiffSidebar';
import { DiffView } from './components/DiffView';
import { SourceEditorModal } from './components/SourceEditorModal';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { SessionNameModal } from './components/SessionNameModal';
import { LogoIcon, SwapIcon } from './components/Icons';
import {
  DEFAULT_OPTIONS,
  type DiffOptions,
  type DiffResult,
  type SamplePreset,
  type ViewMode,
} from './lib/types';
import {
  loadJson,
  loadString,
  save,
  storageKeys,
} from './lib/storage';
import { SAMPLE_CHANGED, SAMPLE_ORIGINAL } from './lib/sample';
import {
  applyContext,
  buildHtmlDiffReport,
} from './lib/diffEngine';
import { sanitizeIgnoreRules } from './lib/ignoreRules';
import {
  buildChangeSections,
  type ChangeSection,
} from './lib/changeSections';
import {
  mergeChangeSections,
  type MergeDirection,
} from './lib/mergeSections';
import {
  createLineTokenizer,
  detectLang,
  type LineTokenizer,
} from './lib/highlighter';
import { MAX_FILE_BYTES } from './components/InputPanel';
import {
  MAX_SESSION_FILE_BYTES,
  createComparisonSession,
  parseComparisonSession,
  serializeComparisonSession,
  sessionFileName,
} from './lib/session';

type Theme = 'light' | 'dark';

interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: DiffResult;
  patch?: string;
  error?: string;
}

const DEBOUNCE_MS = 250;
const WORKER_TIMEOUT_MS = 7500;
const SECTION_LIST_CAP = 400;
const MERGE_HISTORY_LIMIT = 50;

interface MergeSnapshot {
  oldText: string;
  newText: string;
}

function usePersistedState<T>(
  key: string,
  fallback: T,
  sanitize?: (raw: unknown) => T,
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const raw = loadJson(key, null);
    if (raw === null) return fallback;
    return sanitize ? sanitize(raw) : (raw as T);
  });
  const setPersisted = useCallback(
    (next: T) => {
      setValue(next);
      save(key, next);
    },
    [key],
  );
  return [value, setPersisted];
}

function sanitizeOptions(raw: unknown): DiffOptions {
  const o = (raw ?? {}) as Partial<DiffOptions>;
  return {
    ignoreCase: o.ignoreCase === true,
    ignoreWhitespace: o.ignoreWhitespace === true,
    ignoreLineEndings: o.ignoreLineEndings === true,
    context:
      o.context === 'all'
        ? 'all'
        : typeof o.context === 'number' && Number.isFinite(o.context)
          ? o.context
          : DEFAULT_OPTIONS.context,
    granularity:
      o.granularity === 'words' || o.granularity === 'smart'
        ? o.granularity
        : 'chars',
    ignoreRules: sanitizeIgnoreRules(o.ignoreRules),
  };
}

function getInitialTheme(): Theme {
  const stored = loadString(storageKeys.theme, '');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export default function App() {
  const [oldText, setOldText] = useState(() => loadString(storageKeys.oldText, ''));
  const [newText, setNewText] = useState(() => loadString(storageKeys.newText, ''));
  const [options, setOptions] = usePersistedState<DiffOptions>(
    storageKeys.options,
    DEFAULT_OPTIONS,
    sanitizeOptions,
  );
  const [viewMode, setViewMode] = usePersistedState<ViewMode>(
    storageKeys.viewMode,
    'side-by-side',
    (v) => (v === 'inline' ? 'inline' : 'side-by-side'),
  );
  const [wrap, setWrap] = usePersistedState(
    storageKeys.wrap,
    false,
    (v) => v === true,
  );
  const [lineNumbers, setLineNumbers] = usePersistedState(
    storageKeys.lineNumbers,
    true,
    (v) => v === true,
  );
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  const [result, setResult] = useState<DiffResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [patch, setPatch] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [toastUndo, setToastUndo] = useState<(() => void) | null>(null);
  const [globalDrag, setGlobalDrag] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(() => new Set());
  const [currentChangeIndex, setCurrentChangeIndex] = useState<number | null>(null);
  const [activeChangeRowIndex, setActiveChangeRowIndex] = useState<number | null>(null);
  const [activeChangeEndRowIndex, setActiveChangeEndRowIndex] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionNameDialogOpen, setSessionNameDialogOpen] = useState(false);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [syntaxEnabled, setSyntaxEnabled] = usePersistedState(
    storageKeys.syntax,
    true,
    (v) => v === true,
  );
  const [tokenizer, setTokenizer] = useState<LineTokenizer | null>(null);
  const [fileNames, setFileNames] = useState<{
    old: string | null;
    new: string | null;
  }>({ old: null, new: null });
  const [sourceReady, setSourceReady] = useState(() => ({
    old: oldText !== '',
    new: newText !== '',
  }));
  const [mergePast, setMergePast] = useState<MergeSnapshot[]>([]);
  const [mergeFuture, setMergeFuture] = useState<MergeSnapshot[]>([]);

  const workerRef = useRef<Worker | null>(null);
  const workerWatchdogRef = useRef<number | undefined>(undefined);
  const seqRef = useRef(0);
  const toastTimerRef = useRef<number | undefined>(undefined);
  const themeOverridden = useRef(loadString(storageKeys.theme, '') !== '');
  const lastVisibleContextRef = useRef<number | 'all'>(
    options.context === 0 ? 'all' : options.context,
  );
  const expectedMergeTextRef = useRef<MergeSnapshot | null>(null);
  const pendingMergeFocusIndexRef = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setToastUndo(null);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      setToastUndo(null);
    }, 4000);
  }, []);

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const w = new Worker(new URL('./diffWorker.ts', import.meta.url), {
      type: 'module',
    });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.id !== seqRef.current) return;
      window.clearTimeout(workerWatchdogRef.current);
      workerWatchdogRef.current = undefined;
      setComputing(false);
      if (!msg.ok) {
        setResult(null);
        showToast(msg.error ?? 'Something went wrong while diffing.');
        return;
      }
      setResult(msg.result ?? null);
      setPatch(msg.patch ?? null);
    };
    w.onerror = () => {
      window.clearTimeout(workerWatchdogRef.current);
      workerWatchdogRef.current = undefined;
      w.terminate();
      if (workerRef.current === w) workerRef.current = null;
      setComputing(false);
      showToast('Diff worker failed — try smaller inputs.');
    };
    workerRef.current = w;
    return w;
  }, [showToast]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    save(storageKeys.theme, theme);
  }, [theme]);

  useEffect(() => {
    const header = document.querySelector<HTMLElement>('.header');
    const root = document.documentElement;
    if (!header) return;
    const update = () =>
      root.style.setProperty('--header-h', `${header.offsetHeight}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      if (!themeOverridden.current) setTheme(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    ensureWorker();
    return () => {
      window.clearTimeout(workerWatchdogRef.current);
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [ensureWorker]);

  useEffect(() => {
    if (options.context !== 0) {
      lastVisibleContextRef.current = options.context;
    }
  }, [options.context]);

  const syntaxLang = useMemo(
    () => detectLang(fileNames.old, fileNames.new, oldText || newText),
    [fileNames.old, fileNames.new, oldText, newText],
  );

  useEffect(() => {
    if (!syntaxEnabled) {
      setTokenizer(null);
      return;
    }
    let cancelled = false;
    createLineTokenizer(syntaxLang, theme).then((t) => {
      if (!cancelled) setTokenizer(t);
    });
    return () => {
      cancelled = true;
    };
  }, [syntaxEnabled, syntaxLang, theme]);
  useEffect(() => {
    window.clearTimeout(workerWatchdogRef.current);
    workerWatchdogRef.current = undefined;
    if (!sourceReady.old || !sourceReady.new) {
      seqRef.current++;
      setResult(null);
      setPatch(null);
      setComputing(false);
      return;
    }
    setComputing(true);
    const id = ++seqRef.current;
    const timer = window.setTimeout(() => {
      const w = ensureWorker();
      w.postMessage({
        id,
        oldText,
        newText,
        options,
        oldName: fileNames.old ?? undefined,
        newName: fileNames.new ?? undefined,
      });
      workerWatchdogRef.current = window.setTimeout(() => {
        if (id !== seqRef.current) return;
        w.terminate();
        if (workerRef.current === w) workerRef.current = null;
        workerWatchdogRef.current = undefined;
        setComputing(false);
        showToast(
          'Comparison timed out. Check custom regex rules or try smaller inputs.',
        );
      }, WORKER_TIMEOUT_MS);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    oldText,
    newText,
    options,
    fileNames,
    sourceReady,
    ensureWorker,
    showToast,
  ]);

  // Reset expanded gaps when inputs or context settings change
  useEffect(() => {
    setExpandedIndices(new Set());
    setCurrentChangeIndex(null);
    setActiveChangeRowIndex(null);
    setActiveChangeEndRowIndex(null);
  }, [oldText, newText, options.context]);

  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files');
    let dragCounter = 0;
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragCounter++;
      setGlobalDrag(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDragLeave = () => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) setGlobalDrag(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter = 0;
      setGlobalDrag(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) {
        showToast(`"${file.name}" is larger than the 10 MB limit.`);
        return;
      }
      file
        .text()
        .then((text) => {
          const targetLeft = e.clientX < window.innerWidth / 2;
          setFileNames((names) => ({
            ...names,
            [targetLeft ? 'old' : 'new']: file.name,
          }));
          if (targetLeft) {
            setOldText(text);
            setSourceReady((ready) => ({ ...ready, old: true }));
          } else {
            setNewText(text);
            setSourceReady((ready) => ({ ...ready, new: true }));
          }
        })
        .catch(() => showToast(`Could not read "${file.name}".`));
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onDragLeave);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', onDragLeave);
    };
  }, [showToast]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      save(storageKeys.oldText, oldText);
      save(storageKeys.newText, newText);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [oldText, newText]);

  useEffect(() => {
    const expected = expectedMergeTextRef.current;
    if (
      expected &&
      expected.oldText === oldText &&
      expected.newText === newText
    ) {
      expectedMergeTextRef.current = null;
      return;
    }
    setMergePast([]);
    setMergeFuture([]);
  }, [oldText, newText]);

  const handleNewDiff = useCallback(() => {
    const hadSources = sourceReady.old || sourceReady.new;
    const prevOld = oldText;
    const prevNew = newText;
    const prevNames = fileNames;
    const prevOptions = options;
    const prevReady = sourceReady;
    const prevSessionName = sessionName;
    setOldText('');
    setNewText('');
    setOptions(DEFAULT_OPTIONS);
    lastVisibleContextRef.current = DEFAULT_OPTIONS.context;
    setFileNames({ old: null, new: null });
    setSourceReady({ old: false, new: false });
    setSessionName(null);
    setSessionNameDialogOpen(false);
    setSidebarOpen(false);
    setExpandedIndices(new Set());
    setCurrentChangeIndex(null);
    setActiveChangeRowIndex(null);
    setActiveChangeEndRowIndex(null);
    setSearchQuery('');
    setSearchOpen(false);
    setEditorOpen(false);
    setMergePast([]);
    setMergeFuture([]);
    expectedMergeTextRef.current = null;
    pendingMergeFocusIndexRef.current = null;
    save(storageKeys.oldText, '');
    save(storageKeys.newText, '');
    save(storageKeys.options, DEFAULT_OPTIONS);
    if (hadSources) {
      window.clearTimeout(toastTimerRef.current);
      setToast('Cleared');
      const undo = () => {
        setOldText(prevOld);
        setNewText(prevNew);
        setFileNames(prevNames);
        setSourceReady(prevReady);
        setSessionName(prevSessionName);
        setOptions(prevOptions);
        save(storageKeys.oldText, prevOld);
        save(storageKeys.newText, prevNew);
        save(storageKeys.options, prevOptions);
        setToast('Restored');
        setToastUndo(null);
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => setToast(null), 2000);
      };
      setToastUndo(() => undo);
      const id = window.setTimeout(() => {
        setToast(null);
        setToastUndo(null);
      }, 6000);
      toastTimerRef.current = id;
    }
  }, [
    setOptions,
    oldText,
    newText,
    fileNames,
    options,
    sourceReady,
    sessionName,
  ]);

  const handleLoadSample = useCallback(() => {
    setOldText(SAMPLE_ORIGINAL);
    setNewText(SAMPLE_CHANGED);
    setFileNames({ old: null, new: null });
    setSourceReady({ old: true, new: true });
    setSessionName(null);
    setExpandedIndices(new Set());
    setMergePast([]);
    setMergeFuture([]);
  }, []);

  const handleSelectPreset = useCallback((preset: SamplePreset) => {
    setOldText(preset.oldText);
    setNewText(preset.newText);
    setFileNames({ old: preset.oldName, new: preset.newName });
    setSourceReady({ old: true, new: true });
    setSessionName(null);
    setExpandedIndices(new Set());
    setMergePast([]);
    setMergeFuture([]);
  }, []);

  const handleSwap = useCallback(() => {
    setOldText(newText);
    setNewText(oldText);
    setFileNames((names) => ({ old: names.new, new: names.old }));
    setSourceReady((ready) => ({ old: ready.new, new: ready.old }));
    setExpandedIndices(new Set());
    setMergePast([]);
    setMergeFuture([]);
  }, [oldText, newText]);

  const handleCopyPatch = useCallback(async () => {
    if (patch === null) return;
    try {
      await navigator.clipboard.writeText(patch);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Could not access the clipboard.');
    }
  }, [patch, showToast]);

  const handleCopyMarkdown = useCallback(async () => {
    if (patch === null) return;
    try {
      const md = `\`\`\`diff\n${patch.trimEnd()}\n\`\`\`\n`;
      await navigator.clipboard.writeText(md);
      setCopiedMarkdown(true);
      showToast('Copied Markdown diff to clipboard');
      window.setTimeout(() => setCopiedMarkdown(false), 2000);
    } catch {
      showToast('Could not access the clipboard.');
    }
  }, [patch, showToast]);

  const triggerDownload = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const handleImportSession = useCallback(
    async (file: File) => {
      if (file.size > MAX_SESSION_FILE_BYTES) {
        showToast('Could not open session: the file is larger than 32 MB.');
        return;
      }

      try {
        const session = parseComparisonSession(await file.text());
        const { original, changed } = session.sources;
        const preferences = session.preferences;

        setOldText(original.text);
        setNewText(changed.text);
        setFileNames({ old: original.name, new: changed.name });
        setSourceReady({ old: original.ready, new: changed.ready });
        setSessionName(session.name);
        setOptions(preferences.options);
        setViewMode(preferences.viewMode);
        setWrap(preferences.wrap);
        setLineNumbers(preferences.lineNumbers);
        setSyntaxEnabled(preferences.syntaxEnabled);
        lastVisibleContextRef.current =
          preferences.options.context === 0
            ? 'all'
            : preferences.options.context;
        setExpandedIndices(new Set());
        setCurrentChangeIndex(null);
        setActiveChangeRowIndex(null);
        setActiveChangeEndRowIndex(null);
        setSidebarOpen(false);
        setSearchOpen(false);
        setSearchQuery('');
        setEditorOpen(false);
        setSessionNameDialogOpen(false);
        setMergePast([]);
        setMergeFuture([]);
        expectedMergeTextRef.current = null;
        pendingMergeFocusIndexRef.current = null;

        save(storageKeys.oldText, original.text);
        save(storageKeys.newText, changed.text);
        save(storageKeys.options, preferences.options);
        showToast(`Loaded session “${session.name}”`);
      } catch (error) {
        showToast(
          error instanceof Error
            ? error.message
            : 'Could not open session: the file is invalid.',
        );
      }
    },
    [
      setLineNumbers,
      setOptions,
      setSyntaxEnabled,
      setViewMode,
      setWrap,
      showToast,
    ],
  );

  const handleDownloadPatch = useCallback(() => {
    if (patch === null) return;
    const blob = new Blob([patch], { type: 'text/plain' });
    const base = (name: string | null) =>
      name ? name.replace(/\.[^./\\]+$/, '') : 'diff';
    triggerDownload(blob, `${base(fileNames.new)}.patch`);
  }, [patch, fileNames.new, triggerDownload]);

  const handleSaveSession = useCallback(
    (name: string) => {
      try {
        const session = createComparisonSession({
          name,
          oldText,
          newText,
          oldName: fileNames.old,
          newName: fileNames.new,
          oldReady: sourceReady.old,
          newReady: sourceReady.new,
          options,
          viewMode,
          wrap,
          lineNumbers,
          syntaxEnabled,
        });
        const serialized = serializeComparisonSession(session);
        triggerDownload(
          new Blob([serialized], { type: 'application/json' }),
          sessionFileName(session.name),
        );
        setSessionName(session.name);
        setSessionNameDialogOpen(false);
        showToast(`Saved session “${session.name}”`);
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Could not save session.',
        );
      }
    },
    [
      fileNames,
      lineNumbers,
      newText,
      oldText,
      options,
      showToast,
      sourceReady,
      syntaxEnabled,
      triggerDownload,
      viewMode,
      wrap,
    ],
  );

  const handleExportHtml = useCallback(() => {
    if (!result || result.rows.length === 0) return;
    const html = buildHtmlDiffReport({
      rows: result ? applyContext(result.rows, options.context, expandedIndices) : [],
      stats: result.stats,
      oldName: fileNames.old ?? 'original.txt',
      newName: fileNames.new ?? 'changed.txt',
      options,
    });
    const blob = new Blob([html], { type: 'text/html' });
    const base = (name: string | null) =>
      name ? name.replace(/\.[^./\\]+$/, '') : 'diff';
    triggerDownload(blob, `${base(fileNames.new)}-report.html`);
  }, [result, options, expandedIndices, fileNames, triggerDownload]);

  const handleExpandGap = useCallback(
    (startRow: number, endRow: number) => {
      setExpandedIndices((prev) => {
        const next = new Set(prev);
        for (let k = startRow; k <= endRow; k++) {
          next.add(k);
        }
        return next;
      });
    },
    [],
  );

  const handleEditSources = useCallback(() => {
    setSearchOpen(false);
    setEditorOpen(true);
  }, []);
  const handleCloseEditor = useCallback(() => {
    setEditorOpen(false);
  }, []);

  const handleCloseSidebar = useCallback(() => {
    setSidebarOpen(false);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>('[data-details-toggle="true"]')
        ?.focus();
    });
  }, []);

  const handleHideWhitespaceChanges = useCallback(
    (hidden: boolean) => {
      if (options.ignoreWhitespace === hidden) return;
      setOptions({ ...options, ignoreWhitespace: hidden });
    },
    [options, setOptions],
  );

  const handleHideUnchangedLines = useCallback(
    (hidden: boolean) => {
      const currentlyHidden = options.context === 0;
      if (currentlyHidden === hidden) return;

      if (hidden) {
        lastVisibleContextRef.current =
          options.context === 0 ? 'all' : options.context;
        setOptions({ ...options, context: 0 });
        return;
      }

      const restoredContext =
        lastVisibleContextRef.current === 0
          ? 'all'
          : lastVisibleContextRef.current;
      setOptions({ ...options, context: restoredContext });
    },
    [options, setOptions],
  );

  const comparisonReady = sourceReady.old && sourceReady.new;
  const hasAnySource = sourceReady.old || sourceReady.new;

  const identical =
    result?.stats != null &&
    result.stats.added + result.stats.removed + result.stats.changed === 0;

  const visibleRows = useMemo(
    () =>
      result ? applyContext(result.rows, options.context, expandedIndices) : [],
    [result, options.context, expandedIndices],
  );

  // DiffView virtualizes large result sets, so syntax highlighting can stay
  // lazy and only tokenize the rows that are actually mounted.
  const getTokens = useMemo(
    () => (tokenizer ? (line: string) => tokenizer.getTokens(line) : null),
    [tokenizer],
  );

  // Group contiguous changed rows into sections so navigation moves by hunk,
  // not line-by-line through a run of related edits.
  const changeSections = useMemo(
    () => buildChangeSections(visibleRows, result?.rows ?? visibleRows),
    [result, visibleRows],
  );

  const listedSections = useMemo(
    () => changeSections.slice(0, SECTION_LIST_CAP),
    [changeSections],
  );

  const movedSections = useMemo(
    () =>
      changeSections.filter(
        (section) => section.moveId != null && section.moveRole != null,
      ),
    [changeSections],
  );

  const ordinalBySectionStart = useMemo(() => {
    const map = new Map<number, number>();
    changeSections.forEach((section, index) => map.set(section.rowIndex, index));
    return map;
  }, [changeSections]);

  const activateSection = useCallback(
    (index: number) => {
      const section = changeSections[index];
      if (!section) return;
      setCurrentChangeIndex(index);
      setActiveChangeRowIndex(section.rowIndex);
      setActiveChangeEndRowIndex(section.endRowIndex);
    },
    [changeSections],
  );

  const handleSelectChange = useCallback(
    (rowIndex: number) => {
      const index = ordinalBySectionStart.get(rowIndex);
      if (index == null) return;
      activateSection(index);
    },
    [activateSection, ordinalBySectionStart],
  );

  const handleNextChange = useCallback(() => {
    if (changeSections.length === 0) return;
    const nextIndex =
      currentChangeIndex === null
        ? 0
        : (currentChangeIndex + 1) % changeSections.length;
    activateSection(nextIndex);
  }, [activateSection, changeSections.length, currentChangeIndex]);

  const handlePrevChange = useCallback(() => {
    if (changeSections.length === 0) return;
    const previousIndex =
      currentChangeIndex === null
        ? changeSections.length - 1
        : (currentChangeIndex - 1 + changeSections.length) %
          changeSections.length;
    activateSection(previousIndex);
  }, [activateSection, changeSections.length, currentChangeIndex]);

  const currentMovedSectionIndex = useMemo(() => {
    if (currentChangeIndex == null) return null;
    const current = changeSections[currentChangeIndex];
    if (!current) return null;
    const index = movedSections.findIndex(
      (section) => section.rowIndex === current.rowIndex,
    );
    return index >= 0 ? index : null;
  }, [changeSections, currentChangeIndex, movedSections]);

  const activateMovedSection = useCallback(
    (index: number) => {
      const section = movedSections[index];
      if (!section) return;
      const changeIndex = ordinalBySectionStart.get(section.rowIndex);
      if (changeIndex != null) activateSection(changeIndex);
    },
    [activateSection, movedSections, ordinalBySectionStart],
  );

  const handleNextMovedSection = useCallback(() => {
    if (movedSections.length === 0) return;
    const next =
      currentMovedSectionIndex == null
        ? 0
        : (currentMovedSectionIndex + 1) % movedSections.length;
    activateMovedSection(next);
  }, [activateMovedSection, currentMovedSectionIndex, movedSections.length]);

  const handlePrevMovedSection = useCallback(() => {
    if (movedSections.length === 0) return;
    const previous =
      currentMovedSectionIndex == null
        ? movedSections.length - 1
        : (currentMovedSectionIndex - 1 + movedSections.length) %
          movedSections.length;
    activateMovedSection(previous);
  }, [activateMovedSection, currentMovedSectionIndex, movedSections.length]);

  const handleJumpToMovePair = useCallback(
    (rowIndex: number) => {
      const sectionIndex = ordinalBySectionStart.get(rowIndex);
      const peerRowIndex =
        sectionIndex == null
          ? null
          : changeSections[sectionIndex]?.movePeerRowIndex;
      if (peerRowIndex != null) handleSelectChange(peerRowIndex);
    },
    [changeSections, handleSelectChange, ordinalBySectionStart],
  );

  const currentSection: ChangeSection | null =
    currentChangeIndex == null ? null : changeSections[currentChangeIndex] ?? null;

  const applyMergeSnapshot = useCallback(
    (snapshot: MergeSnapshot, focusIndex: number) => {
      expectedMergeTextRef.current = snapshot;
      pendingMergeFocusIndexRef.current = focusIndex;
      setResult(null);
      setPatch(null);
      setComputing(true);
      setOldText(snapshot.oldText);
      setNewText(snapshot.newText);
      save(storageKeys.oldText, snapshot.oldText);
      save(storageKeys.newText, snapshot.newText);
    },
    [],
  );

  const handleMergeSection = useCallback(
    (rowIndex: number, direction: MergeDirection) => {
      const sectionIndex = ordinalBySectionStart.get(rowIndex);
      if (sectionIndex == null) return;
      const section = changeSections[sectionIndex];
      if (!section) return;

      const sectionsToMerge =
        section.moveId == null
          ? [section]
          : changeSections.filter(
              (candidate) => candidate.moveId === section.moveId,
            );
      const merged = mergeChangeSections(
        oldText,
        newText,
        sectionsToMerge,
        direction,
      );
      if (merged.oldText === oldText && merged.newText === newText) return;

      const snapshot = { oldText, newText };
      setMergePast((past) => [
        ...past.slice(-(MERGE_HISTORY_LIMIT - 1)),
        snapshot,
      ]);
      setMergeFuture([]);
      applyMergeSnapshot(merged, sectionIndex);
      showToast(
        direction === 'changed-to-original'
          ? 'Applied Changed to Original'
          : 'Applied Original to Changed',
      );
    },
    [
      applyMergeSnapshot,
      changeSections,
      newText,
      oldText,
      ordinalBySectionStart,
      showToast,
    ],
  );

  const handleUndoMerge = useCallback(() => {
    const snapshot = mergePast[mergePast.length - 1];
    if (!snapshot) return;
    const current = { oldText, newText };
    setMergePast((past) => past.slice(0, -1));
    setMergeFuture((future) => [
      ...future.slice(-(MERGE_HISTORY_LIMIT - 1)),
      current,
    ]);
    applyMergeSnapshot(snapshot, currentChangeIndex ?? 0);
    showToast('Merge undone');
  }, [
    applyMergeSnapshot,
    currentChangeIndex,
    mergePast,
    newText,
    oldText,
    showToast,
  ]);

  const handleRedoMerge = useCallback(() => {
    const snapshot = mergeFuture[mergeFuture.length - 1];
    if (!snapshot) return;
    const current = { oldText, newText };
    setMergeFuture((future) => future.slice(0, -1));
    setMergePast((past) => [
      ...past.slice(-(MERGE_HISTORY_LIMIT - 1)),
      current,
    ]);
    applyMergeSnapshot(snapshot, currentChangeIndex ?? 0);
    showToast('Merge redone');
  }, [
    applyMergeSnapshot,
    currentChangeIndex,
    mergeFuture,
    newText,
    oldText,
    showToast,
  ]);

  useEffect(() => {
    const requested = pendingMergeFocusIndexRef.current;
    if (requested == null || result == null || computing) return;
    pendingMergeFocusIndexRef.current = null;
    if (changeSections.length === 0) return;
    activateSection(Math.min(requested, changeSections.length - 1));
  }, [activateSection, changeSections.length, computing, result]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is currently typing in an input or textarea
      const target = e.target as HTMLElement;
      const inInput =
        target &&
        (target.tagName === 'TEXTAREA' ||
          (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text'));

      if (e.key === 'Escape' && searchOpen && !editorOpen) {
        e.preventDefault();
        setSearchOpen(false);
        return;
      }

      if (e.key === '?' && !inInput && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShortcutsOpen((o) => !o);
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key.toLowerCase() === 'n' || e.key === 'ArrowDown') {
          e.preventDefault();
          handleNextChange();
          return;
        }
        if (e.key.toLowerCase() === 'p' || e.key === 'ArrowUp') {
          e.preventDefault();
          handlePrevChange();
          return;
        }
      }

      if (e.key === 'F7') {
        e.preventDefault();
        if (e.shiftKey) handlePrevChange();
        else handleNextChange();
        return;
      }

      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();

      if (!inInput && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedoMerge();
        else handleUndoMerge();
        return;
      }
      if (!inInput && key === 'y') {
        e.preventDefault();
        handleRedoMerge();
        return;
      }

      if (key === '1') {
        e.preventDefault();
        setViewMode('side-by-side');
      } else if (key === '2') {
        e.preventDefault();
        setViewMode('inline');
      } else if (key === 's') {
        e.preventDefault();
        handleDownloadPatch();
      } else if (key === 'f') {
        // Only hijack Ctrl/Cmd+F when a diff is visible; otherwise allow native find.
        if (comparisonReady && result && (result.rows.length > 0 || identical)) {
          e.preventDefault();
          setSearchOpen((o) => !o);
        }
        return;
      } else if (key === 'e') {
        e.preventDefault();
        if (!comparisonReady) {
          const missingSide = sourceReady.old ? 'right' : 'left';
          document
            .querySelector<HTMLTextAreaElement>(
              `.input-panel--${missingSide} textarea`,
            )
            ?.focus();
        } else if (editorOpen) {
          document
            .querySelector<HTMLTextAreaElement>('.source-editor .input-panel--left textarea')
            ?.focus();
        } else {
          handleEditSources();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    setViewMode,
    handleDownloadPatch,
    handleNextChange,
    handlePrevChange,
    handleEditSources,
    handleUndoMerge,
    handleRedoMerge,
    comparisonReady,
    sourceReady,
    result,
    identical,
    searchOpen,
    editorOpen,
  ]);

  const inputPanels = (
    <>
      <InputPanel
        title="Original text"
        accent="left"
        value={oldText}
        onChange={setOldText}
        onError={showToast}
        fileName={fileNames.old}
        onReadyChange={(ready) =>
          setSourceReady((state) => ({ ...state, old: ready }))
        }
        onFileInfo={(name) =>
          setFileNames((names) => ({ ...names, old: name }))
        }
      />
      <div className="panels__swap">
        <button
          type="button"
          className="btn btn--round"
          onClick={handleSwap}
          title="Swap original and changed text"
          aria-label="Swap texts"
        >
          <SwapIcon size={18} />
        </button>
      </div>
      <InputPanel
        title="Changed text"
        accent="right"
        value={newText}
        onChange={setNewText}
        onError={showToast}
        fileName={fileNames.new}
        onReadyChange={(ready) =>
          setSourceReady((state) => ({ ...state, new: ready }))
        }
        onFileInfo={(name) =>
          setFileNames((names) => ({ ...names, new: name }))
        }
      />
    </>
  );

  return (
    <div className="app">
      <a href="#main-content" className="skip-link">
        Skip to diff
      </a>
      <Header
        theme={theme}
        onToggleTheme={() => {
          themeOverridden.current = true;
          setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
        }}
        onNewDiff={handleNewDiff}
        busy={computing}
        onSelectPreset={handleSelectPreset}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onImportSession={handleImportSession}
      />

      {!comparisonReady ? (
        <main id="main-content" className="main main--landing">
          <div className="panels">{inputPanels}</div>

          <section className="empty" aria-live="polite">
            <LogoIcon size={44} />
            <h2>{hasAnySource ? 'Add the other source' : 'Compare two texts'}</h2>
            <p>
              {hasAnySource
                ? sourceReady.old
                  ? 'Original is ready. Add the changed source to start the comparison.'
                  : 'Changed source is ready. Add the original source to start the comparison.'
                : 'Paste text or open files in both panels above. The viewer opens only when both sources are ready, and everything stays on this device.'}
            </p>
            <button
              type="button"
              className="btn btn--primary"
              onClick={handleLoadSample}
            >
              Try with sample text
            </button>
          </section>
        </main>
      ) : (
        <main id="main-content" className="main main--workspace">
          <SourcesBar
            oldText={oldText}
            newText={newText}
            oldName={fileNames.old}
            newName={fileNames.new}
            identical={!!identical}
            sessionName={sessionName}
            editorOpen={editorOpen}
            onEdit={handleEditSources}
            onSwap={handleSwap}
          />

          <div className={`workspace${sidebarOpen ? ' workspace--sidebar-open' : ''}`}>
            {sidebarOpen && (
            <DiffSidebar
              stats={result?.stats ?? null}
              identical={!!identical}
              timeMs={result?.timeMs}
              totalSections={changeSections.length}
              currentSectionIndex={currentChangeIndex}
              onNextSection={handleNextChange}
              onPrevSection={handlePrevChange}
              totalMovedSections={movedSections.length}
              currentMovedSectionIndex={currentMovedSectionIndex}
              onNextMovedSection={handleNextMovedSection}
              onPrevMovedSection={handlePrevMovedSection}
              onJumpToMovePair={handleJumpToMovePair}
              currentSection={currentSection}
              onMergeSection={handleMergeSection}
              sections={listedSections}
              hiddenSections={changeSections.length - listedSections.length}
              activeSectionStartRow={activeChangeRowIndex}
              onSelectSection={handleSelectChange}
              options={options}
              onOptionsChange={setOptions}
              syntaxEnabled={syntaxEnabled}
              onSyntaxChange={setSyntaxEnabled}
              onClose={handleCloseSidebar}
            />
            )}

            <section className="results" aria-live="polite">
              <DiffToolbar
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                wrap={wrap}
                onWrapChange={setWrap}
                hideWhitespaceChanges={options.ignoreWhitespace}
                onHideWhitespaceChangesChange={handleHideWhitespaceChanges}
                hideUnchangedLines={options.context === 0}
                onHideUnchangedLinesChange={handleHideUnchangedLines}
                lineNumbers={lineNumbers}
                onLineNumbersChange={setLineNumbers}
                sidebarOpen={sidebarOpen}
                onToggleSidebar={() => setSidebarOpen((open) => !open)}
                searchOpen={searchOpen}
                onToggleSearch={() => setSearchOpen((o) => !o)}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onCopyPatch={handleCopyPatch}
                onDownloadPatch={handleDownloadPatch}
                onCopyMarkdown={handleCopyMarkdown}
                onExportHtml={handleExportHtml}
                onSaveSession={() => setSessionNameDialogOpen(true)}
                canUndoMerge={mergePast.length > 0}
                canRedoMerge={mergeFuture.length > 0}
                onUndoMerge={handleUndoMerge}
                onRedoMerge={handleRedoMerge}
                patchReady={patch !== null}
                copied={copied}
                copiedMarkdown={copiedMarkdown}
              />

              {result?.aborted && (
                <div className="notice">
                  <strong>This diff was too large to compute.</strong> Try
                  comparing smaller files, or enable an ignore option in the
                  sidebar to reduce the search space.
                </div>
              )}

              {result && !result.aborted && result.rows.length > 0 && (
                <DiffView
                  rows={visibleRows}
                  viewMode={viewMode}
                  wrap={wrap}
                  lineNumbers={lineNumbers}
                  searchQuery={searchQuery}
                  activeChangeRowIndex={activeChangeRowIndex}
                  activeChangeEndRowIndex={activeChangeEndRowIndex}
                  onExpandGap={handleExpandGap}
                  onCopyNotice={showToast}
                  getTokens={getTokens}
                />
              )}

            </section>
          </div>
        </main>
      )}

      {!comparisonReady && (
        <footer className="footer">
          <p>
            DiffLens — an open source diff checker. Runs entirely in your browser;
            no data is uploaded anywhere. Built with React, TypeScript and jsdiff.
            <span style={{ margin: '0 8px', opacity: 0.5 }}>·</span>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              style={{ padding: '2px 8px', fontSize: 12 }}
              onClick={() => setShortcutsOpen(true)}
            >
              Shortcuts ?
            </button>
          </p>
        </footer>
      )}

      {globalDrag && (
        <div className="drop-overlay" aria-hidden="true">
          Drop to compare — left half fills Original, right half fills Changed
        </div>
      )}

      {toast && (
        <div
          className="toast"
          role="status"
          aria-live="polite"
          onMouseEnter={() => window.clearTimeout(toastTimerRef.current)}
          onMouseLeave={() => {
            toastTimerRef.current = window.setTimeout(() => {
              setToast(null);
              setToastUndo(null);
            }, 2000);
          }}
        >
          <span>{toast}</span>
          {toastUndo && (
            <button
              type="button"
              className="btn btn--small"
              style={{ marginLeft: 4, background: '#fff', color: '#111' }}
              onClick={() => {
                const fn = toastUndo;
                setToastUndo(null);
                fn();
              }}
            >
              Undo
            </button>
          )}
          <button
            type="button"
            className="toast__close"
            onClick={() => {
              setToast(null);
              setToastUndo(null);
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <SessionNameModal
        isOpen={comparisonReady && sessionNameDialogOpen}
        initialName={
          sessionName ??
          (fileNames.old || fileNames.new
            ? `${fileNames.old ?? 'Original'} vs ${fileNames.new ?? 'Changed'}`
            : 'Comparison')
        }
        onClose={() => setSessionNameDialogOpen(false)}
        onSave={handleSaveSession}
      />

      <SourceEditorModal
        isOpen={comparisonReady && editorOpen}
        onClose={handleCloseEditor}
        oldText={oldText}
        newText={newText}
        onChangeOld={setOldText}
        onChangeNew={setNewText}
        oldFileName={fileNames.old}
        newFileName={fileNames.new}
        onFileInfoOld={(name) =>
          setFileNames((names) => ({ ...names, old: name }))
        }
        onFileInfoNew={(name) =>
          setFileNames((names) => ({ ...names, new: name }))
        }
        onReadyChangeOld={(ready) =>
          setSourceReady((state) => ({ ...state, old: ready }))
        }
        onReadyChangeNew={(ready) =>
          setSourceReady((state) => ({ ...state, new: ready }))
        }
        onError={showToast}
        onSwap={handleSwap}
      />

      <KeyboardShortcutsModal
        isOpen={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}
