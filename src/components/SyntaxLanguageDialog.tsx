import { useState } from 'react';
import { TextDialog } from './TextDialog';
import { SYNTAX_LANGUAGES, normalizeSyntaxLanguage, type LangId, type SyntaxLanguage } from '../lib/syntaxLanguages';

export function SyntaxLanguageDialog({ detected, value, onClose, onApply }: {
  detected: LangId;
  value: SyntaxLanguage;
  onClose: () => void;
  onApply: (value: SyntaxLanguage) => void;
}) {
  const [choice, setChoice] = useState(value);
  return (
    <TextDialog labelId="syntax-language-title" descriptionId="syntax-language-help"
      className="text-confirm modal-card session-modal" onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); onApply(choice); }}>
        <header className="modal-header">
          <div className="modal-title"><h3 id="syntax-language-title">Syntax language</h3></div>
        </header>
        <div className="modal-body session-modal__body">
          <label className="session-modal__label" htmlFor="syntax-language-select">Language</label>
          <select id="syntax-language-select" className="session-modal__input" data-dialog-focus
            value={choice} onChange={(event) => setChoice(normalizeSyntaxLanguage(event.target.value))}>
            <option value="auto">Auto ({SYNTAX_LANGUAGES[detected]})</option>
            <option value="text">Plain text</option>
            {Object.entries(SYNTAX_LANGUAGES).map(([id, label]) =>
              id === 'text' ? null : <option key={id} value={id}>{label}</option>)}
          </select>
          <p id="syntax-language-help" className="session-modal__hint">
            This changes syntax colors for both sources, not how differences are calculated.
          </p>
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary">Apply language</button>
        </footer>
      </form>
    </TextDialog>
  );
}
