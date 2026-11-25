import { useEffect, useRef, type ReactNode } from 'react';
import { PencilIcon } from './Icons';

export function SourceEditor({ children, onClose }: {
  children: ReactNode;
  onClose: () => void;
}) {
  const editor = useRef<HTMLElement>(null);

  useEffect(() => {
    editor.current?.querySelector<HTMLTextAreaElement>('.input-panel--left textarea')
      ?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      id="source-editor"
      ref={editor}
      className="source-editor"
      aria-labelledby="source-editor-title"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="source-editor__header">
        <h2 id="source-editor-title"><PencilIcon size={15} /> Edit sources</h2>
        <p>Changes update the diff below as you type.</p>
        <button type="button" className="btn btn--small" onClick={onClose}>Done</button>
      </header>
      <div className="panels">{children}</div>
    </section>
  );
}
