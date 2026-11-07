import { useEffect, useRef, useState } from 'react';
import { activeFilterCount } from '../data/filter';
import { newId, type SavedView } from '../lib/collections';
import { parseHash } from '../lib/urlState';
import { IconX } from '../ui/icons';

export function describeView(v: SavedView): string {
  const st = parseHash(v.hash);
  const parts: string[] = [];
  if (st.q) parts.push(`search "${st.q}"`);
  const n = activeFilterCount(st.filters);
  if (n) parts.push(`${n} ${n === 1 ? 'filter' : 'filters'}`);
  if (v.fuzzy) parts.push('fuzzy');
  if (st.sort.key !== 'relevance') parts.push(`sorted by ${st.sort.key}`);
  const s = parts.join(', ');
  return s ? s[0].toUpperCase() + s.slice(1) : 'Everything';
}

interface Props {
  views: SavedView[];
  setViews: (v: SavedView[]) => void;
  currentHash: string;
  currentFuzzy: boolean;
  onApply: (v: SavedView) => void;
  onClose: () => void;
}

export function ViewsDialog({ views, setViews, currentHash, currentFuzzy, onApply, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const current: SavedView = { id: '', name: '', hash: currentHash, fuzzy: currentFuzzy };

  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const save = () => {
    const n = name.trim();
    if (!n) return;
    const existing = views.find((v) => v.name.toLowerCase() === n.toLowerCase());
    if (existing) setViews(views.map((v) => (v.id === existing.id ? { ...v, hash: currentHash, fuzzy: currentFuzzy } : v)));
    else setViews([...views, { id: newId(), name: n, hash: currentHash, fuzzy: currentFuzzy }]);
    setName('');
  };

  return (
    <div className="drawer-scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog dialog-narrow" role="dialog" aria-modal="true" aria-label="Saved views" tabIndex={-1} ref={ref}>
        <div className="drawer-head">
          <h2>Saved views</h2>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close">
            <IconX size={16} />
          </button>
        </div>
        <div className="tpl-body">
          <form
            className="view-save"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label className="view-save-label" htmlFor="view-name">
              Save the current search and filters
            </label>
            <div className="view-save-row">
              <input
                id="view-name"
                className="input"
                placeholder="Name, e.g. Current vet proteins"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button type="submit" className="btn btn-small btn-primary" disabled={!name.trim()}>
                Save view
              </button>
            </div>
            <p className="muted small">{describeView(current)}. Saving under an existing name replaces it.</p>
          </form>

          {views.length === 0 ? (
            <p className="muted">No saved views yet.</p>
          ) : (
            <ul className="view-list">
              {views.map((v) => (
                <li key={v.id} className="view-item">
                  {renaming === v.id ? (
                    <input
                      className="input"
                      autoFocus
                      value={draft}
                      aria-label="View name"
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => {
                        if (draft.trim()) setViews(views.map((x) => (x.id === v.id ? { ...x, name: draft.trim() } : x)));
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          setRenaming(null);
                        }
                      }}
                    />
                  ) : (
                    <button type="button" className="view-open" onClick={() => onApply(v)}>
                      <span className="view-name">{v.name}</span>
                      <span className="muted small">{describeView(v)}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      setDraft(v.name);
                      setRenaming(v.id);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon"
                    aria-label={`Delete ${v.name}`}
                    title="Delete view"
                    onClick={() => setViews(views.filter((x) => x.id !== v.id))}
                  >
                    <IconX size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
