import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  ALL_EXPORT_COLUMNS,
  COL,
  COLUMNS,
  DEFAULT_TABLE_COLUMNS,
  buildNamesTable,
  buildTable,
  type ColKey,
  type RowCtx,
} from '../data/columns';
import { warmupTasks, type Dataset, type SortKey } from '../data/dataset';
import { activeFilterCount, compute, DEFAULT_DIR, sortResults, type Filters, type SortState } from '../data/filter';
import type { DatasetInfo } from '../data/loader';
import { highlightTokens, ID_LABEL, parseQuery, runText } from '../data/search';
import { download, stamp, toCSV, toHTML, toJSON, toMarkdown, toTSV } from '../lib/export';
import { fmtBytes, fmtDateObj, fmtInt, plural } from '../lib/format';
import { useStored } from '../lib/storage';
import { useLists, type SavedList, type SavedView } from '../lib/collections';
import { renderMany } from '../lib/template';
import { buildHash, parseHash, readHash, writeHash, type View } from '../lib/urlState';
import type { Settings } from '../settings';
import { Swatch, shortType } from '../ui/bits';
import {
  IconColumns,
  IconCopy,
  IconFile,
  IconFlask,
  IconKeyboard,
  IconList,
  IconMoon,
  IconPin,
  IconSliders,
  IconSun,
  IconX,
} from '../ui/icons';
import { MenuButton, MenuPopover, type MenuItem } from '../ui/Menu';
import { useToast } from '../ui/toast';
import { DetailPanel } from './DetailPanel';
import { FilterPanel } from './FilterPanel';
import { HelpDialog } from './HelpDialog';
import { overall, type LoadState } from './LoadScreen';
import { LookupView } from './LookupView';
import { ListsDrawer } from './ListsDrawer';
import { ResultsTable } from './ResultsTable';
import { SearchBox } from './SearchBox';
import { TemplatesDialog } from './TemplatesDialog';
import { describeView, ViewsDialog } from './ViewsDialog';

interface Props {
  ds: Dataset;
  settings: Settings;
  setSettings: (s: Settings | ((p: Settings) => Settings)) => void;
  available: DatasetInfo[];
  onOpenRemote: (name: string) => void;
  onOpenFile: (f: File) => void;
  loadState: LoadState;
  busy: boolean;
}

const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
};

const HTML_COPY_LIMIT = 20000;

export function Browser({ ds, settings, setSettings, available, onOpenRemote, onOpenFile, loadState, busy }: Props) {
  const { copy, toast } = useToast();
  const initial = useMemo(() => readHash(), []);
  const [q, setQ] = useState(initial.q);
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [sort, setSort] = useState<SortState>(initial.sort);
  const [active, setActive] = useState<number | null>(() => (initial.sel ? (ds.byId(initial.sel) ?? null) : null));
  const [view, setView] = useState<View>(initial.view);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const anchor = useRef<number | null>(null);
  const lists = useLists();
  const [views, setViews] = useStored<SavedView[]>('views', []);
  const [lookupText, setLookupText] = useStored<string>('lookupText', '');
  const [helpOpen, setHelpOpen] = useState(false);
  const [listsOpen, setListsOpen] = useState<boolean | 'rename'>(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ s: number; x: number; y: number } | null>(null);
  const [history, setHistory] = useState(0);
  const pushNext = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const pinnedSet = lists.activeSet;
  const fuzzy = settings.searchMode === 'fuzzy';

  // Build the search indexes while the user is still reading the first screen.
  useEffect(() => {
    const tasks = warmupTasks(ds);
    let handle = 0;
    const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 30));
    const cic = window.cancelIdleCallback ?? window.clearTimeout;
    const next = () => {
      const t = tasks.shift();
      if (!t) return;
      t();
      handle = ric(next);
    };
    handle = ric(next);
    return () => cic(handle);
  }, [ds]);

  // ---- URL <-> state -------------------------------------------------------
  useEffect(() => {
    const push = pushNext.current;
    pushNext.current = false;
    writeHash({ q, filters, sort, sel: active !== null ? ds.f.id[active] : null, view }, push);
  }, [q, filters, sort, active, view, ds]);

  useEffect(() => {
    const on = () => {
      const st = readHash();
      setQ(st.q);
      setFilters(st.filters);
      setSort(st.sort);
      setActive(st.sel ? (ds.byId(st.sel) ?? null) : null);
      setView(st.view);
      setHistory((h) => Math.max(0, h - 1));
    };
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, [ds]);

  // ---- Search pipeline -----------------------------------------------------
  const dq = useDeferredValue(q);
  const df = useDeferredValue(filters);
  const pq = useMemo(() => parseQuery(dq), [dq]);
  const text = useMemo(() => runText(ds, pq, fuzzy), [ds, pq, fuzzy]);
  const computed = useMemo(() => compute(ds, text, df), [ds, text, df]);
  const searching = !pq.empty;
  const rows = useMemo(() => sortResults(ds, computed, sort, searching), [ds, computed, sort, searching]);
  const tokens = useMemo(() => [...highlightTokens(pq), ...text.fuzzyWords], [pq, text]);
  const ctx: RowCtx = useMemo(() => ({ bestName: computed.bestName }), [computed]);
  const stale = dq !== q || df !== filters;
  const nFilters = activeFilterCount(filters);

  // A new result set clears the selection (sorting keeps it).
  useEffect(() => {
    setSelected((s) => (s.size ? new Set() : s));
    anchor.current = null;
  }, [computed]);

  const selectedRows = useMemo(
    () => (selected.size ? rows.filter((s) => selected.has(s)) : null),
    [rows, selected],
  );
  /** What bulk actions apply to: the selection, or every result. */
  const targets = selectedRows ?? rows;

  // ---- Actions ---------------------------------------------------------------
  const openSub = useCallback((s: number) => {
    pushNext.current = true;
    setHistory((h) => h + 1);
    setActive(s);
  }, []);

  const listName = lists.active.name;
  const togglePin = useCallback(
    (s: number) => {
      const id = ds.f.id[s];
      if (pinnedSet.has(id)) {
        lists.remove(lists.active.id, [id]);
        toast(`Removed from ${listName}`, { detail: ds.prefName(s), kind: 'info' });
      } else {
        lists.add(lists.active.id, [id]);
        toast(`Added to ${listName}`, { detail: ds.prefName(s), kind: 'info' });
      }
    },
    [ds, pinnedSet, lists, listName, toast],
  );

  const pinMany = (subs: ArrayLike<number>, list: SavedList = lists.active) => {
    const ids = Array.from(subs, (s) => ds.f.id[s]);
    const added = lists.add(list.id, ids);
    toast(`Added ${plural(added, 'substance')} to ${list.name}`, {
      kind: 'info',
      detail: added < ids.length ? `${fmtInt(ids.length - added)} already there` : undefined,
    });
  };

  const copyTemplate = useCallback(
    (i: number, subs: ArrayLike<number>) => {
      const t = settings.templates[i];
      if (!t || !subs.length) return;
      copy(renderMany(t.text, ds, subs, ctx), subs.length === 1 ? t.name : `${fmtInt(subs.length)} lines`);
    },
    [settings.templates, ds, ctx, copy],
  );

  const copyTable = useCallback(
    (subs: ArrayLike<number>, cols: ColKey[], what: string) => {
      const t = buildTable(ds, subs, cols, ctx);
      copy(toTSV(t), what, subs.length <= HTML_COPY_LIMIT ? toHTML(t) : undefined);
    },
    [ds, ctx, copy],
  );

  const copyField = useCallback(
    (subs: ArrayLike<number>, key: ColKey, what: string) => {
      const vals = Array.from(subs, (s) => COL[key].get(ds, s, ctx)).filter(Boolean);
      copy(vals.join('\r\n'), `${fmtInt(vals.length)} ${what}`);
    },
    [ds, ctx, copy],
  );

  const copyOne = useCallback(
    (s: number, key: ColKey) => {
      const c = COL[key];
      copy(c.get(ds, s, ctx), key === 'name' ? 'name' : c.label);
    },
    [ds, ctx, copy],
  );

  const toggleSel = useCallback(
    (s: number, range: boolean) => {
      // Read the anchor now: the state updater runs later, after the anchor moves.
      const from = anchor.current;
      setSelected((prev) => {
        const next = new Set(prev);
        if (range && from !== null) {
          const a = rows.indexOf(from);
          const b = rows.indexOf(s);
          if (a >= 0 && b >= 0) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            for (let i = lo; i <= hi; i++) next.add(rows[i]);
            return next;
          }
        }
        if (next.has(s)) next.delete(s);
        else next.add(s);
        return next;
      });
      anchor.current = s;
    },
    [rows],
  );

  const toggleAll = useCallback(() => {
    setSelected((prev) => (prev.size >= rows.length && rows.length ? new Set() : new Set(rows)));
  }, [rows]);

  const onRowClick = useCallback(
    (s: number, e: React.MouseEvent) => {
      if (e.shiftKey) {
        if (anchor.current === null) anchor.current = active ?? s;
        toggleSel(s, true);
        window.getSelection()?.removeAllRanges();
      } else if (e.ctrlKey || e.metaKey) toggleSel(s, false);
      else anchor.current = s;
      setActive(s);
    },
    [active, toggleSel],
  );

  const onSort = useCallback(
    (key: SortKey) =>
      setSort((cur) =>
        cur.key === key || (key === 'name' && cur.key === 'relevance' && !searching)
          ? { key, dir: cur.key === key ? (cur.dir === 'asc' ? 'desc' : 'asc') : 'desc' }
          : { key, dir: DEFAULT_DIR[key] },
      ),
    [searching],
  );

  const onCopyCell = useCallback((v: string, what: string) => copy(v, what), [copy]);
  const onContextMenu = useCallback((s: number, x: number, y: number) => {
    setActive(s);
    setCtxMenu({ s, x, y });
  }, []);

  const move = useCallback(
    (delta: number | 'home' | 'end') => {
      if (!rows.length) return;
      const cur = active === null ? -1 : rows.indexOf(active);
      let i: number;
      if (delta === 'home') i = 0;
      else if (delta === 'end') i = rows.length - 1;
      else if (cur < 0) i = delta > 0 ? 0 : rows.length - 1;
      else i = Math.min(rows.length - 1, Math.max(0, cur + delta));
      setActive(rows[i]);
      return rows[i];
    },
    [rows, active],
  );

  const pageRows = () => Math.max(1, Math.floor((tableRef.current?.clientHeight ?? 600) / (settings.density === 'compact' ? 32 : 50)) - 1);

  const onKeyNav = (e: React.KeyboardEvent) => {
    if (isEditable(e.target)) return;
    let handled = true;
    if (e.key === 'ArrowDown') {
      const s = move(1);
      if (e.shiftKey && s !== undefined) toggleSel(s, true);
    } else if (e.key === 'ArrowUp') {
      const s = move(-1);
      if (e.shiftKey && s !== undefined) toggleSel(s, true);
    } else if (e.key === 'PageDown') move(pageRows());
    else if (e.key === 'PageUp') move(-pageRows());
    else if (e.key === 'Home') move('home');
    else if (e.key === 'End') move('end');
    else if (e.key === ' ' && active !== null) toggleSel(active, false);
    else handled = false;
    if (handled) e.preventDefault();
  };

  const showLookup = (t?: string) => {
    if (t !== undefined) setLookupText(t);
    setView('lookup');
  };

  const showInResults = (ids: string[], label: string) => {
    setFilters((f) => ({ ...f, list: ids, listName: label }));
    setQ('');
    setView('browse');
    setListsOpen(false);
    toast(`Showing ${plural(ids.length, 'substance')} from ${label}`, { kind: 'info' });
  };

  const applyView = (v: SavedView) => {
    const st = parseHash(v.hash);
    setQ(st.q);
    setFilters(st.filters);
    setSort(st.sort);
    setSettings((x) => ({ ...x, searchMode: v.fuzzy ? 'fuzzy' : 'exact' }));
    setView('browse');
    setViewsOpen(false);
    toast(`Showing ${v.name}`, { kind: 'info' });
  };

  // ---- Global keyboard and paste --------------------------------------------
  const keyState = useRef({ active, selectedRows, rows, view });
  keyState.current = { active, selectedRows, rows, view };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Already handled by a focused component (e.g. arrow keys in the table).
      if (e.defaultPrevented) return;
      if (document.querySelector('.menu, .drawer, .dialog')) return;
      const { active: a, selectedRows: sel, rows: rs } = keyState.current;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (isEditable(e.target)) return;
      if (e.key === '/' && !mod) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a' && keyState.current.view === 'browse') {
        e.preventDefault();
        setSelected(new Set(rs));
        return;
      }
      if (mod && e.key.toLowerCase() === 'c') {
        const textSel = window.getSelection()?.toString();
        if (textSel) return; // let the browser copy highlighted text
        const subs = sel ?? (a !== null ? [a] : null);
        if (subs && subs.length) {
          e.preventDefault();
          copyTable(subs, settings.columns, subs.length === 1 ? 'row' : `${fmtInt(subs.length)} rows`);
        }
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === 'Escape') {
        if (sel) setSelected(new Set());
        else if (a !== null) setActive(null);
        else if (q) setQ('');
        return;
      }
      if (e.key === '?') {
        setHelpOpen(true);
        return;
      }
      if (e.key === 'l' || e.key === 'L') {
        setView((v) => (v === 'lookup' ? 'browse' : 'lookup'));
        return;
      }
      if (a === null) {
        if ((e.key === 'ArrowDown' || e.key === 'j') && keyState.current.view === 'browse' && rs.length) {
          e.preventDefault();
          setActive(rs[0]);
          tableRef.current?.focus();
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (k >= '1' && k <= '9' && k.length === 1) copyTemplate(Number(k) - 1, sel ?? [a]);
      else if (k === 'n') copyOne(a, 'name');
      else if (k === 'i') copyOne(a, 'id');
      else if (k === 'e') copyOne(a, 'ev');
      else if (k === 'u') copyOne(a, 'unii');
      else if (k === 'p') togglePin(a);
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && keyState.current.view === 'browse') {
        e.preventDefault();
        tableRef.current?.focus();
        move(e.key === 'ArrowDown' ? 1 : -1);
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target) || document.querySelector('.menu, .drawer, .dialog')) return;
      const t = e.clipboardData?.getData('text/plain') ?? '';
      if (!t.trim()) return;
      e.preventDefault();
      const lines = t.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length > 1) {
        showLookup(t);
        toast(`Pasted ${fmtInt(lines.length)} lines into the lookup list`, { kind: 'info' });
      } else {
        setView('browse');
        setQ(lines[0].trim());
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyOne, copyTable, copyTemplate, move, q, settings.columns, togglePin, toast]);

  // ---- Detail pane resize ----------------------------------------------------
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = settings.detailWidth;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const w = Math.min(Math.max(340, startW + (startX - ev.clientX)), Math.min(960, window.innerWidth - 480));
      document.documentElement.style.setProperty('--detail-w', w + 'px');
    };
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      const w = Math.min(Math.max(340, startW + (startX - ev.clientX)), Math.min(960, window.innerWidth - 480));
      setSettings((st) => ({ ...st, detailWidth: w }));
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  };

  useEffect(() => {
    document.documentElement.style.setProperty('--detail-w', settings.detailWidth + 'px');
  }, [settings.detailWidth]);

  // ---- Menus -------------------------------------------------------------------
  const exportItems = (): MenuItem[] => {
    const subs = targets;
    const n = subs.length;
    const visibleCols = settings.columns;
    const withMatched: ColKey[] = searching ? [...visibleCols, 'matched', 'matchedLang'] : visibleCols;
    return [
      { heading: selectedRows ? `${fmtInt(n)} selected` : `All ${fmtInt(n)} results` },
      ...settings.templates.map(
        (t, i): MenuItem => ({ label: t.name, hint: i < 9 ? String(i + 1) : 'template', onSelect: () => copyTemplate(i, subs) }),
      ),
      { label: 'Edit templates…', onSelect: () => setTemplatesOpen(true) },
      'sep',
      { label: 'Table for Excel', hint: 'visible columns', onSelect: () => copyTable(subs, withMatched, `${fmtInt(n)} rows`) },
      { label: 'Table for Excel, all fields', onSelect: () => copyTable(subs, ALL_EXPORT_COLUMNS, `${fmtInt(n)} rows`) },
      'sep',
      { label: 'Preferred names', hint: 'one per line', onSelect: () => copyField(subs, 'name', 'names') },
      { label: 'SMS IDs', hint: 'one per line', onSelect: () => copyField(subs, 'id', 'SMS IDs') },
      { label: 'EV codes', hint: 'one per line', onSelect: () => copyField(subs, 'ev', 'EV codes') },
      { label: 'UNIIs', hint: 'one per line', onSelect: () => copyField(subs, 'unii', 'UNIIs') },
      'sep',
      {
        label: 'As CSV',
        onSelect: () => copy(toCSV(buildTable(ds, subs, withMatched, ctx)), 'CSV'),
      },
      {
        label: 'As Markdown',
        disabled: n > 5000,
        onSelect: () => copy(toMarkdown(buildTable(ds, subs, withMatched, ctx)), 'Markdown table'),
      },
      {
        label: 'As JSON',
        onSelect: () => copy(toJSON(buildTable(ds, subs, ALL_EXPORT_COLUMNS, ctx)), 'JSON'),
      },
      'sep',
      {
        label: 'Download CSV',
        hint: 'visible columns',
        onSelect: () => {
          download(`sms-substances-${stamp()}.csv`, toCSV(buildTable(ds, subs, withMatched, ctx)));
          toast('Downloaded CSV', { detail: plural(n, 'row') });
        },
      },
      {
        label: 'Download CSV, all fields',
        onSelect: () => {
          download(`sms-substances-full-${stamp()}.csv`, toCSV(buildTable(ds, subs, ALL_EXPORT_COLUMNS, ctx)));
          toast('Downloaded CSV', { detail: plural(n, 'row') });
        },
      },
      {
        label: 'Download names CSV',
        hint: 'one row per name',
        onSelect: () => {
          const t = buildNamesTable(ds, subs);
          download(`sms-substance-names-${stamp()}.csv`, toCSV(t));
          toast('Downloaded names CSV', { detail: plural(t.rows.length, 'row') });
        },
      },
      'sep',
      { heading: 'Add to a list' },
      ...lists.lists.map(
        (l): MenuItem => ({
          label: l.name,
          hint: fmtInt(l.ids.length),
          disabled: n > 5000,
          onSelect: () => pinMany(subs, l),
        }),
      ),
      {
        label: 'New list…',
        disabled: n > 5000,
        onSelect: () => {
          const l = lists.create(`List ${lists.lists.length + 1}`);
          pinMany(subs, l);
          setListsOpen('rename');
        },
      },
    ];
  };

  const viewItems = (): MenuItem[] => [
    { heading: 'Theme' },
    ...(['system', 'light', 'dark'] as const).map((t) => ({
      label: t === 'system' ? 'Match system' : t[0].toUpperCase() + t.slice(1),
      checked: settings.theme === t,
      onSelect: () => setSettings((s) => ({ ...s, theme: t })),
    })),
    { heading: 'Rows' },
    {
      label: 'Comfortable',
      checked: settings.density === 'comfortable',
      onSelect: () => setSettings((s) => ({ ...s, density: 'comfortable' })),
    },
    {
      label: 'Compact',
      checked: settings.density === 'compact',
      onSelect: () => setSettings((s) => ({ ...s, density: 'compact' })),
    },
    { heading: 'Structures' },
    {
      label: 'Load structure images from PubChem automatically',
      checked: settings.structures,
      onSelect: () => setSettings((s) => ({ ...s, structures: !s.structures })),
    },
    'sep',
    { label: 'Copy templates…', onSelect: () => setTemplatesOpen(true) },
  ];

  const viewsItems = (): MenuItem[] => [
    { heading: views.length ? 'Saved views' : 'No saved views yet' },
    ...views.map((v): MenuItem => ({ label: v.name, hint: describeView(v), onSelect: () => applyView(v) })),
    'sep',
    { label: 'Save current view…', onSelect: () => setViewsOpen(true) },
    ...(views.length ? [{ label: 'Rename or delete views…', onSelect: () => setViewsOpen(true) } as MenuItem] : []),
  ];

  const columnItems = (): MenuItem[] => [
    ...COLUMNS.filter((c) => c.table && c.key !== 'name').map((c) => ({
      label: c.label,
      checked: settings.columns.includes(c.key),
      keepOpen: true,
      onSelect: () =>
        setSettings((s) => ({
          ...s,
          columns: s.columns.includes(c.key)
            ? s.columns.filter((k) => k !== c.key)
            : COLUMNS.map((x) => x.key).filter((k) => k === c.key || s.columns.includes(k)),
        })),
    })),
    'sep',
    {
      label: 'Reset columns',
      onSelect: () => setSettings((s) => ({ ...s, columns: DEFAULT_TABLE_COLUMNS })),
    },
  ];

  const sortOptions: [SortKey, string][] = [
    ['relevance', 'Best match'],
    ['name', 'Name'],
    ['id', 'SMS ID'],
    ['ev', 'EV code'],
    ['type', 'Substance type'],
    ['updated', 'Last updated'],
    ['created', 'Created'],
    ['mw', 'Molecular weight'],
    ['names', 'Number of names'],
  ];
  const effectiveSort = sort.key === 'relevance' && !searching ? 'name' : sort.key;

  // ---- Active filter chips ---------------------------------------------------------
  const chips: { label: string; onRemove: () => void }[] = [];
  const listChip = (
    k: 'type' | 'domain' | 'status' | 'svg' | 'comment' | 'lang' | 'source',
    prefix: string,
    fmt = (v: string) => v,
  ) =>
    filters[k].forEach((v) =>
      chips.push({
        label: `${prefix}${fmt(v) || 'Not set'}`,
        onRemove: () => setFilters((f) => ({ ...f, [k]: f[k].filter((x) => x !== v) })),
      }),
    );
  if (filters.list)
    chips.push({
      label: `${filters.listName ? filters.listName[0].toUpperCase() + filters.listName.slice(1) : 'In list'} (${fmtInt(filters.list.length)})`,
      onRemove: () => setFilters((f) => ({ ...f, list: null, listName: null })),
    });
  listChip('type', '', shortType);
  listChip('domain', '');
  listChip('lang', 'Language: ');
  listChip('source', 'Source: ');
  if (filters.prefOnly) chips.push({ label: 'Preferred names only', onRemove: () => setFilters((f) => ({ ...f, prefOnly: false })) });
  for (const [k, v] of Object.entries(filters.flags))
    chips.push({
      label:
        k === 'replaced'
          ? v === 'no'
            ? 'Hiding replaced'
            : 'Replaced only'
          : k === 'sharedIk'
            ? v === 'yes'
              ? 'Possible duplicates'
              : 'No possible duplicates'
            : `${v === 'yes' ? 'Has' : 'No'} ${COLUMN_FLAG_LABEL[k] ?? k}`,
      onRemove: () =>
        setFilters((f) => {
          const flags = { ...f.flags };
          delete flags[k as keyof typeof flags];
          return { ...f, flags };
        }),
    });
  const rangeChip = (k: 'created' | 'updated' | 'mw', label: string) => {
    const [a, b] = filters[k];
    if (a || b)
      chips.push({
        label: `${label} ${a && b ? `${a} to ${b}` : a ? `from ${a}` : `up to ${b}`}`,
        onRemove: () => setFilters((f) => ({ ...f, [k]: ['', ''] })),
      });
  };
  rangeChip('updated', 'Updated');
  rangeChip('created', 'Created');
  rangeChip('mw', 'Weight');
  listChip('comment', 'Comment: ', (v) => v || 'No comment');
  listChip('svg', 'SVG flag: ');
  listChip('status', 'Status: ');

  const clearAll = () => {
    setFilters((f) => ({
      ...f,
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
    }));
  };

  const ctxItems = (s: number): MenuItem[] => [
    { heading: ds.prefName(s).slice(0, 48) },
    { label: 'Copy name', hint: 'N', onSelect: () => copyOne(s, 'name') },
    { label: 'Copy SMS ID', hint: 'I', onSelect: () => copyOne(s, 'id') },
    { label: 'Copy EV code', hint: 'E', disabled: !ds.f.ev[s], onSelect: () => copyOne(s, 'ev') },
    { label: 'Copy UNII', hint: 'U', disabled: !ds.f.unii[s], onSelect: () => copyOne(s, 'unii') },
    { label: 'Copy InChIKey', disabled: !ds.f.inchikey[s], onSelect: () => copyOne(s, 'inchikey') },
    {
      label: 'Copy row for Excel',
      hint: 'Ctrl C',
      onSelect: () => copyTable([s], settings.columns, 'row'),
    },
    ...settings.templates.slice(0, 9).map(
      (t, i): MenuItem => ({ label: t.name, hint: String(i + 1), onSelect: () => copyTemplate(i, [s]) }),
    ),
    'sep',
    {
      label: pinnedSet.has(ds.f.id[s]) ? `Remove from ${listName}` : `Add to ${listName}`,
      hint: 'P',
      onSelect: () => togglePin(s),
    },
    { label: selected.has(s) ? 'Deselect' : 'Select', hint: 'Space', onSelect: () => toggleSel(s, false) },
  ];

  const idHitNote = (() => {
    if (!text.idScore || !text.idField) return null;
    // Report which identifier the top hit matched.
    const top = rows[0];
    if (top === undefined || !text.idScore[top]) return null;
    const fk = text.idField[top];
    return fk ? ID_LABEL[fk] : null;
  })();

  const lookupMode = view === 'lookup';
  const showDetail = active !== null;

  return (
    <div className={`app density-${settings.density}`}>
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setQ('');
            clearAll();
            setView('browse');
            setActive(null);
          }}
          title="Start over"
        >
          <IconFlask size={22} />
          <span className="brand-name">Flask</span>
        </a>
        <SearchBox
          value={q}
          onChange={(v) => {
            setQ(v);
            if (lookupMode && v) setView('browse');
          }}
          inputRef={searchRef}
          total={ds.n}
          busy={stale}
          mode={settings.searchMode}
          onModeChange={(m) => setSettings((x) => ({ ...x, searchMode: m }))}
          onEnter={() => {
            if (rows.length) setActive(rows[0]);
          }}
          onArrowDown={() => {
            if (!rows.length) return;
            if (active === null || rows.indexOf(active) < 0) setActive(rows[0]);
            tableRef.current?.focus();
          }}
          onPasteLines={(t) => {
            showLookup(t);
            toast(`Pasted ${fmtInt(t.split(/\r?\n/).filter((l) => l.trim()).length)} lines into the lookup list`, {
              kind: 'info',
            });
          }}
        />
        <nav className="top-actions" aria-label="Tools">
          <button
            type="button"
            className={'btn btn-ghost' + (lookupMode ? ' is-on' : '')}
            aria-pressed={lookupMode}
            onClick={() => setView(lookupMode ? 'browse' : 'lookup')}
            title="Look up a pasted list of IDs or names (L)"
          >
            <IconList size={16} />
            <span className="hide-sm">Lookup list</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setListsOpen(true)}
            title={`Lists. P adds to ${listName}`}
          >
            <IconPin size={16} filled={lists.active.ids.length > 0} />
            <span className="hide-sm top-list-name">{listName}</span>
            {lists.active.ids.length > 0 && <span className="badge">{lists.active.ids.length}</span>}
          </button>
          <MenuButton label="Display settings" items={viewItems} className="btn btn-icon" alignRight title="Display settings">
            {settings.theme === 'dark' ? <IconMoon size={16} /> : settings.theme === 'light' ? <IconSun size={16} /> : <IconSliders size={16} />}
          </MenuButton>
          <button
            type="button"
            className="btn btn-icon"
            onClick={() => setHelpOpen(true)}
            title="Shortcuts and search tips (?)"
            aria-label="Shortcuts and search tips"
          >
            <IconKeyboard size={16} />
          </button>
        </nav>
      </header>

      {busy && (
        <div className="reload-bar" role="progressbar" aria-label={`Loading ${loadState.file ?? ''}`}>
          <div className="bar-fill" style={{ transform: `scaleX(${overall(loadState)})` }} />
        </div>
      )}
      {loadState.phase === 'error' && (
        <div className="banner banner-error" role="alert">
          Couldn't open {loadState.file}: {loadState.error} Still showing {ds.raw.fileName}.
        </div>
      )}

      <div className={'workspace' + (showDetail ? ' has-detail' : '') + (lookupMode ? ' is-lookup' : '')}>
        {lookupMode ? (
          <LookupView
            ds={ds}
            text={lookupText}
            setText={setLookupText}
            columns={settings.lookupColumns}
            setColumns={(c) => setSettings((s) => ({ ...s, lookupColumns: c }))}
            active={active}
            onOpen={openSub}
            onShowInResults={(ids) => showInResults(ids, 'the lookup list')}
            onAddToList={(ids) => {
              const added = lists.add(lists.active.id, ids);
              toast(`Added ${plural(added, 'substance')} to ${listName}`, { kind: 'info' });
            }}
            activeListName={listName}
            onClose={() => setView('browse')}
          />
        ) : (
          <>
            <aside className={'filters' + (filtersOpen ? ' is-open' : '')} aria-label="Filters">
              <FilterPanel
                ds={ds}
                filters={filters}
                setFilters={setFilters}
                counts={computed.counts}
                onClose={filtersOpen ? () => setFiltersOpen(false) : undefined}
              />
            </aside>
            <main className="results">
              <div className="results-head">
                <div className="results-count" aria-live="polite">
                  <strong>{fmtInt(rows.length)}</strong> {rows.length === 1 ? 'substance' : 'substances'}
                  {searching && computed.namesMatched > 0 && (
                    <span className="muted"> from {plural(computed.namesMatched, 'matching name')}</span>
                  )}
                  {fuzzy && text.fuzzyMatches > 0 && (
                    <span className="muted">, including {plural(text.fuzzyMatches, 'close match', 'close matches')}</span>
                  )}
                  {idHitNote && <span className="muted"> matched by {idHitNote}</span>}
                  {pq.error && <span className="error-text"> {pq.error}</span>}
                </div>
                <div className="results-tools">
                  <button type="button" className="btn btn-small show-md" onClick={() => setFiltersOpen(true)}>
                    Filters{nFilters ? ` (${nFilters})` : ''}
                  </button>
                  <MenuButton label="Saved views" items={viewsItems} className="btn btn-small" alignRight title="Saved views">
                    Views{views.length ? ` (${views.length})` : ''}
                  </MenuButton>
                  <label className="sort">
                    <span className="sort-label">Sort</span>
                    <select
                      className="input input-small"
                      value={effectiveSort}
                      onChange={(e) => {
                        const k = e.target.value as SortKey;
                        setSort({ key: k, dir: DEFAULT_DIR[k] });
                      }}
                    >
                      {sortOptions.map(([k, l]) => (
                        <option key={k} value={k} disabled={k === 'relevance' && !searching}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <MenuButton label="Columns" items={columnItems} className="btn btn-small btn-icon-sm" alignRight title="Choose columns">
                    <IconColumns size={15} />
                    <span className="hide-sm">Columns</span>
                  </MenuButton>
                  <MenuButton label="Copy or export" items={exportItems} className="btn btn-small btn-primary" alignRight disabled={!rows.length}>
                    <IconCopy size={15} />
                    {selectedRows ? `Copy ${fmtInt(selectedRows.length)}` : 'Copy all'}
                  </MenuButton>
                </div>
              </div>

              {(chips.length > 0 || selectedRows) && (
                <div className="results-sub">
                  {selectedRows && (
                    <div className="selbar">
                      <span>
                        <strong>{fmtInt(selectedRows.length)}</strong> selected
                      </span>
                      <button type="button" className="link-btn" onClick={() => pinMany(selectedRows)}>
                        Add to {listName}
                      </button>
                      <button type="button" className="link-btn" onClick={() => setSelected(new Set())}>
                        Clear
                      </button>
                    </div>
                  )}
                  {chips.length > 0 && (
                    <div className="chips" aria-label="Active filters">
                      {chips.map((c, i) => (
                        <button key={i} type="button" className="chip is-on removable" onClick={c.onRemove} title="Remove filter">
                          {c.label}
                          <IconX size={12} />
                        </button>
                      ))}
                      {chips.length > 1 && (
                        <button type="button" className="link-btn" onClick={clearAll}>
                          Clear all
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {rows.length > 0 ? (
                <ResultsTable
                  ds={ds}
                  rows={rows}
                  ctx={ctx}
                  matched={computed.matched}
                  text={text}
                  tokens={tokens}
                  columns={settings.columns}
                  density={settings.density}
                  active={active}
                  selected={selected}
                  pinned={pinnedSet}
                  sort={sort}
                  searching={searching}
                  tableRef={tableRef}
                  resetKey={computed}
                  onRowClick={onRowClick}
                  onToggle={toggleSel}
                  onToggleAll={toggleAll}
                  onSort={onSort}
                  onContextMenu={onContextMenu}
                  onCopyCell={onCopyCell}
                  onKeyNav={onKeyNav}
                />
              ) : (
                <div className="no-results">
                  <h2>No substances match</h2>
                  {searching && (
                    <p>
                      Nothing matches <strong>{q}</strong>
                      {nFilters ? ' with the current filters' : ''}. Check the spelling, try fewer words, or search part of a
                      name.
                    </p>
                  )}
                  {!searching && nFilters > 0 && <p>No substance passes every active filter.</p>}
                  <div className="no-results-actions">
                    {searching && !fuzzy && !pq.regex && pq.field === null && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setSettings((x) => ({ ...x, searchMode: 'fuzzy' }))}
                      >
                        Try fuzzy search
                      </button>
                    )}
                    {nFilters > 0 && (
                      <button type="button" className="btn" onClick={clearAll}>
                        Clear filters
                      </button>
                    )}
                    {searching && (
                      <button type="button" className="btn" onClick={() => setQ('')}>
                        Clear search
                      </button>
                    )}
                  </div>
                </div>
              )}
            </main>
          </>
        )}

        {showDetail && (
          <div
            className="resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize details"
            onPointerDown={startResize}
            onDoubleClick={() => setSettings((s) => ({ ...s, detailWidth: 440 }))}
          />
        )}
        <aside className={'detail' + (showDetail ? ' is-open' : '')} aria-label="Substance details">
          {active !== null ? (
            <DetailPanel
              key={active}
              ds={ds}
              s={active}
              tokens={tokens}
              nameHit={text.nameHit}
              pinned={pinnedSet.has(ds.f.id[active])}
              listName={listName}
              templates={settings.templates}
              structures={settings.structures}
              canGoBack={history > 0}
              onBack={() => window.history.back()}
              onTogglePin={() => togglePin(active)}
              onOpen={openSub}
              onClose={() => setActive(null)}
              onSearch={(v) => {
                setQ(v);
                setView('browse');
              }}
            />
          ) : (
            <DetailEmpty ds={ds} onTry={(v) => setQ(v)} />
          )}
        </aside>
        {filtersOpen && <div className="scrim show-md" onClick={() => setFiltersOpen(false)} />}
      </div>

      <footer className="statusbar">
        <MenuButton
          label="Dataset"
          className="status-file"
          title="Switch dataset"
          items={() => [
            { heading: 'Exports in this folder' },
            ...available.map((d) => ({
              label: d.name,
              hint: fmtBytes(d.size),
              checked: d.name === ds.raw.fileName,
              onSelect: () => d.name !== ds.raw.fileName && onOpenRemote(d.name),
            })),
            ...(available.length ? (['sep'] as MenuItem[]) : []),
            { label: 'Open another CSV file…', onSelect: () => fileInput.current?.click() },
          ]}
        >
          <IconFile size={13} />
          {ds.raw.fileName}
        </MenuButton>
        {ds.exportDate && <span>Exported {fmtDateObj(ds.exportDate)}</span>}
        <span>
          {fmtInt(ds.n)} substances, {fmtInt(ds.raw.nameCount)} names
        </span>
        <span className="status-right hide-sm">Drop a newer export anywhere to open it</span>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.gz,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onOpenFile(f);
            e.target.value = '';
          }}
        />
      </footer>

      {ctxMenu && (
        <MenuPopover label="Row actions" items={ctxItems(ctxMenu.s)} at={{ x: ctxMenu.x, y: ctxMenu.y }} onClose={() => setCtxMenu(null)} />
      )}
      {listsOpen && (
        <ListsDrawer
          ds={ds}
          api={lists}
          columns={settings.columns}
          templates={settings.templates}
          onOpen={openSub}
          onShowInResults={(l) => showInResults(l.ids, l.name)}
          onClose={() => setListsOpen(false)}
          startRenaming={listsOpen === 'rename'}
        />
      )}
      {templatesOpen && (
        <TemplatesDialog
          ds={ds}
          sample={active ?? rows[0] ?? null}
          templates={settings.templates}
          setTemplates={(t) => setSettings((x) => ({ ...x, templates: t }))}
          onClose={() => setTemplatesOpen(false)}
        />
      )}
      {viewsOpen && (
        <ViewsDialog
          views={views}
          setViews={setViews}
          currentHash={buildHash({ q, filters, sort, sel: null, view: 'browse' }, { allIds: true })}
          currentFuzzy={fuzzy}
          onApply={applyView}
          onClose={() => setViewsOpen(false)}
        />
      )}
      {helpOpen && (
        <HelpDialog
          onClose={() => setHelpOpen(false)}
          onTry={(v) => {
            setQ(v);
            setView('browse');
            setHelpOpen(false);
          }}
        />
      )}
    </div>
  );
}

const COLUMN_FLAG_LABEL: Record<string, string> = {
  inchikey: 'InChIKey',
  formula: 'formula',
  unii: 'UNII',
  inn: 'INN number',
  ec: 'EC number',
  ev: 'EV code',
  parent: 'parent',
  children: 'children',
  replaced: 'replacement',
  comment: 'comment',
  sharedIk: 'possible duplicate',
};

function DetailEmpty({ ds, onTry }: { ds: Dataset; onTry: (q: string) => void }) {
  const types = ds.type.order.slice(0, 13);
  return (
    <div className="detail-empty">
      <h2>Pick a substance</h2>
      <p>Its identifiers, related substances and every name in every language show up here, ready to copy.</p>
      <h3>Try a search</h3>
      <ul className="try-list">
        {[
          ['paracétamol', 'accents and case ignored'],
          ['SUB12039MIG', 'EV code'],
          ['C15H25NO3', 'molecular formula'],
          ['"hydrochloric acid" -concentrated', 'phrase, minus a word'],
          ['ev:SUB120', 'one field, partial'],
        ].map(([v, d]) => (
          <li key={v}>
            <button type="button" className="try" onClick={() => onTry(v)}>
              {v}
            </button>
            <span className="muted">{d}</span>
          </li>
        ))}
      </ul>
      <h3>In this export</h3>
      <ul className="type-legend">
        {types.map((i) => (
          <li key={i}>
            <Swatch type={ds.type.values[i]} />
            <span>{ds.type.values[i]}</span>
            <span className="muted">{fmtInt(ds.type.totals[i])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
