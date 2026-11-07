import { norm } from './normalize';
import {
  FIELD_KEYS,
  NAME_FIELDS,
  SUBSTANCE_FIELDS,
  type FieldKey,
  type RawDataset,
} from './types';

export type Progress = (phase: 'parse' | 'index', fraction: number) => void;

/** RFC 4180 CSV reader. Calls onRow for every record; tolerant of CRLF/LF and BOM. */
function parseCSV(text: string, onRow: (row: string[]) => void, onProgress: (f: number) => void) {
  const n = text.length;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let row: string[] = [];
  let rows = 0;
  while (i < n) {
    let c = text.charCodeAt(i);
    let field: string;
    if (c === 34 /* " */) {
      const start = i + 1;
      let j = start;
      let escaped = false;
      let end = -1;
      for (;;) {
        const q = text.indexOf('"', j);
        if (q === -1) {
          end = n;
          i = n;
          break;
        }
        if (text.charCodeAt(q + 1) === 34) {
          escaped = true;
          j = q + 2;
          continue;
        }
        end = q;
        i = q + 1;
        break;
      }
      field = text.slice(start, end);
      if (escaped) field = field.replace(/""/g, '"');
      c = i < n ? text.charCodeAt(i) : -1;
      // Skip any stray characters between a closing quote and the delimiter.
      while (i < n && c !== 44 && c !== 10 && c !== 13) c = text.charCodeAt(++i);
    } else {
      let j = i;
      while (j < n) {
        c = text.charCodeAt(j);
        if (c === 44 || c === 10 || c === 13) break;
        j++;
      }
      field = text.slice(i, j);
      i = j;
      c = j < n ? c : -1;
    }
    row.push(field);
    if (c === 44 /* , */) {
      i++;
      if (i >= n) {
        row.push('');
        onRow(row);
        row = [];
      }
      continue;
    }
    if (c === 13) {
      i++;
      if (text.charCodeAt(i) === 10) i++;
    } else if (c === 10) i++;
    if (!(row.length === 1 && row[0] === '')) onRow(row);
    row = [];
    if (++rows % 4000 === 0) onProgress(i / n);
  }
  if (row.length && !(row.length === 1 && row[0] === '')) onRow(row);
}

export function build(buffer: ArrayBuffer, fileName: string, progress: Progress = () => {}): RawDataset {
  const t0 = performance.now();
  let text = new TextDecoder('utf-8').decode(buffer);
  // NUL is the separator used to pack string columns for transfer (see pack.ts).
  if (text.includes('\0')) text = text.replace(/\0/g, '');

  let header = null as string[] | null;
  let col: Record<string, number> = {};
  let idCol = -1;
  let nameCol = -1;
  let prefCol = -1;
  let langCol = -1;
  let srcCol = -1;
  const fieldCols: [FieldKey, number][] = [];
  const extraCols: number[] = [];

  const fields = Object.fromEntries(FIELD_KEYS.map((k) => [k, [] as string[]])) as Record<
    FieldKey,
    string[]
  >;
  const extraVals: string[][] = [];

  const subIndex = new Map<string, number>();
  const tmpText: string[] = [];
  const tmpLang: number[] = [];
  const tmpSrc: number[] = [];
  const tmpPref: number[] = [];
  const tmpSub: number[] = [];
  const langIdx = new Map<string, number>();
  const langs: string[] = [];
  const srcIdx = new Map<string, number>([['', 0]]);
  const sources: string[] = [''];
  let rowCount = 0;

  const enumOf = (map: Map<string, number>, list: string[], v: string) => {
    let k = map.get(v);
    if (k === undefined) {
      k = list.length;
      list.push(v);
      map.set(v, k);
    }
    return k;
  };

  parseCSV(
    text,
    (row) => {
      if (!header) {
        header = row.map((h) => h.replace(/^﻿/, '').replace(/^#/, '').trim());
        col = {};
        header.forEach((h, i) => (col[h.toLowerCase()] = i));
        const find = (name: string) => col[name.toLowerCase()] ?? -1;
        idCol = find(SUBSTANCE_FIELDS.id);
        nameCol = find(NAME_FIELDS.name);
        prefCol = find(NAME_FIELDS.preferred);
        langCol = find(NAME_FIELDS.language);
        srcCol = find(NAME_FIELDS.source);
        if (idCol < 0 || nameCol < 0) {
          throw new Error(
            'This file does not look like an SMS substances export: it needs SMS_ID and Substance_Name columns.',
          );
        }
        const used = new Set([nameCol, prefCol, langCol, srcCol]);
        for (const k of FIELD_KEYS) {
          const i = find(SUBSTANCE_FIELDS[k]);
          if (i >= 0) {
            fieldCols.push([k, i]);
            used.add(i);
          }
        }
        header.forEach((_, i) => {
          if (!used.has(i)) {
            extraCols.push(i);
            extraVals.push([]);
          }
        });
        return;
      }
      rowCount++;
      const id = (row[idCol] ?? '').trim();
      if (!id) return;
      let s = subIndex.get(id);
      if (s === undefined) {
        s = subIndex.size;
        subIndex.set(id, s);
        for (const k of FIELD_KEYS) fields[k].push('');
        for (const [k, i] of fieldCols) fields[k][s] = (row[i] ?? '').trim();
        extraCols.forEach((i, e) => extraVals[e].push((row[i] ?? '').trim()));
      }
      tmpText.push(row[nameCol] ?? '');
      tmpLang.push(enumOf(langIdx, langs, langCol >= 0 ? (row[langCol] ?? '').trim() : ''));
      tmpSrc.push(enumOf(srcIdx, sources, srcCol >= 0 ? (row[srcCol] ?? '').trim() : ''));
      tmpPref.push(prefCol >= 0 && /^(true|1|yes|y)$/i.test((row[prefCol] ?? '').trim()) ? 1 : 0);
      tmpSub.push(s);
    },
    (f) => progress('parse', f),
  );

  if (!header) throw new Error('The file is empty.');

  progress('index', 0);

  const subCount = subIndex.size;
  const nameCount = tmpText.length;

  // Group names by substance (stable counting sort keeps the export's order within a substance).
  const subNameCount = new Uint32Array(subCount);
  for (let i = 0; i < nameCount; i++) subNameCount[tmpSub[i]]++;
  const subNameStart = new Uint32Array(subCount);
  for (let s = 1; s < subCount; s++) subNameStart[s] = subNameStart[s - 1] + subNameCount[s - 1];
  const cursor = subNameStart.slice();
  const order = new Uint32Array(nameCount);
  for (let i = 0; i < nameCount; i++) order[cursor[tmpSub[i]]++] = i;

  const nameText = new Array<string>(nameCount);
  const nameLang = new Uint16Array(nameCount);
  const nameSource = new Uint16Array(nameCount);
  const namePref = new Uint8Array(nameCount);
  const nameSub = new Uint32Array(nameCount);
  for (let k = 0; k < nameCount; k++) {
    const i = order[k];
    nameText[k] = tmpText[i];
    nameLang[k] = tmpLang[i];
    nameSource[k] = tmpSrc[i];
    namePref[k] = tmpPref[i];
    nameSub[k] = tmpSub[i];
  }

  const subPrefName = new Int32Array(subCount).fill(-1);
  for (let s = 0; s < subCount; s++) {
    const a = subNameStart[s];
    const b = a + subNameCount[s];
    let p = -1;
    for (let k = a; k < b; k++)
      if (namePref[k]) {
        p = k;
        break;
      }
    subPrefName[s] = p >= 0 ? p : a; // fall back to the first name
  }

  // Search haystack of normalised names.
  const parts = new Array<string>(nameCount);
  const nameOffsets = new Uint32Array(nameCount + 1);
  let pos = 1;
  for (let k = 0; k < nameCount; k++) {
    const t = norm(nameText[k]).replace(/\n/g, ' ');
    parts[k] = t;
    nameOffsets[k] = pos;
    pos += t.length + 1;
    if (k % 20000 === 0) progress('index', k / nameCount);
  }
  nameOffsets[nameCount] = pos;
  const nameHay = '\n' + parts.join('\n') + '\n';

  return {
    fileName,
    header,
    rowCount,
    subCount,
    nameCount,
    fields,
    extra: extraCols.map((i, e) => ({ header: header![i], values: extraVals[e] })),
    nameText,
    nameLang,
    nameSource,
    namePref,
    nameSub,
    subNameStart,
    subNameCount,
    subPrefName,
    langs,
    sources,
    nameHay,
    nameOffsets,
    parseMs: performance.now() - t0,
  };
}
