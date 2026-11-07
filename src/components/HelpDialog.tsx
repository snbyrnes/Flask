import { useEffect, useRef } from 'react';
import { Kbd } from '../ui/bits';
import { IconX } from '../ui/icons';

const KEYS: [string[], string][] = [
  [['/'], 'Focus search (also Ctrl K)'],
  [['↑', '↓'], 'Move through results'],
  [['Enter'], 'Open the first result from the search box'],
  [['Space'], 'Select or deselect the current row'],
  [['Shift', 'click'], 'Select a range of rows'],
  [['Ctrl', 'A'], 'Select all results'],
  [['Ctrl', 'C'], 'Copy selected rows as a table (or the current row)'],
  [['N'], 'Copy the preferred name'],
  [['I'], 'Copy the SMS ID'],
  [['E'], 'Copy the EV code'],
  [['U'], 'Copy the UNII'],
  [['1', '…', '9'], 'Copy the row or selection with copy template 1 to 9'],
  [['P'], 'Add to or remove from the chosen list'],
  [['L'], 'Open the lookup list'],
  [['Esc'], 'Clear selection, close details, then clear search'],
  [['Ctrl', 'V'], 'Paste anywhere to search; several lines open the lookup list'],
];

const SYNTAX: [string, string][] = [
  ['paracetamol', 'Names in any language, accents ignored'],
  ['hydrochloric acid', 'Every word must appear in the same name'],
  ['"hydrochloric acid"', 'Exact phrase'],
  ['insulin -human', 'Leave out names containing a word'],
  ['SUB12039MIG', 'Identifiers match exactly; IDs and codes also match from 4 characters'],
  ['ev:SUB120', 'Search one field: id, ev, unii, inn, ec, inchikey, formula, parent, replacement, name'],
  ['/^insulin \\w+$/', 'Regular expression over names and identifiers'],
  ['paracetemol', 'With Fuzzy on (next to the search box), typos still find close matches, marked "Close match"'],
];

export function HelpDialog({ onClose, onTry }: { onClose: () => void; onTry: (q: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="drawer-scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts and search tips" tabIndex={-1} ref={ref}>
        <div className="drawer-head">
          <h2>Shortcuts and search tips</h2>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close">
            <IconX size={16} />
          </button>
        </div>
        <div className="help-grid">
          <section>
            <h3>Searching</h3>
            <dl className="help-list">
              {SYNTAX.map(([q, d]) => (
                <div key={q}>
                  <dt>
                    <button type="button" className="try" onClick={() => onTry(q)} title="Try this search">
                      {q}
                    </button>
                  </dt>
                  <dd>{d}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h3>Keyboard</h3>
            <dl className="help-list">
              {KEYS.map(([k, d]) => (
                <div key={d}>
                  <dt>
                    {k.map((x, i) => (
                      <Kbd key={i}>{x}</Kbd>
                    ))}
                  </dt>
                  <dd>{d}</dd>
                </div>
              ))}
            </dl>
            <p className="muted small">Double-click any table cell or name to copy it. Right-click a row for more.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
