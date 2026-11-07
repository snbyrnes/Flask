import type { Dataset } from './dataset';
import { fullK, prefixK, similarWords } from './fuzzy';
import { norm } from './normalize';
import type { FieldKey } from './types';

export type IdField = Extract<
  FieldKey,
  'id' | 'ev' | 'unii' | 'inn' | 'ec' | 'inchikey' | 'formula' | 'pheur' | 'parent' | 'replacement'
>;

export const ID_LABEL: Record<IdField, string> = {
  id: 'SMS ID',
  ev: 'EV code',
  unii: 'UNII',
  inn: 'INN number',
  ec: 'EC number',
  inchikey: 'InChIKey',
  formula: 'Formula',
  pheur: 'Ph. Eur. number',
  parent: 'Parent',
  replacement: 'Replacement',
};

/** Fields checked by a plain (unprefixed) search. */
const DEFAULT_ID_FIELDS: IdField[] = ['id', 'ev', 'unii', 'inchikey', 'ec', 'inn', 'formula', 'pheur'];
/** Fields where partial typing (prefix) should already match. */
const PREFIX_FIELDS = new Set<IdField>(['id', 'ev', 'unii', 'inchikey', 'ec']);

export const FIELD_PREFIXES: Record<string, IdField | 'name'> = {
  name: 'name',
  id: 'id',
  sms: 'id',
  ev: 'ev',
  unii: 'unii',
  inn: 'inn',
  ec: 'ec',
  inchikey: 'inchikey',
  ik: 'inchikey',
  formula: 'formula',
  mf: 'formula',
  pheur: 'pheur',
  parent: 'parent',
  replacement: 'replacement',
  replaced: 'replacement',
};

export interface Query {
  raw: string;
  empty: boolean;
  pos: string[];
  neg: string[];
  phrase: string;
  field: IdField | 'name' | null;
  regex: RegExp | null;
  error: string | null;
}

export function parseQuery(raw: string): Query {
  const q: Query = { raw, empty: true, pos: [], neg: [], phrase: '', field: null, regex: null, error: null };
  let text = raw.trim();
  if (!text) return q;
  q.empty = false;

  const rx = text.match(/^\/(.+)\/([a-z]*)$/i);
  if (rx) {
    try {
      const flags = rx[2].includes('i') ? rx[2] : rx[2] + 'i';
      q.regex = new RegExp(rx[1], flags.replace(/[gy]/g, ''));
    } catch (e) {
      q.error = 'Invalid regular expression: ' + (e instanceof Error ? e.message : String(e));
      q.empty = true;
    }
    return q;
  }

  const fm = text.match(/^([a-z]+):\s*(.*)$/i);
  if (fm && FIELD_PREFIXES[fm[1].toLowerCase()]) {
    q.field = FIELD_PREFIXES[fm[1].toLowerCase()];
    text = fm[2];
  }

  for (const m of text.matchAll(/(-?)"([^"]*)"?|(\S+)/g)) {
    let neg = false;
    let tok: string;
    if (m[2] !== undefined) {
      neg = m[1] === '-';
      tok = m[2];
    } else {
      tok = m[3];
      if (tok.length > 1 && tok.startsWith('-')) {
        neg = true;
        tok = tok.slice(1);
      }
    }
    tok = norm(tok).replace(/\s+/g, ' ').trim();
    if (!tok) continue;
    (neg ? q.neg : q.pos).push(tok);
  }
  q.phrase = q.pos.join(' ');
  if (!q.pos.length && !q.neg.length) q.empty = true;
  return q;
}

export interface TextResult {
  query: Query;
  active: boolean;
  /** Per name: 1 if it matches. Null when no name matching happened. */
  nameHit: Uint8Array | null;
  nameScore: Float32Array | null;
  /** Per substance: identifier match score (0 = none). */
  idScore: Float32Array | null;
  /** Per substance: which identifier matched. */
  idField: (IdField | null)[] | null;
  nameMatches: number;
  /** Names added by fuzzy matching (nameHit = 2). */
  fuzzyMatches: number;
  /** Words that fuzzy matching accepted, for highlighting. */
  fuzzyWords: string[];
}

const INACTIVE = (query: Query): TextResult => ({
  query,
  active: false,
  nameHit: null,
  nameScore: null,
  idScore: null,
  idField: null,
  nameMatches: 0,
  fuzzyMatches: 0,
  fuzzyWords: [],
});

const LETTER = /[\p{L}\p{N}]/u;

function atWordStart(s: string, t: string): boolean {
  let i = s.indexOf(t);
  while (i !== -1) {
    if (i === 0 || !LETTER.test(s[i - 1])) return true;
    i = s.indexOf(t, i + 1);
  }
  return false;
}

function scoreName(nn: string, q: Query): number {
  const ph = q.phrase;
  if (!ph) return 30;
  if (nn === ph) return 100;
  if (nn.startsWith(ph)) return 86 - Math.min(10, (nn.length - ph.length) / 6);
  let allWord = true;
  for (const t of q.pos)
    if (!atWordStart(nn, t)) {
      allWord = false;
      break;
    }
  let s = allWord ? 66 : 46;
  if (q.pos.length > 1 && nn.includes(ph)) s += 8;
  return s - Math.min(12, nn.length / 16);
}

/** Largest k with offsets[k] <= p. */
function nameAt(offsets: Uint32Array, p: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= p) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Adds close matches (nameHit = 2) for names where every query word is either
 * contained exactly or within a few edits of a word in the name. Exact matches
 * already found keep their higher scores.
 */
function fuzzyPass(ds: Dataset, q: Query, res: TextResult, hit: Uint8Array, score: Float32Array) {
  const raw = ds.raw;
  const N = raw.nameCount;
  const hay = raw.nameHay;
  const off = raw.nameOffsets;
  const pos = q.pos;
  // Is the user still typing the last word?
  const typing = !/[\s"]$/.test(q.raw);
  const plan = pos.map((t, i) => {
    const phrase = t.includes(' ');
    return {
      t,
      kf: phrase ? 0 : fullK(t.length),
      kp: !phrase && typing && i === pos.length - 1 ? prefixK(t.length) : 0,
    };
  });
  if (!plan.some((p) => p.kf > 0 || p.kp > 0)) return;

  const idx = ds.wordIndex();
  const T = pos.length;
  const cnt = new Uint8Array(N);
  const dist = new Uint8Array(N);
  const viaFuzzy = new Uint8Array(N);
  const stamp = new Int32Array(N).fill(-1);
  const words = new Set<string>();

  for (let ti = 0; ti < T; ti++) {
    const { t, kf, kp } = plan[ti];
    // Names containing the word exactly.
    let p = hay.indexOf(t, 1);
    while (p !== -1) {
      const k = nameAt(off, p);
      if (stamp[k] !== ti) {
        stamp[k] = ti;
        cnt[k]++;
      }
      p = hay.indexOf(t, off[k + 1]);
    }
    // Names containing a similar word.
    const similar = [
      ...(kf > 0 ? similarWords(idx, t, kf, false) : []),
      ...(kp > 0 ? similarWords(idx, t, kp, true) : []),
    ].sort((a, b) => a.d - b.d);
    for (const { id, d } of similar) {
      if (d === 0) continue; // already covered by the exact scan
      if (words.size < 80) words.add(idx.words[id]);
      for (let j = idx.postStart[id]; j < idx.postStart[id + 1]; j++) {
        const k = idx.posts[j];
        if (stamp[k] === ti) continue;
        stamp[k] = ti;
        cnt[k]++;
        dist[k] += d;
        viaFuzzy[k] = 1;
      }
    }
  }

  let added = 0;
  for (let k = 0; k < N; k++) {
    if (cnt[k] !== T || !viaFuzzy[k] || hit[k]) continue;
    if (q.neg.length) {
      const nn = hay.slice(off[k], off[k + 1] - 1);
      if (q.neg.some((x) => nn.includes(x))) continue;
    }
    hit[k] = 2;
    score[k] = 30 - 6 * dist[k] - Math.min(8, (off[k + 1] - off[k]) / 20) + (raw.namePref[k] ? 3 : 0);
    added++;
  }
  res.nameMatches += added;
  res.fuzzyMatches = added;
  res.fuzzyWords = [...words];
}

export function runText(ds: Dataset, q: Query, fuzzy = false): TextResult {
  if (q.empty) return INACTIVE(q);
  const raw = ds.raw;
  const N = raw.nameCount;
  const S = ds.n;
  const res: TextResult = { ...INACTIVE(q), active: true };

  // Regex: test original names and identifiers.
  if (q.regex) {
    const re = q.regex;
    const hit = new Uint8Array(N);
    const score = new Float32Array(N);
    let c = 0;
    for (let k = 0; k < N; k++) {
      if (re.test(raw.nameText[k])) {
        hit[k] = 1;
        score[k] = 50 + (raw.namePref[k] ? 6 : 0);
        c++;
      }
    }
    const idScore = new Float32Array(S);
    const idField: (IdField | null)[] = new Array(S).fill(null);
    for (const fk of DEFAULT_ID_FIELDS) {
      const arr = ds.f[fk];
      for (let s = 0; s < S; s++) {
        if (!idScore[s] && arr[s] && re.test(arr[s])) {
          idScore[s] = 60;
          idField[s] = fk;
        }
      }
    }
    return { ...res, nameHit: hit, nameScore: score, idScore, idField, nameMatches: c };
  }

  const doNames = q.field === null || q.field === 'name';
  const idFields: IdField[] =
    q.field === null ? DEFAULT_ID_FIELDS : q.field === 'name' ? [] : [q.field as IdField];

  if (doNames) {
    const hay = raw.nameHay;
    const off = raw.nameOffsets;
    const hit = new Uint8Array(N);
    const score = new Float32Array(N);
    let c = 0;
    const pos = q.pos;
    const neg = q.neg;
    const check = (k: number) => {
      const nn = hay.slice(off[k], off[k + 1] - 1);
      for (let i = 0; i < pos.length; i++) if (!nn.includes(pos[i])) return;
      for (let i = 0; i < neg.length; i++) if (nn.includes(neg[i])) return;
      hit[k] = 1;
      score[k] = scoreName(nn, q) + (raw.namePref[k] ? 6 : 0);
      c++;
    };
    if (pos.length === 1 && pos[0].length === 1 && !neg.length) {
      // A single character matches names that start with it (substring would match nearly everything).
      const needle = '\n' + pos[0];
      let p = hay.indexOf(needle);
      while (p !== -1) {
        const k = nameAt(off, p + 1);
        hit[k] = 1;
        score[k] = 80 - Math.min(10, (off[k + 1] - off[k]) / 6) + (raw.namePref[k] ? 6 : 0);
        c++;
        p = hay.indexOf(needle, p + 2);
      }
    } else if (pos.length) {
      // Scan the haystack for the longest token, then verify the rest per candidate name.
      let lead = pos[0];
      for (const t of pos) if (t.length > lead.length) lead = t;
      let p = hay.indexOf(lead, 1);
      while (p !== -1) {
        const k = nameAt(off, p);
        check(k);
        p = hay.indexOf(lead, off[k + 1]);
      }
    } else {
      for (let k = 0; k < N; k++) check(k);
    }
    res.nameHit = hit;
    res.nameScore = score;
    res.nameMatches = c;
    if (fuzzy && pos.length) fuzzyPass(ds, q, res, hit, score);
  }

  // Identifier matching: only for single-token positive queries (identifiers never contain spaces).
  const single = q.pos.length === 1 && q.neg.length === 0 ? q.pos[0] : null;
  const token = single ?? (q.field && q.field !== 'name' ? q.phrase : null);
  if (token && idFields.length) {
    let idScore: Float32Array | null = null;
    let idField: (IdField | null)[] | null = null;
    const set = (s: number, sc: number, fk: IdField) => {
      if (!idScore || !idField) {
        idScore = new Float32Array(S);
        idField = new Array(S).fill(null);
      }
      if (sc > idScore[s]) {
        idScore[s] = sc;
        idField[s] = fk;
      }
    };
    const scoped = q.field !== null;
    for (const fk of idFields) {
      const exactScore = fk === 'formula' ? 110 : fk === 'inn' ? 120 : 300;
      const prefixScore = (v: string) => 140 - Math.min(20, v.length - token.length);
      if (scoped) {
        // Explicit field search: exact, prefix or substring.
        const arr = ds.idLower(fk);
        for (let s = 0; s < S; s++) {
          const v = arr[s];
          if (!v) continue;
          if (v === token) set(s, exactScore, fk);
          else if (v.startsWith(token)) set(s, prefixScore(v), fk);
          else if (token.length >= 2 && v.includes(token)) set(s, 90, fk);
        }
      } else {
        const exact = ds.exactIndex(fk).get(token);
        if (exact) for (const s of exact) set(s, exactScore, fk);
        if (PREFIX_FIELDS.has(fk) && token.length >= 4) {
          const arr = ds.idLower(fk);
          for (const s of ds.prefixMatches(fk, token)) if (arr[s] !== token) set(s, prefixScore(arr[s]), fk);
        }
      }
    }
    res.idScore = idScore;
    res.idField = idField;
  }
  return res;
}

/** Normalised tokens to highlight in displayed names. */
export function highlightTokens(q: Query): string[] {
  if (q.regex || q.empty) return [];
  if (q.field && q.field !== 'name') return [];
  return [...q.pos].sort((a, b) => b.length - a.length);
}
