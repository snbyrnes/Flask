import { memo, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { COL, type ColKey, type RowCtx } from '../data/columns';
import type { Dataset, SortKey } from '../data/dataset';
import type { SortState } from '../data/filter';
import { ID_LABEL, type TextResult } from '../data/search';
import { fmtDate } from '../lib/format';
import { Formula, Highlight, Swatch, shortType } from '../ui/bits';
import { IconPin } from '../ui/icons';

interface Props {
  ds: Dataset;
  rows: Uint32Array;
  ctx: RowCtx;
  matched: Uint16Array;
  text: TextResult;
  tokens: string[];
  columns: ColKey[];
  density: 'comfortable' | 'compact';
  active: number | null;
  selected: Set<number>;
  pinned: Set<string>;
  sort: SortState;
  searching: boolean;
  tableRef: RefObject<HTMLDivElement | null>;
  /** Changes whenever the result set changes (scroll resets to top). */
  resetKey: unknown;
  onRowClick: (s: number, e: React.MouseEvent) => void;
  onToggle: (s: number, shift: boolean) => void;
  onToggleAll: () => void;
  onSort: (key: SortKey) => void;
  onContextMenu: (s: number, x: number, y: number) => void;
  onCopyCell: (value: string, what: string) => void;
  onKeyNav: (e: React.KeyboardEvent) => void;
}

const HEADER_H = 36;

export function ResultsTable(p: Props) {
  const { rows, density, tableRef } = p;
  const rowH = density === 'compact' ? 32 : 50;
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);

  useLayoutEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, [tableRef]);

  // New result set: back to the top.
  useLayoutEffect(() => {
    const el = tableRef.current;
    if (el) el.scrollTop = 0;
    setScrollTop(0);
  }, [p.resetKey, tableRef]);

  // Keep the active row in view.
  const activeIdx = p.active === null ? -1 : rows.indexOf(p.active);
  const lastActive = useRef<number | null>(null);
  useEffect(() => {
    const el = tableRef.current;
    if (!el || activeIdx < 0 || lastActive.current === p.active) return;
    lastActive.current = p.active;
    const top = activeIdx * rowH;
    const viewTop = el.scrollTop;
    const viewH = el.clientHeight - HEADER_H;
    if (top < viewTop) el.scrollTop = top;
    else if (top + rowH > viewTop + viewH) el.scrollTop = top + rowH - viewH;
  }, [activeIdx, p.active, rowH, tableRef]);

  const cols = p.columns.filter((k) => COL[k]);
  const template = ['36px', ...cols.map((k) => (k === 'name' ? 'minmax(220px, 1fr)' : COL[k].width + 'px'))].join(' ');
  const minWidth = 36 + cols.reduce((a, k) => a + (k === 'name' ? 220 : COL[k].width), 0);

  const overscan = 10;
  const start = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / rowH) + overscan);

  const allSelected = rows.length > 0 && p.selected.size >= rows.length;
  const someSelected = p.selected.size > 0 && !allSelected;

  const visible: number[] = [];
  for (let i = start; i < end; i++) visible.push(i);

  return (
    <div
      ref={tableRef}
      className="table"
      role="grid"
      aria-label="Substances"
      aria-rowcount={rows.length + 1}
      aria-multiselectable="true"
      tabIndex={0}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      onKeyDown={p.onKeyNav}
    >
      <div className="thead" role="row" style={{ gridTemplateColumns: template, minWidth }}>
        <div className="th th-check" role="columnheader">
          <input
            type="checkbox"
            aria-label={allSelected ? 'Clear selection' : 'Select all results'}
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = someSelected;
            }}
            onChange={p.onToggleAll}
          />
        </div>
        {cols.map((k) => {
          const c = COL[k];
          const sortKey = c.sort;
          const on = sortKey && (p.sort.key === sortKey || (sortKey === 'name' && p.sort.key === 'relevance' && !p.searching));
          return (
            <div
              key={k}
              role="columnheader"
              className={'th' + (c.num ? ' is-num' : '')}
              aria-sort={on ? (p.sort.dir === 'asc' || p.sort.key === 'relevance' ? 'ascending' : 'descending') : undefined}
            >
              {sortKey ? (
                <button type="button" className={'th-btn' + (on ? ' is-on' : '')} onClick={() => p.onSort(sortKey)}>
                  {k === 'name' ? 'Name' : c.label}
                  {on && <span className="sort-arrow">{p.sort.key === 'relevance' ? '' : p.sort.dir === 'asc' ? '↑' : '↓'}</span>}
                </button>
              ) : (
                <span className="th-text">{c.label}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="tbody" style={{ height: rows.length * rowH, minWidth }}>
        {visible.map((i) => {
          const s = rows[i];
          return (
            <Row
              key={s}
              ds={p.ds}
              s={s}
              i={i}
              top={i * rowH}
              height={rowH}
              template={template}
              cols={cols}
              ctx={p.ctx}
              matched={p.matched[s]}
              text={p.text}
              tokens={p.tokens}
              compact={density === 'compact'}
              active={p.active === s}
              selected={p.selected.has(s)}
              pinned={p.pinned.has(p.ds.f.id[s])}
              onClick={p.onRowClick}
              onToggle={p.onToggle}
              onContextMenu={p.onContextMenu}
              onCopyCell={p.onCopyCell}
            />
          );
        })}
      </div>
    </div>
  );
}

interface RowProps {
  ds: Dataset;
  s: number;
  i: number;
  top: number;
  height: number;
  template: string;
  cols: ColKey[];
  ctx: RowCtx;
  matched: number;
  text: TextResult;
  tokens: string[];
  compact: boolean;
  active: boolean;
  selected: boolean;
  pinned: boolean;
  onClick: Props['onRowClick'];
  onToggle: Props['onToggle'];
  onContextMenu: Props['onContextMenu'];
  onCopyCell: Props['onCopyCell'];
}

const Row = memo(function Row(r: RowProps) {
  const { ds, s } = r;
  const f = ds.f;
  const prefK = ds.raw.subPrefName[s];
  const best = r.ctx.bestName?.[s] ?? -1;
  const alias = best >= 0 && best !== prefK ? best : -1;
  const idField = r.text.idField?.[s] ?? null;
  const idHit = idField && (r.text.idScore?.[s] ?? 0) > 0;
  const more = r.matched - (best >= 0 && r.text.nameHit?.[best] ? 1 : 0);
  const fuzzyHit = best >= 0 && r.text.nameHit?.[best] === 2;

  const sub = (() => {
    if (alias >= 0)
      return (
        <>
          <span className="alias-lang">{ds.lang(alias)}</span>
          <span className="alias-name">
            <Highlight text={ds.raw.nameText[alias]} tokens={r.tokens} />
          </span>
        </>
      );
    if (idHit && idField)
      return (
        <>
          <span className="alias-lang">{ID_LABEL[idField]}</span>
          <mark className="alias-id">{f[idField][s]}</mark>
        </>
      );
    return null;
  })();

  return (
    <div
      role="row"
      aria-rowindex={r.i + 2}
      aria-selected={r.selected}
      id={'row-' + s}
      className={'tr' + (r.active ? ' is-active' : '') + (r.selected ? ' is-selected' : '') + (r.i % 2 ? ' is-odd' : '')}
      style={{ transform: `translateY(${r.top}px)`, height: r.height, gridTemplateColumns: r.template }}
      onClick={(e) => r.onClick(s, e)}
      onContextMenu={(e) => {
        e.preventDefault();
        r.onContextMenu(s, e.clientX, e.clientY);
      }}
    >
      <div className="td td-check" role="gridcell" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          tabIndex={-1}
          aria-label={`Select ${ds.prefName(s)}`}
          checked={r.selected}
          onChange={(e) => r.onToggle(s, (e.nativeEvent as MouseEvent).shiftKey)}
        />
      </div>
      {r.cols.map((k) => {
        if (k === 'name') {
          return (
            <div
              key={k}
              role="gridcell"
              className="td td-name"
              onDoubleClick={() => r.onCopyCell(ds.prefName(s), 'name')}
            >
              <div className="name-line">
                <Swatch type={f.type[s]} />
                <span className="name-text" title={ds.prefName(s)}>
                  <Highlight text={ds.prefName(s)} tokens={r.tokens} />
                </span>
                {r.pinned && <IconPin size={12} filled className="pin-mark" aria-label="Pinned" />}
                {f.replacement[s] && <span className="tag tag-warn">Replaced</span>}
                {f.domain[s] === 'Veterinary use' && <span className="tag">Vet</span>}
              </div>
              {(sub || more > 0 || fuzzyHit) && (
                <div className="name-sub">
                  {fuzzyHit && (
                    <span className="tag tag-fuzzy" title="Found by fuzzy search, not an exact match">
                      Close match
                    </span>
                  )}
                  {sub}
                  {more > 0 && <span className="alias-more">+{more} more</span>}
                </div>
              )}
            </div>
          );
        }
        const c = COL[k];
        const v = c.get(ds, s, r.ctx);
        let content: React.ReactNode = v;
        if (k === 'type') content = <span title={v}>{shortType(v)}</span>;
        else if (k === 'formula' && v) content = <Formula value={v} />;
        else if ((k === 'created' || k === 'updated') && v) content = <span title={v}>{fmtDate(v)}</span>;
        else if (idHit && idField === k) content = <mark>{v}</mark>;
        return (
          <div
            key={k}
            role="gridcell"
            className={'td' + (c.mono ? ' mono' : '') + (c.num ? ' is-num' : '') + (v ? '' : ' is-blank')}
            onDoubleClick={() => r.onCopyCell(v, c.label)}
            title={v && v.length > 18 ? v : undefined}
          >
            {v ? content : '—'}
          </div>
        );
      })}
    </div>
  );
});
