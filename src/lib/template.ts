import { COL, COLUMNS, type ColKey, type RowCtx } from '../data/columns';
import type { Dataset } from '../data/dataset';

/**
 * Copy templates.
 *
 *   {name}            a field (any column key: id, ev, unii, formula, current, …)
 *   [, EV code {ev}]  optional part, left out when a field inside it is empty
 *   \t  \n            tab and new line;  \[ \] \{ \} \\ for the literal characters
 */
export interface CopyTemplate {
  id: string;
  name: string;
  text: string;
}

export const DEFAULT_TEMPLATES: CopyTemplate[] = [
  { id: 'ref', name: 'Name (SMS ID, EV code)', text: '{name} (SMS ID {id}[, EV code {ev}])' },
  { id: 'ev', name: 'Name - EV code', text: '{name}[ - {ev}]' },
  { id: 'xl', name: 'SMS ID, EV code, name for Excel', text: '{id}\\t{ev}\\t{name}' },
];

export const TEMPLATE_FIELDS: { key: ColKey; label: string }[] = COLUMNS.map((c) => ({ key: c.key, label: c.label }));

const KEYS = new Map<string, ColKey>(COLUMNS.map((c) => [c.key.toLowerCase(), c.key]));

type Node = { t: 'text'; v: string } | { t: 'field'; k: string } | { t: 'opt'; c: Node[] };

export interface Parsed {
  nodes: Node[];
  unknown: string[];
}

export function parseTemplate(src: string): Parsed {
  const root: Node[] = [];
  const stack: Node[][] = [root];
  const unknown = new Set<string>();
  let text = '';
  const top = () => stack[stack.length - 1];
  const flush = () => {
    if (text) top().push({ t: 'text', v: text });
    text = '';
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      const nx = src[++i];
      text += nx === 'n' ? '\n' : nx === 't' ? '\t' : nx;
    } else if (ch === '{') {
      const end = src.indexOf('}', i);
      if (end === -1) {
        text += ch;
        continue;
      }
      flush();
      const k = src.slice(i + 1, end).trim();
      if (!KEYS.has(k.toLowerCase())) unknown.add(k);
      top().push({ t: 'field', k });
      i = end;
    } else if (ch === '[') {
      flush();
      const group: Node = { t: 'opt', c: [] };
      top().push(group);
      stack.push(group.c);
    } else if (ch === ']' && stack.length > 1) {
      flush();
      stack.pop();
    } else text += ch;
  }
  flush();
  return { nodes: root, unknown: [...unknown] };
}

function render(nodes: Node[], get: (k: string) => string): { s: string; missing: boolean } {
  let s = '';
  let missing = false;
  for (const n of nodes) {
    if (n.t === 'text') s += n.v;
    else if (n.t === 'field') {
      const v = get(n.k);
      if (!v) missing = true;
      s += v;
    } else {
      const r = render(n.c, get);
      if (!r.missing) s += r.s;
    }
  }
  return { s, missing };
}

export function renderOne(p: Parsed, ds: Dataset, s: number, ctx: RowCtx = {}): string {
  return render(p.nodes, (k) => {
    const key = KEYS.get(k.toLowerCase());
    return key ? COL[key].get(ds, s, ctx) : '';
  }).s;
}

/** One rendered line per substance (a blank line between multi-line results). */
export function renderMany(text: string, ds: Dataset, subs: ArrayLike<number>, ctx: RowCtx = {}): string {
  const p = parseTemplate(text);
  const out: string[] = new Array(subs.length);
  for (let i = 0; i < subs.length; i++) out[i] = renderOne(p, ds, subs[i], ctx);
  return out.join(out.some((x) => x.includes('\n')) ? '\r\n\r\n' : '\r\n');
}
