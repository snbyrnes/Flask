import type { Dataset, SortKey } from './dataset';

export type ColKey =
  | 'name'
  | 'matched'
  | 'matchedLang'
  | 'id'
  | 'ev'
  | 'type'
  | 'domain'
  | 'status'
  | 'formula'
  | 'mw'
  | 'unii'
  | 'inn'
  | 'ec'
  | 'inchikey'
  | 'pheur'
  | 'svg'
  | 'parent'
  | 'parentName'
  | 'replacement'
  | 'replacementName'
  | 'current'
  | 'currentName'
  | 'currentEv'
  | 'comment'
  | 'created'
  | 'updated'
  | 'names';

export interface RowCtx {
  /** Best matching name index per substance (from the current search). */
  bestName?: Int32Array | null;
}

export interface ColumnDef {
  key: ColKey;
  label: string;
  /** Table width in px. */
  width: number;
  mono?: boolean;
  num?: boolean;
  sort?: SortKey;
  /** Can be shown as a table column. */
  table?: boolean;
  get(ds: Dataset, s: number, ctx: RowCtx): string;
}

const nameOf = (ds: Dataset, id: string) => {
  const s = id ? ds.byId(id) : undefined;
  return s === undefined ? '' : ds.prefName(s);
};

export const COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Preferred name', width: 0, sort: 'name', table: true, get: (ds, s) => ds.prefName(s) },
  {
    key: 'matched',
    label: 'Matched name',
    width: 260,
    get: (ds, s, c) => {
      const k = c.bestName?.[s] ?? -1;
      return k >= 0 ? ds.raw.nameText[k] : '';
    },
  },
  {
    key: 'matchedLang',
    label: 'Matched name language',
    width: 120,
    get: (ds, s, c) => {
      const k = c.bestName?.[s] ?? -1;
      return k >= 0 ? ds.lang(k) : '';
    },
  },
  { key: 'id', label: 'SMS ID', width: 120, mono: true, sort: 'id', table: true, get: (ds, s) => ds.f.id[s] },
  { key: 'ev', label: 'EV code', width: 120, mono: true, sort: 'ev', table: true, get: (ds, s) => ds.f.ev[s] },
  { key: 'type', label: 'Substance type', width: 140, sort: 'type', table: true, get: (ds, s) => ds.f.type[s] },
  { key: 'domain', label: 'Domain', width: 110, table: true, get: (ds, s) => ds.f.domain[s] },
  { key: 'status', label: 'Status', width: 90, table: true, get: (ds, s) => ds.f.status[s] },
  { key: 'formula', label: 'Molecular formula', width: 140, mono: true, table: true, get: (ds, s) => ds.f.formula[s] },
  { key: 'mw', label: 'Molecular weight', width: 104, num: true, sort: 'mw', table: true, get: (ds, s) => ds.f.mw[s] },
  { key: 'unii', label: 'UNII', width: 110, mono: true, table: true, get: (ds, s) => ds.f.unii[s] },
  { key: 'inn', label: 'INN number', width: 92, mono: true, table: true, get: (ds, s) => ds.f.inn[s] },
  { key: 'ec', label: 'EC number', width: 108, mono: true, table: true, get: (ds, s) => ds.f.ec[s] },
  { key: 'inchikey', label: 'InChIKey', width: 250, mono: true, table: true, get: (ds, s) => ds.f.inchikey[s] },
  { key: 'pheur', label: 'Ph. Eur. number', width: 110, mono: true, table: true, get: (ds, s) => ds.f.pheur[s] },
  { key: 'svg', label: 'SVG flag', width: 80, table: true, get: (ds, s) => ds.f.svg[s] },
  { key: 'parent', label: 'Parent SMS ID', width: 124, mono: true, table: true, get: (ds, s) => ds.f.parent[s] },
  { key: 'parentName', label: 'Parent name', width: 220, get: (ds, s) => nameOf(ds, ds.f.parent[s]) },
  {
    key: 'replacement',
    label: 'Replacement SMS ID',
    width: 124,
    mono: true,
    table: true,
    get: (ds, s) => ds.f.replacement[s],
  },
  { key: 'replacementName', label: 'Replacement name', width: 220, get: (ds, s) => nameOf(ds, ds.f.replacement[s]) },
  {
    key: 'current',
    label: 'Current SMS ID',
    width: 124,
    mono: true,
    table: true,
    // Blank for substances that are not replaced.
    get: (ds, s) => (ds.currentOf[s] >= 0 ? ds.f.id[ds.currentOf[s]] : ''),
  },
  {
    key: 'currentName',
    label: 'Current name',
    width: 220,
    get: (ds, s) => (ds.currentOf[s] >= 0 ? ds.prefName(ds.currentOf[s]) : ''),
  },
  {
    key: 'currentEv',
    label: 'Current EV code',
    width: 120,
    mono: true,
    get: (ds, s) => (ds.currentOf[s] >= 0 ? ds.f.ev[ds.currentOf[s]] : ''),
  },
  { key: 'comment', label: 'Comment', width: 240, table: true, get: (ds, s) => ds.f.comment[s] },
  { key: 'created', label: 'Created', width: 104, sort: 'created', table: true, get: (ds, s) => ds.f.created[s] },
  { key: 'updated', label: 'Last updated', width: 104, sort: 'updated', table: true, get: (ds, s) => ds.f.updated[s] },
  {
    key: 'names',
    label: 'Names',
    width: 72,
    num: true,
    sort: 'names',
    table: true,
    get: (ds, s) => String(ds.raw.subNameCount[s]),
  },
];

export const COL: Record<ColKey, ColumnDef> = Object.fromEntries(COLUMNS.map((c) => [c.key, c])) as Record<
  ColKey,
  ColumnDef
>;

export const DEFAULT_TABLE_COLUMNS: ColKey[] = ['name', 'type', 'ev', 'id', 'unii', 'formula'];

/** Every substance-level field, in export order. */
export const ALL_EXPORT_COLUMNS: ColKey[] = [
  'id',
  'name',
  'ev',
  'type',
  'domain',
  'status',
  'formula',
  'mw',
  'inchikey',
  'unii',
  'inn',
  'ec',
  'pheur',
  'svg',
  'parent',
  'parentName',
  'replacement',
  'replacementName',
  'current',
  'currentName',
  'currentEv',
  'comment',
  'created',
  'updated',
  'names',
];

export interface Table {
  header: string[];
  rows: string[][];
}

export function buildTable(ds: Dataset, subs: ArrayLike<number>, cols: ColKey[], ctx: RowCtx = {}): Table {
  const defs = cols.map((k) => COL[k]);
  const extra = cols === ALL_EXPORT_COLUMNS ? ds.raw.extra : [];
  const header = [...defs.map((d) => d.label), ...extra.map((e) => e.header)];
  const rows: string[][] = new Array(subs.length);
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i];
    const r = defs.map((d) => d.get(ds, s, ctx));
    for (const e of extra) r.push(e.values[s]);
    rows[i] = r;
  }
  return { header, rows };
}

/** One row per name, mirroring the original export layout. */
export function buildNamesTable(ds: Dataset, subs: ArrayLike<number>): Table {
  const header = ['SMS ID', 'EV code', 'Substance name', 'Preferred', 'Language', 'Name source', 'Substance type'];
  const rows: string[][] = [];
  for (let i = 0; i < subs.length; i++) {
    const s = subs[i];
    const [a, b] = ds.nameRange(s);
    for (let k = a; k < b; k++) {
      rows.push([
        ds.f.id[s],
        ds.f.ev[s],
        ds.raw.nameText[k],
        ds.raw.namePref[k] ? 'True' : 'False',
        ds.lang(k),
        ds.source(k),
        ds.f.type[s],
      ]);
    }
  }
  return { header, rows };
}
