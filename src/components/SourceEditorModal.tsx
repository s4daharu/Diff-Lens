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
    const previousFocus = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    document.body.style.overflow = 'hidden';

    const getFocusable = () =>
      Array.from(
        card?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);

    const focusInitial = () => {
      const original = card?.querySelector<HTMLTextAreaElement>(
        '.input-panel--left textarea',
      );
      (original ?? getFocusable()[0] ?? card)?.focus();
    };

    focusInitial();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        e.preventDefault();
        card?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !card?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    const onFocus = (e: FocusEvent) => {
      if (!card?.contains(e.target as Node)) {
        e.preventDefault();
        (getFocusable()[0] ?? card)?.focus();
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
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        id="source-editor-dialog"
        ref={cardRef}
        className="modal-card modal-card--wide source-editor"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-editor-title"
        aria-describedby="source-editor-description"
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
          <span id="source-editor-description" className="editor-modal-hint">
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
