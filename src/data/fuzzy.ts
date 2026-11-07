import type { Dataset } from './dataset';
import { norm } from './normalize';

/**
 * Typo-tolerant matching.
 *
 * Names are split into words; each distinct word keeps a postings list of the
 * names it appears in. A query word is compared against words of similar
 * length with an edit distance that counts swapped neighbours as one edit
 * ("paracteamol" -> "paracetamol" is 1).
 */
export interface WordIndex {
  words: string[];
  wordId: Map<string, number>;
  /** Word ids by length (index = length, last bucket holds everything longer). */
  byLen: Uint32Array[];
  /** postings for word w: posts[postStart[w] .. postStart[w + 1]) */
  postStart: Uint32Array;
  posts: Uint32Array;
}

const MAXLEN = 48;
const SPLIT = /[^\p{L}\p{N}]+/u;

export function buildWordIndex(ds: Dataset): WordIndex {
  const N = ds.raw.nameCount;
  const wordId = new Map<string, number>();
  const words: string[] = [];
  const lastName: number[] = [];
  const pairW: number[] = [];
  const pairN: number[] = [];
  for (let k = 0; k < N; k++) {
    const parts = ds.normName(k).split(SPLIT);
    for (const w of parts) {
      if (w.length < 3) continue;
      let id = wordId.get(w);
      if (id === undefined) {
        id = words.length;
        words.push(w);
        wordId.set(w, id);
        lastName.push(-1);
      }
      if (lastName[id] === k) continue; // same word twice in one name
      lastName[id] = k;
      pairW.push(id);
      pairN.push(k);
    }
  }
  const W = words.length;
  const postStart = new Uint32Array(W + 1);
  for (const id of pairW) postStart[id + 1]++;
  for (let i = 0; i < W; i++) postStart[i + 1] += postStart[i];
  const fill = postStart.slice(0, W);
  const posts = new Uint32Array(pairW.length);
  for (let i = 0; i < pairW.length; i++) posts[fill[pairW[i]]++] = pairN[i];

  const lenLists: number[][] = Array.from({ length: MAXLEN + 1 }, () => []);
  for (let id = 0; id < W; id++) lenLists[Math.min(MAXLEN, words[id].length)].push(id);
  const byLen = lenLists.map((l) => Uint32Array.from(l));
  return { words, wordId, byLen, postStart, posts };
}

const BUF = 200;
let rA = new Int32Array(BUF + 2);
let rB = new Int32Array(BUF + 2);
let rC = new Int32Array(BUF + 2);

/**
 * Optimal-string-alignment distance between a and b, giving up above k (returns k + 1).
 * With prefix = true, it is the distance from a to the closest prefix of b, for
 * matching a word that is still being typed.
 */
export function osa(a: string, b: string, k: number, prefix: boolean): number {
  const n = a.length;
  let m = b.length;
  if (n === 0) return prefix ? 0 : m <= k ? m : k + 1;
  if (n >= BUF) return k + 1;
  if (prefix) {
    if (m < n - k) return k + 1;
    m = Math.min(m, n + k);
  } else if (Math.abs(m - n) > k) return k + 1;
  if (m >= BUF) return k + 1;

  let prev2 = rA;
  let prev = rB;
  let cur = rC;
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    const ai = a.charCodeAt(i - 1);
    const lo = Math.max(1, i - k);
    const hi = Math.min(m, i + k);
    cur[0] = i;
    if (lo > 1) cur[lo - 1] = k + 1;
    let rowMin = lo === 1 ? i : k + 1;
    for (let j = lo; j <= hi; j++) {
      const bj = b.charCodeAt(j - 1);
      let v = prev[j - 1] + (ai === bj ? 0 : 1);
      const del = prev[j] + 1;
      if (del < v) v = del;
      const ins = cur[j - 1] + 1;
      if (ins < v) v = ins;
      if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === bj) {
        const t = prev2[j - 2] + 1;
        if (t < v) v = t;
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (hi < m) cur[hi + 1] = k + 1;
    if (rowMin > k) return k + 1;
    const t = prev2;
    prev2 = prev;
    prev = cur;
    cur = t;
  }
  if (prefix) {
    let best = k + 1;
    for (let j = Math.max(0, n - k); j <= m; j++) if (prev[j] < best) best = prev[j];
    return best;
  }
  return prev[m] <= k ? prev[m] : k + 1;
}

/** Edits allowed for a complete word / a word still being typed. */
export const fullK = (len: number) => (len < 4 ? 0 : len < 8 ? 1 : 2);
export const prefixK = (len: number) => (len < 6 ? 0 : len < 9 ? 1 : 2);

/** Words within k edits of token (sorted by distance). */
export function similarWords(idx: WordIndex, token: string, k: number, prefix: boolean): { id: number; d: number }[] {
  const n = token.length;
  const out: { id: number; d: number }[] = [];
  if (k <= 0) {
    const id = idx.wordId.get(token);
    if (id !== undefined) out.push({ id, d: 0 });
    return out;
  }
  const minLen = Math.max(3, n - k);
  const maxLen = prefix ? MAXLEN : Math.min(MAXLEN, n + k);
  const c0 = token.charCodeAt(0);
  const c1 = token.charCodeAt(1);
  for (let L = minLen; L <= maxLen; L++) {
    const bucket = idx.byLen[L];
    for (let i = 0; i < bucket.length; i++) {
      const id = bucket[i];
      const w = idx.words[id];
      // Cheap pre-check: a typo rarely hits both of the first two letters.
      if (prefix && w.charCodeAt(0) !== c0 && w.charCodeAt(1) !== c1 && w.charCodeAt(0) !== c1) continue;
      const d = osa(token, w, k, prefix);
      if (d <= k) out.push({ id, d });
    }
  }
  out.sort((x, y) => x.d - y.d);
  return out;
}

/** Plain Levenshtein similarity 0..100 (strings capped at 120 characters). */
export function similarity(a: string, b: string): number {
  const A = a.slice(0, 120);
  const B = b.slice(0, 120);
  if (!A.length || !B.length) return 0;
  if (A === B) return 100;
  let prev = new Array<number>(B.length + 1);
  let cur = new Array<number>(B.length + 1);
  for (let j = 0; j <= B.length; j++) prev[j] = j;
  for (let i = 1; i <= A.length; i++) {
    cur[0] = i;
    const ai = A.charCodeAt(i - 1);
    for (let j = 1; j <= B.length; j++) {
      const v = prev[j - 1] + (ai === B.charCodeAt(j - 1) ? 0 : 1);
      cur[j] = Math.min(v, prev[j] + 1, cur[j - 1] + 1);
    }
    [prev, cur] = [cur, prev];
  }
  return Math.max(0, Math.round(100 * (1 - prev[B.length] / Math.max(A.length, B.length))));
}

/**
 * Strips things that make a spreadsheet value differ from the registered name:
 * strengths and units ("500 mg", "10 %", "5 mg/ml"), pharmacopoeia suffixes
 * (BP, USP, Ph. Eur.), "w/w" style qualifiers and brackets.
 */
export function cleanName(v: string): string {
  return v
    .replace(/\d+(?:[.,]\d+)?\s*%/g, ' ')
    .replace(
      /\b\d+(?:[.,]\d+)?\s*(?:mg|g|kg|mcg|µg|ug|ng|ml|l|iu|ui|mmol|mol|meq|units?|u)\b(?:\s*\/\s*(?:\d+(?:[.,]\d+)?\s*)?(?:mg|g|kg|ml|l|dose|tab(?:let)?s?|cap(?:sule)?s?|vials?|amps?)\b)?/gi,
      ' ',
    )
    .replace(/\b[wv]\s*\/\s*[wv]\b/gi, ' ')
    .replace(/\b(?:ph\.?\s*eur\.?|b\.?p\.?|u\.?s\.?p\.?|j\.?p\.?|n\.?f\.?)(?=[\s,;)\]]|$)/gi, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[\s,;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Suggestion {
  s: number;
  /** Name index that matched best. */
  k: number;
  /** 0..100 */
  score: number;
}

/** Closest substances for a value that had no exact match (used by the lookup list). */
export function suggest(ds: Dataset, input: string, limit = 3): Suggestion[] {
  const target = norm(input).replace(/\s+/g, ' ').trim();
  if (target.length < 3) return [];
  const idx = ds.wordIndex();
  const toks = [...new Set(target.split(SPLIT).filter((w) => w.length >= 3))];
  if (!toks.length) return [];

  const counts = new Map<number, number>();
  for (const t of toks) {
    const seen = new Set<number>();
    for (const { id } of similarWords(idx, t, fullK(t.length), false)) {
      for (let p = idx.postStart[id]; p < idx.postStart[id + 1]; p++) {
        const nm = idx.posts[p];
        if (seen.has(nm)) continue;
        seen.add(nm);
        counts.set(nm, (counts.get(nm) ?? 0) + 1);
      }
    }
  }
  const need = Math.max(1, Math.ceil(toks.length * 0.5));
  const cands = [...counts].filter(([, c]) => c >= need).sort((a, b) => b[1] - a[1]).slice(0, 400);

  const bySub = new Map<number, Suggestion>();
  for (const [k] of cands) {
    const score = similarity(target, ds.normName(k));
    const s = ds.raw.nameSub[k];
    const prev = bySub.get(s);
    if (!prev || score > prev.score) bySub.set(s, { s, k, score });
  }
  return [...bySub.values()]
    .filter((x) => x.score >= 50)
    .sort((a, b) => b.score - a.score || ds.raw.subNameCount[b.s] - ds.raw.subNameCount[a.s])
    .slice(0, limit);
}
