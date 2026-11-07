import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dataset } from '../data/dataset';
import { newId } from '../lib/collections';
import { DEFAULT_TEMPLATES, parseTemplate, renderOne, TEMPLATE_FIELDS, type CopyTemplate } from '../lib/template';
import { Kbd } from '../ui/bits';
import { IconX } from '../ui/icons';

interface Props {
  ds: Dataset;
  /** Substance used for the live preview. */
  sample: number | null;
  templates: CopyTemplate[];
  setTemplates: (t: CopyTemplate[]) => void;
  onClose: () => void;
}

export function TemplatesDialog({ ds, sample, templates, setTemplates, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const lastInput = useRef<{ id: string; el: HTMLInputElement } | null>(null);
  const [, force] = useState(0);

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

  const update = (id: string, patch: Partial<CopyTemplate>) =>
    setTemplates(templates.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const insertField = (key: string) => {
    const target = lastInput.current;
    const tpl = target ? templates.find((t) => t.id === target.id) : templates[templates.length - 1];
    if (!tpl) return;
    const el = target?.el;
    const at = el?.selectionStart ?? tpl.text.length;
    const end = el?.selectionEnd ?? at;
    const text = tpl.text.slice(0, at) + `{${key}}` + tpl.text.slice(end);
    update(tpl.id, { text });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = at + key.length + 2;
      el.setSelectionRange(pos, pos);
    });
  };

  const parsed = useMemo(() => templates.map((t) => parseTemplate(t.text)), [templates]);
  const sampleSub = sample ?? 0;

  return (
    <div className="drawer-scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Copy templates" tabIndex={-1} ref={ref}>
        <div className="drawer-head">
          <h2>Copy templates</h2>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close">
            <IconX size={16} />
          </button>
        </div>
        <div className="tpl-body">
          <p className="tpl-intro">
            Write <code>{'{field}'}</code> for a value. Wrap text in <code>[ ]</code> to leave it out when a field inside is
            empty, so <code>{'{name}[ ({ev})]'}</code> skips the brackets for substances without an EV code. Use{' '}
            <code>\t</code> for a tab (a new Excel column) and <code>\n</code> for a new line. Press <Kbd>1</Kbd>–<Kbd>9</Kbd>{' '}
            to copy the current row or selection with a template.
          </p>

          <ol className="tpl-list">
            {templates.map((t, i) => {
              const p = parsed[i];
              const preview = renderOne(p, ds, sampleSub);
              return (
                <li key={t.id} className="tpl-item">
                  <span className="tpl-num" aria-hidden="true">
                    {i < 9 ? i + 1 : ''}
                  </span>
                  <div className="tpl-fields">
                    <input
                      className="input tpl-name"
                      value={t.name}
                      aria-label={`Template ${i + 1} name`}
                      onChange={(e) => update(t.id, { name: e.target.value })}
                    />
                    <input
                      className="input mono tpl-text"
                      value={t.text}
                      spellCheck={false}
                      aria-label={`Template ${i + 1}`}
                      onFocus={(e) => {
                        lastInput.current = { id: t.id, el: e.currentTarget };
                        force((x) => x + 1);
                      }}
                      onChange={(e) => update(t.id, { text: e.target.value })}
                    />
                    <div className="tpl-preview" title="Preview">
                      <span className="muted small">Preview</span>
                      <pre>{preview || ' '}</pre>
                    </div>
                    {p.unknown.length > 0 && (
                      <p className="error-text small">
                        Unknown {p.unknown.length === 1 ? 'field' : 'fields'}: {p.unknown.map((u) => `{${u}}`).join(', ')}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-icon"
                    aria-label={`Delete template ${t.name}`}
                    title="Delete template"
                    onClick={() => setTemplates(templates.filter((x) => x.id !== t.id))}
                  >
                    <IconX size={14} />
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="tpl-actions">
            <button
              type="button"
              className="btn btn-small"
              onClick={() => setTemplates([...templates, { id: newId(), name: 'New template', text: '{name}' }])}
            >
              Add template
            </button>
            <button type="button" className="link-btn" onClick={() => setTemplates(DEFAULT_TEMPLATES)}>
              Restore the starter templates
            </button>
          </div>

          <h3 className="tpl-fields-head">Fields</h3>
          <p className="muted small">
            Click to insert into {lastInput.current ? 'the template you were editing' : 'the last template'}.
          </p>
          <div className="tpl-chips">
            {TEMPLATE_FIELDS.map((f) => (
              <button
                key={f.key}
                type="button"
                className="chip"
                title={f.label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertField(f.key)}
              >
                {`{${f.key}}`}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
