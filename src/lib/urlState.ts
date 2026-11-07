import { FLAG_DEFS, type FlagKey, type SortKey } from '../data/dataset';
import { EMPTY_FILTERS, type Filters, type SortState, type Tri } from '../data/filter';

export type View = 'browse' | 'lookup';

export interface UrlState {
  q: string;
  filters: Filters;
  sort: SortState;
  /** SMS ID of the substance shown in the detail panel. */
  sel: string | null;
  view: View;
}

const SORTS: SortKey[] = ['relevance', 'name', 'id', 'ev', 'type', 'updated', 'created', 'mw', 'names'];
const SEP = '|';

/** Parses a "#q=…&type=…" string (leading # optional). */
export function parseHash(hash: string): UrlState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const list = (k: string) => (p.get(k) !== null ? p.get(k)!.split(SEP).filter((v, i, a) => a.indexOf(v) === i) : []);
  const range = (k: string): [string, string] => {
    const v = p.get(k);
    if (!v) return ['', ''];
    const [a = '', b = ''] = v.split('..');
    return [a, b];
  };
  const flags: Partial<Record<FlagKey, Tri>> = {};
  for (const d of FLAG_DEFS) {
    const v = p.get('has.' + d.key);
    if (v === 'yes' || v === 'no') flags[d.key] = v;
  }
  const [sk, sd] = (p.get('sort') ?? '').split('.');
  const sort: SortState = {
    key: SORTS.includes(sk as SortKey) ? (sk as SortKey) : 'relevance',
    dir:
      sd === 'asc' || sd === 'desc'
        ? sd
        : sk === 'updated' || sk === 'created' || sk === 'names'
          ? 'desc'
          : sk && sk !== 'relevance'
            ? 'asc'
            : 'desc',
  };
  return {
    q: p.get('q') ?? '',
    filters: {
      ...EMPTY_FILTERS,
      type: list('type'),
      domain: list('domain'),
      status: list('status'),
      svg: list('svg'),
      comment: list('comment'),
      lang: list('lang'),
      source: list('source'),
      prefOnly: p.get('pref') === '1',
      flags,
      created: range('created'),
      updated: range('updated'),
      mw: range('mw'),
      list: p.get('ids') ? p.get('ids')!.split(',').filter(Boolean) : null,
      listName: p.get('ln'),
    },
    sort,
    sel: p.get('s'),
    view: p.get('view') === 'lookup' ? 'lookup' : 'browse',
  };
}

export const readHash = () => parseHash(location.hash);

/** allIds: keep long ID lists (saved views); URLs drop lists over 300 IDs to stay short. */
export function buildHash(s: UrlState, opts: { allIds?: boolean } = {}): string {
  const p = new URLSearchParams();
  if (s.view === 'lookup') p.set('view', 'lookup');
  if (s.q) p.set('q', s.q);
  const f = s.filters;
  const setList = (k: string, v: string[]) => v.length && p.set(k, v.join(SEP));
  setList('type', f.type);
  setList('domain', f.domain);
  setList('status', f.status);
  setList('svg', f.svg);
  setList('comment', f.comment);
  setList('lang', f.lang);
  setList('source', f.source);
  if (f.prefOnly) p.set('pref', '1');
  for (const [k, v] of Object.entries(f.flags)) if (v) p.set('has.' + k, v);
  const setRange = (k: string, r: [string, string]) => (r[0] || r[1]) && p.set(k, `${r[0]}..${r[1]}`);
  setRange('created', f.created);
  setRange('updated', f.updated);
  setRange('mw', f.mw);
  if (f.list && (opts.allIds || f.list.length <= 300)) {
    p.set('ids', f.list.join(','));
    if (f.listName) p.set('ln', f.listName);
  }
  if (s.sort.key !== 'relevance' || s.sort.dir !== 'desc') p.set('sort', `${s.sort.key}.${s.sort.dir}`);
  if (s.sel) p.set('s', s.sel);
  const str = p.toString().replace(/%7C/gi, '|').replace(/%2C/gi, ',');
  return str ? '#' + str : '';
}

export function writeHash(s: UrlState, push: boolean) {
  const h = buildHash(s);
  const url = location.pathname + location.search + h;
  if (url === location.pathname + location.search + location.hash) return;
  if (push) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}
