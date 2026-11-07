import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { COL, COLUMNS, type ColKey } from '../data/columns';
import type { Dataset } from '../data/dataset';
import { cleanName, suggest, type Suggestion } from '../data/fuzzy';
import { download, stamp, toCSV, toHTML, toTSV } from '../lib/export';
import { fmtInt } from '../lib/format';
import { useStored } from '../lib/storage';
import { Swatch } from '../ui/bits';
import { IconColumns, IconCopy, IconDownload, IconX } from '../ui/icons';
import { MenuButton, type MenuItem } from '../ui/Menu';
import { useToast } from '../ui/toast';

interface Props {
  ds: Dataset;
  text: string;
  setText: (t: string) => void;
  columns: ColKey[];
  setColumns: (c: ColKey[]) => void;
  active: number | null;
  onOpen: (s: number) => void;
  onShowInResults: (ids: string[]) => void;
  onAddToList: (ids: string[]) => void;
  activeListName: string;
  onClose: () => void;
}

type Status = 'found' | 'multiple' | 'missing' | 'blank';
type Tab = 'all' | 'found' | 'multiple' | 'replaced' | 'missing';

interface Line {
  n: number;
  input: string;
  /** Matches after mapping replaced substances (when that option is on). */
  subs: number[];
  by: string;
  status: Status;
  /** [matched, current] for every replaced match. */
  replaced: [number, number][];
  /** Text used to look for suggestions. */
  key: string;
  accepted: boolean;
}

interface Opts {
  ids: boolean;
  names: boolean;
  clean: boolean;
  resolve: boolean;
  suggest: boolean;
}

const MAX_RENDER = 3000;
const AUTO_ACCEPT = 90;

export function LookupView(p: Props) {
  const { ds, text, setText, columns, setColumns, active, onOpen } = p;
  const { copy, toast } = useToast();
  const [opts, setOpts] = useStored<Opts>('lookupOpts', { ids: true, names: true, clean: true, resolve: true, suggest: true });
  const [accepted, setAccepted] = useStored<Record<string, string>>('lookupAccepted', {});
  const [tab, setTab] = useState<Tab>('all');
  const dText = useDeferredValue(text);

  const lines: Line[] = useMemo(() => {
    const raw = dText.replace(/\r/g, '').split('\n');
    while (raw.length && !raw[raw.length - 1].trim()) raw.pop();
    return raw.map((l, i) => {
      // Several pasted columns: use the first non-empty cell.
      const cell = l.includes('\t') ? (l.split('\t').find((c) => c.trim()) ?? '') : l;
      const input = cell.trim().replace(/^"(.*)"$/, '$1');
      const blank: Line = { n: i + 1, input, subs: [], by: '', status: 'blank', replaced: [], key: '', accepted: false };
      if (!input) return blank;
      let r = ds.lookup(input, opts.ids, opts.names);
      let by = r.by;
      const cleaned = opts.clean ? cleanName(input) : input;
      if (!r.subs.length && opts.clean && cleaned && cleaned !== input) {
        const r2 = ds.lookup(cleaned, false, opts.names);
        if (r2.subs.length) {
          r = r2;
          by = 'Name, cleaned';
        }
      }
      let acc = false;
      if (!r.subs.length && accepted[input]) {
        const s = ds.byId(accepted[input]);
        if (s !== undefined) {
          r = { subs: [s], by: '' };
          by = 'Accepted suggestion';
          acc = true;
        }
      }
      const replaced = r.subs.filter((s) => ds.f.replacement[s]).map((s) => [s, ds.current(s)] as [number, number]);
      const subs = opts.resolve ? [...new Set(r.subs.map((s) => ds.current(s)))] : r.subs;
      const status: Status = subs.length === 0 ? 'missing' : subs.length === 1 ? 'found' : 'multiple';
      return { ...blank, subs, by, status, replaced, key: cleaned || input, accepted: acc };
    });
  }, [ds, dText, opts, accepted]);

  // ---- Suggestions for unmatched lines, computed in idle time ----------------
  const sugg = useRef(new Map<string, Suggestion[]>());
  const [, setSuggVersion] = useState(0);
  const pendingKeys = useMemo(
    () =>
      opts.suggest
        ? [...new Set(lines.filter((l) => l.status === 'missing').map((l) => l.key))].filter((k) => !sugg.current.has(k))
        : [],
    [lines, opts.suggest],
  );
  useEffect(() => {
    if (!pendingKeys.length) return;
    const queue = [...pendingKeys];
    let handle = 0;
    let cancelled = false;
    const ric = window.requestIdleCallback ?? ((cb: (d: IdleDeadline) => void) => window.setTimeout(() => cb({ timeRemaining: () => 12, didTimeout: false }), 16));
    const cic = window.cancelIdleCallback ?? window.clearTimeout;
    const work = (deadline: IdleDeadline) => {
      if (cancelled) return;
      const until = performance.now() + Math.max(8, Math.min(30, deadline.timeRemaining()));
      while (queue.length && performance.now() < until) {
        const k = queue.shift()!;
        if (!sugg.current.has(k)) sugg.current.set(k, suggest(ds, k));
      }
      setSuggVersion((v) => v + 1);
      if (queue.length) handle = ric(work);
    };
    handle = ric(work);
    return () => {
      cancelled = true;
      cic(handle);
    };
  }, [pendingKeys, ds]);
  const suggestionsFor = (l: Line) => (l.status === 'missing' && opts.suggest ? sugg.current.get(l.key) : undefined);
  const searching = pendingKeys.some((k) => !sugg.current.has(k));

  const counts = useMemo(() => {
    const c = { found: 0, multiple: 0, missing: 0, blank: 0, replaced: 0 };
    for (const l of lines) {
      c[l.status]++;
      if (l.replaced.length) c.replaced++;
    }
    return c;
  }, [lines]);

  const cols = columns.filter((k) => COL[k]);
  const shown =
    tab === 'all'
      ? lines
      : tab === 'replaced'
        ? lines.filter((l) => l.replaced.length)
        : lines.filter((l) => l.status === tab);
  const foundIds = useMemo(() => {
    const set = new Set<string>();
    for (const l of lines) for (const s of l.subs) set.add(ds.f.id[s]);
    return [...set];
  }, [lines, ds]);

  const confident = lines.filter((l) => {
    const sg = suggestionsFor(l);
    return sg && sg[0] && sg[0].score >= AUTO_ACCEPT;
  });

  const note = (l: Line): string => {
    const parts: string[] = [];
    for (const [from, to] of l.replaced)
      parts.push(
        opts.resolve
          ? `Replaced: ${ds.f.id[from]} is now ${ds.f.id[to]}`
          : `Replaced by ${ds.f.id[to]}${to !== ds.idToSub.get(ds.f.replacement[from]) ? ' (via another replacement)' : ''}`,
      );
    const sg = suggestionsFor(l);
    if (sg?.length) parts.push(`Closest: ${ds.prefName(sg[0].s)} (${ds.f.id[sg[0].s]}, ${sg[0].score}%)`);
    return parts.join('; ');
  };

  const resultLabel = (l: Line) =>
    l.status === 'found' ? 'Found' : l.status === 'multiple' ? `${l.subs.length} matches` : l.status === 'missing' ? 'Not found' : '';

  /** One output row per input line, in input order, so it pastes back next to the source column. */
  const outTable = () => {
    const header = ['Input', 'Result', 'Matched on', 'Note', ...cols.map((k) => COL[k].label)];
    const rows = lines.map((l) => [
      l.input,
      resultLabel(l),
      l.by,
      note(l),
      ...cols.map((k) => l.subs.map((s) => COL[k].get(ds, s, {})).join('; ')),
    ]);
    return { header, rows };
  };

  const accept = (input: string, s: number) => setAccepted((a) => ({ ...a, [input]: ds.f.id[s] }));

  const colItems = (): MenuItem[] =>
    COLUMNS.filter((c) => c.key !== 'matched' && c.key !== 'matchedLang').map((c) => ({
      label: c.label,
      checked: columns.includes(c.key),
      keepOpen: true,
      onSelect: () =>
        setColumns(
          columns.includes(c.key)
            ? columns.filter((k) => k !== c.key)
            : COLUMNS.map((x) => x.key).filter((k) => k === c.key || columns.includes(k)),
        ),
    }));

  const total = lines.length - counts.blank;
  const opt = (k: keyof Opts, label: string, title: string) => (
    <label className="check-row" title={title}>
      <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
      <span className="check-label">{label}</span>
    </label>
  );

  return (
    <div className="lookup">
      <div className="lookup-input">
        <div className="lookup-head">
          <h2>Lookup list</h2>
          <button type="button" className="btn btn-icon" onClick={p.onClose} aria-label="Back to browsing" title="Back to browsing">
            <IconX size={16} />
          </button>
        </div>
        <p className="lookup-lead">
          Paste one value per line: SMS IDs, EV codes, UNIIs, InChIKeys, EC or INN numbers, formulas or names in any language.
          If you paste several columns, the first one is used.
        </p>
        <textarea
          className="lookup-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'100000090270\nSUB12039MIG\nGEB06NHM23\nParacetamol 500 mg\nAmoxicilin trihydrate'}
          spellCheck={false}
          aria-label="Values to look up, one per line"
          autoFocus={!text}
        />
        <div className="lookup-opts">
          {opt('ids', 'Match identifiers', 'SMS ID, EV code, UNII, InChIKey, EC, INN, Ph. Eur. number, formula')}
          {opt('names', 'Match names', 'Exact names in any language, ignoring case and accents')}
          {opt('clean', 'Ignore strengths and suffixes', 'Retry without "500 mg", "10 %", "BP", "Ph. Eur." and brackets')}
          {opt('resolve', 'Use the current substance for replaced ones', 'Follow replacements to the substance in use today')}
          {opt('suggest', 'Suggest close matches', 'For values with no match, find similar names you can accept')}
        </div>
        {text && (
          <div className="lookup-clear">
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setText('');
                setAccepted({});
              }}
            >
              Clear list
            </button>
          </div>
        )}
      </div>

      <div className="lookup-results">
        <div className="lookup-bar">
          <div className="tabs" role="tablist" aria-label="Show">
            {(
              [
                ['all', 'All', total],
                ['found', 'Found', counts.found],
                ['multiple', 'Several', counts.multiple],
                ['replaced', 'Replaced', counts.replaced],
                ['missing', 'Not found', counts.missing],
              ] as const
            ).map(([k, label, c]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={'tab' + (tab === k ? ' is-on' : '')}
                onClick={() => setTab(k)}
              >
                {label} <span className="tab-count">{fmtInt(c)}</span>
              </button>
            ))}
          </div>
          <span className="detail-spacer" />
          <MenuButton label="Output columns" items={colItems} className="btn btn-small" alignRight title="Choose output columns">
            <IconColumns size={15} /> Columns
          </MenuButton>
          <button
            type="button"
            className="btn btn-small btn-primary"
            disabled={!total}
            onClick={() => {
              const t = outTable();
              copy(toTSV(t), `${fmtInt(lines.length)} result rows`, toHTML(t));
            }}
            title="One row per input line, in the same order. Paste next to your original column."
          >
            <IconCopy size={15} /> Copy results
          </button>
          <MenuButton
            label="More actions"
            className="btn btn-small"
            alignRight
            disabled={!total}
            items={() => [
              {
                label: `Accept ${fmtInt(confident.length)} suggestions scoring ${AUTO_ACCEPT}% or more`,
                disabled: !confident.length,
                onSelect: () => {
                  setAccepted((a) => {
                    const next = { ...a };
                    for (const l of confident) next[l.input] = ds.f.id[suggestionsFor(l)![0].s];
                    return next;
                  });
                  toast(`Accepted ${plural(confident.length)}`);
                },
              },
              {
                label: 'Undo all accepted suggestions',
                disabled: !Object.keys(accepted).length,
                onSelect: () => setAccepted({}),
              },
              'sep',
              {
                label: 'Copy found SMS IDs',
                onSelect: () => copy(foundIds.join('\r\n'), `${foundIds.length} SMS IDs`),
                disabled: !foundIds.length,
              },
              {
                label: 'Copy inputs that were not found',
                onSelect: () =>
                  copy(
                    lines.filter((l) => l.status === 'missing').map((l) => l.input).join('\r\n'),
                    `${counts.missing} missing values`,
                  ),
                disabled: !counts.missing,
              },
              {
                label: 'Download results as CSV',
                onSelect: () => {
                  download(`sms-lookup-${stamp()}.csv`, toCSV(outTable()));
                  toast('Downloaded CSV');
                },
              },
              'sep',
              {
                label: `Add found substances to ${p.activeListName}`,
                disabled: !foundIds.length,
                onSelect: () => p.onAddToList(foundIds),
              },
              {
                label: `Browse the ${fmtInt(foundIds.length)} found substances`,
                hint: 'filter, sort, export',
                disabled: !foundIds.length,
                onSelect: () => p.onShowInResults(foundIds),
              },
            ]}
          >
            <IconDownload size={15} /> More
          </MenuButton>
        </div>
        {searching && <div className="lookup-busy">Looking for close matches…</div>}

        {!total ? (
          <div className="lookup-empty">
            <p>
              Results appear here as you paste. Each input line gets one output row, so you can paste the results straight back
              into your spreadsheet.
            </p>
          </div>
        ) : (
          <div className="lookup-table-wrap">
            <table className="lookup-table">
              <thead>
                <tr>
                  <th className="col-n">#</th>
                  <th>Input</th>
                  <th>Result</th>
                  {cols.map((k) => (
                    <th key={k}>{COL[k].label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, MAX_RENDER).map((l) => (
                  <LookupRow
                    key={l.n}
                    l={l}
                    ds={ds}
                    cols={cols}
                    active={active}
                    resolve={opts.resolve}
                    suggestions={suggestionsFor(l)}
                    pending={opts.suggest && l.status === 'missing' && !sugg.current.has(l.key)}
                    onOpen={onOpen}
                    onAccept={(s) => accept(l.input, s)}
                    onUnaccept={() =>
                      setAccepted((a) => {
                        const next = { ...a };
                        delete next[l.input];
                        return next;
                      })
                    }
                  />
                ))}
              </tbody>
            </table>
            {shown.length > MAX_RENDER && (
              <p className="muted small pad">
                Showing the first {fmtInt(MAX_RENDER)} of {fmtInt(shown.length)} lines. Copy results includes every line.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const plural = (n: number) => `${fmtInt(n)} ${n === 1 ? 'suggestion' : 'suggestions'}`;

function LookupRow({
  l,
  ds,
  cols,
  active,
  resolve,
  suggestions,
  pending,
  onOpen,
  onAccept,
  onUnaccept,
}: {
  l: Line;
  ds: Dataset;
  cols: ColKey[];
  active: number | null;
  resolve: boolean;
  suggestions: Suggestion[] | undefined;
  pending: boolean;
  onOpen: (s: number) => void;
  onAccept: (s: number) => void;
  onUnaccept: () => void;
}) {
  const label =
    l.status === 'found' ? 'Found' : l.status === 'multiple' ? `${l.subs.length} matches` : l.status === 'missing' ? 'Not found' : '';
  const subs = l.subs.slice(0, 12);
  return (
    <tr className={'lk-row lk-' + l.status + (l.subs.includes(active ?? -1) ? ' is-active' : '')}>
      <td className="col-n">{l.n}</td>
      <td className="lk-input mono" title={l.input}>
        {l.input}
      </td>
      <td className="lk-status">
        {label && <span className={'status status-' + l.status}>{label}</span>}
        {l.by && <span className="muted small"> {l.by}</span>}
        {l.accepted && (
          <button type="button" className="mini-link" onClick={onUnaccept}>
            Undo
          </button>
        )}
        {l.replaced.map(([from, to]) => (
          <div key={from} className="lk-note">
            <span className="tag tag-warn">Replaced</span>{' '}
            {resolve ? (
              <>
                <span className="mono">{ds.f.id[from]}</span> is now{' '}
                <button type="button" className="inline-link mono" onClick={() => onOpen(to)}>
                  {ds.f.id[to]}
                </button>
              </>
            ) : (
              <>
                by{' '}
                <button type="button" className="inline-link mono" onClick={() => onOpen(to)}>
                  {ds.f.id[to]}
                </button>
              </>
            )}
          </div>
        ))}
        {pending && <div className="lk-note muted small">Looking for close matches…</div>}
        {suggestions && suggestions.length === 0 && <div className="lk-note muted small">No close matches</div>}
        {suggestions && suggestions.length > 0 && (
          <ul className="sugg-list" aria-label="Close matches">
            {suggestions.map((sg) => (
              <li key={sg.s} className="sugg">
                <button type="button" className="lk-link" onClick={() => onOpen(sg.s)} title={ds.raw.nameText[sg.k]}>
                  <Swatch type={ds.f.type[sg.s]} />
                  {ds.prefName(sg.s)}
                </button>
                <span className={'sugg-score' + (sg.score >= AUTO_ACCEPT ? ' is-high' : '')}>{sg.score}%</span>
                <button type="button" className="btn btn-small sugg-accept" onClick={() => onAccept(sg.s)}>
                  Accept
                </button>
              </li>
            ))}
          </ul>
        )}
      </td>
      {cols.map((k) => (
        <td key={k} className={COL[k].mono ? 'mono' : ''}>
          {subs.map((s, i) =>
            k === 'name' ? (
              <button key={i} type="button" className="lk-link" onClick={() => onOpen(s)}>
                <Swatch type={ds.f.type[s]} />
                {ds.prefName(s)}
              </button>
            ) : (
              <div key={i} className="lk-val">
                {COL[k].get(ds, s, {}) || <span className="none">—</span>}
              </div>
            ),
          )}
          {l.subs.length > subs.length && <div className="muted small">+{l.subs.length - subs.length} more</div>}
        </td>
      ))}
    </tr>
  );
}
