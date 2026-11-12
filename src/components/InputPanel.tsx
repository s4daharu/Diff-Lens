import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  CloseIcon,
  CopyIcon,
  PasteIcon,
  UploadIcon,
  WandIcon,
  CheckIcon,
} from './Icons';
import {
  countLines,
  countWords,
  applyTextTransform,
} from '../lib/diffEngine';
import type { TextTransform } from '../lib/types';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

interface InputPanelProps {
  title: string;
  accent: 'left' | 'right';
  value: string;
  onChange: (value: string) => void;
  onError: (message: string) => void;
  onFileInfo?: (fileName: string | null) => void;
  fileName?: string | null;
  placeholder?: string;
  onReadyChange?: (ready: boolean) => void;
}

export function InputPanel({
  title,
  accent,
  value,
  onChange,
  onError,
  onFileInfo,
  fileName,
  placeholder,
  onReadyChange,
}: InputPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  useEffect(() => {
    if (!toolsOpen) return;
    const onClick = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setToolsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setToolsOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [toolsOpen]);

  const handleFile = async (file: File | undefined | null) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      onError(`"${file.name}" is larger than the 10 MB limit.`);
      return;
    }
    try {
      onChange(await file.text());
      onFileInfo?.(file.name);
      onReadyChange?.(true);
    } catch {
      onError(`Could not read "${file.name}".`);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onError('Clipboard permission denied');
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        onChange(text);
        onFileInfo?.(null);
        onReadyChange?.(true);
      }
    } catch {
      onError('Clipboard access denied. Please paste directly into the box.');
    }
  };

  const handleTransform = (transform: TextTransform) => {
    const res = applyTextTransform(value, transform);
    if (!res.success) {
      onError(res.error ?? 'Transformation failed');
    } else {
      onChange(res.result);
      setToolsOpen(false);
    }
  };

  const chars = value.length;
  const lines = countLines(value);
  const words = countWords(value);

  return (
    <section className={`panel input-panel input-panel--${accent}`}>
      <div
        className="input-panel__dropzone"
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current++;
          setDragOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        data-dragover={dragOver || undefined}
      >
        <header className="input-panel__header">
          <div className="input-panel__title-group">
            <span className="input-panel__title">{title}</span>
            {fileName && (
              <span className="input-panel__file-badge" title={`Loaded from ${fileName}`}>
                <span className="file-badge-name">{fileName}</span>
                <button
                  type="button"
                  className="file-badge-close"
                  onClick={() => onFileInfo?.(null)}
                  title="Clear file tag"
                  aria-label="Clear file name"
                >
                  ×
                </button>
              </span>
            )}
          </div>

          <div className="input-panel__actions">
            <button
              type="button"
              className="btn btn--small"
              onClick={() => fileRef.current?.click()}
              title="Open file from disk"
            >
              <UploadIcon size={14} />
              <span className="btn__label">Open file</span>
            </button>

            <button
              type="button"
              className="btn btn--small btn--icon"
              onClick={handlePaste}
              title="Paste from clipboard"
              aria-label="Paste from clipboard"
            >
              <PasteIcon size={14} />
            </button>

            {value && (
              <>
                <button
                  type="button"
                  className="btn btn--small btn--icon"
                  onClick={handleCopy}
                  title={copied ? 'Copied to clipboard' : 'Copy entire text'}
                  aria-label="Copy text"
                >
                  {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                </button>

                <div className="dropdown-wrapper" ref={toolsMenuRef}>
                  <button
                    type="button"
                    className="btn btn--small btn--icon"
                    onClick={() => setToolsOpen((o) => !o)}
                    title="Text tools (Format JSON, Sort, Clean)"
                    aria-label="Text tools"
                    aria-expanded={toolsOpen}
                    aria-haspopup="menu"
                  >
                    <WandIcon size={14} />
                  </button>

                  {toolsOpen && (
                    <div className="dropdown-menu dropdown-menu--right">
                      <button
                        type="button"
                        className="dropdown-item"
                        onClick={() => handleTransform('format-json')}
                      >
                        Format / Prettify JSON
                      </button>
                      <button
                        type="button"
                        className="dropdown-item"
                        onClick={() => handleTransform('sort-lines')}
                      >
                        Sort lines (A → Z)
                      </button>
                      <button
                        type="button"
                        className="dropdown-item"
                        onClick={() => handleTransform('sort-lines-desc')}
                      >
                        Sort lines (Z → A)
                      </button>
                      <button
                        type="button"
                        className="dropdown-item"
                        onClick={() => handleTransform('trim-whitespace')}
                      >
                        Trim line whitespace
                      </button>
                      <button
                        type="button"
                        className="dropdown-item"
                        onClick={() => handleTransform('remove-blank-lines')}
                      >
                        Remove empty lines
                      </button>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className="btn btn--small btn--icon"
                  onClick={() => {
                    onChange('');
                    onFileInfo?.(null);
                    onReadyChange?.(false);
                  }}
                  title="Clear text"
                  aria-label={`Clear ${title.toLowerCase()}`}
                >
                  <CloseIcon size={14} />
                </button>
              </>
            )}
          </div>
        </header>

        <textarea
          className="input-panel__textarea"
          aria-label={title}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            onFileInfo?.(null);
            onReadyChange?.(true);
          }}
          placeholder={
            placeholder ?? 'Paste text here, or drop a file onto this panel…'
          }
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />

        <footer className="input-panel__footer">
          <span>{lines.toLocaleString()} lines</span>
          <span>{words.toLocaleString()} words</span>
          <span>{chars.toLocaleString()} chars</span>
        </footer>
      </div>
      <input
        ref={fileRef}
        type="file"
        hidden
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </section>
  );
}
