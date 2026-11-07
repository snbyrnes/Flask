import { unpack } from './pack';
import type { RawDataset, WorkerOut } from './types';

export interface DatasetInfo {
  name: string;
  /** Size of the CSV (uncompressed). */
  size: number;
  modified: number;
  /** Where to fetch it, relative to the page. May be gzipped. */
  url?: string;
}

export type LoadPhase = 'list' | 'download' | 'parse' | 'index';
export type OnProgress = (phase: LoadPhase, fraction: number) => void;

const known = new Map<string, DatasetInfo>();

/**
 * Exports the app can load: datasets.json next to the page, which the dev server
 * generates from the project folder and the build publishes. Empty if unavailable.
 */
export async function listDatasets(): Promise<DatasetInfo[]> {
  try {
    const r = await fetch('datasets.json', { cache: 'no-cache' });
    if (!r.ok) return [];
    const j = await r.json();
    const list: DatasetInfo[] = Array.isArray(j) ? j.filter((d) => d && typeof d.name === 'string') : [];
    known.clear();
    for (const d of list) known.set(d.name, d);
    return list;
  } catch {
    return [];
  }
}

/** Gzip data (published exports are stored as .csv.gz) is decompressed; anything else is returned as is. */
export async function gunzipIfNeeded(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buf;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

export async function downloadDataset(name: string, onProgress: OnProgress): Promise<ArrayBuffer> {
  const url = known.get(name)?.url ?? 'api/datasets/' + encodeURIComponent(name);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not read ${name} (HTTP ${r.status}).`);
  return gunzipIfNeeded(await readBody(r, onProgress));
}

async function readBody(r: Response, onProgress: OnProgress): Promise<ArrayBuffer> {
  const total = Number(r.headers.get('Content-Length')) || 0;
  if (!r.body || !total) return r.arrayBuffer();
  const reader = r.body.getReader();
  const out = new Uint8Array(total);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > out.length) {
      // Server sent more than announced; fall back to concatenation.
      const bigger = new Uint8Array(Math.max(out.length * 2, got + value.length));
      bigger.set(out.subarray(0, got));
      bigger.set(value, got);
      got += value.length;
      return finishGrow(reader, bigger, got);
    }
    out.set(value, got);
    got += value.length;
    onProgress('download', got / total);
  }
  return out.buffer.slice(0, got);
}

async function finishGrow(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buf: Uint8Array,
  got: number,
): Promise<ArrayBuffer> {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > buf.length) {
      const b = new Uint8Array(Math.max(buf.length * 2, got + value.length));
      b.set(buf.subarray(0, got));
      buf = b;
    }
    buf.set(value, got);
    got += value.length;
  }
  return buf.buffer.slice(0, got) as ArrayBuffer;
}

export function parseInWorker(buffer: ArrayBuffer, fileName: string, onProgress: OnProgress): Promise<RawDataset> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const m = ev.data;
      if (m.type === 'progress') onProgress(m.phase, m.fraction);
      else if (m.type === 'done') {
        worker.terminate();
        try {
          resolve(unpack(m.data));
        } catch (e) {
          reject(e);
        }
      } else {
        worker.terminate();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'The parser stopped unexpectedly.'));
    };
    worker.postMessage({ type: 'parse', buffer, fileName }, [buffer]);
  });
}
