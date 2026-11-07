import { FLAG_DEFS, type Dataset, type FlagKey, type SortKey } from './dataset';
import type { TextResult } from './search';

export type Tri = 'yes' | 'no';

export interface Filters {
  type: string[];
  domain: string[];
  status: string[];
  svg: string[];
  /** Comment categories (see commentCategory). '' means no comment. */
  comment: string[];
  lang: string[];
  source: string[];
  prefOnly: boolean;
  flags: Partial<Record<FlagKey, Tri>>;
  created: [string, string];
  updated: [string, string];
  mw: [string, string];
  /** Restrict to these SMS IDs (from a pasted lookup list or a saved list). */
  list: string[] | null;
  /** Where the list came from, for the filter chip. */
  listName?: string | null;
}

export const EMPTY_FILTERS: Filters = {
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
  list: null,
  listName: null,
};

export function activeFilterCount(f: Filters): number {
  return (
    f.type.length +
    f.domain.length +
    f.status.length +
    f.svg.length +
    f.comment.length +
    f.lang.length +
    f.source.length +
    (f.prefOnly ? 1 : 0) +
    Object.keys(f.flags).length +
    (f.created[0] || f.created[1] ? 1 : 0) +
    (f.updated[0] || f.updated[1] ? 1 : 0) +
    (f.mw[0] || f.mw[1] ? 1 : 0) +
    (f.list ? 1 : 0)
  );
}

/** Uses names: filters on name-level attributes. */
export function nameFiltersActive(f: Filters) {
  return f.lang.length > 0 || f.source.length > 0 || f.prefOnly;
}

export interface Counts {
  type: Uint32Array;
  domain: Uint32Array;
  status: Uint32Array;
  svg: Uint32Array;
  comment: Uint32Array;
  lang: Uint32Array;
  source: Uint32Array;
  pref: number;
  flags: Record<FlagKey, [yes: number, no: number]>;
}

export interface Computed {
  results: Uint32Array;
  score: Float32Array;
  /** Best matching (and displayed) name per substance. */
  bestName: Int32Array;
  /** Number of names that matched per substance (when searching or name-filtering). */
  matched: Uint16Array;
  counts: Counts;
  namesMatched: number;
}

const B_TYPE = 1 << 0;
const B_DOMAIN = 1 << 1;
const B_STATUS = 1 << 2;
const B_SVG = 1 << 3;
const B_OTHER = 1 << 4;
const B_NAME = 1 << 5;
const B_COMMENT = 1 << 6;
const B_FLAG0 = 7; // flags occupy bits 7..(7+FLAG_DEFS.length)

function mask(selected: string[], values: string[]): Uint8Array | null {
  if (!selected.length) return null;
  const m = new Uint8Array(values.length);
  const set = new Set(selected);
  values.forEach((v, i) => {
    if (set.has(v)) m[i] = 1;
  });
  return m;
}

export function compute(ds: Dataset, text: TextResult, flt: Filters): Computed {
  const S = ds.n;
  const raw = ds.raw;
  const f = ds.f;

  const typeM = mask(flt.type, ds.type.values);
  const domM = mask(flt.domain, ds.domain.values);
  const statM = mask(flt.status, ds.status.values);
  const svgM = mask(flt.svg, ds.svg.values);
  const comM = mask(flt.comment ?? [], ds.comment.values);
  const langM = mask(flt.lang, raw.langs);
  const srcM = mask(flt.source, raw.sources);
  const prefOnly = flt.prefOnly;

  const flagChecks = FLAG_DEFS.map((d, i) => ({
    key: d.key,
    bit: d.bit,
    want: flt.flags[d.key],
    fbit: 1 << (B_FLAG0 + i),
  }));
  const activeFlags = flagChecks.filter((c) => c.want);

  const [c0, c1] = flt.created;
  const [u0, u1] = flt.updated;
  const mw0 = flt.mw[0] === '' ? NaN : parseFloat(flt.mw[0]);
  const mw1 = flt.mw[1] === '' ? NaN : parseFloat(flt.mw[1]);
  const listSet = flt.list ? new Set(flt.list) : null;
  const otherActive = !!(c0 || c1 || u0 || u1 || !Number.isNaN(mw0) || !Number.isNaN(mw1) || listSet);

  const tActive = text.active;
  const nameHit = text.nameHit;
  const nameScore = text.nameScore;
  const idScore = text.idScore;
  const nameFilt = !!(langM || srcM || prefOnly);
  const needNames = tActive || nameFilt;

  const counts: Counts = {
    type: new Uint32Array(ds.type.values.length),
    domain: new Uint32Array(ds.domain.values.length),
    status: new Uint32Array(ds.status.values.length),
    svg: new Uint32Array(ds.svg.values.length),
    comment: new Uint32Array(ds.comment.values.length),
    lang: new Uint32Array(raw.langs.length),
    source: new Uint32Array(raw.sources.length),
    pref: 0,
    flags: Object.fromEntries(FLAG_DEFS.map((d) => [d.key, [0, 0]])) as unknown as Counts['flags'],
  };
  const flagCounts = flagChecks.map((c) => counts.flags[c.key]);

  const langStamp = new Int32Array(raw.langs.length).fill(-1);
  const srcStamp = new Int32Array(raw.sources.length).fill(-1);

  const out = new Uint32Array(S);
  let nOut = 0;
  const score = new Float32Array(S);
  const bestName = new Int32Array(S).fill(-1);
  const matched = new Uint16Array(S);
  let namesMatched = 0;

  const typeIdx = ds.type.idx;
  const domIdx = ds.domain.idx;
  const statIdx = ds.status.idx;
  const svgIdx = ds.svg.idx;
  const comIdx = ds.comment.idx;
  const flags = ds.flags;
  const nStart = raw.subNameStart;
  const nCount = raw.subNameCount;
  const nLang = raw.nameLang;
  const nSrc = raw.nameSource;
  const nPref = raw.namePref;
  const prefName = raw.subPrefName;

  for (let s = 0; s < S; s++) {
    let m = 0;
    if (typeM && !typeM[typeIdx[s]]) m |= B_TYPE;
    if (domM && !domM[domIdx[s]]) m |= B_DOMAIN;
    if (statM && !statM[statIdx[s]]) m |= B_STATUS;
    if (svgM && !svgM[svgIdx[s]]) m |= B_SVG;
    if (comM && !comM[comIdx[s]]) m |= B_COMMENT;
    const fl = flags[s];
    for (let i = 0; i < activeFlags.length; i++) {
      const c = activeFlags[i];
      const has = (fl & c.bit) !== 0;
      if (has !== (c.want === 'yes')) m |= c.fbit;
    }
    if (otherActive) {
      let bad = false;
      if (c0 && f.created[s] < c0) bad = true;
      else if (c1 && f.created[s].slice(0, 10) > c1) bad = true;
      else if (u0 && f.updated[s] < u0) bad = true;
      else if (u1 && f.updated[s].slice(0, 10) > u1) bad = true;
      else if (!Number.isNaN(mw0) && !(ds.mw[s] >= mw0)) bad = true;
      else if (!Number.isNaN(mw1) && !(ds.mw[s] <= mw1)) bad = true;
      else if (listSet && !listSet.has(f.id[s])) bad = true;
      if (bad) m |= B_OTHER;
    }

    // Two or more failing groups: this substance can't contribute to any count.
    if (m & (m - 1)) continue;

    const subOk = m === 0; // passes every substance-level filter
    const idSc = idScore ? idScore[s] : 0;
    let best = -1;
    let bestSc = -1;
    let nameOk = false;
    let hits = 0;

    if (!needNames) {
      nameOk = true;
      best = prefName[s];
      if (subOk) {
        const a = nStart[s];
        const b = a + nCount[s];
        for (let k = a; k < b; k++) {
          const l = nLang[k];
          if (langStamp[l] !== s) {
            langStamp[l] = s;
            counts.lang[l]++;
          }
          const so = nSrc[k];
          if (srcStamp[so] !== s) {
            srcStamp[so] = s;
            counts.source[so]++;
          }
        }
        counts.pref++;
      }
    } else {
      const a = nStart[s];
      const b = a + nCount[s];
      let prefSeen = false;
      for (let k = a; k < b; k++) {
        // 1 = exact match, 2 = close (fuzzy) match
        const viaName = nameHit !== null && nameHit[k] !== 0;
        if (tActive && !viaName && idSc === 0) continue;
        const lOk = !langM || langM[nLang[k]] === 1;
        const sOk = !srcM || srcM[nSrc[k]] === 1;
        const pOk = !prefOnly || nPref[k] === 1;
        if (lOk && sOk && pOk) {
          nameOk = true;
          if (viaName || !tActive) hits++;
          const sc = viaName && nameScore ? nameScore[k] : nPref[k] ? 1 : 0;
          if (sc > bestSc) {
            bestSc = sc;
            best = k;
          }
        }
        if (subOk) {
          if (sOk && pOk) {
            const l = nLang[k];
            if (langStamp[l] !== s) {
              langStamp[l] = s;
              counts.lang[l]++;
            }
          }
          if (lOk && pOk) {
            const so = nSrc[k];
            if (srcStamp[so] !== s) {
              srcStamp[so] = s;
              counts.source[so]++;
            }
          }
          if (lOk && sOk && nPref[k]) prefSeen = true;
        }
      }
      if (prefSeen) counts.pref++;
    }
    if (!nameOk) m |= B_NAME;

    if ((m & ~B_TYPE) === 0) counts.type[typeIdx[s]]++;
    if ((m & ~B_DOMAIN) === 0) counts.domain[domIdx[s]]++;
    if ((m & ~B_STATUS) === 0) counts.status[statIdx[s]]++;
    if ((m & ~B_SVG) === 0) counts.svg[svgIdx[s]]++;
    if ((m & ~B_COMMENT) === 0) counts.comment[comIdx[s]]++;
    for (let i = 0; i < flagChecks.length; i++) {
      if ((m & ~flagChecks[i].fbit) === 0) flagCounts[i][(fl & flagChecks[i].bit) !== 0 ? 0 : 1]++;
    }

    if (m === 0) {
      out[nOut++] = s;
      bestName[s] = best;
      score[s] = Math.max(bestSc, idSc);
      matched[s] = hits;
      namesMatched += hits;
    }
  }

  return {
    results: out.slice(0, nOut),
    score,
    bestName,
    matched,
    counts,
    namesMatched,
  };
}

export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

export const DEFAULT_DIR: Record<SortKey, 'asc' | 'desc'> = {
  relevance: 'desc',
  name: 'asc',
  id: 'asc',
  ev: 'asc',
  type: 'asc',
  updated: 'desc',
  created: 'desc',
  mw: 'asc',
  names: 'desc',
};

export function sortResults(ds: Dataset, c: Computed, sort: SortState, searching: boolean): Uint32Array {
  const r = c.results.slice();
  if (sort.key === 'relevance' && !searching) sort = { key: 'name', dir: 'asc' };
  const key = sort.key;
  if (key === 'relevance') {
    const sc = c.score;
    const nr = ds.rank('name');
    const dir = sort.dir === 'desc' ? 1 : -1;
    r.sort((a, b) => dir * (sc[b] - sc[a]) || nr[a] - nr[b]);
    return r;
  }
  const rank = ds.rank(key);
  if (sort.dir === 'asc') r.sort((a, b) => rank[a] - rank[b]);
  else r.sort((a, b) => rank[b] - rank[a]);
  return r;
}
