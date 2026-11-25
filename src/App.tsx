import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Header } from './components/Header';
import { InputPanel } from './components/InputPanel';
import { SourcesBar } from './components/SourcesBar';
import { DiffToolbar } from './components/DiffToolbar';
import { DiffSidebar } from './components/DiffSidebar';
import { DiffView, type ChangeJump, type SearchTarget } from './components/DiffView';
import { SourceEditor } from './components/SourceEditor';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { SessionNameModal } from './components/SessionNameModal';
import { SavedComparisonsDialog } from './components/SavedComparisonsDialog';
import { PrintReport } from './components/PrintReport';
import { ImageComparison } from './components/ImageComparison';
import { SwapIcon } from './components/Icons';
import {
  DEFAULT_OPTIONS,
  type ComparisonType,
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
  formatMarkdownPatch,
} from './lib/diffEngine';
import { sanitizeIgnoreRules } from './lib/ignoreRules';
import { createLineSearch, indexDiffMatches } from './lib/diffSearch';
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
  normalizeSessionName,
  parseComparisonSession,
  serializeComparisonSession,
  sessionFileName,
  type ComparisonSession,
  type CreateComparisonSessionInput,
} from './lib/session';
import {
  addSavedComparison, deleteSavedComparison, listSavedComparisons,
  readSavedComparison, updateSavedComparison, type SavedComparison,
  SavedComparisonConflict,
} from './lib/savedComparisons';

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

interface PrintReportRequest {
  viewMode: ViewMode;
  generatedAt: string;
}

interface TextDraft extends MergeSnapshot {
  names: { old: string | null; new: string | null };
  ready: { old: boolean; new: boolean };
  compared: boolean;
  savedId: string | null;
  savedRevision: string | null;
  sessionName: string | null;
}

function loadDraft(): TextDraft {
  const stored = loadJson<TextDraft | null>(storageKeys.draft, null);
  if (stored && typeof stored.oldText === 'string' && typeof stored.newText === 'string'
    && stored.names && stored.ready) return stored;
  const oldText = loadString(storageKeys.oldText, '');
  const newText = loadString(storageKeys.newText, '');
  return {
    oldText, newText,
    names: { old: null, new: null },
    ready: { old: oldText !== '', new: newText !== '' },
    compared: false,
    savedId: null,
    savedRevision: null,
    sessionName: null,
  };
}

interface ComparisonInput extends MergeSnapshot {
  options: DiffOptions;
  oldName: string | null;
  newName: string | null;
}

type SessionSnapshot = Omit<CreateComparisonSessionInput, 'name'>;

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
        : typeof o.context === 'number' && Number.isSafeInteger(o.context) && o.context >= 0
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
  const [draft] = useState(loadDraft);
  const [oldText, setOldText] = useState(draft.oldText);
  const [newText, setNewText] = useState(draft.newText);
  const [hasCompared, setHasCompared] = useState(draft.compared);
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
  const [comparisonType, setComparisonType] =
    useState<ComparisonType>('text');
  const [imageBusy, setImageBusy] = useState(false);
  const [imageResetToken, setImageResetToken] = useState(0);

  const [result, setResult] = useState<DiffResult | null>(null);
  const [resultInput, setResultInput] = useState<ComparisonInput | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
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
  const [searchSelection, setSearchSelection] = useState<{
    index: ReturnType<typeof indexDiffMatches>;
    ordinal: number;
  } | null>(null);
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(() => new Set());
  const [currentChangeIndex, setCurrentChangeIndex] = useState<number | null>(null);
  const [changeJump, setChangeJump] = useState<ChangeJump | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionNameDialogOpen, setSessionNameDialogOpen] = useState(false);
  const [sessionName, setSessionName] = useState<string | null>(draft.sessionName);
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedEntries, setSavedEntries] = useState<SavedComparison[]>([]);
  const [savedLoadError, setSavedLoadError] = useState<string | null>(null);
  const [activeSavedId, setActiveSavedId] = useState<string | null>(draft.savedId);
  const [syntaxEnabled, setSyntaxEnabled] = usePersistedState(
    storageKeys.syntax,
    true,
    (v) => v === true,
  );
  const [tokenizer, setTokenizer] = useState<LineTokenizer | null>(null);
  const [fileNames, setFileNames] = useState(draft.names);
  const [sourceReady, setSourceReady] = useState(draft.ready);
  const [mergePast, setMergePast] = useState<MergeSnapshot[]>([]);
  const [mergeFuture, setMergeFuture] = useState<MergeSnapshot[]>([]);
  const [printReport, setPrintReport] = useState<PrintReportRequest | null>(
    null,
  );

  const workerRef = useRef<Worker | null>(null);
  const requestInputRef = useRef<ComparisonInput | null>(null);
  const workerWatchdogRef = useRef<number | undefined>(undefined);
  const seqRef = useRef(0);
  const toastTimerRef = useRef<number | undefined>(undefined);
  const themeOverridden = useRef(loadString(storageKeys.theme, '') !== '');
  const lastVisibleContextRef = useRef<number | 'all'>(
    options.context === 0 ? 'all' : options.context,
  );
  const expectedMergeTextRef = useRef<MergeSnapshot | null>(null);
  const pendingMergeFocusIndexRef = useRef<number | null>(null);
  const lastLocalSave = useRef<{
    id: string;
    snapshot: SessionSnapshot;
    pending?: Promise<void>;
  } | null>(null);
  const openedSavedBaseline = useRef<string | null>(null);
  const savedRevision = useRef<{ id: string; value: string } | null>(
    draft.savedId && draft.savedRevision ? { id: draft.savedId, value: draft.savedRevision } : null,
  );
  const workspaceHeading = useRef<HTMLHeadingElement>(null);
  const activeSaved = savedEntries.find((entry) => entry.id === activeSavedId);
  const draftSavedRevision = savedRevision.current?.id === activeSavedId ? savedRevision.current.value : null;
  const displayName = activeSaved?.name ?? sessionName;

  const comparisonInput = useMemo<ComparisonInput>(() => ({
    oldText, newText, options, oldName: fileNames.old, newName: fileNames.new,
  }), [oldText, newText, options, fileNames]);
  const freshResult = result != null && !result.aborted && resultInput === comparisonInput;
  const sessionSnapshot = useMemo<SessionSnapshot>(() => ({
    ...comparisonInput,
    oldReady: sourceReady.old, newReady: sourceReady.new,
    viewMode, wrap, lineNumbers, syntaxEnabled,
  }), [comparisonInput, sourceReady, viewMode, wrap, lineNumbers, syntaxEnabled]);

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
      if (workerRef.current !== w || msg.id !== seqRef.current) return;
      window.clearTimeout(workerWatchdogRef.current);
      workerWatchdogRef.current = undefined;
      setComputing(false);
      const requestInput = requestInputRef.current;
      requestInputRef.current = null;
      if (!msg.ok) {
        setComparisonError(msg.error ?? 'Something went wrong while diffing.');
        setPatch(null);
        return;
      }
      setResult(msg.result ?? null);
      setResultInput(requestInput);
      setPatch(msg.patch ?? null);
    };
    w.onerror = () => {
      if (workerRef.current !== w) return;
      window.clearTimeout(workerWatchdogRef.current);
      workerWatchdogRef.current = undefined;
      w.terminate();
      workerRef.current = null;
      requestInputRef.current = null;
      setComputing(false);
      setComparisonError('Diff worker failed — try smaller inputs.');
      setPatch(null);
    };
    workerRef.current = w;
    return w;
  }, []);

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
    if (comparisonType !== 'text') return;
    return () => {
      window.clearTimeout(workerWatchdogRef.current);
      workerRef.current?.terminate();
      workerRef.current = null;
      requestInputRef.current = null;
    };
  }, [comparisonType]);

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
    if (comparisonType !== 'text' || !syntaxEnabled) {
      setTokenizer(null);
      return;
    }
    let cancelled = false;
    createLineTokenizer(syntaxLang, theme).then(
      (t) => { if (!cancelled) setTokenizer(t); },
      () => { if (!cancelled) setTokenizer(null); },
    );
    return () => {
      cancelled = true;
    };
  }, [comparisonType, syntaxEnabled, syntaxLang, theme]);
  useEffect(() => {
    window.clearTimeout(workerWatchdogRef.current);
    workerWatchdogRef.current = undefined;
    // A busy worker would queue the new request behind obsolete inputs.
    if (requestInputRef.current) {
      workerRef.current?.terminate();
      workerRef.current = null;
      requestInputRef.current = null;
    }
    if (comparisonType !== 'text') {
      seqRef.current++;
      setComputing(false);
      return;
    }
    if (!hasCompared) {
      seqRef.current++;
      setResult(null);
      setResultInput(null);
      setPatch(null);
      setComputing(false);
      setComparisonError(null);
      return;
    }
    setComparisonError(null);
    setComputing(true);
    const id = ++seqRef.current;
    const timer = window.setTimeout(() => {
      try {
        const w = ensureWorker();
        requestInputRef.current = comparisonInput;
        w.postMessage({
          id,
          ...comparisonInput,
          oldName: comparisonInput.oldName ?? undefined,
          newName: comparisonInput.newName ?? undefined,
        });
        workerWatchdogRef.current = window.setTimeout(() => {
          if (id !== seqRef.current) return;
          w.terminate();
          if (workerRef.current === w) workerRef.current = null;
          requestInputRef.current = null;
          workerWatchdogRef.current = undefined;
          setComputing(false);
          setPatch(null);
          setComparisonError(
            'Comparison timed out. Check custom regex rules or try smaller inputs.',
          );
        }, WORKER_TIMEOUT_MS);
      } catch {
        workerRef.current?.terminate();
        workerRef.current = null;
        requestInputRef.current = null;
        setComputing(false);
        setPatch(null);
        setComparisonError('Could not start the diff worker. Try reloading this page.');
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    comparisonType,
    comparisonInput,
    hasCompared,
    ensureWorker,
  ]);

  // Reset expanded gaps when inputs or context settings change
  useEffect(() => {
    setExpandedIndices(new Set());
    setCurrentChangeIndex(null);
    setChangeJump(null);
  }, [comparisonInput]);

  useEffect(() => {
    if (comparisonType !== 'text') return;
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
    const resetDropOverlay = () => {
      dragCounter = 0;
      setGlobalDrag(false);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('drop', resetDropOverlay, true);
    window.addEventListener('dragend', onDragLeave);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('drop', resetDropOverlay, true);
      window.removeEventListener('dragend', onDragLeave);
    };
  }, [comparisonType, showToast]);

  useEffect(() => {
    const persist = () => {
      const next: TextDraft = {
        oldText, newText, names: fileNames, ready: sourceReady,
        compared: hasCompared, savedId: activeSavedId, sessionName,
        savedRevision: draftSavedRevision,
      };
      save(storageKeys.draft, next);
    };
    const timer = window.setTimeout(persist, 500);
    window.addEventListener('pagehide', persist);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', persist);
    };
  }, [oldText, newText, fileNames, sourceReady, hasCompared, activeSavedId, draftSavedRevision, sessionName]);

  useEffect(() => {
    if (!savedOpen && !activeSavedId) return;
    let cancelled = false;
    listSavedComparisons().then(
      (entries) => {
        if (cancelled) return;
        setSavedEntries(entries);
        setSavedLoadError(null);
      },
      () => {
        if (!cancelled) setSavedLoadError('Saved comparisons are unavailable in this browser.');
      },
    );
    return () => { cancelled = true; };
  }, [savedOpen, activeSavedId]);

  const upsertSavedEntry = useCallback((entry: SavedComparison) => {
    setSavedEntries((entries) => [...entries.filter(({ id }) => id !== entry.id), entry]);
  }, []);

  const persistSaved = useCallback((entry: SavedComparison, automatic = false) => {
    const marker: NonNullable<typeof lastLocalSave.current> = {
      id: entry.id, snapshot: sessionSnapshot,
    };
    const previous = lastLocalSave.current;
    const pending = (async () => {
      if (previous?.id === entry.id) await previous.pending;
      const base = savedRevision.current;
      if (base?.id !== entry.id) throw new SavedComparisonConflict();
      const updated = await updateSavedComparison(entry.id, {
        session: createComparisonSession({ ...sessionSnapshot, name: entry.name }),
        baseRevision: base.value,
        automatic,
      });
      savedRevision.current = { id: entry.id, value: updated.savedAt };
      upsertSavedEntry(updated);
    })().catch((error: unknown) => {
      if (lastLocalSave.current === marker) lastLocalSave.current = null;
      if (error instanceof SavedComparisonConflict) {
        setActiveSavedId((current) => current === entry.id ? null : current);
      }
      throw error;
    }).finally(() => {
      marker.pending = undefined;
    });
    marker.pending = pending;
    lastLocalSave.current = marker;
    return pending;
  }, [sessionSnapshot, upsertSavedEntry]);

  const flushAutosave = useCallback(() => {
    if (!activeSaved?.autosave || !hasCompared) return;
    const last = lastLocalSave.current;
    const pending = last?.id === activeSaved.id && last.snapshot === sessionSnapshot
      ? last.pending : persistSaved(activeSaved, true);
    return pending?.then(() => true, (error: unknown) => {
      showToast(error instanceof SavedComparisonConflict ? error.message :
        'Could not autosave this comparison. Export a backup to keep your edits.');
      return false;
    });
  }, [activeSaved, hasCompared, sessionSnapshot, persistSaved, showToast]);

  useEffect(() => {
    if (activeSaved && openedSavedBaseline.current === activeSaved.id) {
      lastLocalSave.current = { id: activeSaved.id, snapshot: sessionSnapshot };
      openedSavedBaseline.current = null;
    }
    if (!activeSaved?.autosave || !hasCompared) return;
    const timer = window.setTimeout(flushAutosave, 600);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushAutosave();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [activeSaved, hasCompared, flushAutosave, sessionSnapshot]);

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

  const handleNewDiff = useCallback(async () => {
    const pending = flushAutosave();
    if (pending && !await pending) return;
    const hadSources = sourceReady.old || sourceReady.new;
    const prevOld = oldText;
    const prevNew = newText;
    const prevNames = fileNames;
    const prevOptions = options;
    const prevReady = sourceReady;
    const prevSessionName = sessionName;
    const prevSavedId = activeSavedId;
    setOldText('');
    setNewText('');
    setHasCompared(false);
    setActiveSavedId(null);
    setOptions(DEFAULT_OPTIONS);
    lastVisibleContextRef.current = DEFAULT_OPTIONS.context;
    setFileNames({ old: null, new: null });
    setSourceReady({ old: false, new: false });
    setSessionName(null);
    setSessionNameDialogOpen(false);
    setSidebarOpen(false);
    setExpandedIndices(new Set());
    setCurrentChangeIndex(null);
    setChangeJump(null);
    setSearchQuery('');
    setSearchOpen(false);
    setEditorOpen(false);
    setMergePast([]);
    setMergeFuture([]);
    expectedMergeTextRef.current = null;
    pendingMergeFocusIndexRef.current = null;
    if (hadSources) {
      window.clearTimeout(toastTimerRef.current);
      setToast('Cleared');
      const undo = () => {
        setOldText(prevOld);
        setNewText(prevNew);
        setFileNames(prevNames);
        setSourceReady(prevReady);
        setSessionName(prevSessionName);
        setActiveSavedId(prevSavedId);
        setHasCompared(hasCompared);
        setOptions(prevOptions);
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
    activeSavedId,
    hasCompared,
    flushAutosave,
  ]);

  const handleLoadSample = useCallback(async () => {
    const pending = flushAutosave();
    if (pending && !await pending) return;
    setOldText(SAMPLE_ORIGINAL);
    setNewText(SAMPLE_CHANGED);
    setFileNames({ old: null, new: null });
    setSourceReady({ old: true, new: true });
    setHasCompared(true);
    setActiveSavedId(null);
    setSessionName(null);
    setExpandedIndices(new Set());
    setMergePast([]);
    setMergeFuture([]);
  }, [flushAutosave]);

  const handleSelectPreset = useCallback(async (preset: SamplePreset) => {
    const pending = flushAutosave();
    if (pending && !await pending) return;
    setResult(null);
    setResultInput(null);
    setPatch(null);
    setOldText(preset.oldText);
    setNewText(preset.newText);
    setFileNames({ old: preset.oldName, new: preset.newName });
    setSourceReady({ old: true, new: true });
    setHasCompared(true);
    setActiveSavedId(null);
    setSessionName(null);
    setExpandedIndices(new Set());
    setMergePast([]);
    setMergeFuture([]);
  }, [flushAutosave]);

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
    if (!freshResult || patch === null) return;
    try {
      await navigator.clipboard.writeText(patch);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Could not access the clipboard.');
    }
  }, [freshResult, patch, showToast]);

  const handleCopyMarkdown = useCallback(async () => {
    if (!freshResult || patch === null) return;
    try {
      await navigator.clipboard.writeText(formatMarkdownPatch(patch));
      setCopiedMarkdown(true);
      showToast('Copied Markdown diff to clipboard');
      window.setTimeout(() => setCopiedMarkdown(false), 2000);
    } catch {
      showToast('Could not access the clipboard.');
    }
  }, [freshResult, patch, showToast]);

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

  const restoreSession = useCallback(
    (session: ComparisonSession, entry?: SavedComparison) => {
      const { original, changed } = session.sources;
      const preferences = session.preferences;

      setResult(null);
      setResultInput(null);
      setPatch(null);
      setOldText(original.text);
      setNewText(changed.text);
      setFileNames({ old: original.name, new: changed.name });
      setSourceReady({ old: original.ready, new: changed.ready });
      setHasCompared(original.ready && changed.ready);
      setActiveSavedId(entry?.id ?? null);
      savedRevision.current = entry ? { id: entry.id, value: entry.savedAt } : null;
      openedSavedBaseline.current = entry?.id ?? null;
      setSessionName(session.name);
      setOptions(preferences.options);
      setViewMode(preferences.viewMode);
      setWrap(preferences.wrap);
      setLineNumbers(preferences.lineNumbers);
      setSyntaxEnabled(preferences.syntaxEnabled);
      lastVisibleContextRef.current = preferences.options.context === 0
        ? 'all'
        : preferences.options.context;
      setExpandedIndices(new Set());
      setCurrentChangeIndex(null);
      setChangeJump(null);
      setSidebarOpen(false);
      setSearchOpen(false);
      setSearchQuery('');
      setEditorOpen(false);
      setSessionNameDialogOpen(false);
      setSavedOpen(false);
      setMergePast([]);
      setMergeFuture([]);
      expectedMergeTextRef.current = null;
      pendingMergeFocusIndexRef.current = null;

      showToast(`Loaded session “${session.name}”`);
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

  const handleImportSession = useCallback(async (file: File) => {
    if (file.size > MAX_SESSION_FILE_BYTES) {
      showToast('Could not open session: the file is larger than 32 MB.');
      return;
    }
    try {
      const session = parseComparisonSession(await file.text());
      if (await flushAutosave() === false) return;
      restoreSession(session);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not open session: the file is invalid.');
    }
  }, [flushAutosave, restoreSession, showToast]);

  const handleSaveLocal = async (name: string, autosave: boolean) => {
    if (await flushAutosave() === false) throw new Error('Could not autosave the current comparison.');
    const entry = await addSavedComparison(
      createComparisonSession({ ...sessionSnapshot, name }), autosave,
    );
    lastLocalSave.current = { id: entry.id, snapshot: sessionSnapshot };
    savedRevision.current = { id: entry.id, value: entry.savedAt };
    upsertSavedEntry(entry);
    setActiveSavedId(entry.id);
    setSessionName(null);
    setSavedOpen(false);
    showToast(`Saved “${entry.name}” on this device`);
  };

  const handleOpenSaved = async (entry: SavedComparison) => {
    if (await flushAutosave() === false) throw new Error('Could not autosave the current comparison.');
    const saved = await readSavedComparison(entry.id);
    upsertSavedEntry(saved.entry);
    restoreSession(saved.session, saved.entry);
  };

  const handleDownloadPatch = useCallback(() => {
    if (!freshResult || patch === null) return;
    const blob = new Blob([patch], { type: 'text/plain' });
    const base = (name: string | null) =>
      name ? name.replace(/\.[^./\\]+$/, '') : 'diff';
    triggerDownload(blob, `${base(fileNames.new)}.patch`);
  }, [freshResult, patch, fileNames.new, triggerDownload]);

  const handleSaveSession = useCallback(
    (name: string) => {
      try {
        const session = createComparisonSession({ ...sessionSnapshot, name });
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
      showToast,
      sessionSnapshot,
      triggerDownload,
    ],
  );

  const handlePrintReport = useCallback(
    (reportViewMode: ViewMode) => {
      if (!freshResult) return;
      flushSync(() => {
        setPrintReport({
          viewMode: reportViewMode,
          generatedAt: new Date().toISOString(),
        });
      });
      window.print();
    },
    [freshResult],
  );

  const handleExportHtml = useCallback(() => {
    if (!freshResult || !result || result.rows.length === 0) return;
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
  }, [freshResult, result, options, expandedIndices, fileNames, triggerDownload]);

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
    if (editorOpen) {
      document.querySelector<HTMLTextAreaElement>('.source-editor .input-panel--left textarea')
        ?.focus({ preventScroll: true });
    } else {
      setEditorOpen(true);
    }
  }, [editorOpen]);
  const handleCloseEditor = useCallback(() => {
    setEditorOpen(false);
    document.querySelector<HTMLButtonElement>('[data-edit-sources]')?.focus({ preventScroll: true });
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

  const canStartComparison = sourceReady.old && sourceReady.new;
  const hasAnySource = sourceReady.old || sourceReady.new;
  const handleCompare = () => {
    if (!canStartComparison) return;
    setHasCompared(true);
    window.requestAnimationFrame(() => workspaceHeading.current?.focus({ preventScroll: true }));
  };

  useEffect(() => {
    const onBeforePrint = () => {
      if (
        comparisonType !== 'text' ||
        !hasCompared ||
        !freshResult ||
        printReport
      ) {
        return;
      }
      flushSync(() => {
        setPrintReport({
          viewMode,
          generatedAt: new Date().toISOString(),
        });
      });
    };
    const onAfterPrint = () => setPrintReport(null);
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, [hasCompared, comparisonType, printReport, freshResult, viewMode]);

  const identical =
    result?.stats != null &&
    result.stats.added + result.stats.removed + result.stats.changed === 0;

  const lineSearch = useMemo(
    () => searchOpen ? createLineSearch(searchQuery) : null,
    [searchOpen, searchQuery],
  );
  const searchIndex = useMemo(
    () => indexDiffMatches(result?.rows ?? [], lineSearch),
    [result, lineSearch],
  );
  const searchOrdinal = searchSelection?.index === searchIndex ? searchSelection.ordinal : null;
  const selectedMatch = useMemo(
    () => searchOrdinal == null ? null : searchIndex.at(searchOrdinal),
    [searchOrdinal, searchIndex],
  );
  const navigateSearch = (step: 1 | -1) => {
    const { count } = searchIndex;
    if (!count) return;
    const ordinal = searchOrdinal == null
      ? (step === 1 ? 0 : count - 1)
      : (searchOrdinal + step + count) % count;
    setSearchSelection({ index: searchIndex, ordinal });
  };
  const toggleSearch = useCallback(() => {
    setSearchOpen((open) => !open);
    setSearchSelection(null);
  }, []);

  const visibleRows = useMemo(
    () =>
      result ? applyContext(result.rows, options.context, expandedIndices, selectedMatch?.rowIndex) : [],
    [result, options.context, expandedIndices, selectedMatch?.rowIndex],
  );
  const searchTarget = useMemo<SearchTarget | null>(() => {
    if (!result || !selectedMatch) return null;
    const visibleIndex = visibleRows.indexOf(result.rows[selectedMatch.rowIndex]);
    return visibleIndex < 0 ? null : { ...selectedMatch, visibleIndex };
  }, [result, selectedMatch, visibleRows]);

  const printRows = useMemo(
    () =>
      printReport && result
        ? applyContext(result.rows, options.context, expandedIndices)
        : [],
    [expandedIndices, options.context, printReport, result],
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
  const sectionsAtStart = useMemo(
    () => new Map(changeSections.map((section) => [section.rowIndex, section])),
    [changeSections],
  );

  const activateSection = useCallback(
    (index: number, focus = true) => {
      const section = changeSections[index];
      if (!section) return;
      setCurrentChangeIndex(index);
      setSearchSelection(null);
      setChangeJump({ focus });
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

  const handleNextChange = useCallback((focus = true) => {
    if (changeSections.length === 0) return;
    const nextIndex =
      currentChangeIndex === null
        ? 0
        : (currentChangeIndex + 1) % changeSections.length;
    activateSection(nextIndex, focus);
  }, [activateSection, changeSections.length, currentChangeIndex]);

  const handlePrevChange = useCallback((focus = true) => {
    if (changeSections.length === 0) return;
    const previousIndex =
      currentChangeIndex === null
        ? changeSections.length - 1
        : (currentChangeIndex - 1 + changeSections.length) %
          changeSections.length;
    activateSection(previousIndex, focus);
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
      setComputing(true);
      setOldText(snapshot.oldText);
      setNewText(snapshot.newText);
    },
    [],
  );

  const handleMergeSection = useCallback(
    (rowIndex: number, direction: MergeDirection) => {
      if (!freshResult) return;
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
      let merged: MergeSnapshot;
      try {
        merged = mergeChangeSections(oldText, newText, sectionsToMerge, direction);
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Could not apply this change section.');
        return;
      }
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
      freshResult,
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
    if (requested == null || !freshResult || computing) return;
    pendingMergeFocusIndexRef.current = null;
    if (changeSections.length === 0) return;
    const focus = !document.activeElement?.matches('textarea, input, select, [contenteditable=true]');
    activateSection(Math.min(requested, changeSections.length - 1), focus);
  }, [activateSection, changeSections.length, computing, freshResult]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (comparisonType !== 'text') return;
      // Ignore if user is currently typing in an input or textarea
      const target = e.target as HTMLElement;
      const inInput =
        target &&
        (target.tagName === 'TEXTAREA' ||
          target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.defaultPrevented || savedOpen || sessionNameDialogOpen) return;
      if (e.key === 'Escape' && searchOpen) {
        e.preventDefault();
        toggleSearch();
        return;
      }

      if (e.key === '?' && !inInput && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShortcutsOpen((o) => !o);
        return;
      }

      if (!inInput && e.altKey && !e.ctrlKey && !e.metaKey) {
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

      if (!inInput && e.key === 'F7') {
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
        if (hasCompared && result && (result.rows.length > 0 || identical)) {
          e.preventDefault();
          toggleSearch();
        }
        return;
      } else if (key === 'e') {
        e.preventDefault();
        if (!hasCompared) {
          const missingSide = sourceReady.old ? 'right' : 'left';
          document
            .querySelector<HTMLTextAreaElement>(
              `.input-panel--${missingSide} textarea`,
            )
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
    comparisonType,
    hasCompared,
    sourceReady,
    result,
    identical,
    searchOpen,
    savedOpen,
    sessionNameDialogOpen,
    toggleSearch,
  ]);

  const initialSessionName = displayName ??
    (fileNames.old || fileNames.new
      ? `${fileNames.old ?? 'Original'} vs ${fileNames.new ?? 'Changed'}`
      : 'Comparison');
  const closeSessionName = useCallback(() => setSessionNameDialogOpen(false), []);
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
          setSourceReady((state) => ({ ...state, old: hasCompared || ready }))
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
          setSourceReady((state) => ({ ...state, new: hasCompared || ready }))
        }
        onFileInfo={(name) =>
          setFileNames((names) => ({ ...names, new: name }))
        }
      />
    </>
  );

  return (
    <div className={`app${printReport ? ' app--print-report' : ''}`}>
      <a href="#main-content" className="skip-link">
        Skip to diff
      </a>
      <Header
        theme={theme}
        onToggleTheme={() => {
          themeOverridden.current = true;
          setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
        }}
        comparisonType={comparisonType}
        onComparisonTypeChange={(nextType) => {
          if (nextType === comparisonType) return;
          setComparisonType(nextType);
          setGlobalDrag(false);
          setShortcutsOpen(false);
          setSearchOpen(false);
          setEditorOpen(false);
          setSavedOpen(false);
          setSessionNameDialogOpen(false);
          setPrintReport(null);
        }}
        onNewDiff={
          comparisonType === 'text'
            ? handleNewDiff
            : () => setImageResetToken((token) => token + 1)
        }
        busy={comparisonType === 'text' ? computing : imageBusy}
        onSelectPreset={
          comparisonType === 'text' ? handleSelectPreset : undefined
        }
        onOpenShortcuts={
          comparisonType === 'text'
            ? () => setShortcutsOpen(true)
            : undefined
        }
        onImportSession={
          comparisonType === 'text' ? handleImportSession : undefined
        }
        onShowSaved={comparisonType === 'text' ? () => setSavedOpen(true) : undefined}
      />

      <div
        className="text-comparison-shell"
        hidden={comparisonType !== 'text'}
      >
      {!hasCompared ? (
        <main
          id={comparisonType === 'text' ? 'main-content' : undefined}
          className="main main--landing"
        >
          <section className="text-intro">
            <h1>Compare text</h1>
            <p>Paste text or open two files. Your content stays on this device.</p>
          </section>
          <div className="panels">{inputPanels}</div>
          <div className="text-start">
            <button type="button" className="btn btn--primary" disabled={!canStartComparison}
              onClick={handleCompare}>Compare</button>
            <button type="button" className="btn" onClick={handleLoadSample}>Try with sample text</button>
            <p className="text-start__hint" role="status">
              {canStartComparison ? 'Both sources are ready.' : hasAnySource
                ? `Add the ${sourceReady.old ? 'changed' : 'original'} source to compare.`
                : 'Add an original and a changed source to compare.'}
            </p>
          </div>
        </main>
      ) : (
        <main
          id={comparisonType === 'text' ? 'main-content' : undefined}
          className="main main--workspace"
        >
          <h1 className="sr-only" tabIndex={-1} ref={workspaceHeading}>Text comparison</h1>
          <SourcesBar
            oldText={oldText}
            newText={newText}
            oldName={fileNames.old}
            newName={fileNames.new}
            identical={!!identical}
            sessionName={displayName}
            editorOpen={editorOpen}
            onEdit={editorOpen ? handleCloseEditor : handleEditSources}
            onSwap={handleSwap}
          />

          {editorOpen && <SourceEditor onClose={handleCloseEditor}>{inputPanels}</SourceEditor>}

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
              activeSectionStartRow={currentSection?.rowIndex ?? null}
              mergeDisabled={!freshResult}
              onSelectSection={handleSelectChange}
              options={options}
              onOptionsChange={setOptions}
              syntaxEnabled={syntaxEnabled}
              onSyntaxChange={setSyntaxEnabled}
              onClose={handleCloseSidebar}
            />
            )}

            <section className="results" aria-label="Comparison results">
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
                onToggleSearch={toggleSearch}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                searchCount={searchIndex.count}
                searchOrdinal={searchOrdinal}
                onSearchNext={() => navigateSearch(1)}
                onSearchPrev={() => navigateSearch(-1)}
                changeCount={changeSections.length}
                changeOrdinal={currentChangeIndex}
                onNextChange={() => handleNextChange(false)}
                onPrevChange={() => handlePrevChange(false)}
                onCopyPatch={handleCopyPatch}
                onDownloadPatch={handleDownloadPatch}
                onCopyMarkdown={handleCopyMarkdown}
                onExportHtml={handleExportHtml}
                onPrintReport={handlePrintReport}
                reportReady={freshResult}
                onSaveSession={() => setSessionNameDialogOpen(true)}
                canUndoMerge={mergePast.length > 0}
                canRedoMerge={mergeFuture.length > 0}
                onUndoMerge={handleUndoMerge}
                onRedoMerge={handleRedoMerge}
                patchReady={freshResult && patch !== null}
                copied={copied}
                copiedMarkdown={copiedMarkdown}
              />

              {comparisonError && <div className="notice" role="alert">{comparisonError}</div>}
              {!result && !comparisonError && <p className="notice" role="status">Comparing sources…</p>}
              {result?.aborted && (
                <div className="notice">
                  <strong>This diff was too large to compute.</strong> Try
                  comparing smaller files, or enable an ignore option in the
                  sidebar to reduce the search space.
                </div>
              )}

              {result && !result.aborted && (
                <DiffView
                  rows={visibleRows}
                  viewMode={viewMode}
                  wrap={wrap}
                  lineNumbers={lineNumbers}
                   search={lineSearch}
                   searchTarget={searchTarget}
                   activeChangeRowIndex={currentSection?.rowIndex}
                   activeChangeEndRowIndex={currentSection?.endRowIndex}
                   changeJump={changeJump}
                   sectionsAtStart={sectionsAtStart}
                   onMergeSection={handleMergeSection}
                   mergeDisabled={!freshResult}
                  onExpandGap={handleExpandGap}
                  onCopyNotice={showToast}
                  getTokens={getTokens}
                />
              )}

            </section>
          </div>
        </main>
      )}

      {!hasCompared && (
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
      </div>

      <ImageComparison
        active={comparisonType === 'image'}
        resetToken={imageResetToken}
        onBusyChange={setImageBusy}
        onError={showToast}
      />

      {comparisonType === 'text' &&
        printReport &&
        result && freshResult && (
        <PrintReport
          rows={printRows}
          stats={result.stats}
          viewMode={printReport.viewMode}
          sessionName={displayName}
          oldName={fileNames.old ?? 'Original'}
          newName={fileNames.new ?? 'Changed'}
          generatedAt={printReport.generatedAt}
          options={options}
          expandedContextCount={expandedIndices.size}
        />
      )}

      {comparisonType === 'text' && globalDrag && (
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
        isOpen={
          comparisonType === 'text' &&
           hasCompared &&
          sessionNameDialogOpen
        }
        initialName={initialSessionName}
        onClose={closeSessionName}
        onSave={handleSaveSession}
      />

      {comparisonType === 'text' && savedOpen && (
        <SavedComparisonsDialog
          entries={[...savedEntries].sort((a, b) => b.savedAt.localeCompare(a.savedAt))}
          loadError={savedLoadError}
          activeId={activeSavedId}
          canSave={hasCompared}
          initialName={initialSessionName}
          onClose={() => setSavedOpen(false)}
          onCreate={handleSaveLocal}
          onOpen={handleOpenSaved}
          onRename={async (entry, name) => {
            upsertSavedEntry(await updateSavedComparison(entry.id, { name: normalizeSessionName(name) }));
          }}
          onDelete={async (entry) => {
            await deleteSavedComparison(entry.id);
            setSavedEntries((entries) => entries.filter(({ id }) => id !== entry.id));
            if (activeSavedId === entry.id) {
              setActiveSavedId(null);
              setSessionName(null);
            }
          }}
          onSave={async (entry) => {
            await persistSaved(entry);
            setSavedOpen(false);
            showToast(`Saved changes to “${entry.name}”`);
          }}
          onAutosave={async (entry, autosave) => {
            upsertSavedEntry(await updateSavedComparison(entry.id, { autosave }));
          }}
        />
      )}

      <KeyboardShortcutsModal
        isOpen={comparisonType === 'text' && shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
    </div>
  );
}
