import type { Table } from '../data/columns';

const clean = (v: string) => v.replace(/[\t\r\n]+/g, ' ');

export function toTSV(t: Table, header = true): string {
  const lines = t.rows.map((r) => r.map(clean).join('\t'));
  if (header) lines.unshift(t.header.map(clean).join('\t'));
  return lines.join('\r\n');
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);

export function toCSV(t: Table, header = true): string {
  const lines = t.rows.map((r) => r.map(csvCell).join(','));
  if (header) lines.unshift(t.header.map(csvCell).join(','));
  return lines.join('\r\n');
}

const mdCell = (v: string) => clean(v).replace(/\|/g, '\\|');

export function toMarkdown(t: Table): string {
  const head = '| ' + t.header.map(mdCell).join(' | ') + ' |';
  const sep = '| ' + t.header.map(() => '---').join(' | ') + ' |';
  return [head, sep, ...t.rows.map((r) => '| ' + r.map(mdCell).join(' | ') + ' |')].join('\n');
}

export function toJSON(t: Table): string {
  return JSON.stringify(
    t.rows.map((r) => Object.fromEntries(t.header.map((h, i) => [h, r[i]]))),
    null,
    2,
  );
}

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * HTML table for rich paste. The mso-number-format hint keeps Excel from turning
 * 12-digit SMS IDs into 1.00E+11 or EC numbers into dates.
 */
export function toHTML(t: Table, header = true): string {
  const td = `style="mso-number-format:'\\@';"`;
  const head = header ? '<tr>' + t.header.map((h) => `<th>${esc(h)}</th>`).join('') + '</tr>' : '';
  const body = t.rows.map((r) => '<tr>' + r.map((v) => `<td ${td}>${esc(v)}</td>`).join('') + '</tr>').join('');
  return `<meta charset="utf-8"><table>${head}${body}</table>`;
}

export function download(filename: string, text: string, mime = 'text/csv') {
  // BOM so Excel opens UTF-8 CSV with accents intact.
  const bom = mime === 'text/csv' ? '﻿' : '';
  const blob = new Blob([bom + text], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
