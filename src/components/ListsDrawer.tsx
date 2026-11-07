import { useEffect, useRef, useState } from 'react';
import { buildTable, type ColKey } from '../data/columns';
import type { Dataset } from '../data/dataset';
import type { ListsApi, SavedList } from '../lib/collections';
import { toHTML, toTSV } from '../lib/export';
import { fmtInt } from '../lib/format';
import { renderMany, type CopyTemplate } from '../lib/template';
import { Swatch } from '../ui/bits';
import { IconX } from '../ui/icons';
import { MenuButton } from '../ui/Menu';
import { useToast } from '../ui/toast';

interface Props {
  ds: Dataset;
  api: ListsApi;
  columns: ColKey[];
  templates: CopyTemplate[];
  onOpen: (s: number) => void;
  onShowInResults: (l: SavedList) => void;
  onClose: () => void;
  /** Open with the list name ready to edit (right after creating a list). */
  startRenaming?: boolean;
}

export function ListsDrawer({ ds, api, columns, templates, onOpen, onShowInResults, onClose, startRenaming }: Props) {
  const { copy } = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const { lists, active } = api;
  const [editing, setEditing] = useState(!!startRenaming);
  const [draft, setDraft] = useState(startRenaming ? active.name : '');
  const subs = active.ids.map((id) => ds.byId(id)).filter((s): s is number => s !== undefined);
  const missing = active.ids.filter((id) => ds.byId(id) === undefined);

  useEffect(() => {
    if (!startRenaming) ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.menu')) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const startRename = (name: string) => {
    setDraft(name);
    setEditing(true);
  };
  const commitRename = () => {
    const name = draft.trim();
    if (name) api.rename(active.id, name);
    setEditing(false);
  };

  return (
    <div className="drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Lists" tabIndex={-1} ref={ref}>
        <div className="drawer-head">
          <h2>Lists</h2>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close">
            <IconX size={16} />
          </button>
        </div>

        <div className="list-picker">
          {editing ? (
            <input
              className="input"
              autoFocus
              onFocus={(e) => e.target.select()}
              value={draft}
              aria-label="List name"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setEditing(false);
                }
              }}
            />
          ) : (
            <select
              className="input"
              value={active.id}
              aria-label="Choose a list"
              onChange={(e) => api.setActiveId(e.target.value)}
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({fmtInt(l.ids.length)})
                </option>
              ))}
            </select>
          )}
          <button type="button" className="btn btn-small" onClick={() => startRename(active.name)} disabled={editing}>
            Rename
          </button>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              const l = api.create(`List ${lists.length + 1}`);
              startRename(l.name);
            }}
          >
            New list
          </button>
        </div>
        <p className="drawer-note">
          <kbd className="kbd">P</kbd> adds the current row to <strong>{active.name}</strong>. New pins go to whichever list is
          chosen here.
        </p>

        {active.ids.length === 0 ? (
          <p className="drawer-empty">
            This list is empty. Pin substances from the results, the detail panel or a selection to collect them here.
          </p>
        ) : (
          <>
            <div className="drawer-actions">
              <button
                type="button"
                className="btn btn-small btn-primary"
                onClick={() => {
                  const t = buildTable(ds, subs, columns);
                  copy(toTSV(t), `${subs.length} substances`, toHTML(t));
                }}
              >
                Copy table
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => copy(subs.map((s) => ds.f.id[s]).join('\r\n'), `${subs.length} SMS IDs`)}
              >
                Copy SMS IDs
              </button>
              <button
                type="button"
                className="btn btn-small"
                onClick={() => copy(subs.map((s) => ds.prefName(s)).join('\r\n'), `${subs.length} names`)}
              >
                Copy names
              </button>
              {templates.length > 0 && (
                <MenuButton
                  label="Copy with a template"
                  className="btn btn-small"
                  items={templates.map((t) => ({
                    label: t.name,
                    onSelect: () => copy(renderMany(t.text, ds, subs), `${subs.length} lines`),
                  }))}
                >
                  Template…
                </MenuButton>
              )}
              <button type="button" className="btn btn-small" onClick={() => onShowInResults(active)}>
                Show in results
              </button>
            </div>
            <ul className="pin-list">
              {subs.map((s) => (
                <li key={s} className="pin-item">
                  <button type="button" className="pin-open" onClick={() => onOpen(s)}>
                    <Swatch type={ds.f.type[s]} />
                    <span className="pin-name">{ds.prefName(s)}</span>
                    <span className="mono muted small">{ds.f.id[s]}</span>
                    {ds.f.ev[s] && <span className="mono muted small">{ds.f.ev[s]}</span>}
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon"
                    aria-label={`Remove ${ds.prefName(s)}`}
                    title="Remove from list"
                    onClick={() => api.remove(active.id, [ds.f.id[s]])}
                  >
                    <IconX size={14} />
                  </button>
                </li>
              ))}
            </ul>
            {missing.length > 0 && (
              <p className="muted small pad">
                {missing.length} SMS {missing.length === 1 ? 'ID is' : 'IDs are'} not in this export:{' '}
                <span className="mono">{missing.join(', ')}</span>
              </p>
            )}
          </>
        )}
        <div className="drawer-foot">
          {active.ids.length > 0 && (
            <button type="button" className="link-btn" onClick={() => api.remove(active.id, active.ids)}>
              Empty this list
            </button>
          )}
          {lists.length > 1 && (
            <button
              type="button"
              className="link-btn danger"
              onClick={() => {
                if (!active.ids.length || confirm(`Delete the list "${active.name}" and its ${active.ids.length} entries?`)) {
                  api.deleteList(active.id);
                  api.setActiveId(lists.find((l) => l.id !== active.id)!.id);
                }
              }}
            >
              Delete list
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
