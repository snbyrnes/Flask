import { useRef } from 'react';
import type { DatasetInfo, LoadPhase } from '../data/loader';
import { fmtBytes } from '../lib/format';
import { IconFile, IconFlask } from '../ui/icons';

export interface LoadState {
  phase: LoadPhase | 'ready' | 'empty' | 'error';
  fraction: number;
  file?: string;
  error?: string;
  notice?: string;
}

const PHASE_TEXT: Record<string, string> = {
  list: 'Looking for exports',
  download: 'Reading file',
  parse: 'Parsing rows',
  index: 'Building the search index',
};

/** Overall progress across phases, so the bar moves forward only. */
export function overall(l: LoadState) {
  const w: Record<string, [number, number]> = {
    list: [0, 0.02],
    download: [0.02, 0.25],
    parse: [0.25, 0.85],
    index: [0.85, 1],
  };
  const [a, b] = w[l.phase] ?? [1, 1];
  return a + (b - a) * Math.min(1, Math.max(0, l.fraction));
}

export function LoadScreen({
  load,
  available,
  onOpenRemote,
  onOpenFile,
}: {
  load: LoadState;
  available: DatasetInfo[];
  onOpenRemote: (name: string) => void;
  onOpenFile: (f: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const loading = load.phase in PHASE_TEXT;
  return (
    <div className="load-screen">
      <div className="load-card">
        <div className="load-brand">
          <IconFlask size={28} />
          <h1>SMS Substances</h1>
        </div>

        {loading && (
          <div className="load-progress" aria-live="polite">
            <p className="load-file">{load.file ?? ' '}</p>
            <div
              className="bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(overall(load) * 100)}
            >
              <div className="bar-fill" style={{ transform: `scaleX(${overall(load)})` }} />
            </div>
            <p className="load-phase">{PHASE_TEXT[load.phase]}</p>
          </div>
        )}

        {load.phase === 'error' && (
          <div className="load-error" role="alert">
            <strong>{load.file ? `Couldn't open ${load.file}` : "Couldn't open the file"}</strong>
            <p>{load.error}</p>
          </div>
        )}

        {(load.phase === 'empty' || load.phase === 'error') && (
          <>
            {load.phase === 'empty' && (
              <p className="load-lead">
                Open an SMS substances list export to start. The file is read in your browser and isn't uploaded.
                {import.meta.env.DEV && ' Put the CSV in the project folder or ./data to have it load automatically.'}
              </p>
            )}
            {load.notice && <p className="load-notice">{load.notice}</p>}
            <div className="load-actions">
              <button type="button" className="btn btn-primary" onClick={() => input.current?.click()}>
                <IconFile size={16} /> Open a CSV export
              </button>
              <span className="load-or">or drop it anywhere on this window</span>
            </div>
            {available.length > 0 && (
              <ul className="load-list">
                {available.map((d) => (
                  <li key={d.name}>
                    <button type="button" className="link-btn" onClick={() => onOpenRemote(d.name)}>
                      {d.name}
                    </button>
                    <span className="muted">{fmtBytes(d.size)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <input
          ref={input}
          type="file"
          accept=".csv,.gz,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onOpenFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
