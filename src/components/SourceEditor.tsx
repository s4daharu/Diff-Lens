import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { PencilIcon } from './Icons';

type EditorSide = 'both' | 'left' | 'right';

export function SourceEditor({ children, onClose, narrow }: {
  children: ReactNode;
  onClose: () => void;
  narrow: boolean;
}) {
  const editor = useRef<HTMLElement>(null);
  const [side, setSide] = useState<EditorSide>(narrow ? 'left' : 'both');
  const [height, setHeight] = useState(150);
  const activeSide = narrow && side === 'both' ? 'left' : side;

  useEffect(() => {
    editor.current?.querySelector<HTMLTextAreaElement>('.input-panel--left textarea')
      ?.focus({ preventScroll: true });
  }, []);

  const selectSide = (value: EditorSide) => {
    setSide(value);
    requestAnimationFrame(() => editor.current?.querySelector<HTMLTextAreaElement>(
      `.input-panel--${value === 'right' ? 'right' : 'left'} textarea`,
    )?.focus({ preventScroll: true }));
  };

  return (
    <section
      id="source-editor"
      ref={editor}
      className="source-editor"
      data-source-side={activeSide}
      style={{ '--source-editor-height': `${height}px` } as CSSProperties}
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
        <div className="source-editor__modes" role="group" aria-label="Sources to edit">
          {([['both', 'Both'], ['left', 'Original'], ['right', 'Changed']] as const)
            .filter(([value]) => value !== 'both' || !narrow)
            .map(([value, label]) => (
              <button key={value} type="button" className="btn btn--small btn--toggle"
                aria-pressed={activeSide === value} onClick={() => selectSide(value)}>{label}</button>
            ))}
        </div>
        {!narrow && <label className="source-editor__size">
          <span>Editor height</span>
          <input type="range" min={120} max={320} step={10} value={height}
            onChange={(event) => setHeight(event.target.valueAsNumber)} />
        </label>}
        <button type="button" className="btn btn--small source-editor__done" onClick={onClose}>Done</button>
      </header>
      <div className="panels">{children}</div>
    </section>
  );
}
