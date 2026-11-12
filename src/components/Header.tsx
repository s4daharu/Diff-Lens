import { useEffect, useRef, useState } from 'react';
import {
  KeyboardIcon,
  LogoIcon,
  UploadIcon,
  MoonIcon,
  SunIcon,
} from './Icons';
import { SAMPLE_PRESETS } from '../lib/sample';
import type { SamplePreset } from '../lib/types';

interface HeaderProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onNewDiff: () => void;
  busy: boolean;
  onSelectPreset?: (preset: SamplePreset) => void;
  onOpenShortcuts?: () => void;
  onImportSession?: (file: File) => void;
}

export function Header({
  theme,
  onToggleTheme,
  onNewDiff,
  busy,
  onSelectPreset,
  onOpenShortcuts,
  onImportSession,
}: HeaderProps) {
  const [samplesOpen, setSamplesOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const sessionInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!samplesOpen) return;
    const onClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSamplesOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSamplesOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [samplesOpen]);

  return (
    <header className="header">
      <div className="header__brand">
        <LogoIcon size={30} />
        <div className="header__titles">
          <span className="header__name">DiffLens</span>
          <span className="header__tagline">
            Open source diff checker — runs 100% in your browser
          </span>
        </div>
      </div>

      <div className="header__actions">
        {busy && (
          <span className="header__busy" role="status" aria-live="polite">
            Comparing…
          </span>
        )}

        {onSelectPreset && (
          <div className="dropdown-wrapper" ref={dropdownRef}>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setSamplesOpen((o) => !o)}
              title="Load example text datasets"
              aria-label="Samples"
              aria-expanded={samplesOpen}
              aria-haspopup="menu"
            >
              <span className="btn__label">Samples</span>
              <span style={{ fontSize: 10, marginLeft: 2 }}>▼</span>
            </button>

            {samplesOpen && (
              <div className="dropdown-menu">
                <div className="dropdown-header">Choose sample:</div>
                {SAMPLE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="dropdown-item dropdown-item--stack"
                    onClick={() => {
                      onSelectPreset(preset);
                      setSamplesOpen(false);
                    }}
                  >
                    <span className="dropdown-item__title">{preset.label}</span>
                    <span className="dropdown-item__desc">
                      {preset.category} · {preset.oldName}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {onImportSession && (
          <>
            <input
              ref={sessionInputRef}
              type="file"
              accept=".difflens.json,.json,application/json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) onImportSession(file);
              }}
            />
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => sessionInputRef.current?.click()}
              title="Open a saved DiffLens comparison session"
              aria-label="Open comparison session"
            >
              <UploadIcon size={16} />
              <span className="btn__label">Open session</span>
            </button>
          </>
        )}

        {onOpenShortcuts && (
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            onClick={onOpenShortcuts}
            title="Keyboard shortcuts (Press ?)"
            aria-label="Keyboard shortcuts"
          >
            <KeyboardIcon size={16} />
          </button>
        )}

        <button
          type="button"
          className="btn btn--ghost"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <SunIcon size={17} /> : <MoonIcon size={17} />}
          <span className="btn__label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>

        <button type="button" className="btn btn--primary" onClick={onNewDiff}>
          New diff
        </button>
      </div>
    </header>
  );
}
