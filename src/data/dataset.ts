import { buildWordIndex, type WordIndex } from './fuzzy';
import { norm } from './normalize';
import type { FieldKey, RawDataset } from './types';

export const FLAG_DEFS = [
  { key: 'inchikey', label: 'InChIKey', bit: 1 << 0 },
  { key: 'formula', label: 'Molecular formula', bit: 1 << 1 },
  { key: 'unii', label: 'UNII', bit: 1 << 2 },
  { key: 'inn', label: 'INN number', bit: 1 << 3 },
  { key: 'ec', label: 'EC number', bit: 1 << 4 },
  { key: 'ev', label: 'EV code', bit: 1 << 5 },
  { key: 'parent', label: 'Parent substance', bit: 1 << 6 },
  { key: 'children', label: 'Child substances', bit: 1 << 7 },
  { key: 'replaced', label: 'Replacement substance', bit: 1 << 8 },
  { key: 'comment', label: 'Comment', bit: 1 << 9 },
  { key: 'sharedIk', label: 'Possible duplicate', bit: 1 << 10 },
] as const;
export type FlagKey = (typeof FLAG_DEFS)[number]['key'];

export type SortKey = 'relevance' | 'name' | 'id' | 'ev' | 'type' | 'updated' | 'created' | 'mw' | 'names';

export interface EnumFacet {
  values: string[];
  idx: Uint16Array;
  /** Value indices ordered by total count, descending. */
  order: number[];
  totals: Uint32Array;
}

function enumFacet(values: string[]): EnumFacet {
  const map = new Map<string, number>();
  const list: string[] = [];
  const idx = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    let k = map.get(v);
    if (k === undefined) {
      k = list.length;
      list.push(v);
      map.set(v, k);
    }
    idx[i] = k;
  }
  const totals = new Uint32Array(list.length);
  for (let i = 0; i < idx.length; i++) totals[idx[i]]++;
  const order = list.map((_, i) => i).sort((a, b) => totals[b] - totals[a] || list[a].localeCompare(list[b]));
  return { values: list, idx, order, totals };
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Groups free-text comments into filterable categories ("Duplicate of 1000…/SUB…" -> one bucket). */
export function commentCategory(c: string): string {
  const t = c.trim().replace(/\s+/g, ' ');
  if (!t) return '';
  if (/^duplicate of\b/i.test(t)) return 'Duplicate of another substance';
  return t[0].toUpperCase() + t.slice(1);
}

export class Dataset {
  readonly raw: RawDataset;
  readonly f: Record<FieldKey, string[]>;
  readonly n: number;
  readonly type: EnumFacet;
  readonly domain: EnumFacet;
  readonly status: EnumFacet;
  readonly svg: EnumFacet;
  /** Comment categories (see commentCategory). */
  readonly comment: EnumFacet;
  readonly flags: Uint16Array;
  /**
   * For replaced substances: the substance at the end of the replacement chain
   * (-2 if the chain leaves this export or loops). -1 for substances that are current.
   */
  readonly currentOf: Int32Array;
  readonly flagTotals: Record<FlagKey, number>;
  readonly mw: Float64Array;
  readonly idToSub = new Map<string, number>();
  readonly children = new Map<number, number[]>();
  readonly replaces = new Map<number, number[]>();
  /** Substances that have at least one name in each language / source. */
  readonly langTotals: Uint32Array;
  readonly sourceTotals: Uint32Array;
  readonly langOrder: number[];
  readonly sourceOrder: number[];
  readonly exportDate: Date | null;
  readonly minDate: string;
  readonly maxDate: string;

  private ranks = new Map<string, Uint32Array>();
  private _idLower: Partial<Record<FieldKey, string[]>> = {};
  private _exactNames: Map<string, number[]> | null = null;
  private _byInchikey: Map<string, number[]> | null = null;
  private _words: WordIndex | null = null;

  /** Word index for typo-tolerant search (built on first use, ~0.5 s). */
  wordIndex(): WordIndex {
    if (!this._words) this._words = buildWordIndex(this);
    return this._words;
  }

  constructor(raw: RawDataset) {
    this.raw = raw;
    this.f = raw.fields;
    const n = (this.n = raw.subCount);
    const f = this.f;

    this.type = enumFacet(f.type);
    this.domain = enumFacet(f.domain);
    this.status = enumFacet(f.status);
    this.svg = enumFacet(f.svg);
    this.comment = enumFacet(f.comment.map(commentCategory));

    for (let s = 0; s < n; s++) this.idToSub.set(f.id[s], s);

    const push = (m: Map<number, number[]>, k: number, v: number) => {
      const a = m.get(k);
      if (a) a.push(v);
      else m.set(k, [v]);
    };
    for (let s = 0; s < n; s++) {
      const p = f.parent[s] ? this.idToSub.get(f.parent[s]) : undefined;
      if (p !== undefined) push(this.children, p, s);
      const r = f.replacement[s] ? this.idToSub.get(f.replacement[s]) : undefined;
      if (r !== undefined) push(this.replaces, r, s);
    }

    this.currentOf = new Int32Array(n).fill(-1);
    for (let s = 0; s < n; s++) {
      if (!f.replacement[s]) continue;
      const chain = this.replacementChain(s);
      const last = chain[chain.length - 1];
      this.currentOf[s] = last !== undefined && !f.replacement[last] ? last : -2;
    }

    // Current (non-replaced) substances that share an InChIKey: likely duplicates.
    const ikCount = new Map<string, number>();
    for (let s = 0; s < n; s++)
      if (f.inchikey[s] && !f.replacement[s]) ikCount.set(f.inchikey[s], (ikCount.get(f.inchikey[s]) ?? 0) + 1);

    this.flags = new Uint16Array(n);
    this.mw = new Float64Array(n);
    let minDate = '9999';
    let maxDate = '0000';
    for (let s = 0; s < n; s++) {
      let b = 0;
      if (f.inchikey[s]) b |= 1 << 0;
      if (f.formula[s]) b |= 1 << 1;
      if (f.unii[s]) b |= 1 << 2;
      if (f.inn[s]) b |= 1 << 3;
      if (f.ec[s]) b |= 1 << 4;
      if (f.ev[s]) b |= 1 << 5;
      if (f.parent[s]) b |= 1 << 6;
      if (this.children.has(s)) b |= 1 << 7;
      if (f.replacement[s]) b |= 1 << 8;
      if (f.comment[s]) b |= 1 << 9;
      if (f.inchikey[s] && !f.replacement[s] && (ikCount.get(f.inchikey[s]) ?? 0) > 1) b |= 1 << 10;
      this.flags[s] = b;
      const w = parseFloat(f.mw[s]);
      this.mw[s] = Number.isFinite(w) ? w : NaN;
      const c = f.created[s];
      const u = f.updated[s];
      if (c && c < minDate) minDate = c;
      if (u && u > maxDate) maxDate = u;
    }
    this.minDate = minDate.slice(0, 10);
    this.maxDate = maxDate.slice(0, 10);
    this.flagTotals = Object.fromEntries(
      FLAG_DEFS.map((d) => {
        let c = 0;
        for (let s = 0; s < n; s++) if (this.flags[s] & d.bit) c++;
        return [d.key, c];
      }),
    ) as Record<FlagKey, number>;

    // Per-language / per-source substance totals.
    this.langTotals = new Uint32Array(raw.langs.length);
    this.sourceTotals = new Uint32Array(raw.sources.length);
    const ls = new Int32Array(raw.langs.length).fill(-1);
    const ss = new Int32Array(raw.sources.length).fill(-1);
    for (let k = 0; k < raw.nameCount; k++) {
      const s = raw.nameSub[k];
      const l = raw.nameLang[k];
      const so = raw.nameSource[k];
      if (ls[l] !== s) {
        ls[l] = s;
        this.langTotals[l]++;
      }
      if (ss[so] !== s) {
        ss[so] = s;
        this.sourceTotals[so]++;
      }
    }
    const byTotal = (tot: Uint32Array, names: string[]) =>
      names.map((_, i) => i).sort((a, b) => tot[b] - tot[a] || names[a].localeCompare(names[b]));
    this.langOrder = byTotal(this.langTotals, raw.langs);
    this.sourceOrder = byTotal(this.sourceTotals, raw.sources);

    const m = raw.fileName.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
    this.exportDate = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
  }

  /** Replacement chain after s: [replacedBy, replacedBy's replacement, ...]. Stops at a gap or loop. */
  replacementChain(s: number): number[] {
    const out: number[] = [];
    const seen = new Set<number>([s]);
    let cur = s;
    while (this.f.replacement[cur]) {
      const next = this.idToSub.get(this.f.replacement[cur]);
      if (next === undefined || seen.has(next)) break;
      out.push(next);
      seen.add(next);
      cur = next;
    }
    return out;
  }

  /** The substance to use today: itself if current, else the end of its replacement chain. */
  current(s: number): number {
    const c = this.currentOf[s];
    return c >= 0 ? c : s;
  }

  prefName(s: number): string {
    return this.raw.nameText[this.raw.subPrefName[s]] ?? '';
  }

  nameRange(s: number): [number, number] {
    const a = this.raw.subNameStart[s];
    return [a, a + this.raw.subNameCount[s]];
  }

  /** Normalised name for name index k (slice of the haystack). */
  normName(k: number): string {
    const o = this.raw.nameOffsets;
    return this.raw.nameHay.slice(o[k], o[k + 1] - 1);
  }

  lang(k: number): string {
    return this.raw.langs[this.raw.nameLang[k]];
  }

  source(k: number): string {
    return this.raw.sources[this.raw.nameSource[k]];
  }

  byId(id: string): number | undefined {
    return this.idToSub.get(id.trim());
  }

  idLower(key: FieldKey): string[] {
    let a = this._idLower[key];
    if (!a) {
      a = this.f[key].map((v) => v.toLowerCase());
      this._idLower[key] = a;
    }
    return a;
  }

  /** Exact (normalised) name -> substances. Built on first use. */
  exactNames(): Map<string, number[]> {
    if (!this._exactNames) {
      const m = new Map<string, number[]>();
      const raw = this.raw;
      for (let k = 0; k < raw.nameCount; k++) {
        const key = this.normName(k).trim().replace(/\s+/g, ' ');
        const s = raw.nameSub[k];
        const a = m.get(key);
        if (!a) m.set(key, [s]);
        else if (a[a.length - 1] !== s) a.push(s);
      }
      this._exactNames = m;
    }
    return this._exactNames;
  }

  sameInchikey(s: number): number[] {
    if (!this._byInchikey) {
      const m = new Map<string, number[]>();
      const ik = this.f.inchikey;
      for (let i = 0; i < this.n; i++) {
        if (!ik[i]) continue;
        const a = m.get(ik[i]);
        if (a) a.push(i);
        else m.set(ik[i], [i]);
      }
      this._byInchikey = m;
    }
    const key = this.f.inchikey[s];
    return key ? (this._byInchikey.get(key) ?? []).filter((x) => x !== s) : [];
  }

  /** Rank of each substance for a sort key (ascending). Computed once per key. */
  rank(key: Exclude<SortKey, 'relevance'>): Uint32Array {
    let r = this.ranks.get(key);
    if (r) return r;
    const n = this.n;
    const idx = Array.from({ length: n }, (_, i) => i);
    const f = this.f;
    let cmp: (a: number, b: number) => number;
    const byKey = (keys: string[]) => (a: number, b: number) => (keys[a] < keys[b] ? -1 : keys[a] > keys[b] ? 1 : a - b);
    switch (key) {
      case 'name': {
        cmp = byKey(idx.map((s) => naturalKey(this.prefName(s))));
        break;
      }
      case 'id':
        cmp = (a, b) => f.id[a].length - f.id[b].length || (f.id[a] < f.id[b] ? -1 : f.id[a] > f.id[b] ? 1 : 0);
        break;
      case 'ev':
        cmp = byKey(idx.map((s) => (f.ev[s] ? naturalKey(f.ev[s]) : '￿')));
        break;
      case 'type': {
        const nr = this.rank('name');
        const vals = this.type.values;
        const alpha = vals.map((_, i) => i).sort((a, b) => collator.compare(vals[a], vals[b]));
        const pos = new Uint16Array(vals.length);
        alpha.forEach((v, i) => (pos[v] = i));
        const ti = this.type.idx;
        cmp = (a, b) => pos[ti[a]] - pos[ti[b]] || nr[a] - nr[b];
        break;
      }
      case 'updated':
        cmp = (a, b) => (f.updated[a] < f.updated[b] ? -1 : f.updated[a] > f.updated[b] ? 1 : 0);
        break;
      case 'created':
        cmp = (a, b) => (f.created[a] < f.created[b] ? -1 : f.created[a] > f.created[b] ? 1 : 0);
        break;
      case 'mw': {
        const w = this.mw;
        cmp = (a, b) => {
          const x = w[a];
          const y = w[b];
          if (Number.isNaN(x)) return Number.isNaN(y) ? 0 : 1;
          if (Number.isNaN(y)) return -1;
          return x - y;
        };
        break;
      }
      case 'names': {
        const c = this.raw.subNameCount;
        cmp = (a, b) => c[a] - c[b];
        break;
      }
    }
    idx.sort(cmp);
    r = new Uint32Array(n);
    for (let i = 0; i < n; i++) r[idx[i]] = i;
    this.ranks.set(key, r);
    return r;
  }

  /** Exact lower-cased value -> substances for one identifier field. Built on first use. */
  exactIndex(key: FieldKey): Map<string, number[]> {
    let m = this._exact[key];
    if (!m) {
      m = new Map();
      const arr = this.idLower(key);
      for (let s = 0; s < this.n; s++) {
        const v = arr[s];
        if (!v) continue;
        const a = m.get(v);
        if (a) a.push(s);
        else m.set(v, [s]);
      }
      this._exact[key] = m;
    }
    return m;
  }
  private _exact: Partial<Record<FieldKey, Map<string, number[]>>> = {};

  /** Substances whose lower-cased field value starts with prefix (sorted index, built on first use). */
  prefixMatches(key: FieldKey, prefix: string, limit = 20000): number[] {
    let idx = this._sorted[key];
    if (!idx) {
      const arr = this.idLower(key);
      const subs = Array.from({ length: this.n }, (_, i) => i).filter((s) => arr[s] !== '');
      subs.sort((a, b) => (arr[a] < arr[b] ? -1 : arr[a] > arr[b] ? 1 : 0));
      idx = { keys: subs.map((s) => arr[s]), subs: Uint32Array.from(subs) };
      this._sorted[key] = idx;
    }
    const { keys, subs } = idx;
    let lo = 0;
    let hi = keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[mid] < prefix) lo = mid + 1;
      else hi = mid;
    }
    const out: number[] = [];
    for (let i = lo; i < keys.length && out.length < limit && keys[i].startsWith(prefix); i++) out.push(subs[i]);
    return out;
  }
  private _sorted: Partial<Record<FieldKey, { keys: string[]; subs: Uint32Array }>> = {};

  /** Looks up a single pasted line against identifiers and exact names. */
  lookup(line: string, useIds: boolean, useNames: boolean): { subs: number[]; by: string } {
    const v = line.trim();
    if (!v) return { subs: [], by: '' };
    if (useIds) {
      const lower = v.toLowerCase();
      for (const [k, label] of LOOKUP_FIELDS) {
        const hits = this.exactIndex(k).get(lower);
        if (hits?.length) return { subs: hits.slice(), by: label };
      }
    }
    if (useNames) {
      const hits = this.exactNames().get(norm(v).replace(/\s+/g, ' '));
      if (hits?.length) return { subs: hits.slice(), by: 'Name' };
    }
    return { subs: [], by: '' };
  }
}

/** Case- and accent-insensitive sort key with numbers compared by value ("Insulin 2" < "Insulin 10"). */
function naturalKey(v: string) {
  return norm(v).replace(/\d+/g, (d) => d.replace(/^0+(?=\d)/, '').padStart(12, '0'));
}

/** Index builders worth running in idle time right after load, cheapest-to-need first. */
export function warmupTasks(ds: Dataset): (() => void)[] {
  const ids: FieldKey[] = ['id', 'ev', 'unii', 'inchikey', 'ec', 'inn', 'formula', 'pheur'];
  const prefix: FieldKey[] = ['id', 'ev', 'unii', 'inchikey', 'ec'];
  return [
    ...ids.map((k) => () => void ds.exactIndex(k)),
    ...prefix.map((k) => () => void ds.prefixMatches(k, '￿')),
    () => void ds.rank('updated'),
    () => void ds.exactNames(),
    () => void ds.wordIndex(),
  ];
}

const LOOKUP_FIELDS: [FieldKey, string][] = [
  ['id', 'SMS ID'],
  ['ev', 'EV code'],
  ['unii', 'UNII'],
  ['inchikey', 'InChIKey'],
  ['ec', 'EC number'],
  ['inn', 'INN number'],
  ['pheur', 'Ph. Eur. number'],
  ['formula', 'Formula'],
];
