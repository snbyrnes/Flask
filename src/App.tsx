import { useCallback, useEffect, useRef, useState } from 'react';
import { Browser } from './components/Browser';
import { LoadScreen, type LoadState } from './components/LoadScreen';
import { Dataset } from './data/dataset';
import { downloadDataset, gunzipIfNeeded, listDatasets, parseInWorker, type DatasetInfo, type LoadPhase } from './data/loader';
import { useStored } from './lib/storage';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { ToastProvider } from './ui/toast';

export default function App() {
  const [settings, setSettings] = useStored<Settings>('settings', DEFAULT_SETTINGS);
  const [ds, setDs] = useState<Dataset | null>(null);
  const [available, setAvailable] = useState<DatasetInfo[]>([]);
  const [load, setLoad] = useState<LoadState>({ phase: 'list', fraction: 0 });
  const [dragging, setDragging] = useState(false);
  const loadSeq = useRef(0);

  // Theme
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
  }, [settings.theme]);

  const run = useCallback(async (label: string, getBuffer: (p: (ph: LoadPhase, f: number) => void) => Promise<ArrayBuffer>) => {
    const seq = ++loadSeq.current;
    const progress = (phase: LoadPhase, fraction: number) => {
      if (seq === loadSeq.current) setLoad({ phase, fraction, file: label });
    };
    try {
      const t0 = performance.now();
      progress('download', 0);
      const buf = await getBuffer(progress);
      const t1 = performance.now();
      progress('parse', 0);
      const raw = await parseInWorker(buf, label, progress);
      if (seq !== loadSeq.current) return;
      const t2 = performance.now();
      const d = new Dataset(raw);
      d.rank('name'); // warm the default sort before first paint
      const t3 = performance.now();
      console.info(
        `[sms] ${label}: read ${(t1 - t0).toFixed(0)} ms, parse ${raw.parseMs.toFixed(0)} ms (+${(t2 - t1 - raw.parseMs).toFixed(0)} ms transfer), index ${(t3 - t2).toFixed(0)} ms`,
      );
      setDs(d);
      setLoad({ phase: 'ready', fraction: 1, file: label });
      document.title = `SMS Substances (${d.n.toLocaleString('en')})`;
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setLoad({ phase: 'error', fraction: 0, file: label, error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const openRemote = useCallback(
    (name: string) => run(name, (p) => downloadDataset(name, p)),
    [run],
  );

  const openFile = useCallback(
    (file: File) => {
      if (!/\.(csv|txt)(\.gz)?$/i.test(file.name)) {
        setLoad((l) => ({ ...l, notice: `${file.name} is not a CSV file. Drop an SMS substances export (.csv).` }));
        return;
      }
      run(file.name.replace(/\.gz$/i, ''), async (p) => {
        p('download', 1);
        return gunzipIfNeeded(await file.arrayBuffer());
      });
    },
    [run],
  );

  useEffect(() => {
    (async () => {
      const list = await listDatasets();
      setAvailable(list);
      if (list.length) openRemote(list[0].name);
      else setLoad({ phase: 'empty', fraction: 0 });
    })();
  }, [openRemote]);

  // Drag and drop a CSV anywhere on the window.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) openFile(f);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [openFile]);

  const busy = load.phase !== 'ready' && load.phase !== 'empty' && load.phase !== 'error';

  return (
    <ToastProvider>
      {ds ? (
        <Browser
          key={ds.raw.fileName + ds.n}
          ds={ds}
          settings={settings}
          setSettings={setSettings}
          available={available}
          onOpenRemote={openRemote}
          onOpenFile={openFile}
          loadState={load}
          busy={busy}
        />
      ) : (
        <LoadScreen load={load} available={available} onOpenRemote={openRemote} onOpenFile={openFile} />
      )}
      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-card">
            <strong>Drop to open this export</strong>
            <span>Any SMS substances list CSV works. Nothing leaves your computer.</span>
          </div>
        </div>
      )}
    </ToastProvider>
  );
}
