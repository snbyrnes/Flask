import { memo, type ReactNode } from 'react';
import { normWithMap } from '../data/normalize';
import { formulaParts } from '../lib/format';
import { IconCheck, IconCopy } from './icons';
import { useToast } from './toast';
import { useState } from 'react';

/** Highlights normalised tokens inside an original (un-normalised) string. */
export const Highlight = memo(function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  if (!tokens.length || !text) return <>{text}</>;
  const { text: nt, map } = normWithMap(text);
  const marks = new Uint8Array(text.length);
  let any = false;
  for (const t of tokens) {
    if (!t) continue;
    let i = nt.indexOf(t);
    while (i !== -1) {
      const a = map[i];
      const b = map[i + t.length] ?? text.length;
      for (let k = a; k < b; k++) marks[k] = 1;
      any = true;
      i = nt.indexOf(t, i + t.length);
    }
  }
  if (!any) return <>{text}</>;
  const out: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    const m = marks[i];
    let j = i;
    while (j < text.length && marks[j] === m) j++;
    const seg = text.slice(i, j);
    out.push(m ? <mark key={i}>{seg}</mark> : seg);
    i = j;
  }
  return <>{out}</>;
});

/** Molecular formula with real subscripts. Copies as plain text. */
export function Formula({ value }: { value: string }) {
  return (
    <span className="formula" aria-label={value}>
      {formulaParts(value).map((p, i) => (p.sub ? <sub key={i}>{p.t}</sub> : <span key={i}>{p.t}</span>))}
    </span>
  );
}

const TYPE_TONES: Record<string, string> = {
  Chemical: 'chem',
  'Specified Substance Group 1': 'ssg1',
  'Specified Substance Group 2': 'ssg2',
  'Specified Substance Group 3': 'ssg3',
  'Specified Substance Group 4': 'ssg4',
  Protein: 'protein',
  'Nucleic acid': 'nucleic',
  Polymer: 'polymer',
  Mixture: 'mixture',
  'Structurally Diverse - Herbal': 'herbal',
  'Structurally Diverse - Vaccine': 'vaccine',
  'Structurally Diverse - Other': 'other',
  'Structurally Diverse - Cell therapy': 'cell',
  'Structurally Diverse - Allergen': 'allergen',
  'Structurally Diverse - Plasma derived': 'plasma',
};

export const typeTone = (t: string) => TYPE_TONES[t] ?? 'other';

/** Shorter label for long type names in tight spots. */
export const shortType = (t: string) =>
  t.replace(/^Structurally Diverse - /, 'SD ').replace(/^Specified Substance Group /, 'SSG ');

export function Swatch({ type, size = 10 }: { type: string; size?: number }) {
  return (
    <span
      className={'swatch tone-' + typeTone(type)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/** Small icon button that copies a value and flashes a check mark. */
export function CopyButton({
  value,
  what,
  html,
  className = '',
  label,
}: {
  value: string | (() => string);
  what: string;
  html?: () => string;
  className?: string;
  label?: string;
}) {
  const { copy } = useToast();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={'copy-btn ' + className + (done ? ' is-done' : '')}
      title={`Copy ${what}`}
      aria-label={`Copy ${what}`}
      onClick={async (e) => {
        e.stopPropagation();
        await copy(typeof value === 'function' ? value() : value, what, html?.());
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <IconCheck size={14} /> : <IconCopy size={14} />}
      {label && <span>{label}</span>}
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
