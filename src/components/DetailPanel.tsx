import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ALL_EXPORT_COLUMNS, buildTable, type Table } from '../data/columns';
import { FLAG_DEFS, type Dataset } from '../data/dataset';
import { norm } from '../data/normalize';
import { toHTML, toJSON, toMarkdown, toTSV } from '../lib/export';
import { fmtDate, fmtInt } from '../lib/format';
import { renderMany, type CopyTemplate } from '../lib/template';
import { CopyButton, Formula, Highlight, Swatch, typeTone } from '../ui/bits';
import { IconBack, IconExternal, IconPin, IconX } from '../ui/icons';
import { MenuButton, type MenuItem } from '../ui/Menu';
import { useToast } from '../ui/toast';

interface Props {
  ds: Dataset;
  s: number;
  tokens: string[];
  nameHit: Uint8Array | null;
  pinned: boolean;
  /** Name of the list the pin button adds to. */
  listName: string;
  templates: CopyTemplate[];
  structures: boolean;
  canGoBack: boolean;
  onBack: () => void;
  onTogglePin: () => void;
  onOpen: (s: number) => void;
  onClose: () => void;
  onSearch: (q: string) => void;
}

const UNII_URL = (v: string) => `https://precision.fda.gov/uniisearch/srs/unii/${encodeURIComponent(v)}`;
const PUBCHEM_URL = (v: string) => `https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(v)}`;
const PUBCHEM_IMG = (v: string) =>
  `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/inchikey/${encodeURIComponent(v)}/PNG?image_size=400x300`;

export function summaryText(ds: Dataset, s: number) {
  const f = ds.f;
  const lines: [string, string][] = [
    ['Name', ds.prefName(s)],
    ['SMS ID', f.id[s]],
    ['EV code', f.ev[s]],
    ['Type', f.type[s]],
    ['Domain', f.domain[s]],
    ['UNII', f.unii[s]],
    ['INN number', f.inn[s]],
    ['EC number', f.ec[s]],
    ['InChIKey', f.inchikey[s]],
    ['Molecular formula', f.formula[s]],
    ['Molecular weight', f.mw[s]],
  ];
  return lines
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

export function citeText(ds: Dataset, s: number) {
  const f = ds.f;
  const ids = [`SMS ID ${f.id[s]}`, f.ev[s] && `EV code ${f.ev[s]}`].filter(Boolean).join(', ');
  return `${ds.prefName(s)} (${ids})`;
}

export function DetailPanel(p: Props) {
  const { ds, s } = p;
  const f = ds.f;
  const { copy } = useToast();
  const name = ds.prefName(s);
  const [a, b] = ds.nameRange(s);

  const row = (): Table => buildTable(ds, [s], ALL_EXPORT_COLUMNS);
  const namesTable = (): Table => {
    const rows: string[][] = [];
    for (let k = a; k < b; k++)
      rows.push([ds.raw.nameText[k], ds.lang(k), ds.source(k), ds.raw.namePref[k] ? 'Preferred' : '']);
    return { header: ['Name', 'Language', 'Source', 'Preferred'], rows };
  };

  const copyItems: MenuItem[] = [
    ...(p.templates.length
      ? [
          { heading: 'Templates' } as MenuItem,
          ...p.templates.map(
            (t, i): MenuItem => ({
              label: t.name,
              hint: i < 9 ? String(i + 1) : undefined,
              onSelect: () => copy(renderMany(t.text, ds, [s]), t.name),
            }),
          ),
          'sep' as MenuItem,
        ]
      : []),
    { label: 'Name and identifiers', hint: 'text', onSelect: () => copy(summaryText(ds, s), 'summary') },
    { label: 'Name with SMS ID and EV code', hint: 'one line', onSelect: () => copy(citeText(ds, s), 'reference') },
    'sep',
    {
      label: 'All fields for Excel',
      hint: 'table',
      onSelect: () => {
        const t = row();
        copy(toTSV(t), 'all fields', toHTML(t));
      },
    },
    { label: 'All fields as JSON', onSelect: () => copy(toJSON(row()), 'JSON') },
    { label: 'All fields as Markdown', onSelect: () => copy(toMarkdown(row()), 'Markdown table') },
    'sep',
    {
      label: 'All names with language and source',
      hint: 'table',
      onSelect: () => {
        const t = namesTable();
        copy(toTSV(t), `${b - a} names`, toHTML(t));
      },
    },
    {
      label: 'Link to this substance',
      onSelect: () => copy(`${location.origin}${location.pathname}#s=${f.id[s]}`, 'link'),
    },
  ];

  const parent = f.parent[s] ? ds.byId(f.parent[s]) : undefined;
  const children = ds.children.get(s) ?? [];
  const replaces = ds.replaces.get(s) ?? [];
  const sameIk = useMemo(() => ds.sameInchikey(s), [ds, s]);

  return (
    <article className={'detail-card tone-' + typeTone(f.type[s])} aria-label={name}>
      <header className="detail-head">
        <div className="detail-toolbar">
          {p.canGoBack && (
            <button type="button" className="btn btn-icon" onClick={p.onBack} title="Back" aria-label="Back">
              <IconBack size={16} />
            </button>
          )}
          <span className="detail-type">
            <Swatch type={f.type[s]} size={12} />
            {f.type[s]}
          </span>
          <span className="detail-spacer" />
          <button
            type="button"
            className={'btn btn-icon' + (p.pinned ? ' is-on' : '')}
            onClick={p.onTogglePin}
            title={p.pinned ? `Remove from ${p.listName} (P)` : `Add to ${p.listName} (P)`}
            aria-pressed={p.pinned}
            aria-label={p.pinned ? `Remove from ${p.listName}` : `Add to ${p.listName}`}
          >
            <IconPin size={16} filled={p.pinned} />
          </button>
          <MenuButton label="Copy substance" items={copyItems} className="btn btn-small" alignRight>
            Copy as…
          </MenuButton>
          <button type="button" className="btn btn-icon" onClick={p.onClose} title="Close (Esc)" aria-label="Close details">
            <IconX size={16} />
          </button>
        </div>

        <div className="detail-title-row">
          <h2 className={'detail-title' + (name.length > 120 ? ' is-long' : name.length > 48 ? ' is-mid' : '')}>{name}</h2>
          <CopyButton value={name} what="name" className="title-copy" />
        </div>
        <div className="detail-meta">
          <span>{f.domain[s]}</span>
          {f.status[s] && <span>{f.status[s]}</span>}
          <span>
            {fmtInt(b - a)} {b - a === 1 ? 'name' : 'names'}
          </span>
          {f.formula[s] && (
            <span className="detail-formula">
              <Formula value={f.formula[s]} />
              {f.mw[s] && <span className="muted"> {f.mw[s]} g/mol</span>}
            </span>
          )}
        </div>

        {f.replacement[s] && <ReplacedNotice ds={ds} s={s} onOpen={p.onOpen} />}
        {(ds.flags[s] & DUP_BIT) !== 0 && (
          <div className="notice notice-info">
            Possible duplicate: {sameIk.filter((x) => !f.replacement[x]).length === 1 ? 'another current substance shares' : `${sameIk.filter((x) => !f.replacement[x]).length} other current substances share`}{' '}
            this InChIKey. See related substances below.
          </div>
        )}
      </header>

      <section className="detail-section">
        <h3>Identifiers</h3>
        <dl className="ids">
          <IdRow label="SMS ID" value={f.id[s]} />
          <IdRow label="EV code" value={f.ev[s]} />
          <IdRow label="UNII" value={f.unii[s]} href={f.unii[s] && UNII_URL(f.unii[s])} hrefLabel="FDA UNII search" />
          <IdRow label="INN number" value={f.inn[s]} />
          <IdRow label="EC number" value={f.ec[s]} />
          {f.pheur[s] && <IdRow label="Ph. Eur. number" value={f.pheur[s]} />}
          <IdRow
            label="InChIKey"
            value={f.inchikey[s]}
            href={f.inchikey[s] && PUBCHEM_URL(f.inchikey[s])}
            hrefLabel="Search PubChem"
            wrap
          />
          <IdRow
            label="Formula"
            value={f.formula[s]}
            display={f.formula[s] ? <Formula value={f.formula[s]} /> : undefined}
            action={
              f.formula[s] ? (
                <button
                  type="button"
                  className="mini-link"
                  onClick={() => p.onSearch(f.formula[s])}
                  title="Search for every substance with this formula"
                >
                  Same formula
                </button>
              ) : undefined
            }
          />
          <IdRow label="Mol. weight" value={f.mw[s]} mono={false} />
          <IdRow label="Created" value={f.created[s]} display={fmtDate(f.created[s], true)} mono={false} />
          <IdRow label="Last updated" value={f.updated[s]} display={fmtDate(f.updated[s], true)} mono={false} />
          <IdRow label="SVG flag" value={f.svg[s]} mono={false} />
          {ds.raw.extra.map((e) =>
            e.values[s] ? <IdRow key={e.header} label={e.header.replace(/_/g, ' ')} value={e.values[s]} /> : null,
          )}
        </dl>
        {f.comment[s] && (
          <div className="comment">
            <span className="comment-label">Comment</span>
            <p>
              <Linkified ds={ds} text={f.comment[s]} onOpen={p.onOpen} />
            </p>
          </div>
        )}
      </section>

      {(parent !== undefined ||
        f.parent[s] ||
        children.length > 0 ||
        replaces.length > 0 ||
        sameIk.length > 0) && (
        <section className="detail-section">
          <h3>Related substances</h3>
          {parent !== undefined && <RelList title="Parent" ds={ds} subs={[parent]} onOpen={p.onOpen} />}
          {f.parent[s] && parent === undefined && (
            <p className="muted small">
              Parent SMS ID <span className="mono">{f.parent[s]}</span> is not in this export.
            </p>
          )}
          {children.length > 0 && <RelList title="Children" ds={ds} subs={children} onOpen={p.onOpen} />}
          {replaces.length > 0 && <RelList title="Replaces" ds={ds} subs={replaces} onOpen={p.onOpen} />}
          {sameIk.length > 0 && <RelList title="Same InChIKey" ds={ds} subs={sameIk} onOpen={p.onOpen} />}
        </section>
      )}

      {f.inchikey[s] && <Structure key={s} inchikey={f.inchikey[s]} auto={p.structures} />}

      <Names ds={ds} s={s} tokens={p.tokens} nameHit={p.nameHit} />
    </article>
  );
}

const DUP_BIT = FLAG_DEFS.find((d) => d.key === 'sharedIk')!.bit;

/** "Replaced": shows the substance to use today and the chain that leads to it. */
function ReplacedNotice({ ds, s, onOpen }: { ds: Dataset; s: number; onOpen: (s: number) => void }) {
  const chain = ds.replacementChain(s);
  const cur = ds.currentOf[s];
  if (!chain.length)
    return (
      <div className="notice notice-warn">
        Replaced by SMS ID <span className="mono">{ds.f.replacement[s]}</span>, which is not in this export.
      </div>
    );
  const target = cur >= 0 ? cur : chain[chain.length - 1];
  return (
    <div className="notice notice-warn notice-stack">
      <span className="notice-title">{cur >= 0 ? 'Replaced. The current substance is' : 'Replaced by'}</span>
      <div className="notice-row">
        <SubLink ds={ds} s={target} onOpen={onOpen} />
        <CopyButton value={ds.f.id[target]} what="current SMS ID" />
      </div>
      {chain.length > 1 && (
        <div className="notice-chain">
          Via{' '}
          {chain.slice(0, -1).map((x, i) => (
            <span key={x}>
              {i > 0 && ', then '}
              <button type="button" className="inline-link" onClick={() => onOpen(x)} title={ds.f.id[x]}>
                {ds.prefName(x)}
              </button>
            </span>
          ))}
          , which {chain.length > 2 ? 'were' : 'was'} also replaced.
        </div>
      )}
      {cur === -2 && <div className="notice-chain">The replacement chain continues outside this export.</div>}
    </div>
  );
}

function IdRow({
  label,
  value,
  display,
  href,
  hrefLabel,
  mono = true,
  wrap,
  action,
}: {
  label: string;
  value: string;
  display?: ReactNode;
  href?: string;
  hrefLabel?: string;
  mono?: boolean;
  wrap?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className={'id-row' + (value ? '' : ' is-blank')}>
      <dt>{label}</dt>
      <dd>
        {value ? (
          <>
            <span className={'id-value' + (mono ? ' mono' : '') + (wrap ? ' wrap' : '')}>{display ?? value}</span>
            <span className="id-actions">
              {action}
              {href && (
                <a className="icon-link" href={href} target="_blank" rel="noreferrer noopener" title={hrefLabel} aria-label={hrefLabel}>
                  <IconExternal size={14} />
                </a>
              )}
              <CopyButton value={value} what={label} />
            </span>
          </>
        ) : (
          <span className="none">None</span>
        )}
      </dd>
    </div>
  );
}

function SubLink({ ds, s, onOpen }: { ds: Dataset; s: number; onOpen: (s: number) => void }) {
  return (
    <button type="button" className="sub-link" onClick={() => onOpen(s)}>
      <Swatch type={ds.f.type[s]} />
      <span className="sub-link-name">{ds.prefName(s)}</span>
      <span className="mono muted">{ds.f.id[s]}</span>
    </button>
  );
}

function RelList({ title, ds, subs, onOpen }: { title: string; ds: Dataset; subs: number[]; onOpen: (s: number) => void }) {
  const [all, setAll] = useState(false);
  const limit = 6;
  const shown = all ? subs : subs.slice(0, limit);
  return (
    <div className="rel">
      <div className="rel-title">
        {title}
        {subs.length > 1 && <span className="muted"> {fmtInt(subs.length)}</span>}
      </div>
      <ul className="rel-list">
        {shown.map((x) => (
          <li key={x}>
            <SubLink ds={ds} s={x} onOpen={onOpen} />
          </li>
        ))}
      </ul>
      {subs.length > limit && (
        <button type="button" className="link-btn" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${fmtInt(subs.length)}`}
        </button>
      )}
    </div>
  );
}

/** Turns SMS IDs and EV codes inside free text into links when they exist in the export. */
function Linkified({ ds, text, onOpen }: { ds: Dataset; text: string; onOpen: (s: number) => void }) {
  const parts: ReactNode[] = [];
  const re = /\b(\d{12})\b|\b(SUB\d+[A-Z]*)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const target = m[1] ? ds.byId(m[1]) : ds.exactIndex('ev').get(m[2].toLowerCase())?.[0];
    if (target === undefined) continue;
    parts.push(text.slice(last, m.index));
    parts.push(
      <button key={m.index} type="button" className="inline-link mono" onClick={() => onOpen(target)} title={ds.prefName(target)}>
        {m[0]}
      </button>,
    );
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function Structure({ inchikey, auto }: { inchikey: string; auto: boolean }) {
  const [show, setShow] = useState(auto);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  useEffect(() => setShow(auto), [auto]);
  return (
    <section className="detail-section">
      <h3>Structure</h3>
      {!show ? (
        <button type="button" className="btn btn-small" onClick={() => setShow(true)}>
          Load image from PubChem
        </button>
      ) : (
        <div className={'structure is-' + state}>
          {state !== 'error' && (
            <img
              src={PUBCHEM_IMG(inchikey)}
              alt="2D structure from PubChem"
              onLoad={() => setState('ok')}
              onError={() => setState('error')}
            />
          )}
          {state === 'loading' && <span className="muted small">Loading from PubChem…</span>}
          {state === 'error' && (
            <span className="muted small">PubChem has no structure for this InChIKey, or it can't be reached.</span>
          )}
        </div>
      )}
      <p className="muted small structure-note">Looked up on PubChem by InChIKey. Not part of the SMS export.</p>
    </section>
  );
}

function Names({ ds, s, tokens, nameHit }: { ds: Dataset; s: number; tokens: string[]; nameHit: Uint8Array | null }) {
  const [find, setFind] = useState('');
  const [lang, setLang] = useState('');
  const { copy } = useToast();
  const [a, b] = ds.nameRange(s);
  const total = b - a;

  useEffect(() => {
    setFind('');
    setLang('');
  }, [s]);

  const langs = useMemo(() => {
    const m = new Map<string, number>();
    for (let k = a; k < b; k++) m.set(ds.lang(k), (m.get(ds.lang(k)) ?? 0) + 1);
    return m;
  }, [ds, a, b]);

  const groups = useMemo(() => {
    const nf = norm(find.trim());
    const g = new Map<string, number[]>();
    for (let k = a; k < b; k++) {
      const l = ds.lang(k);
      if (lang && l !== lang) continue;
      if (nf && !ds.normName(k).includes(nf)) continue;
      const arr = g.get(l);
      if (arr) arr.push(k);
      else g.set(l, [k]);
    }
    const prefLang = ds.lang(ds.raw.subPrefName[s]);
    const keys = [...g.keys()].sort((x, y) => {
      const rx = x === prefLang ? 0 : x === 'English' ? 1 : 2;
      const ry = y === prefLang ? 0 : y === 'English' ? 1 : 2;
      return rx - ry || x.localeCompare(y);
    });
    // Preferred first, then the export's order.
    return keys.map((l) => [l, g.get(l)!.sort((x, y) => ds.raw.namePref[y] - ds.raw.namePref[x] || x - y)] as const);
  }, [ds, s, a, b, find, lang]);

  const visible = groups.flatMap(([, ks]) => ks);
  const hlTokens = useMemo(() => {
    const t = norm(find.trim());
    return t ? [...tokens, t] : tokens;
  }, [tokens, find]);

  const items: MenuItem[] = [
    {
      label: visible.length === total ? 'All names, one per line' : `Shown names, one per line (${visible.length})`,
      onSelect: () => copy(visible.map((k) => ds.raw.nameText[k]).join('\r\n'), `${visible.length} names`),
    },
    {
      label: 'Names with language and source',
      hint: 'table',
      onSelect: () => {
        const t: Table = {
          header: ['Name', 'Language', 'Source', 'Preferred'],
          rows: visible.map((k) => [ds.raw.nameText[k], ds.lang(k), ds.source(k), ds.raw.namePref[k] ? 'Preferred' : '']),
        };
        copy(toTSV(t), `${visible.length} names`, toHTML(t));
      },
    },
    {
      label: 'English names, one per line',
      disabled: !langs.has('English'),
      onSelect: () => {
        const ks: number[] = [];
        for (let k = a; k < b; k++) if (ds.lang(k) === 'English') ks.push(k);
        copy(ks.map((k) => ds.raw.nameText[k]).join('\r\n'), `${ks.length} English names`);
      },
    },
  ];

  return (
    <section className="detail-section names">
      <div className="names-head">
        <h3>
          Names <span className="muted">{fmtInt(total)}</span>
        </h3>
        <MenuButton label="Copy names" items={items} className="btn btn-small" alignRight>
          Copy names…
        </MenuButton>
      </div>
      {total > 4 && (
        <div className="names-tools">
          <input
            type="search"
            className="input"
            placeholder="Find a name"
            aria-label="Find a name"
            value={find}
            onChange={(e) => setFind(e.target.value)}
          />
          {langs.size > 1 && (
            <select className="input" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
              <option value="">All languages ({langs.size})</option>
              {[...langs.entries()]
                .sort((x, y) => x[0].localeCompare(y[0]))
                .map(([l, c]) => (
                  <option key={l} value={l}>
                    {l} ({c})
                  </option>
                ))}
            </select>
          )}
        </div>
      )}
      {groups.length === 0 && <p className="muted small">No names match.</p>}
      {groups.map(([l, ks]) => (
        <Fragment key={l}>
          <h4 className="lang-head">
            {l || 'No language'} <span className="muted">{ks.length}</span>
          </h4>
          <ul className="name-list">
            {ks.map((k) => (
              <li
                key={k}
                className={'name-item' + (nameHit?.[k] ? ' is-hit' : '')}
                onDoubleClick={() => copy(ds.raw.nameText[k], 'name')}
              >
                <span className="name-item-text">
                  <Highlight text={ds.raw.nameText[k]} tokens={hlTokens} />
                  {ds.raw.namePref[k] ? <span className="tag tag-pref">Preferred</span> : null}
                  {ds.source(k) && <span className="name-source">{ds.source(k)}</span>}
                </span>
                <CopyButton value={ds.raw.nameText[k]} what="name" className="name-copy" />
              </li>
            ))}
          </ul>
        </Fragment>
      ))}
    </section>
  );
}
