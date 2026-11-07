import { useMemo, useState, type ReactNode } from 'react';
import { FLAG_DEFS, type Dataset, type FlagKey } from '../data/dataset';
import { activeFilterCount, type Counts, type Filters, type Tri } from '../data/filter';
import { daysBefore, fmtCompact, fmtInt } from '../lib/format';
import { useStored } from '../lib/storage';
import { Swatch } from '../ui/bits';
import { IconChevronDown, IconX } from '../ui/icons';

interface Props {
  ds: Dataset;
  filters: Filters;
  setFilters: (f: Filters | ((p: Filters) => Filters)) => void;
  counts: Counts;
  onClose?: () => void;
}

type ListKey = 'type' | 'domain' | 'status' | 'svg' | 'comment' | 'lang' | 'source';

/** Flags that have their own controls elsewhere in the panel. */
const OWN_CONTROL = new Set<FlagKey>(['replaced', 'comment', 'sharedIk']);

export function FilterPanel({ ds, filters, setFilters, counts, onClose }: Props) {
  const [collapsed, setCollapsed] = useStored<Record<string, boolean>>('collapsed', { status: true, svg: true });
  const toggleList = (k: ListKey, v: string) =>
    setFilters((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));
  const only = (k: ListKey, v: string) => setFilters((f) => ({ ...f, [k]: [v] }));
  const clearList = (k: ListKey) => setFilters((f) => ({ ...f, [k]: [] }));
  const n = activeFilterCount(filters);

  const section = (id: string, title: string, active: boolean, onClear: (() => void) | null, body: ReactNode, note?: string) => (
    <section className="facet" key={id}>
      <div className="facet-head">
        <button
          type="button"
          className="facet-toggle"
          aria-expanded={!collapsed[id]}
          onClick={() => setCollapsed((c) => ({ ...c, [id]: !c[id] }))}
        >
          <IconChevronDown size={14} className="facet-chev" />
          <span>{title}</span>
          {active && <span className="facet-dot" aria-label="active" />}
        </button>
        {active && onClear && (
          <button type="button" className="facet-clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      {!collapsed[id] && (
        <div className="facet-body">
          {note && <p className="facet-note">{note}</p>}
          {body}
        </div>
      )}
    </section>
  );

  const list = (
    k: ListKey,
    values: string[],
    order: number[],
    cnt: Uint32Array,
    opts: { label?: (v: string) => ReactNode; limit?: number; searchable?: boolean } = {},
  ) => (
    <ValueList
      values={values}
      order={order}
      counts={cnt}
      selected={filters[k]}
      onToggle={(v) => toggleList(k, v)}
      onOnly={(v) => only(k, v)}
      label={opts.label}
      limit={opts.limit ?? 8}
      searchable={opts.searchable}
    />
  );

  const setFlag = (k: FlagKey, v: Tri) =>
    setFilters((f) => {
      const flags = { ...f.flags };
      if (flags[k] === v) delete flags[k];
      else flags[k] = v;
      return { ...f, flags };
    });

  const setFlagValue = (k: FlagKey, v: Tri | null) =>
    setFilters((f) => {
      const flags = { ...f.flags };
      if (v) flags[k] = v;
      else delete flags[k];
      return { ...f, flags };
    });

  const setRange = (k: 'created' | 'updated' | 'mw', i: 0 | 1, v: string) =>
    setFilters((f) => {
      const r: [string, string] = [...f[k]];
      r[i] = v;
      return { ...f, [k]: r };
    });

  const latest = ds.maxDate;
  const updatedPresets: [string, number][] = [
    ['30 days', 30],
    ['90 days', 90],
    ['12 months', 365],
  ];

  return (
    <div className="filter-panel">
      <div className="filter-top">
        <h2>Filters</h2>
        {n > 0 && (
          <button
            type="button"
            className="link-btn"
            onClick={() => setFilters((f) => ({ ...emptyLike(f), list: f.list }))}
          >
            Clear all
          </button>
        )}
        {onClose && (
          <button type="button" className="btn btn-icon filter-close" aria-label="Close filters" onClick={onClose}>
            <IconX size={16} />
          </button>
        )}
      </div>

      {section(
        'replaced',
        'Replaced substances',
        !!filters.flags.replaced,
        null,
        (() => {
          const [replaced, current] = counts.flags.replaced;
          const cur = filters.flags.replaced ?? null;
          const opts: [Tri | null, string, number, string][] = [
            [null, 'All', replaced + current, 'Include replaced substances'],
            ['no', 'Hide', current, 'Leave out substances replaced by another'],
            ['yes', 'Only', replaced, 'Show only substances replaced by another'],
          ];
          return (
            <div className="seg seg-wide" role="radiogroup" aria-label="Replaced substances">
              {opts.map(([v, label, n, title]) => (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={cur === v}
                  className={'seg-btn' + (cur === v ? ' is-on' : '')}
                  onClick={() => setFlagValue('replaced', v)}
                  title={`${title}: ${fmtInt(n)}`}
                >
                  {label} <span className="seg-count">{fmtCompact(n)}</span>
                </button>
              ))}
            </div>
          );
        })(),
        'Replaced substances point to the SMS entry that supersedes them.',
      )}

      {section(
        'quality',
        'Data quality',
        filters.comment.length > 0 || !!filters.flags.sharedIk,
        () => {
          clearList('comment');
          setFlagValue('sharedIk', null);
        },
        <>
          <label className="check-row pref-row">
            <input
              type="checkbox"
              checked={filters.flags.sharedIk === 'yes'}
              onChange={(e) => setFlagValue('sharedIk', e.target.checked ? 'yes' : null)}
            />
            <span className="check-label">Possible duplicates</span>
            <span className="check-count">{fmtCompact(counts.flags.sharedIk[0])}</span>
          </label>
          <p className="facet-note">Current substances that share an InChIKey with another current substance.</p>
          <h3 className="facet-sub">Comment</h3>
          {list('comment', ds.comment.values, ds.comment.order, counts.comment, {
            label: (v) => <span>{v || 'No comment'}</span>,
          })}
        </>,
      )}

      {section(
        'type',
        'Substance type',
        filters.type.length > 0,
        () => clearList('type'),
        list('type', ds.type.values, ds.type.order, counts.type, {
          limit: 20,
          label: (v) => (
            <>
              <Swatch type={v} />
              <span>{v || 'Not set'}</span>
            </>
          ),
        }),
      )}

      {section(
        'domain',
        'Domain',
        filters.domain.length > 0,
        () => clearList('domain'),
        list('domain', ds.domain.values, ds.domain.order, counts.domain),
      )}

      {section(
        'names',
        'Names',
        filters.lang.length > 0 || filters.source.length > 0 || filters.prefOnly,
        () => setFilters((f) => ({ ...f, lang: [], source: [], prefOnly: false })),
        <>
          <label className="check-row pref-row">
            <input
              type="checkbox"
              checked={filters.prefOnly}
              onChange={(e) => setFilters((f) => ({ ...f, prefOnly: e.target.checked }))}
            />
            <span className="check-label">Preferred names only</span>
            <span className="check-count">{fmtCompact(counts.pref)}</span>
          </label>
          <h3 className="facet-sub">Language</h3>
          {list('lang', ds.raw.langs, ds.langOrder, counts.lang, { limit: 6, searchable: true })}
          <h3 className="facet-sub">Name source</h3>
          {list('source', ds.raw.sources, ds.sourceOrder, counts.source, {
            limit: 6,
            searchable: true,
            label: (v) => <span>{v || 'No source given'}</span>,
          })}
        </>,
        'Search matches only names that pass these filters.',
      )}

      {section(
        'flags',
        'Identifiers and links',
        Object.keys(filters.flags).some((k) => !OWN_CONTROL.has(k as FlagKey)),
        () =>
          setFilters((f) => ({
            ...f,
            flags: Object.fromEntries(Object.entries(f.flags).filter(([k]) => OWN_CONTROL.has(k as FlagKey))),
          })),
        <div className="flag-rows">
          {FLAG_DEFS.filter((d) => !OWN_CONTROL.has(d.key)).map((d) => {
            const [yes, no] = counts.flags[d.key];
            const cur = filters.flags[d.key];
            return (
              <div className="flag-row" key={d.key}>
                <span className="flag-label">{d.label}</span>
                <div className="seg" role="group" aria-label={d.label}>
                  <button
                    type="button"
                    className={'seg-btn' + (cur === 'yes' ? ' is-on' : '')}
                    aria-pressed={cur === 'yes'}
                    onClick={() => setFlag(d.key, 'yes')}
                    title={`Has ${d.label}: ${fmtInt(yes)}`}
                  >
                    Has <span className="seg-count">{fmtCompact(yes)}</span>
                  </button>
                  <button
                    type="button"
                    className={'seg-btn' + (cur === 'no' ? ' is-on' : '')}
                    aria-pressed={cur === 'no'}
                    onClick={() => setFlag(d.key, 'no')}
                    title={`No ${d.label}: ${fmtInt(no)}`}
                  >
                    None <span className="seg-count">{fmtCompact(no)}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>,
      )}

      {section(
        'dates',
        'Dates',
        !!(filters.created[0] || filters.created[1] || filters.updated[0] || filters.updated[1]),
        () => setFilters((f) => ({ ...f, created: ['', ''], updated: ['', ''] })),
        <>
          <h3 className="facet-sub">Last updated</h3>
          <div className="range">
            <input
              type="date"
              aria-label="Updated from"
              value={filters.updated[0]}
              min={ds.minDate}
              max={latest}
              onChange={(e) => setRange('updated', 0, e.target.value)}
            />
            <span>to</span>
            <input
              type="date"
              aria-label="Updated to"
              value={filters.updated[1]}
              min={ds.minDate}
              max={latest}
              onChange={(e) => setRange('updated', 1, e.target.value)}
            />
          </div>
          <div className="presets">
            {updatedPresets.map(([label, days]) => {
              const from = daysBefore(latest, days);
              const on = filters.updated[0] === from && !filters.updated[1];
              return (
                <button
                  key={label}
                  type="button"
                  className={'chip' + (on ? ' is-on' : '')}
                  aria-pressed={on}
                  onClick={() => setFilters((f) => ({ ...f, updated: on ? ['', ''] : [from, ''] }))}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <p className="facet-note">Relative to the newest update in this export ({latest}).</p>
          <h3 className="facet-sub">Created</h3>
          <div className="range">
            <input
              type="date"
              aria-label="Created from"
              value={filters.created[0]}
              min={ds.minDate}
              max={latest}
              onChange={(e) => setRange('created', 0, e.target.value)}
            />
            <span>to</span>
            <input
              type="date"
              aria-label="Created to"
              value={filters.created[1]}
              min={ds.minDate}
              max={latest}
              onChange={(e) => setRange('created', 1, e.target.value)}
            />
          </div>
        </>,
      )}

      {section(
        'mw',
        'Molecular weight',
        !!(filters.mw[0] || filters.mw[1]),
        () => setFilters((f) => ({ ...f, mw: ['', ''] })),
        <div className="range">
          <input
            type="number"
            inputMode="decimal"
            placeholder="Min"
            aria-label="Minimum molecular weight"
            value={filters.mw[0]}
            min={0}
            onChange={(e) => setRange('mw', 0, e.target.value)}
          />
          <span>to</span>
          <input
            type="number"
            inputMode="decimal"
            placeholder="Max"
            aria-label="Maximum molecular weight"
            value={filters.mw[1]}
            min={0}
            onChange={(e) => setRange('mw', 1, e.target.value)}
          />
        </div>,
        'g/mol. Substances without a weight are left out while this is set.',
      )}

      {section(
        'svg',
        'SVG flag',
        filters.svg.length > 0,
        () => clearList('svg'),
        list('svg', ds.svg.values, ds.svg.order, counts.svg, { label: (v) => <span>{v || 'Not set'}</span> }),
      )}

      {section(
        'status',
        'Status',
        filters.status.length > 0,
        () => clearList('status'),
        list('status', ds.status.values, ds.status.order, counts.status),
      )}
    </div>
  );
}

function emptyLike(f: Filters): Filters {
  return {
    ...f,
    type: [],
    domain: [],
    status: [],
    svg: [],
    comment: [],
    lang: [],
    source: [],
    prefOnly: false,
    flags: {},
    created: ['', ''],
    updated: ['', ''],
    mw: ['', ''],
  };
}

function ValueList({
  values,
  order,
  counts,
  selected,
  onToggle,
  onOnly,
  label,
  limit,
  searchable,
}: {
  values: string[];
  order: number[];
  counts: Uint32Array;
  selected: string[];
  onToggle: (v: string) => void;
  onOnly: (v: string) => void;
  label?: (v: string) => ReactNode;
  limit: number;
  searchable?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [find, setFind] = useState('');
  const sel = useMemo(() => new Set(selected), [selected]);

  let items = order;
  const f = find.trim().toLowerCase();
  if (f) items = items.filter((i) => values[i].toLowerCase().includes(f));
  const showAll = expanded || !!f || items.length <= limit + 2;
  let shown = showAll ? items : items.slice(0, limit);
  // Keep selected values visible even when collapsed.
  if (!showAll) {
    const extra = items.slice(limit).filter((i) => sel.has(values[i]));
    shown = [...shown, ...extra];
  }

  return (
    <div className="value-list">
      {searchable && (expanded || f) && values.length > limit + 2 && (
        <input
          className="value-find"
          type="search"
          placeholder={`Find in ${values.length}`}
          aria-label="Find a value"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
      )}
      {shown.map((i) => {
        const v = values[i];
        const c = counts[i];
        const on = sel.has(v);
        return (
          <div className={'check-row' + (c === 0 && !on ? ' is-empty' : '')} key={i}>
            <label className="check-main">
              <input type="checkbox" checked={on} onChange={() => onToggle(v)} />
              <span className="check-label">{label ? label(v) : v || 'Not set'}</span>
            </label>
            <button
              type="button"
              className="only-btn"
              onClick={() => onOnly(v)}
              title={`Show only ${v || 'not set'}`}
              aria-label={`Only ${v || 'not set'}`}
            >
              only
            </button>
            <span className="check-count">{fmtCompact(c)}</span>
          </div>
        );
      })}
      {!f && items.length > limit + 2 && (
        <button type="button" className="link-btn more-btn" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show fewer' : `Show all ${values.length}`}
        </button>
      )}
      {f && !items.length && <p className="facet-note">No values match.</p>}
    </div>
  );
}
