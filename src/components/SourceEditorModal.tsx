import { useEffect, useRef } from 'react';
import { InputPanel } from './InputPanel';
import { CloseIcon, PencilIcon, SwapIcon } from './Icons';

interface SourceEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  oldText: string;
  newText: string;
  onChangeOld: (value: string) => void;
  onChangeNew: (value: string) => void;
  oldFileName: string | null;
  newFileName: string | null;
  onFileInfoOld: (name: string | null) => void;
  onFileInfoNew: (name: string | null) => void;
  onReadyChangeOld: (ready: boolean) => void;
  onReadyChangeNew: (ready: boolean) => void;
  onError: (message: string) => void;
  onSwap: () => void;
}

export function SourceEditorModal({
  isOpen,
  onClose,
  oldText,
  newText,
  onChangeOld,
  onChangeNew,
  oldFileName,
  newFileName,
  onFileInfoOld,
  onFileInfoNew,
  onReadyChangeOld,
  onReadyChangeNew,
  onError,
  onSwap,
}: SourceEditorModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const onFocus = (e: FocusEvent) => {
      if (!cardRef.current?.contains(e.target as Node)) {
        e.preventDefault();
        cardRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocus as unknown as EventListener);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener(
        'focusin',
        onFocus as unknown as EventListener,
      );
      prev?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="source-editor-title"
    >
      <div
        ref={cardRef}
        className="modal-card modal-card--wide source-editor"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <header className="modal-header">
          <div className="modal-title">
            <PencilIcon size={17} />
            <h3 id="source-editor-title">Edit sources</h3>
          </div>
          <button
            type="button"
            className="btn btn--small btn--icon btn--ghost"
            onClick={onClose}
            aria-label="Close editor"
          >
            <CloseIcon size={16} />
          </button>
        </header>

        <div className="modal-body modal-body--editor">
          <div className="panels">
            <InputPanel
              title="Original text"
              accent="left"
              value={oldText}
              onChange={onChangeOld}
              onError={onError}
              fileName={oldFileName}
              onFileInfo={onFileInfoOld}
              onReadyChange={onReadyChangeOld}
            />
            <div className="panels__swap">
              <button
                type="button"
                className="btn btn--round"
                onClick={onSwap}
                title="Swap original and changed text"
                aria-label="Swap sources"
              >
                <SwapIcon size={18} />
              </button>
            </div>
            <InputPanel
              title="Changed text"
              accent="right"
              value={newText}
              onChange={onChangeNew}
              onError={onError}
              fileName={newFileName}
              onFileInfo={onFileInfoNew}
              onReadyChange={onReadyChangeNew}
            />
          </div>
        </div>

        <footer className="editor-modal-footer">
          <span className="editor-modal-hint">
            The diff recomputes automatically as you type. Everything stays on
            this device.
          </span>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
