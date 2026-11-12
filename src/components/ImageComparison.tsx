import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
} from 'react';
import {
  comparePixelBuffers,
  type ImageChangeRegion,
  type ImageDiffResult,
} from '../lib/imageDiff';
import {
  DownloadIcon,
  ResetIcon,
  SwapIcon,
  UploadIcon,
} from './Icons';

export type ImageCompareMode =
  | 'side-by-side'
  | 'slider'
  | 'fade'
  | 'subtract'
  | 'highlight';

const ACCEPTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);
const ACCEPTED_IMAGE_EXTENSIONS = /\.(png|jpe?g|webp)$/i;
export const MAX_IMAGE_FILE_BYTES = 25 * 1024 * 1024;

interface LoadedImage {
  file: File;
  url: string;
  name: string;
  format: string;
  size: number;
  width: number;
  height: number;
}

interface ImageWorkerResponse {
  id: number;
  ok: boolean;
  result?: ImageDiffResult;
  error?: string;
}

interface ImageComparisonProps {
  active: boolean;
  resetToken: number;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string) => void;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function imageFormat(file: File): string {
  if (file.type === 'image/jpeg') return 'JPEG';
  if (file.type === 'image/webp') return 'WebP';
  if (file.type === 'image/png') return 'PNG';
  const extension = file.name.split('.').pop()?.toUpperCase();
  return extension === 'JPG' ? 'JPEG' : extension || 'Image';
}

function validImageFile(file: File): boolean {
  return (
    ACCEPTED_IMAGE_TYPES.has(file.type) ||
    (file.type === '' && ACCEPTED_IMAGE_EXTENSIONS.test(file.name))
  );
}

async function decodeImage(file: File): Promise<LoadedImage> {
  if (!validImageFile(file)) {
    throw new Error('Choose a PNG, JPEG, or WebP image.');
  }
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    throw new Error(
      `"${file.name}" is larger than the ${MAX_IMAGE_FILE_BYTES / 1024 / 1024} MB image limit.`,
    );
  }

  const bitmap = await createImageBitmap(file);
  try {
    return {
      file,
      url: URL.createObjectURL(file),
      name: file.name,
      format: imageFormat(file),
      size: file.size,
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

async function pixelsOnMain(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create image canvas context.');
    context.drawImage(bitmap, 0, 0);
    return {
      data: context.getImageData(0, 0, bitmap.width, bitmap.height).data,
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
}

async function compareOnMain(
  original: File,
  changed: File,
  threshold: number,
  ignoreAlpha: boolean,
): Promise<ImageDiffResult> {
  const [originalPixels, changedPixels] = await Promise.all([
    pixelsOnMain(original),
    pixelsOnMain(changed),
  ]);
  return comparePixelBuffers(
    originalPixels,
    changedPixels,
    threshold,
    ignoreAlpha,
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ImageSourcePicker({
  side,
  source,
  onLoad,
  onClear,
  compact = false,
}: {
  side: 'original' | 'changed';
  source: LoadedImage | null;
  onLoad: (file: File) => void;
  onClear: () => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const label = side === 'original' ? 'Original image' : 'Changed image';

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onLoad(file);
  };

  if (compact && source) {
    return (
      <div className={`image-source-chip image-source-chip--${side}`}>
        <img src={source.url} alt="" />
        <div className="image-source-chip__text">
          <strong>{source.name}</strong>
          <span>
            {source.width}×{source.height} · {source.format} ·{' '}
            {formatBytes(source.size)}
          </span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onLoad(file);
          }}
        />
        <button
          type="button"
          className="btn btn--small"
          onClick={() => inputRef.current?.click()}
          aria-label={`Replace ${label}`}
        >
          Replace
        </button>
        <button
          type="button"
          className="btn btn--small btn--ghost"
          onClick={onClear}
          aria-label={`Clear ${label}`}
        >
          Clear
        </button>
      </div>
    );
  }

  return (
    <section
      className={`image-source-picker image-source-picker--${side}${
        dragOver ? ' image-source-picker--drag' : ''
      }`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onLoad(file);
        }}
      />
      {source ? (
        <>
          <img
            className="image-source-picker__preview"
            src={source.url}
            alt={`${label} preview`}
          />
          <div className="image-source-picker__meta">
            <strong>{source.name}</strong>
            <span>
              {source.width}×{source.height} · {source.format} ·{' '}
              {formatBytes(source.size)}
            </span>
          </div>
          <div className="image-source-picker__actions">
            <button
              type="button"
              className="btn btn--small"
              onClick={() => inputRef.current?.click()}
              aria-label={`Replace ${label}`}
            >
              Replace
            </button>
            <button
              type="button"
              className="btn btn--small btn--ghost"
              onClick={onClear}
              aria-label={`Clear ${label}`}
            >
              Clear
            </button>
          </div>
        </>
      ) : (
        <>
          <UploadIcon size={28} />
          <strong>{label}</strong>
          <span>Drop a PNG, JPEG, or WebP here, or choose a local file.</span>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => inputRef.current?.click()}
            aria-label={`Open ${label}`}
          >
            <UploadIcon size={15} />
            Open image
          </button>
        </>
      )}
    </section>
  );
}

function RegionBoxes({
  regions,
  activeRegionId,
}: {
  regions: ImageChangeRegion[];
  activeRegionId: number | null;
}) {
  return (
    <>
      {regions.map((region) => (
        <span
          key={region.id}
          className={`image-region-box${
            activeRegionId === region.id ? ' image-region-box--active' : ''
          }`}
          style={{
            left: region.x,
            top: region.y,
            width: region.width,
            height: region.height,
          }}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

export function ImageComparison({
  active,
  resetToken,
  onBusyChange,
  onError,
}: ImageComparisonProps) {
  const [original, setOriginal] = useState<LoadedImage | null>(null);
  const [changed, setChanged] = useState<LoadedImage | null>(null);
  const [mode, setMode] = useState<ImageCompareMode>('side-by-side');
  const [threshold, setThreshold] = useState(16);
  const [ignoreAlpha, setIgnoreAlpha] = useState(false);
  const [sliderPosition, setSliderPosition] = useState(50);
  const [fadeOpacity, setFadeOpacity] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [result, setResult] = useState<ImageDiffResult | null>(null);
  const [processingMode, setProcessingMode] = useState<
    'worker' | 'main-thread' | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [activeRegionIndex, setActiveRegionIndex] = useState<number | null>(
    null,
  );
  const requestIdRef = useRef(0);
  const originalRef = useRef<LoadedImage | null>(null);
  const changedRef = useRef<LoadedImage | null>(null);
  const primaryViewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    panX: number;
    panY: number;
  } | null>(null);

  useEffect(() => {
    originalRef.current = original;
  }, [original]);
  useEffect(() => {
    changedRef.current = changed;
  }, [changed]);

  useEffect(
    () => () => {
      if (originalRef.current) URL.revokeObjectURL(originalRef.current.url);
      if (changedRef.current) URL.revokeObjectURL(changedRef.current.url);
    },
    [],
  );

  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  const clearSource = useCallback((side: 'original' | 'changed') => {
    const setter = side === 'original' ? setOriginal : setChanged;
    setter((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    setResult(null);
    setActiveRegionIndex(null);
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, []);

  useEffect(() => {
    if (resetToken === 0) return;
    clearSource('original');
    clearSource('changed');
    setMode('side-by-side');
    setThreshold(16);
    setIgnoreAlpha(false);
    setSliderPosition(50);
    setFadeOpacity(50);
  }, [clearSource, resetToken]);

  const loadSource = useCallback(
    async (side: 'original' | 'changed', file: File) => {
      try {
        const decoded = await decodeImage(file);
        const setter = side === 'original' ? setOriginal : setChanged;
        setter((current) => {
          if (current) URL.revokeObjectURL(current.url);
          return decoded;
        });
        setPan({ x: 0, y: 0 });
        setZoom(1);
        setActiveRegionIndex(null);
      } catch (error) {
        onError(
          error instanceof Error ? error.message : 'Could not read image.',
        );
      }
    },
    [onError],
  );

  const swapSources = useCallback(() => {
    setOriginal(changed);
    setChanged(original);
    setPan({ x: 0, y: 0 });
    setActiveRegionIndex(null);
  }, [changed, original]);

  useEffect(() => {
    if (!active || !original || !changed) {
      setBusy(false);
      return;
    }

    let cancelled = false;
    let fallbackStarted = false;
    const id = ++requestIdRef.current;
    setBusy(true);
    setActiveRegionIndex(null);

    const runFallback = async () => {
      if (fallbackStarted || cancelled) return;
      fallbackStarted = true;
      try {
        const next = await compareOnMain(
          original.file,
          changed.file,
          threshold,
          ignoreAlpha,
        );
        if (cancelled || id !== requestIdRef.current) return;
        setResult(next);
        setProcessingMode('main-thread');
      } catch (error) {
        if (!cancelled) {
          onError(
            error instanceof Error
              ? error.message
              : 'Image comparison failed.',
          );
          setResult(null);
        }
      } finally {
        if (!cancelled && id === requestIdRef.current) setBusy(false);
      }
    };

    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      void runFallback();
      return () => {
        cancelled = true;
      };
    }

    const worker = new Worker(
      new URL('../imageDiffWorker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (event: MessageEvent<ImageWorkerResponse>) => {
      if (cancelled || id !== requestIdRef.current) return;
      if (!event.data.ok || !event.data.result) {
        worker.terminate();
        void runFallback();
        return;
      }
      setResult(event.data.result);
      setProcessingMode('worker');
      setBusy(false);
      worker.terminate();
    };
    worker.onerror = () => {
      worker.terminate();
      void runFallback();
    };
    worker.postMessage({
      id,
      original: original.file,
      changed: changed.file,
      threshold,
      ignoreAlpha,
    });

    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, [active, changed, ignoreAlpha, onError, original, threshold]);

  const activeRegion =
    activeRegionIndex == null ? null : result?.regions[activeRegionIndex] ?? null;

  const focusRegion = useCallback(
    (index: number) => {
      if (!result || result.regions.length === 0) return;
      const normalized =
        (index + result.regions.length) % result.regions.length;
      const region = result.regions[normalized];
      setActiveRegionIndex(normalized);
      const viewport = primaryViewportRef.current;
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const nextZoom = Math.max(zoom, 1);
      setZoom(nextZoom);
      setPan({
        x: rect.width / 2 - (region.x + region.width / 2) * nextZoom,
        y: rect.height / 2 - (region.y + region.height / 2) * nextZoom,
      });
    },
    [result, zoom],
  );

  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  };

  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({
      x: drag.panX + event.clientX - drag.clientX,
      y: drag.panY + event.clientY - drag.clientY,
    });
  };

  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;

  const stageContent = (
    stageMode: ImageCompareMode,
    side?: 'original' | 'changed',
  ) => {
    if (!original || !changed || !result) return null;
    const showOriginal =
      side === 'original' ||
      (!side && ['slider', 'fade', 'subtract'].includes(stageMode));
    const showChanged = side !== 'original';
    const showRegions =
      stageMode === 'highlight' || activeRegionIndex != null;

    return (
      <div
        className="image-stage__content"
        data-transform={transform}
        style={{
          width: result.width,
          height: result.height,
          transform,
        }}
      >
        {showOriginal && (
          <img
            className="image-stage__image image-stage__image--original"
            src={original.url}
            alt=""
            draggable={false}
            style={{ width: original.width, height: original.height }}
          />
        )}
        {showChanged && (
          <img
            className={`image-stage__image image-stage__image--changed${
              stageMode === 'subtract' ? ' image-stage__image--difference' : ''
            }`}
            src={changed.url}
            alt=""
            draggable={false}
            style={{
              width: changed.width,
              height: changed.height,
              opacity:
                stageMode === 'fade' ? fadeOpacity / 100 : undefined,
              clipPath:
                stageMode === 'slider'
                  ? `inset(0 ${100 - sliderPosition}% 0 0)`
                  : undefined,
            }}
          />
        )}
        {showRegions && (
          <RegionBoxes
            regions={result.regions}
            activeRegionId={activeRegion?.id ?? null}
          />
        )}
      </div>
    );
  };

  const viewportProps = {
    onPointerDown: startPan,
    onPointerMove: movePan,
    onPointerUp: endPan,
    onPointerCancel: endPan,
  };

  const exportHighlight = useCallback(async () => {
    if (!changed || !result) return;
    try {
      const bitmap = await createImageBitmap(changed.file);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = result.width;
        canvas.height = result.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Could not create export canvas.');
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0);

        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let index = 0; index < result.mask.length; index++) {
          if (result.mask[index] === 0) continue;
          const offset = index * 4;
          image.data[offset] = Math.round(image.data[offset] * 0.38 + 158);
          image.data[offset + 1] = Math.round(image.data[offset + 1] * 0.38);
          image.data[offset + 2] = Math.round(
            image.data[offset + 2] * 0.38 + 50,
          );
          image.data[offset + 3] = Math.max(image.data[offset + 3], 230);
        }
        context.putImageData(image, 0, 0);

        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((value) => {
            if (value) resolve(value);
            else reject(new Error('Could not encode PNG.'));
          }, 'image/png');
        });
        const base = changed.name.replace(/\.[^./\\]+$/, '') || 'image';
        downloadBlob(blob, `${base}-visual-diff.png`);
      } finally {
        bitmap.close();
      }
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : 'Could not export visual diff.',
      );
    }
  }, [changed, onError, result]);

  const metadata = useMemo(
    () => [
      { label: 'Original', source: original },
      { label: 'Changed', source: changed },
    ],
    [changed, original],
  );

  const ready = Boolean(original && changed);

  return (
    <main
      id={active ? 'main-content' : undefined}
      className={`main image-compare${ready ? ' image-compare--ready' : ''}`}
      hidden={!active}
      data-image-processing={processingMode ?? undefined}
    >
      {!ready ? (
        <>
          <section className="image-compare__intro">
            <div>
              <p className="image-compare__eyebrow">Image comparison</p>
              <h1>Compare screenshots and images locally</h1>
              <p>
                PNG, JPEG, and WebP files are decoded and compared in this
                browser. Nothing is uploaded.
              </p>
            </div>
          </section>
          <div className="image-source-grid">
            <ImageSourcePicker
              side="original"
              source={original}
              onLoad={(file) => void loadSource('original', file)}
              onClear={() => clearSource('original')}
            />
            <div className="image-source-grid__swap">
              <button
                type="button"
                className="btn btn--round"
                onClick={swapSources}
                disabled={!original && !changed}
                aria-label="Swap images"
                title="Swap images"
              >
                <SwapIcon size={18} />
              </button>
            </div>
            <ImageSourcePicker
              side="changed"
              source={changed}
              onLoad={(file) => void loadSource('changed', file)}
              onClear={() => clearSource('changed')}
            />
          </div>
        </>
      ) : (
        <>
          <section className="image-sources-bar" aria-label="Image sources">
            <ImageSourcePicker
              compact
              side="original"
              source={original}
              onLoad={(file) => void loadSource('original', file)}
              onClear={() => clearSource('original')}
            />
            <button
              type="button"
              className="btn btn--round"
              onClick={swapSources}
              aria-label="Swap images"
              title="Swap images"
            >
              <SwapIcon size={17} />
            </button>
            <ImageSourcePicker
              compact
              side="changed"
              source={changed}
              onLoad={(file) => void loadSource('changed', file)}
              onClear={() => clearSource('changed')}
            />
          </section>

          <section className="image-toolbar" aria-label="Image comparison controls">
            <div
              className="image-mode-tabs"
              role="tablist"
              aria-label="Image comparison mode"
            >
              {(
                [
                  ['side-by-side', 'Side by side'],
                  ['slider', 'Slider'],
                  ['fade', 'Fade'],
                  ['subtract', 'Subtract'],
                  ['highlight', 'Highlight'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  className={`btn btn--small${
                    mode === value ? ' btn--primary' : ''
                  }`}
                  aria-selected={mode === value}
                  onClick={() => setMode(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <label className="image-control">
              <span>Pixel threshold</span>
              <input
                type="range"
                min="0"
                max="255"
                value={threshold}
                aria-label="Pixel difference threshold"
                onChange={(event) => setThreshold(Number(event.target.value))}
              />
              <output>{threshold}</output>
            </label>

            <label className="image-check">
              <input
                type="checkbox"
                checked={ignoreAlpha}
                onChange={(event) => setIgnoreAlpha(event.target.checked)}
              />
              Ignore alpha
            </label>

            {mode === 'slider' && (
              <label className="image-control">
                <span>Split</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={sliderPosition}
                  aria-label="Comparison slider position"
                  onChange={(event) =>
                    setSliderPosition(Number(event.target.value))
                  }
                />
                <output>{sliderPosition}%</output>
              </label>
            )}

            {mode === 'fade' && (
              <label className="image-control">
                <span>Changed opacity</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={fadeOpacity}
                  aria-label="Changed image opacity"
                  onChange={(event) =>
                    setFadeOpacity(Number(event.target.value))
                  }
                />
                <output>{fadeOpacity}%</output>
              </label>
            )}

            <div
              className="image-zoom-controls"
              role="group"
              aria-label="Synchronized zoom controls"
            >
              <button
                type="button"
                className="btn btn--small"
                onClick={() =>
                  setZoom((value) => Math.max(0.25, value - 0.25))
                }
                aria-label="Zoom out images"
              >
                −
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
                aria-label="Zoom in images"
              >
                +
              </button>
              <button
                type="button"
                className="btn btn--small btn--ghost"
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                aria-label="Reset image zoom and pan"
              >
                <ResetIcon size={14} />
                Reset
              </button>
            </div>

            <button
              type="button"
              className="btn btn--small"
              onClick={() => void exportHighlight()}
              disabled={!result || busy}
              aria-label="Export highlight as PNG"
            >
              <DownloadIcon size={14} />
              Export PNG
            </button>
          </section>

          <div className="image-workspace">
            <section
              className="image-viewer"
              aria-label={`${mode} image comparison`}
              aria-busy={busy}
            >
              {busy && (
                <div className="image-viewer__busy" role="status">
                  Comparing images…
                </div>
              )}
              {result && (
                <>
                  {mode === 'side-by-side' ? (
                    <div className="image-stage-grid">
                      <div
                        ref={primaryViewportRef}
                        className="image-stage"
                        aria-label="Original image viewport"
                        {...viewportProps}
                      >
                        <span className="image-stage__label">Original</span>
                        {stageContent(mode, 'original')}
                      </div>
                      <div
                        className="image-stage"
                        aria-label="Changed image viewport"
                        {...viewportProps}
                      >
                        <span className="image-stage__label">Changed</span>
                        {stageContent(mode, 'changed')}
                      </div>
                    </div>
                  ) : (
                    <div
                      ref={primaryViewportRef}
                      className={`image-stage image-stage--overlay image-stage--${mode}`}
                      {...viewportProps}
                    >
                      {stageContent(mode)}
                      {mode === 'slider' && (
                        <span
                          className="image-slider-line"
                          style={{ left: `${sliderPosition}%` }}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  )}
                </>
              )}
            </section>

            <aside className="image-sidebar" aria-label="Image diff details">
              <section className="image-sidebar__section">
                <h2>Difference</h2>
                {result ? (
                  <dl className="image-diff-stats">
                    <div>
                      <dt>Changed pixels</dt>
                      <dd>{result.changedPixels.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Changed</dt>
                      <dd>{result.changePercent.toFixed(2)}%</dd>
                    </div>
                    <div>
                      <dt>Regions</dt>
                      <dd>
                        {result.totalRegions.toLocaleString()}
                        {result.regionsTruncated ? '+' : ''}
                      </dd>
                    </div>
                    <div>
                      <dt>Canvas</dt>
                      <dd>
                        {result.width}×{result.height}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="image-sidebar__muted">Waiting for comparison…</p>
                )}
                {processingMode && (
                  <p className="image-processing-note">
                    Processed in{' '}
                    {processingMode === 'worker'
                      ? 'background worker'
                      : 'browser fallback'}
                  </p>
                )}
              </section>

              <section className="image-sidebar__section">
                <h2>Metadata</h2>
                <div className="image-metadata-list">
                  {metadata.map(({ label, source }) =>
                    source ? (
                      <div className="image-metadata-card" key={label}>
                        <strong>{label}</strong>
                        <span>{source.name}</span>
                        <span>
                          {source.width}×{source.height} · {source.format}
                        </span>
                        <span>{formatBytes(source.size)}</span>
                      </div>
                    ) : null,
                  )}
                </div>
                {original &&
                  changed &&
                  (original.width !== changed.width ||
                    original.height !== changed.height) && (
                    <p className="image-size-warning">
                      Dimensions differ; pixels outside either image count as
                      changed.
                    </p>
                  )}
              </section>

              <section className="image-sidebar__section image-regions">
                <div className="image-regions__header">
                  <h2>Changed regions</h2>
                  {result && result.regions.length > 0 && (
                    <div
                      className="image-region-nav"
                      role="group"
                      aria-label="Changed region navigation"
                    >
                      <button
                        type="button"
                        className="btn btn--small btn--icon"
                        onClick={() =>
                          focusRegion(
                            (activeRegionIndex ?? 0) - 1,
                          )
                        }
                        aria-label="Previous changed region"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn--small btn--icon"
                        onClick={() =>
                          focusRegion(
                            activeRegionIndex == null
                              ? 0
                              : activeRegionIndex + 1,
                          )
                        }
                        aria-label="Next changed region"
                      >
                        ↓
                      </button>
                    </div>
                  )}
                </div>
                {result?.regions.length ? (
                  <>
                    {result.regionsTruncated && (
                      <p className="image-sidebar__muted">
                        Showing the {result.regions.length} largest of{' '}
                        {result.totalRegions} regions.
                      </p>
                    )}
                    <div className="image-region-list">
                      {result.regions.map((region, index) => (
                        <button
                          key={region.id}
                          type="button"
                          className={`image-region-item${
                            activeRegionIndex === index
                              ? ' image-region-item--active'
                              : ''
                          }`}
                          aria-current={
                            activeRegionIndex === index ? 'true' : undefined
                          }
                          onClick={() => focusRegion(index)}
                        >
                          <span>Region {index + 1}</span>
                          <span>
                            {region.width}×{region.height} at {region.x},{region.y}
                          </span>
                          <span>
                            {region.changedPixels.toLocaleString()} pixels
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="image-sidebar__muted">
                    {result ? 'No changed regions.' : 'No regions yet.'}
                  </p>
                )}
              </section>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
