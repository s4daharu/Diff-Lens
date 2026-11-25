import { useLayoutEffect, useRef, type ReactNode } from 'react';

export function TextDialog({ id, labelId, descriptionId, className, onClose, children }: {
  id?: string;
  labelId: string;
  descriptionId?: string;
  className: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropDown = useRef(false);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-dialog-focus]')?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (previous?.isConnected && !dialog.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      id={id}
      ref={dialogRef}
      className={className}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onPointerDown={(event) => { backdropDown.current = event.target === event.currentTarget; }}
      onClick={(event) => {
        if (backdropDown.current && event.target === event.currentTarget) onClose();
        backdropDown.current = false;
      }}
    >
      {children}
    </dialog>
  );
}
