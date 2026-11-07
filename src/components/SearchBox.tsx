import type { RefObject } from 'react';
import { IconSearch, IconX } from '../ui/icons';

export type SearchMode = 'exact' | 'fuzzy';

interface Props {
  value: string;
  onChange: (v: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  total: number;
  busy: boolean;
  mode: SearchMode;
  onModeChange: (m: SearchMode) => void;
  onEnter: () => void;
  onArrowDown: () => void;
  /** Called when several lines are pasted (e.g. a column from Excel). */
  onPasteLines: (text: string) => void;
}

const MODES: [SearchMode, string, string][] = [
  ['exact', 'Exact', 'Exact: names must contain what you type'],
  ['fuzzy', 'Fuzzy', 'Fuzzy: also finds close matches, so typos like "paracetemol" still work'],
];

export function SearchBox({ value, onChange, inputRef, busy, mode, onModeChange, onEnter, onArrowDown, onPasteLines }: Props) {
  return (
    <div className={'search' + (busy ? ' is-busy' : '')} role="search">
      <IconSearch className="search-icon" size={18} />
      <input
        ref={inputRef}
        type="search"
        className="search-input"
        value={value}
        placeholder="Search by name, SMS ID, EV code, UNII, InChIKey or formula"
        aria-label="Search substances"
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onEnter();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            onArrowDown();
          } else if (e.key === 'Escape') {
            if (value) {
              e.preventDefault();
              e.stopPropagation();
              onChange('');
            } else (e.target as HTMLInputElement).blur();
          }
        }}
        onPaste={(e) => {
          const t = e.clipboardData.getData('text/plain');
          const lines = t.split(/\r?\n/).filter((l) => l.trim());
          if (lines.length > 1) {
            e.preventDefault();
            onPasteLines(t);
          }
        }}
      />
      {value ? (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear search"
          title="Clear search (Esc)"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
        >
          <IconX size={16} />
        </button>
      ) : (
        <kbd className="kbd search-kbd" aria-hidden="true">
          /
        </kbd>
      )}
      <div className="search-mode" role="radiogroup" aria-label="Match mode">
        {MODES.map(([m, label, title]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            className={'search-mode-btn' + (mode === m ? ' is-on' : '')}
            title={title}
            onClick={() => {
              onModeChange(m);
              inputRef.current?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
