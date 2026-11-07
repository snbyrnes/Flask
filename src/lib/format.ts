const nf = new Intl.NumberFormat('en');
export const fmtInt = (n: number) => nf.format(n);

export function fmtCompact(n: number) {
  if (n < 10000) return nf.format(n);
  if (n < 1e6) return (n / 1000).toFixed(n < 100000 ? 1 : 0).replace(/\.0$/, '') + 'k';
  return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2025-05-07 11:58:39' -> '7 May 2025' */
export function fmtDate(v: string, withTime = false) {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return v;
  const d = `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
  return withTime && m[4] ? `${d}, ${m[4]}:${m[5]}` : d;
}

export function fmtDateObj(d: Date) {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtBytes(n: number) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/** Splits a molecular formula into text/subscript runs: digits after an element or bracket are subscripts. */
export function formulaParts(f: string): { t: string; sub: boolean }[] {
  const out: { t: string; sub: boolean }[] = [];
  const re = /(\d+(?:\.\d+)?)|([^\d]+)/g;
  let m: RegExpExecArray | null;
  let prev = '';
  while ((m = re.exec(f))) {
    if (m[1]) {
      const sub = /[A-Za-z)\]]$/.test(prev);
      out.push({ t: m[1], sub });
      prev = m[1];
    } else {
      out.push({ t: m[2], sub: false });
      prev = m[2];
    }
  }
  return out;
}

/** Days before `iso` (YYYY-MM-DD) as YYYY-MM-DD. */
export function daysBefore(iso: string, days: number) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() - days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function plural(n: number, one: string, many = one + 's') {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}
